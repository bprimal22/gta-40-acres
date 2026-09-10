import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

// Exercise the real browser geometry builder without WebGL or texture requests.
// TypeScript compilation here only enables its extensionless local imports.
registerHooks({
  resolve(specifier, context, next) {
    if (
      specifier.startsWith('.') &&
      context.parentURL &&
      !/\.[a-z]+$/i.test(specifier)
    ) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate))
        return { url: candidate.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.endsWith('.ts')) return next(url, context);
    return {
      format: 'module',
      shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        compilerOptions: {
          target: ts.ScriptTarget.ES2023,
          module: ts.ModuleKind.ESNext,
        },
      }).outputText,
    };
  },
});
const { SpeedwayWalkway } = await import('../lib/campus/walkway.ts');
const { Terrain } = await import('../lib/campus/terrain.ts');
const { subtractVolumes } = await import('../lib/campus/clip-volume.ts');
await RAPIER.init();
const physics = new RAPIER.World({ x: 0, y: -24, z: 0 });
const loadDescriptor = Object.getOwnPropertyDescriptor(
  THREE.TextureLoader.prototype,
  'load',
);
assert(loadDescriptor);
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
const data = JSON.parse(
  readFileSync(new URL('../public/data/campus.json', import.meta.url)),
);
const walkway = new SpeedwayWalkway(
  data,
  { height: () => 2 },
  physics,
  {
    capabilities: { getMaxAnisotropy: () => 8 },
  },
  true,
);
Object.defineProperty(THREE.TextureLoader.prototype, 'load', loadDescriptor);
walkway.group.updateWorldMatrix(true, true);

// Regression: the slight turn at this actual mapped joint left a solid sliver
// of source scan across the whole walking route before longitudinal overlap.
const jointWall = new THREE.PlaneGeometry(12, 10)
  .rotateY(Math.PI / 2)
  .translate(65.376, 5, -132.068);
const trimmed = subtractVolumes(
  jointWall,
  new THREE.Matrix4(),
  walkway.volumes,
);
assert(
  trimmed && trimmed.attributes.position.count === 0,
  'the mapped approach joint must fully clear a crossing scan wall',
);

// All centerline samples must have a continuous upward-facing ground surface.
const ray = new THREE.Raycaster();
let centerlineSamples = 0;
for (const path of data.paths.filter((p) =>
  [...walkway.sourceWayIds, 15381080, 571500825].includes(p.id),
)) {
  for (let i = 0; i < path.points.length - 1; i++) {
    const [ax, az] = path.points[i],
      [bx, bz] = path.points[i + 1];
    // Stay just inside terminal edges to avoid testing float32 rounding of a
    // zero-width ray placed exactly on the outside of a boundary vertex.
    for (let f = 0.001; f < 1; f += 0.1) {
      const x = ax + (bx - ax) * f,
        z = az + (bz - az) * f;
      if (path.name !== 'Speedway' && (x < 12.785 || x > 119.9)) continue;
      ray.set(new THREE.Vector3(x, 15, z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(walkway.surfaces, true)[0];
      assert(
        hit && hit.face.normal.y > 0.5 && Math.abs(hit.point.y - 2.06) < 0.04,
        `missing upward ground at ${x}, ${z}`,
      );
      centerlineSamples++;
    }
  }
}
// Decorative canopies must never enter the collection used for landing queries.
const fakeCanopy = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100).rotateX(-Math.PI / 2),
);
fakeCanopy.position.set(8, 10, -90);
walkway.trees.group.add(fakeCanopy);
walkway.group.updateWorldMatrix(true, true);
ray.set(new THREE.Vector3(8, 15, -90), new THREE.Vector3(0, -1, 0));
assert(ray.intersectObject(walkway.group, true)[0].point.y === 10);
assert(
  ray.intersectObject(walkway.surfaces, true)[0].point.y < 2.1,
  'ground queries must exclude decorative canopies',
);
fakeCanopy.removeFromParent();
fakeCanopy.geometry.dispose();
fakeCanopy.material.dispose();

// Give both sides a source ground 0.9 m higher and check the rendered transition
// and Rapier agree. This catches reversed winding and stale collider rebuilds.
for (let i = 0; i < 180; i++)
  walkway.stitchGround(
    physics,
    new THREE.Vector3(8, 3, -90),
    (_x, _z, y) => y + 0.9,
  );
await new Promise((resolve) => setTimeout(resolve, 550));
walkway.stitchGround(
  physics,
  new THREE.Vector3(8, 3, -90),
  (_x, _z, y) => y + 0.9,
);
physics.step();
ray.set(new THREE.Vector3(-6, 15, -90), new THREE.Vector3(0, -1, 0));
const visual = ray.intersectObject(walkway.surfaces, true)[0];
const physical = physics.castRay(
  new RAPIER.Ray({ x: -6, y: 15, z: -90 }, { x: 0, y: -1, z: 0 }),
  20,
  true,
);
assert(
  visual && physical && visual.point.y > 2.3 && visual.point.y < 2.8,
  'transition must rise inside the cleared area',
);
assert(visual.face.normal.y > 0.5, 'transition must face upward');
assert(
  Math.abs(visual.point.y - (15 - physical.timeOfImpact)) < 0.001,
  'visual transition and collision must have the same height',
);

// Real contour heights reproduce the intersecting-strip defect that a flat
// fixture cannot: one road's grass used to poke above another road's paving.
const terrainData = JSON.parse(
  readFileSync(new URL('../public/data/terrain.json', import.meta.url)),
);
const junctionPhysics = new RAPIER.World({ x: 0, y: -24, z: 0 });
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
const junction = new SpeedwayWalkway(
  data,
  new Terrain(terrainData),
  junctionPhysics,
  { capabilities: { getMaxAnisotropy: () => 8 } },
  true,
);
Object.defineProperty(THREE.TextureLoader.prototype, 'load', loadDescriptor);
junction.group.updateWorldMatrix(true, true);
junctionPhysics.step();
// x=18 lay inside the old invented 13.5 m promenade. It is outside PWP's
// documented 30 ft paving at this junction; retain the three actual path lines.
for (const x of [9, 12, 15])
  for (const z of [-133, -130, -127]) {
    ray.set(new THREE.Vector3(x, 25, z), new THREE.Vector3(0, -1, 0));
    const surface = ray.intersectObject(junction.surfaces, true)[0];
    assert(
      surface && surface.object.material !== junction.materials[1],
      `grass must not cover junction paving at ${x},${z}`,
    );
    const collision = junctionPhysics.castRay(
      new RAPIER.Ray({ x, y: 25, z }, { x: 0, y: -1, z: 0 }),
      30,
      true,
    );
    assert(
      collision &&
        Math.abs(surface.point.y - (25 - collision.timeOfImpact)) < 0.001,
      'junction render and collision surfaces must agree',
    );
  }
assert(
  junction.treePlacements.every((p) => Math.hypot(p.x - 13.4, p.z + 128.5) > 4),
  'keep the tested turning route clear of planted trunks',
);
assert(junction.excludedTrees > 0);
junction.dispose(junctionPhysics);
junctionPhysics.free();

const report = {
  checks: [
    'mapped joint clearance',
    'continuous ground',
    'decorative canopy exclusion',
    'transition winding',
    'matching Rapier transition',
    'real-contour junction paving and collision',
    'junction tree clearance',
  ],
  centerlineSamples,
  ...walkway.snapshot(),
};
const evidencePrefix = process.argv[2] ?? 'landscape-current';
assert(/^[a-z0-9-]+$/.test(evidencePrefix));
writeFileSync(
  new URL(
    `../evidence/${evidencePrefix}-landscape-check.json`,
    import.meta.url,
  ),
  `${JSON.stringify(report, null, 2)}\n`,
);
writeFileSync(
  new URL(
    `../evidence/${evidencePrefix}-repair-footprints.json`,
    import.meta.url,
  ),
  `${JSON.stringify(walkway.volumes.map((v) => v.planes.slice(0, 4).map((p) => [p.normal.x, p.normal.z, p.constant])))}\n`,
);
walkway.dispose(physics);
physics.free();
jointWall.dispose();
trimmed.dispose();
console.log(
  `PASS: ${report.checks.join(', ')}; ${centerlineSamples} centerline samples.`,
);
