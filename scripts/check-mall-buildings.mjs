import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

registerHooks({ load(url, context, next) {
  if (!url.endsWith('.ts')) return next(url, context);
  return { format: 'module', shortCircuit: true, source: ts.transpileModule(
    readFileSync(new URL(url), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } },
  ).outputText };
} });

const { buildMallBuildings } = await import('../lib/campus/mall-buildings.ts');
const plan = JSON.parse(readFileSync(new URL('../public/data/mall-buildings-plan.json', import.meta.url)));
// Wall samples are above the facade datum, so a flat ground fixture isolates
// the closed exterior geometry. The MLK checker separately uses contour ground.
const buildings = buildMallBuildings(() => 0);
await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -24, z: 0 });
const scene = new T.Group();
const checks = [];
try {
  for (const mesh of buildings.meshes) {
    scene.add(mesh);
    const positions = mesh.geometry.attributes.position.array;
    assert(Array.from(positions).every(Number.isFinite), `${mesh.name}: non-finite geometry`);
    world.createCollider(RAPIER.ColliderDesc.trimesh(
      positions,
      Uint32Array.from({ length: positions.length / 3 }, (_, i) => i),
      RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
    ));
  }
  scene.updateWorldMatrix(true, true);
  world.step();
  const ray = new T.Raycaster();
  for (const building of plan.buildings) {
    const ring = building.rings[0];
    const area = ring.reduce((sum, p, i) => sum + p[0] * ring[(i + 1) % ring.length][1]
      - ring[(i + 1) % ring.length][0] * p[1], 0);
    const edges = ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length] }));
    edges.sort((a, b) => Math.hypot(b.b[0] - b.a[0], b.b[1] - b.a[1])
      - Math.hypot(a.b[0] - a.a[0], a.b[1] - a.a[1]));
    const { a, b } = edges[0];
    const normal = new T.Vector3(b[1] - a[1], 0, a[0] - b[0]).normalize().multiplyScalar(Math.sign(area));
    for (let floor = 0; floor < Math.min(building.floors, 3); floor++) {
      const origin = new T.Vector3((a[0] + b[0]) / 2,
        building.base + (floor + .53) * building.floorHeight, (a[1] + b[1]) / 2).addScaledVector(normal, 2);
      const direction = normal.clone().negate();
      ray.set(origin, direction); ray.far = 2.1;
      const visible = ray.intersectObject(scene, true)[0];
      const physical = world.castRay(new RAPIER.Ray(origin, direction), 2.1, true);
      assert(visible && physical, `${building.abbr} floor ${floor}: missing exterior`);
      assert(visible.distance > 1.5, `${building.abbr}: unexpected exterior obstruction`);
      assert(Math.abs(visible.distance - physical.timeOfImpact) < .001,
        `${building.abbr} floor ${floor}: visual/physical wall mismatch`);
      checks.push({ building: building.abbr, floor, visibleDistance: visible.distance,
        physicalDistance: physical.timeOfImpact });
    }
  }
  const result = { passed: true, stats: buildings.stats, materialBatches: buildings.meshes.length,
    checks, limits: 'Horizontal visual/physical wall agreement on three floors per building; flat ground fixture. Does not establish exact architecture, interiors, or streamed browser behavior.' };
  writeFileSync('evidence/iteration-39-building-check.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  world.free();
  for (const mesh of buildings.meshes) mesh.geometry.dispose();
  for (const material of buildings.materials) material.dispose();
}
