import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

globalThis.self = globalThis;
class TextureStub extends T.Loader {
  load(_uri, ready) { const texture = new T.Texture(); queueMicrotask(() => ready(texture)); return texture; }
}
const manager = new T.LoadingManager().addHandler(/./, new TextureStub());
async function load(file) {
  const data = await fs.readFile(file);
  return new GLTFLoader(manager).parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
}
function headPoints(scene) {
  const result = new Set();
  scene.traverse((o) => {
    if (!o.isMesh || o.material.name !== 'm002_head') return;
    for (const i of o.geometry.index.array)
      result.add(new T.Vector3().fromBufferAttribute(o.geometry.attributes.position, i)
        .toArray().map((v) => Math.round(v * 1e4)).join(','));
  });
  return [...result].sort((a, b) => a.localeCompare(b));
}
async function measure(file) {
  const gltf = await load(file), scene = gltf.scene;
  const torso = [], straps = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData.strapRings ||
      (o.material.name === 'Backpack woven fabric' && o.geometry.attributes.position.count === 637)) straps.push(o);
    if (!o.isSkinnedMesh || o.material.name !== 'm002_body') return;
    const g = o.geometry, p = g.attributes.position, triangles = [];
    for (let n = 0; n < g.index.count; n += 3) {
      const ids = [0, 1, 2].map((k) => g.index.getX(n + k));
      if (ids.some((i) => p.getZ(i) < 106 || p.getZ(i) > 154 || Math.abs(p.getX(i)) > 24)) continue;
      triangles.push(ids);
    }
    if (triangles.length) torso.push({ mesh: o, triangles });
  });
  assert.equal(straps.length, 2);
  const mixer = new T.AnimationMixer(scene), samples = [];
  function transformed(mesh, i) {
    const point = new T.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, i);
    if (mesh.isSkinnedMesh) mesh.applyBoneTransform(i, point);
    return point.applyMatrix4(mesh.matrixWorld);
  }
  for (const clip of gltf.animations) {
    mixer.stopAllAction(); mixer.clipAction(clip).play();
    const distances = [];
    for (let step = 0; step < 12; step++) {
      mixer.setTime(clip.duration * step / 12);
      scene.updateMatrixWorld(true);
      const triangles = [];
      for (const { mesh, triangles: ids } of torso) {
        const vertices = new Map();
        for (const tri of ids) {
          for (const i of tri) if (!vertices.has(i)) vertices.set(i, transformed(mesh, i));
          const triangle = new T.Triangle(...tri.map((i) => vertices.get(i)));
          if (triangle.getArea() > 1e-12) triangles.push(triangle);
        }
      }
      for (const strap of straps)
        for (let row = 13; row <= 35; row += 2) {
          const center = new T.Vector3();
          for (let n = 0; n < 12; n++) center.add(transformed(strap, row * 13 + n));
          center.divideScalar(12);
          let distance = Infinity;
          for (const tri of triangles)
            distance = Math.min(distance, tri.closestPointToPoint(center, new T.Vector3()).distanceTo(center));
          assert.ok(Number.isFinite(distance), 'Every strap sample must have a finite surface distance');
          distances.push(distance * 100);
        }
    }
    distances.sort((a, b) => a - b);
    samples.push({ clip: clip.name, poses: 12, samples: distances.length,
      medianCenterDistanceCm: distances[Math.floor(distances.length / 2)],
      p95CenterDistanceCm: distances[Math.floor(distances.length * 0.95)],
      maxCenterDistanceCm: distances.at(-1) });
  }
  return { samples, head: headPoints(scene) };
}
const previous = await measure('../research/character-reference/versions/pre-hair-groom/character.glb');
const current = await measure('public/assets/personal-character/character.glb');
assert.deepEqual(current.head, previous.head, 'Accessory changes must preserve the complete anatomical head');
for (const sample of current.samples)
  assert.ok(sample.maxCenterDistanceCm < 2.5, `${sample.clip}: fitted straps must stay near the jacket`);
console.log(JSON.stringify({
  description: 'Geometric strap center-to-jacket distance, 12 poses per clip; not a cloth simulation or all-surface intersection proof',
  unchangedHeadPoints: current.head.length,
  previous: previous.samples,
  current: current.samples,
}, null, 2));
