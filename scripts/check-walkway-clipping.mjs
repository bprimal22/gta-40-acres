import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { subtractVolumes } from '../lib/campus/clip-volume.ts';

function box(x0, y0, z0, x1, y1, z1) {
  return {
    bounds: new THREE.Box3(
      new THREE.Vector3(x0, y0, z0),
      new THREE.Vector3(x1, y1, z1),
    ),
    planes: [
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), x0),
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -x1),
      new THREE.Plane(new THREE.Vector3(0, -1, 0), y0),
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -y1),
      new THREE.Plane(new THREE.Vector3(0, 0, -1), z0),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -z1),
    ],
  };
}
const source = new THREE.PlaneGeometry(20, 20)
  .rotateX(-Math.PI / 2)
  .translate(0, 1, 0);
const identity = new THREE.Matrix4(),
  a = box(-2, 0, -2, 2, 3, 2);
function area(geometry) {
  const p = geometry.attributes.position,
    n = geometry.index?.count ?? p.count;
  let total = 0;
  for (let i = 0; i < n; i += 3) {
    const points = [0, 1, 2].map((j) =>
      new THREE.Vector3().fromBufferAttribute(
        p,
        geometry.index ? geometry.index.getX(i + j) : i + j,
      ),
    );
    total +=
      points[1].sub(points[0]).cross(points[2].sub(points[0])).length() / 2;
  }
  return total;
}
const cut = subtractVolumes(source, identity, [a]);
assert(cut);
assert(
  Math.abs(area(cut) - 384) < 0.0001,
  'partial triangles must leave exactly a 4 × 4 m opening',
);
for (let i = 0; i < cut.attributes.position.count; i++) {
  const x = cut.attributes.position.getX(i);
  assert(
    Math.abs(cut.attributes.uv.getX(i) - (x / 20 + 0.5)) < 1e-6,
    'new vertices must preserve UV interpolation',
  );
}
const overlap = subtractVolumes(source, identity, [a, box(0, 0, -2, 4, 3, 2)]);
assert(
  Math.abs(area(overlap) - 376) < 0.0001,
  'overlapping volumes must subtract their union only once',
);
assert.equal(
  subtractVolumes(source, identity, [box(30, 0, 30, 35, 3, 35)]),
  null,
  'untouched geometry must be reused',
);
assert.equal(
  subtractVolumes(source, identity, [box(-2, 4, -2, 2, 6, 2)]),
  null,
  'height bounds must preserve surfaces outside the clearance',
);
const shifted = source.clone().translate(-100, 0, 20);
const shiftedCut = subtractVolumes(
  shifted,
  new THREE.Matrix4().makeTranslation(100, 0, -20),
  [a],
);
assert(
  Math.abs(area(shiftedCut) - 384) < 0.0001,
  'world-frame clipping must preserve local geometry scale',
);
assert.equal(
  subtractVolumes(source, identity, [box(-30, 0, -30, 30, 3, 30)]).attributes
    .position.count,
  0,
);

// Degenerate footprint edges can leave only an unbounded vertical slab.
// A large source triangle still intersects the small declared bounds; the
// broad-phase box check alone must not let that slab erase the whole tile.
const unbounded = { bounds: a.bounds.clone(), planes: a.planes.slice(2, 4) };
const boundedCut = subtractVolumes(source, identity, [unbounded]);
assert(boundedCut);
assert(
  Math.abs(area(boundedCut) - 384) < 0.0001,
  'a malformed half-space set must never remove surfaces outside its declared box',
);
const zeroWidth = { bounds: a.bounds.clone(), planes: unbounded.planes };
zeroWidth.bounds.max.x = zeroWidth.bounds.min.x;
const degenerateCut = subtractVolumes(source, identity, [zeroWidth]);
assert(
  !degenerateCut || Math.abs(area(degenerateCut) - 400) < 0.0001,
  'a zero-width footprint must not remove a positive-area horizontal surface',
);

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.8, z: 0 });
world.createCollider(
  RAPIER.ColliderDesc.trimesh(
    cut.attributes.position.array,
    Uint32Array.from({ length: cut.attributes.position.count }, (_, i) => i),
  ),
);
const ground = world.createCollider(
  RAPIER.ColliderDesc.cuboid(10, 0.1, 10).setTranslation(0, -0.1, 0),
);
const wall = world.createCollider(
  RAPIER.ColliderDesc.cuboid(0.1, 2, 2).setTranslation(3, 2, 0),
);
world.step();
const ray = (x, y, z, dx, dy, dz) =>
  world.castRay(new RAPIER.Ray({ x, y, z }, { x: dx, y: dy, z: dz }), 10, true);
assert.equal(
  ray(0, 5, 0, 0, -1, 0).collider.handle,
  ground.handle,
  'the rendered opening must also be open in collision',
);
assert(
  Math.abs(ray(5, 5, 0, 0, -1, 0).timeOfImpact - 4) < 1e-5,
  'original ground outside the cut must remain solid',
);
assert.equal(
  ray(0, 1.5, 0, 1, 0, 0).collider.handle,
  wall.handle,
  'nearby wall collision must remain',
);
world.free();
console.log(
  'PASS: area, overlapping cuts, UV continuity, bounds, world transform, full removal, and matching Rapier opening/ground/wall checks.',
);
