import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire, registerHooks } from 'node:module';
import { createHash } from 'node:crypto';

// Run from the existing game directory. The same validator can load either the
// staged package or the owner's installed module, without editing the game.
const require = createRequire(resolve('package.json'));
const ts = require('typescript');
const threeUrl = pathToFileURL(resolve('node_modules/three/build/three.module.js')).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'three') return { url: threeUrl, shortCircuit: true };
    if (specifier.startsWith('three/addons/')) return { url: pathToFileURL(resolve('node_modules/three/examples/jsm', specifier.slice('three/addons/'.length))).href, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.endsWith('.ts')) return next(url, context);
    return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText };
  },
});
const T = await import(threeUrl);
const RAPIER = await import(pathToFileURL(require.resolve('@dimforge/rapier3d-compat')).href);
const modulePath = process.env.FLAWN_MODULE ?? '../research/flawn-visual-package/lib/campus/flawn-building.ts';
const { buildFlawnBuilding, flawnFootprint } = await import(pathToFileURL(resolve(modulePath)).href);
const { subtractVolumes } = await import(pathToFileURL(resolve('lib/campus/clip-volume.ts')).href);
const built = buildFlawnBuilding();
await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -24, z: 0 });
const scene = new T.Group(), ray = new T.Raycaster();
const checks = [], records = [];
try {
  assert.equal(built.meshes.length, built.colliderGeometries.length);
  assert(built.stats.panels >= 30 && built.stats.panels < 60);
  assert(built.stats.triangles < 160000, 'FAC facade exceeded its geometry budget');
  for (let i = 0; i < built.meshes.length; i++) {
    const mesh = built.meshes[i], g = mesh.geometry;
    assert.equal(g, built.colliderGeometries[i], 'Collision must consume exact visible buffer');
    assert(g.attributes.position.count > 0 && g.attributes.position.count % 3 === 0);
    for (const [name, a] of Object.entries(g.attributes)) assert(Array.from(a.array).every(Number.isFinite), `Nonfinite ${name}`);
    const p = g.attributes.position.array;
    world.createCollider(RAPIER.ColliderDesc.trimesh(p, Uint32Array.from({ length: p.length / 3 }, (_, j) => j), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES));
    scene.add(mesh);
  }
  world.step(); scene.updateWorldMatrix(true, true);
  let maxDifference = 0, recessed = 0;
  for (const witness of built.wallSamples) {
    const origin = new T.Vector3(...witness.origin), direction = new T.Vector3(...witness.direction);
    ray.set(origin, direction); ray.far = 4.3;
    const visible = ray.intersectObject(scene, true)[0];
    const physical = world.castRay(new RAPIER.Ray(origin, direction), 4.3, true);
    assert(visible && physical, `Missing ${witness.kind} at ${witness.origin}`);
    const difference = Math.abs(visible.distance - physical.timeOfImpact);
    assert(difference < .002, `Visible/physical divergence ${difference}`);
    maxDifference = Math.max(difference, maxDifference);
    if (witness.kind === 'recessed ground glazing') {
      assert(visible.distance > 3.1, `Ground glazing lost its physical recess: ${visible.distance} at ${witness.origin}`);
      recessed++;
    }
    records.push({ ...witness, visibleDistance: visible.distance, collisionDistance: physical.timeOfImpact });
  }
  checks.push({ name: 'Visible exterior and physical walls align, including pierced screens, columns, ground glass and roof clerestory', rays: records.length, maxDifference });
  checks.push({ name: 'Ground glass leaves an open colonnade behind the outer piers', recessedBays: recessed });

  // A grid through one tall panel must hit both the near carved web and the
  // deeper glass through its holes. This catches a flat textured replacement
  // that would otherwise pass a single wall/collider ray comparison.
  const screenWitness = built.wallSamples.find(w => w.kind.startsWith('pierced'));
  const inward = new T.Vector3(...screenWitness.direction), along = new T.Vector3(-inward.z, 0, inward.x);
  let openScreenRays = 0, solidScreenRays = 0;
  for (let row = -5; row <= 5; row++) for (let col = -5; col <= 5; col++) {
    const origin = new T.Vector3(...screenWitness.origin).addScaledVector(along, col * .16); origin.y += row * .13;
    ray.set(origin, inward); ray.far = 4;
    const visual = ray.intersectObject(scene, true)[0], physical = world.castRay(new RAPIER.Ray(origin, inward), 4, true);
    assert(visual && physical && Math.abs(visual.distance - physical.timeOfImpact) < .002);
    if (visual.distance > 2.7) openScreenRays++;
    if (visual.distance < 2.3) solidScreenRays++;
  }
  assert(openScreenRays >= 15 && solidScreenRays >= 15, 'Screen must contain deep holes and solid carved webs');
  checks.push({ name: 'Screen has actual open holes through a physical stone lattice', gridRays: 121, openScreenRays, solidScreenRays });

  for (const m of built.materials.filter(m => m.name.includes('coursed') || m.name.includes('ground stone'))) {
    const shader = { vertexShader: '#include <uv_vertex>', fragmentShader: '#include <color_fragment>\n#include <normal_fragment_maps>' };
    m.onBeforeCompile(shader, {}); const first = JSON.stringify(shader); m.onBeforeCompile(shader, {});
    assert.equal(JSON.stringify(shader), first, 'Material hook must be repeat-safe');
    assert(shader.fragmentShader.includes('facBump') && shader.fragmentShader.includes('fwidth'), 'Physical metre masonry detail missing');
  }
  checks.push({ name: 'Metre-scale masonry hooks are idempotent and use antialiased joints/bump' });

  const clipWitness = (x, y, z) => {
    const g = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute([x, y, z, x + .02, y, z, x, y + .02, z + .02], 3));
    g.computeVertexNormals(); const clipped = subtractVolumes(g, new T.Matrix4(), built.volumes);
    const removed = Boolean(clipped && clipped.attributes.position.count === 0);
    clipped?.dispose(); g.dispose(); return removed;
  };
  assert(clipWitness(-310, 25, -20), 'Former FAC interior shell must be removed');
  assert(!clipWitness(-353, 25, 0), 'L-shaped western recess must remain outside scan cut');
  assert(!clipWitness(-369, 25, -70), 'Union service building must remain outside scan cut');
  assert(!clipWitness(-250, 25, -10), 'Tower west frontage must remain outside scan cut');
  assert(!clipWitness(-310, 10, -20), 'Low ground outside replacement elevation must be retained');
  const fpArea = flawnFootprint.reduce((sum, p, i) => sum + p[0] * flawnFootprint[(i + 1) % flawnFootprint.length][1] - flawnFootprint[(i + 1) % flawnFootprint.length][0] * p[1], 0);
  const edge = flawnFootprint.map((a, i) => ({ a, b: flawnFootprint[(i + 1) % flawnFootprint.length] })).sort((a, b) => Math.hypot(b.b[0] - b.a[0], b.b[1] - b.a[1]) - Math.hypot(a.b[0] - a.a[0], a.b[1] - a.a[1]))[0];
  const outward = new T.Vector3(edge.b[1] - edge.a[1], 0, edge.a[0] - edge.b[0]).normalize().multiplyScalar(Math.sign(fpArea));
  const fringe = new T.Vector3((edge.a[0] + edge.b[0]) / 2, 0, (edge.a[1] + edge.b[1]) / 2).addScaledVector(outward, .32);
  assert(!clipWitness(fringe.x, 17.3, fringe.z), 'Registration fringe must preserve adjacent ground');
  assert(clipWitness(fringe.x, 25, fringe.z), 'Registration fringe must remove raised old facade fragments');
  checks.push({ name: 'Replacement cut removes FAC while preserving western plan recess, Union, Tower and lower ground' });
  checks.push({ name: 'External registration fringe removes high scan fragments and preserves the adjacent floor', witnessXZ: [fringe.x, fringe.z] });

  const elevations = [-1, 0, 3.9, 4.24, 14.15, 16.5];
  const variants = buildFlawnBuilding({ baseElevation: 18.1, roofHeight: 17.5 });
  assert.equal(variants.stats.baseElevation, 18.1); assert.equal(variants.stats.roofElevation, 35.6);
  for (const m of variants.meshes) m.geometry.dispose(); for (const m of variants.materials) m.dispose();
  checks.push({ name: 'Explicit elevation/roof configuration supports live alignment without remapping footprint', referenceElevationsAboveBase: elevations });

  const result = { passed: true, sourceSha256: createHash('sha256').update(readFileSync(resolve(modulePath))).digest('hex'), stats: built.stats, footprintVertices: flawnFootprint.length, checks, rays: records, limits: 'Offline authored geometry and Rapier checks only. No source tile integration, ground survey, shader rendering, screenshot or browser controls verified by this test.' };
  const out = process.env.FLAWN_EVIDENCE ?? '../research/flawn-visual-package/offline-check.json';
  mkdirSync(resolve(out, '..'), { recursive: true }); writeFileSync(resolve(out), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ ...result, rays: `${records.length} records in evidence JSON` }, null, 2));
} finally {
  world.free(); for (const m of built.meshes) m.geometry.dispose(); for (const m of built.materials) m.dispose();
}
