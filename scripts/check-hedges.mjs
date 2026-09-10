import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname } from 'node:path';
import ts from 'typescript';
import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WebGLAttributes } from 'three/src/renderers/webgl/WebGLAttributes.js';
import { WebGLGeometries } from 'three/src/renderers/webgl/WebGLGeometries.js';
import { WebGLObjects } from 'three/src/renderers/webgl/WebGLObjects.js';

// Build the live campus once for its current hedge placements. GLB geometry,
// materials, ForegroundTrees ownership and Rapier are real. Texture image decode
// and raw GL calls are fixtures; no browser, network, GPU drawing or timing.
const game = new URL('../', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = new Map();
function source(url) {
  const bytes = readFileSync(url);
  sources.set(url.href, hash(bytes));
  return bytes;
}
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL && !/\.[a-z]+$/i.test(specifier)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.endsWith('.ts')) return next(url, context);
    return { format: 'module', shortCircuit: true, source: ts.transpileModule(
      source(new URL(url)).toString('utf8'),
      { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } },
    ).outputText };
  },
});
const { buildHedgeBatches, hedgeCells } = await import('../lib/campus/hedge-batches.ts');
const { ForegroundTrees } = await import('../lib/campus/foreground-trees.ts');
const { SpeedwayWalkway } = await import('../lib/campus/walkway.ts');
const { Terrain } = await import('../lib/campus/terrain.ts');
const checks = [];
function check(name, fn) {
  try { const details = fn(); checks.push({ name, passed: true, details }); }
  catch (error) { checks.push({ name, passed: false, error: error.stack }); }
}
function track(resource, records, kind) {
  if (records.has(resource)) return;
  const record = { kind, name: resource.name, disposals: 0 };
  records.set(resource, record);
  resource.addEventListener('dispose', () => record.disposals++);
}
function trackedMaterials(scene, records) {
  scene.traverse(object => {
    if (!object.isMesh) return;
    track(object.geometry, records, 'geometry');
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      track(material, records, 'material');
      for (const value of Object.values(material)) if (value?.isTexture) track(value, records, 'texture');
    }
  });
}
function glBufferFixture(batches) {
  const allocated = new Set(), deleted = new Set(), releasedObjects = new Set(), releasedGeometries = new Set();
  const gl = {
    ARRAY_BUFFER: 34962, FLOAT: 5126,
    createBuffer() { const buffer = {}; allocated.add(buffer); return buffer; },
    bindBuffer() {}, bufferData() {},
    deleteBuffer(buffer) { assert(allocated.has(buffer)); assert(!deleted.has(buffer), 'GL buffer deleted twice'); deleted.add(buffer); },
  };
  const info = { memory: { geometries: 0 }, render: { frame: 1 } };
  const states = {
    releaseStatesOfObject(object) { assert(!releasedObjects.has(object)); releasedObjects.add(object); },
    releaseStatesOfGeometry(geometry) { assert(!releasedGeometries.has(geometry)); releasedGeometries.add(geometry); },
  };
  const attributes = WebGLAttributes(gl), geometries = WebGLGeometries(gl, attributes, info, states);
  const objects = WebGLObjects(gl, geometries, attributes, states, info);
  for (const batch of batches) objects.update(batch);
  return { allocated, deleted, releasedObjects, releasedGeometries, attributes, objects, info };
}

const resources = new Map(), loaded = new Map();
const textureLoad = Object.getOwnPropertyDescriptor(T.TextureLoader.prototype, 'load');
const gltfLoad = Object.getOwnPropertyDescriptor(GLTFLoader.prototype, 'loadAsync');
let walkway, world, owner, glBuffers;
let statistics, bounds, normals, colliderCount, glSummary, resourceSummary;
try {
  await RAPIER.init();
  world = new RAPIER.World({ x: 0, y: -24, z: 0 });
  T.TextureLoader.prototype.load = () => new T.Texture();
  walkway = new SpeedwayWalkway(
    JSON.parse(source(new URL('public/data/campus.json', game))),
    new Terrain(JSON.parse(source(new URL('public/data/terrain.json', game)))),
    world, { capabilities: { getMaxAnisotropy: () => 8 } }, true,
  );
  Object.defineProperty(T.TextureLoader.prototype, 'load', textureLoad);
  const hedges = walkway.hedgePlacements, originalPlacements = JSON.stringify(hedges);
  assert(hedges.length > 0, 'Current full-campus construction must produce hedges');
  // The former renderer used this exact sampling; it is independent of the live helper.
  const reference = hedges.flatMap(strip => {
    const count = Math.ceil(Math.hypot(strip.b[0] - strip.a[0], strip.b[1] - strip.a[1]) / .8);
    return Array.from({ length: count }, (_, i) => {
      const t = (i + .5) / count;
      return { x: T.MathUtils.lerp(strip.a[0], strip.b[0], t), z: T.MathUtils.lerp(strip.a[1], strip.b[1], t),
        y: T.MathUtils.lerp(strip.y, strip.endY, t), width: strip.width, height: strip.height };
    });
  });
  const beforeColliders = new Set(); world.colliders.forEach(collider => beforeColliders.add(collider.handle));
  GLTFLoader.prototype.loadAsync = async url => {
    assert.match(url, /^\/assets\/foreground-tree\/(near|mid|far)\.glb$/);
    const bytes = source(new URL(`public${url}`, game));
    const loader = new GLTFLoader();
    // GLTFLoader still parses the real mesh/material/texture bindings; only image
    // decoding is replaced with 1x1 data so this remains a node-only regression.
    loader.register(parser => ({ name: 'UT_TEST_TEXTURE_IMAGE', loadTexture(index) {
      const texture = new T.DataTexture(new Uint8Array([72, 110, 45, 255]), 1, 1);
      texture.name = parser.json.textures[index].name ?? `Fixture image ${index}`;
      texture.flipY = false;
      return Promise.resolve(texture);
    } }));
    const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    trackedMaterials(gltf.scene, resources); loaded.set(url, gltf);
    return gltf;
  };
  owner = walkway.trees;
  assert(owner instanceof ForegroundTrees, 'Use the actual full-campus foreground owner');
  // One real tree also exercises the shared source maps and tree trunk lifecycle.
  // Loading hundreds of unrelated trunks adds no hedge coverage.
  await owner.load(walkway.treePlacements.slice(0, 1), hedges);
  if (gltfLoad) Object.defineProperty(GLTFLoader.prototype, 'loadAsync', gltfLoad);
  else delete GLTFLoader.prototype.loadAsync;
  const batches = owner.group.children.filter(object => object.isInstancedMesh);
  assert(batches.length > 0);
  const geometry = batches[0].geometry, material = batches[0].material;
  const cells = hedgeCells(hedges), actualColliders = [];
  world.colliders.forEach(collider => {
    if (!beforeColliders.has(collider.handle) && collider.shapeType() === RAPIER.ShapeType.Cuboid) actualColliders.push(collider);
  });
  const leafSource = [...resources.keys()].find(resource => resource.isMaterial && resource.name.includes('leaves') && resources.get(resource).disposals === 0);
  assert(leafSource?.map);
  const farBytes = readFileSync(new URL('public/assets/foreground-tree/far.glb', game));
  const far = JSON.parse(farBytes.subarray(20, 20 + farBytes.readUInt32LE(12)));
  const oldLeaf = far.meshes.flatMap(mesh => mesh.primitives).find(primitive => far.materials[primitive.material].name.includes('leaves'));
  const oldTriangles = far.accessors[oldLeaf.indices].count / 3;
  statistics = { hedges: hedges.length, cells: cells.length, beforeTrianglesPerCell: oldTriangles,
    beforeAllInstanceTriangles: oldTriangles * cells.length, after: owner.hedgeStats,
    triangleReduction: 1 - owner.hedgeStats.trianglesPerCell / oldTriangles };

  check('Every live campus hedge cell and graded center is retained', () => {
    assert.deepEqual(cells, reference); assert.equal(JSON.stringify(hedges), originalPlacements); assert.deepEqual(hedgeCells([]), []);
    assert.equal(owner.hedgeStats.hedgeStrips, hedges.length); assert.equal(owner.hedgeStats.cells, reference.length);
    return { strips: hedges.length, cells: cells.length };
  });
  check('Live batches cover every cell once with matching bounds and useful spatial culling', () => {
    const seen = new Set(), matrix = new T.Matrix4(), worldMatrix = new T.Matrix4(), box = new T.Box3();
    const largest = new T.Vector3(); let maxError = 0;
    const maxWidth = Math.max(...cells.map(cell => cell.width));
    for (const batch of batches) {
      batch.updateWorldMatrix(true, false); assert(batch.frustumCulled); assert(batch.boundingSphere && batch.boundingBox);
      assert.equal(batch.geometry, geometry); assert.equal(batch.material, material);
      const size = batch.boundingBox.getSize(new T.Vector3()); largest.max(size);
      assert(size.x <= owner.hedgeStats.gridMetres + maxWidth + .001 && size.z <= owner.hedgeStats.gridMetres + maxWidth + .001);
      for (let i = 0; i < batch.count; i++) {
        const index = batch.userData.hedgeCellIndices[i]; assert(!seen.has(index)); seen.add(index);
        const cell = reference[index]; assert(cell); batch.getMatrixAt(i, matrix);
        worldMatrix.multiplyMatrices(batch.matrixWorld, matrix); box.copy(geometry.boundingBox).applyMatrix4(worldMatrix);
        const expected = new T.Box3(new T.Vector3(cell.x - cell.width / 2, cell.y, cell.z - cell.width / 2),
          new T.Vector3(cell.x + cell.width / 2, cell.y + cell.height, cell.z + cell.width / 2));
        const error = Math.max(box.min.distanceTo(expected.min), box.max.distanceTo(expected.max)); maxError = Math.max(maxError, error);
        assert(error < .00003, `Cell ${index}: envelope differs by ${error} m`);
        assert(batch.boundingBox.containsBox(geometry.boundingBox.clone().applyMatrix4(matrix)));
      }
    }
    assert.equal(seen.size, cells.length); assert.equal(owner.hedgeStats.batches, batches.length);
    bounds = { maxCellErrorMetres: maxError, maxBatchDimensions: largest.toArray() }; return bounds;
  });
  check('Live hedge geometry is finite, nondegenerate, correctly oriented and compact', () => {
    for (const attribute of Object.values(geometry.attributes)) assert([...attribute.array].every(Number.isFinite));
    const p = geometry.attributes.position, n = geometry.attributes.normal;
    const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), normal = new T.Vector3();
    let minArea = Infinity, minAgreement = Infinity;
    for (let i = 0; i < p.count; i += 3) {
      a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
      const face = b.sub(a).cross(c.sub(a)); minArea = Math.min(minArea, face.length() / 2); assert(face.lengthSq() > 1e-14);
      normal.set(n.getX(i) + n.getX(i + 1) + n.getX(i + 2), n.getY(i) + n.getY(i + 1) + n.getY(i + 2), n.getZ(i) + n.getZ(i + 1) + n.getZ(i + 2)).normalize();
      minAgreement = Math.min(minAgreement, face.normalize().dot(normal));
    }
    assert(minAgreement > .35); assert(p.count / 3 <= oldTriangles * .7);
    assert.equal(owner.hedgeStats.trianglesPerCell, p.count / 3);
    assert.equal(owner.hedgeStats.totalInstanceTriangles, p.count / 3 * cells.length);
    normals = { minTriangleArea: minArea, minNormalAgreement: minAgreement }; return normals;
  });
  check('Live clustered shrubs consist entirely of small leaves with no solid core faces', () => {
    const leafCount = geometry.userData.leafCount, leafVertices = geometry.userData.leafVertexStride;
    assert(Number.isInteger(leafCount) && leafCount > 0); assert.equal(leafVertices, 12);
    assert.equal(geometry.userData.coreTriangles, 0, 'Do not restore an opaque box or sphere core');
    assert(geometry.userData.clusterCount >= 3, 'Keep overlapping irregular foliage clusters');
    const position = geometry.attributes.position;
    assert.equal(position.count, leafCount * leafVertices, 'Every rendered face must belong to a leaf');
    assert.equal(geometry.userData.leafTriangles, position.count / 3);
    const sizes = [...new Map(cells.map(cell => [`${cell.width},${cell.height}`, [cell.width, cell.height]])).values()];
    const diameters = [];
    // Inspect each actual leaf fan at every authored width/height combination.
    // This catches large hidden faces or a return to oversized cabbage leaves.
    for (let leaf = 0; leaf < leafCount; leaf++) {
      for (const [width, height] of sizes) {
        const scale = new T.Vector3(width, height, width);
        const points = Array.from({ length: leafVertices }, (_, i) => new T.Vector3().fromBufferAttribute(position, leaf * leafVertices + i).multiply(scale));
        let diameter = 0;
        for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) diameter = Math.max(diameter, points[i].distanceTo(points[j]));
        diameters.push(diameter);
      }
    }
    diameters.sort((a, b) => a - b);
    assert(diameters.at(-1) < .085, 'Hedge leaves must not return to cabbage scale');
    return { coreTriangles: geometry.userData.coreTriangles, clusters: geometry.userData.clusterCount,
      leafCountPerCell: leafCount, medianDiameterMetres: diameters[Math.floor(diameters.length * .5)],
      p90DiameterMetres: diameters[Math.floor(diameters.length * .9)], maxDiameterMetres: diameters.at(-1) };
  });
  check('Actual owner collider buffers match the former hedge sampling', () => {
    const referenceWorld = new RAPIER.World({ x: 0, y: -24, z: 0 });
    try {
      assert.equal(actualColliders.length, reference.length);
      const key = collider => JSON.stringify([collider.translation(), collider.halfExtents(), collider.rotation()]);
      const expected = reference.map(cell => referenceWorld.createCollider(RAPIER.ColliderDesc.cuboid(cell.width * .43, cell.height * .45, cell.width * .43)
        .setTranslation(cell.x, cell.y + cell.height * .45, cell.z)));
      assert.deepEqual(actualColliders.map(key).sort(), expected.map(key).sort());
      colliderCount = actualColliders.length; return { exactColliderMatches: colliderCount };
    } finally { referenceWorld.free(); }
  });
  check('Real GLB diffuse/normal maps are shared by a matte hedge clone without changing tree materials', () => {
    assert.notEqual(material, leafSource); assert.equal(material.transparent, false); assert.equal(material.opacity, 1);
    assert.equal(material.depthWrite, true); assert.equal(material.side, T.DoubleSide); assert.equal(leafSource.transparent, true);
    assert.equal(material.roughnessMap, null); assert.equal(material.metalnessMap, null);
    assert(material.roughness >= .9); assert(material.normalScale.length() < .3);
    assert(leafSource.roughnessMap && leafSource.metalnessMap, 'Tree ARM source remains intact');
    const textures = new Set();
    for (const field of ['map', 'normalMap']) {
      assert.equal(material[field], leafSource[field]); assert(material[field]); textures.add(material[field]);
      assert.equal(resources.get(material[field]).disposals, 0);
    }
    assert.equal(owner.hedgeStats.borrowedTextures, textures.size);
    const lod = owner.group.children.find(object => object.isLOD); assert(lod);
    assert.deepEqual(lod.levels.map(level => level.distance), [0, 24, 65]);
    assert.equal(loaded.size, 3); return { uniqueBorrowedTextures: textures.size, realGlbsParsed: loaded.size, representativeTree: true };
  });
  check('Standalone hedge disposal preserves the borrowed source textures', () => {
    const asset = buildHedgeBatches(hedges.slice(0, 1), leafSource), own = new Map();
    for (const batch of asset.batches) track(batch, own, 'instance');
    track(asset.geometry, own, 'geometry'); track(asset.material, own, 'material');
    asset.dispose(); asset.dispose();
    assert([...own.values()].every(record => record.disposals === 1));
    for (const field of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) assert.equal(resources.get(leafSource[field]).disposals, 0);
    return { ownedResourcesDisposedOnce: own.size, borrowedTexturesDisposed: 0 };
  });
  track(geometry, resources, 'geometry'); track(material, resources, 'material');
  for (const batch of batches) track(batch, resources, 'instance');
  glBuffers = glBufferFixture(batches);
  check('Installed renderer registers one shared geometry and all instance buffers', () => {
    assert.equal(glBuffers.info.memory.geometries, 1);
    assert.equal(glBuffers.allocated.size, Object.keys(geometry.attributes).length + batches.length * 2);
    for (const batch of batches) {
      assert(glBuffers.attributes.get(batch.instanceMatrix)); assert(glBuffers.attributes.get(batch.instanceColor));
    }
    return { registeredGeometries: glBuffers.info.memory.geometries, buffers: glBuffers.allocated.size };
  });
  owner.dispose(); owner.dispose();
  check('Actual foreground teardown releases shared textures, materials, geometry and Rapier colliders once', () => {
    assert([...resources.values()].every(record => record.disposals === 1), JSON.stringify([...resources.values()].filter(record => record.disposals !== 1)));
    assert.equal(owner.group.parent, null); assert.equal(world.colliders.len(), beforeColliders.size);
    resourceSummary = Object.fromEntries(['texture', 'material', 'geometry', 'instance'].map(kind => [kind,
      [...resources.values()].filter(record => record.kind === kind).length]));
    return { disposedOnce: resourceSummary, remainingForegroundColliders: 0 };
  });
  check('Actual Three renderer disposal listeners free geometry and instance GL buffers once', () => {
    assert.equal(glBuffers.deleted.size, glBuffers.allocated.size); assert.equal(glBuffers.info.memory.geometries, 0);
    assert.equal(glBuffers.releasedObjects.size, batches.length); assert.equal(glBuffers.releasedGeometries.size, 1);
    for (const batch of batches) { assert.equal(glBuffers.attributes.get(batch.instanceMatrix), undefined); assert.equal(glBuffers.attributes.get(batch.instanceColor), undefined); }
    glSummary = { buffersCreated: glBuffers.allocated.size, buffersDeleted: glBuffers.deleted.size,
      objectsReleased: glBuffers.releasedObjects.size, geometriesReleased: glBuffers.releasedGeometries.size };
    return glSummary;
  });
} catch (error) { checks.push({ name: 'Live campus / GLB setup and execution', passed: false, error: error.stack }); }
finally {
  Object.defineProperty(T.TextureLoader.prototype, 'load', textureLoad);
  if (gltfLoad) Object.defineProperty(GLTFLoader.prototype, 'loadAsync', gltfLoad);
  else delete GLTFLoader.prototype.loadAsync;
  glBuffers?.objects.dispose();
  if (walkway && world) walkway.dispose(world);
  world?.free();
}
check('All loaded TypeScript and explicitly read asset sources stayed unchanged during the check', () => {
  for (const [url, digest] of sources) assert.equal(hash(readFileSync(new URL(url))), digest, `Changed during test: ${url}`);
  return { files: sources.size };
});
const result = { passed: checks.every(check => check.passed), threeRevision: T.REVISION, checks,
  statistics, bounds, normals, colliderCount, rendererBufferDisposal: glSummary, ownerDisposal: resourceSummary,
  sources: Object.fromEntries([...sources].map(([url, digest]) => [url.startsWith(game.href) ? url.slice(game.href.length) : url, digest])),
  scope: 'One full live campus build, all live hedge placements, three real parsed GLBs, one representative tree, real ForegroundTrees lifecycle and Rapier colliders. Actual installed Three WebGLAttributes/WebGLGeometries/WebGLObjects cleanup runs against a raw GL call fixture. Image decoding and GL calls are mocked; GPU pixels, frame time and texture GPU upload/deletion require the parent browser check.' };
const output = process.env.UT_HEDGE_EVIDENCE ?? '/tmp/ut-iteration-55/hedges-check.json';
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ passed: result.passed, checks: checks.length, failures: checks.filter(check => !check.passed),
  statistics, rendererBufferDisposal: glSummary, ownerDisposal: resourceSummary, evidence: output }, null, 2));
if (!result.passed) process.exitCode = 1;
