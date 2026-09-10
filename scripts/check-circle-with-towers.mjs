import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import * as T from 'three';

registerHooks({ load(url, context, next) {
  if (!url.endsWith('/circle-with-towers.ts')) return next(url, context);
  return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
  }).outputText };
} });
const { buildCircleWithTowers, CIRCLE_WITH_TOWERS_REFERENCE } = await import('../lib/campus/circle-with-towers.ts');
const sculpture = buildCircleWithTowers();
assert.equal(sculpture.stats.towers, 8); assert.equal(sculpture.stats.blocks, 3712);
assert.equal(sculpture.stats.drawCalls, 2); assert(sculpture.stats.triangles < 50000);
assert(sculpture.stats.colliderTriangles < 1000);
for (const g of sculpture.geometries) {
  for (const a of Object.values(g.attributes)) assert([...a.array].every(Number.isFinite), 'finite geometry');
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) assert(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < .001, 'unit normals');
}
const box = sculpture.bounds, size = box.getSize(new T.Vector3());
assert(Math.abs(box.min.y) < 1e-6); assert(Math.abs(box.max.y - CIRCLE_WITH_TOWERS_REFERENCE.heightMetres) < 1e-6);
assert(Math.abs(size.x - CIRCLE_WITH_TOWERS_REFERENCE.diameterMetres) < .006);
assert(Math.abs(size.z - CIRCLE_WITH_TOWERS_REFERENCE.diameterMetres) < .006);
assert(Math.abs(box.min.x + box.max.x) < 1e-6); assert(Math.abs(box.min.z + box.max.z) < 1e-6);
const colliderMaterial = new T.MeshBasicMaterial();
const colliders = sculpture.colliderGeometries.map(g => new T.Mesh(g, colliderMaterial));
for (const mesh of colliders) mesh.updateMatrixWorld();
function cast(origin, direction, targets) {
  return new T.Raycaster(new T.Vector3(...origin), new T.Vector3(...direction), 0, 20).intersectObjects(targets, false);
}
assert.equal(cast([0, 10, 0], [0, -1, 0], colliders).length, 0, 'open centre has no collider');
assert.equal(cast([0, 10, 0], [0, -1, 0], sculpture.meshes).length, 0, 'open centre has no visual cap');
for (const tower of sculpture.towers) {
  const hits = cast([tower.center[0], 10, tower.center[2]], [0, -1, 0], colliders);
  assert(hits.length > 0 && Math.abs(hits[0].point.y - tower.height) < 1e-6, 'tower collider reaches top');
}
const wallZ = (sculpture.footprint.innerRadius + sculpture.footprint.outerRadius) / 2;
const wallHit = cast([0, 10, wallZ], [0, -1, 0], colliders);
assert(wallHit.length > 0 && Math.abs(wallHit[0].point.y - sculpture.footprint.lowWallHeight) < 1e-6, 'low wall height');
const innerHit = cast([0, .4, 0], [0, 0, 1], colliders);
assert(innerHit.length > 0 && Math.abs(innerHit[0].point.z - sculpture.footprint.innerRadius) < 1e-6, 'inward ring normals');
const outsideHit = cast([0, .4, 10], [0, 0, -1], colliders);
assert(outsideHit.length > 0 && Math.abs(outsideHit[0].point.z - sculpture.footprint.outerRadius) < 1e-6, 'outward ring normals');
const source = readFileSync('lib/campus/circle-with-towers.ts', 'utf8');
const report = { sourceSha256: createHash('sha256').update(source).digest('hex'), stats: sculpture.stats,
  bounds: { min: box.min.toArray(), max: box.max.toArray(), size: size.toArray() }, footprint: sculpture.footprint,
  verified: ['finite unit-normal geometry', 'published overall size within 6mm', 'eight towers reach published height',
    'low wall height', 'open centre in render and collider', 'inside and outside ring ray hits', 'idempotent disposal'],
  limits: 'Block sizes/course counts and exact construction are photo-guided estimates. No claim of a surveyed reconstruction or world placement.' };
const disposed = [];
for (const resource of [...sculpture.geometries, ...sculpture.materials]) resource.addEventListener('dispose', () => disposed.push(resource.uuid));
sculpture.dispose(); sculpture.dispose(); assert.equal(disposed.length, sculpture.geometries.length + sculpture.materials.length);
assert.equal(new Set(disposed).size, disposed.length); colliderMaterial.dispose();
const out = '../research/scenery-reference-2026-09-06/surroundings/circle-fixture'; mkdirSync(out, { recursive: true });
writeFileSync(`${out}/geometry-check.json`, JSON.stringify(report, null, 2) + '\n');
writeFileSync(`${out}/circle-with-towers.js`, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText);
console.log(JSON.stringify(report, null, 2));
