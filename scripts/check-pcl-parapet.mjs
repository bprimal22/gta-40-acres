import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildPclParapet, pclParapetPoints } from '../lib/campus/pcl-forecourt.ts';
import { subtractVolumes } from '../lib/campus/clip-volume.ts';

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -24, z: 0 });
const repair = buildPclParapet();
const visual = new THREE.Group();
const material = new THREE.MeshBasicMaterial();
for (const geometry of [...repair.walls, ...repair.coping, ...repair.paving]) {
  visual.add(new THREE.Mesh(geometry, material));
  world.createCollider(RAPIER.ColliderDesc.trimesh(
    geometry.attributes.position.array, new Uint32Array(geometry.index.array),
    RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
  ));
}
visual.updateWorldMatrix(true, true);
world.step();
const ray = new THREE.Raycaster();
let surfaceChecks = 0, wallChecks = 0;
for (let i = 0; i < pclParapetPoints.length - 1; i++) {
  const a = new THREE.Vector3(...pclParapetPoints[i]);
  const b = new THREE.Vector3(...pclParapetPoints[i + 1]);
  const direction = b.clone().sub(a).setY(0).normalize();
  const outward = new THREE.Vector3(direction.z, 0, -direction.x);
  for (const f of [0.1, 0.5, 0.9]) {
    const p = a.clone().lerp(b, f);
    for (const offset of [0, 1.4]) {
      const at = p.clone().addScaledVector(outward, offset);
      ray.set(at.clone().setY(8), new THREE.Vector3(0, -1, 0));
      const mesh = ray.intersectObject(visual, true)[0];
      const collision = world.castRay(new RAPIER.Ray(
        { x: at.x, y: 8, z: at.z }, { x: 0, y: -1, z: 0 }), 20, true);
      assert(mesh && collision && mesh.face.normal.y > 0.5, 'upward paved edge/coping');
      assert(Math.abs(mesh.point.y - (8 - collision.timeOfImpact)) < 0.001,
        'render and collider heights agree');
      surfaceChecks++;
    }
    const start = p.clone().addScaledVector(outward, 1.6).add(new THREE.Vector3(0, 0.94, 0));
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(start.x, start.y, start.z));
    const capsule = world.createCollider(RAPIER.ColliderDesc.capsule(0.54, 0.34), body);
    const controller = world.createCharacterController(0.025);
    controller.enableAutostep(0.32, 0.2, false);
    controller.enableSnapToGround(0.38);
    controller.setMaxSlopeClimbAngle(Math.PI * 0.25);
    world.step();
    for (let frame = 0; frame < 90; frame++) {
      controller.computeColliderMovement(capsule, {
        x: -outward.x * 5.8 / 60, y: -1 / 60, z: -outward.z * 5.8 / 60,
      });
      const move = controller.computedMovement(), from = body.translation();
      body.setNextKinematicTranslation({ x: from.x + move.x, y: from.y + move.y, z: from.z + move.z });
      world.step();
    }
    const end = new THREE.Vector3().copy(body.translation());
    assert(end.clone().sub(p).dot(outward) >= 0.6, 'running capsule must stay outside wall');
    assert(end.y > p.y + 0.75, 'no fall through the paved edge');
    world.removeCharacterController(controller);
    world.removeRigidBody(body);
    wallChecks++;
  }
}
// A replacement must not erase the upper façade along with the low parapet.
const upperFacade = new THREE.PlaneGeometry(10, 6).rotateY(Math.PI / 2)
  .translate(-87.6, 10, 330.64);
assert.equal(subtractVolumes(upperFacade, new THREE.Matrix4(), repair.volumes), null);
const report = { surfaceChecks, runningWallApproaches: wallChecks,
  upperFacadePreserved: true, parapetMeters: Math.round(repair.length),
  scope: 'Synthetic geometry and actual Rapier controller; browser replay is separate.' };
writeFileSync(new URL('../evidence/iteration-20-pcl-parapet-check.json', import.meta.url),
  `${JSON.stringify(report, null, 2)}\n`);
console.log('PASS:', report);
world.free();
upperFacade.dispose();
visual.traverse((object) => { if (object.isMesh) object.geometry.dispose(); });
material.dispose();
