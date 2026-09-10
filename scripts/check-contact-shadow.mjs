import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ContactShadow } from '../lib/campus/contact-shadow.ts';

const parent = new THREE.Group();
parent.position.set(120, 5, -133);
parent.rotation.y = 0.3;
const source = new THREE.Mesh(
  new THREE.PlaneGeometry(10, 10),
  new THREE.MeshBasicMaterial(),
);
parent.add(source);
parent.updateMatrixWorld(true);
// Model TilesGroup's static-world optimization: do not update the parent again
// after adding a shadow receiver. The receiver must initialize its own matrix.
let wanted = [source],
  disposedGeometry = 0;
source.geometry.addEventListener('dispose', () => disposedGeometry++);
const shadow = new ContactShadow(() => wanted);
shadow.update(new THREE.Vector3(120, 5, -133), 0);
const receiver = shadow.receivers.get(source);
assert(
  receiver.matrixWorld.equals(source.matrixWorld),
  'receiver must inherit the tile transform even under a static TilesGroup',
);
assert.equal(
  receiver.geometry,
  source.geometry,
  'shadow must share the exact displayed surface',
);
const hits = [];
receiver.raycast(new THREE.Raycaster(), hits);
assert.equal(
  hits.length,
  0,
  'shadow overlay must not produce duplicate camera/ground ray hits',
);
wanted = [];
shadow.update(new THREE.Vector3(), 100);
assert.equal(source.children.length, 0, 'unneeded receivers must detach');
shadow.dispose();
assert.equal(
  disposedGeometry,
  0,
  'tile renderer must retain ownership of the shared geometry',
);
console.log(
  'PASS: receiver transform under a static parent, shared geometry, raycast exclusion, detachment and geometry ownership.',
);
