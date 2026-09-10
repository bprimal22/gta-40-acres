import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// No GPU or network is needed to validate skeletal poses and root motion.
// Textures are checked visually in the real browser playtest.
globalThis.self = globalThis;
class TextureStub extends THREE.Loader {
  load(file, onLoad) {
    const texture = new THREE.Texture();
    queueMicrotask(() => onLoad(texture));
    return texture;
  }
}
const manager = new THREE.LoadingManager().addHandler(/./, new TextureStub());
const personal = process.argv.includes('--personal');
const buffer = await fs.readFile(
  `public/assets/${personal ? 'personal-character' : 'civilian'}/character.glb`,
);
const jsonLength = buffer.readUInt32LE(12);
const asset = JSON.parse(buffer.subarray(20, 20 + jsonLength));
for (const mesh of asset.meshes)
  for (const primitive of mesh.primitives) {
    if (primitive.attributes.JOINTS_0 !== undefined)
      assert(
        primitive.indices !== undefined,
        'A removed empty material group must not become a nonindexed face',
      );
    if (primitive.indices !== undefined)
      assert(asset.accessors[primitive.indices].count > 0);
  }
const gltf = await new GLTFLoader(manager).parseAsync(
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  '',
);
const model = gltf.scene,
  rig = model.getObjectByName('UTCampusCivilian');
assert(rig, 'character metadata and rig node must survive conversion');
assert.deepEqual(gltf.animations.map((c) => c.name).sort(), [
  'Idle',
  'Run',
  'Walk',
]);
assert.equal(rig.userData.forwardAxis, '+Z');
if (personal) {
  let headTriangles = 0;
  const clothEdges = new Map();
  const clothSkin = new Map();
  model.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const material = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of material) {
      if (m.name === 'm002_head') headTriangles += o.geometry.index.count / 3;
      if (m.name !== 'm002_body') continue;
      const g = o.geometry,
        p = g.attributes.position;
      const keyFor = (i) =>
        [p.getX(i), p.getY(i), p.getZ(i)]
          .map((v) => Math.round(v * 1e3))
          .join(',');
      for (let n = 0; n < g.index.count; n += 3) {
        const tri = [0, 1, 2].map((k) => g.index.getX(n + k));
        for (let k = 0; k < 3; k++) {
          const a = tri[k],
            b = tri[(k + 1) % 3];
          if (
            p.getZ(a) <= 30 ||
            p.getZ(a) >= 69 ||
            p.getZ(b) <= 30 ||
            p.getZ(b) >= 69
          )
            continue;
          const ka = keyFor(a),
            kb = keyFor(b);
          if (ka === kb) continue;
          const edge = ka < kb ? `${ka}/${kb}` : `${kb}/${ka}`;
          clothEdges.set(edge, (clothEdges.get(edge) ?? 0) + 1);
          for (const i of [a, b]) {
            const weights = new Map();
            for (let j = 0; j < 4; j++) {
              const bone = g.attributes.skinIndex.getComponent(i, j);
              const w = g.attributes.skinWeight.getComponent(i, j);
              assert.ok(
                Number.isFinite(w) && w >= 0,
                'Skin weights must remain finite and positive',
              );
              weights.set(bone, (weights.get(bone) ?? 0) + w);
            }
            assert.ok(
              Math.abs([...weights.values()].reduce((a, b) => a + b, 0) - 1) <
                1e-5,
            );
            const key = keyFor(i),
              previous = clothSkin.get(key);
            if (previous) {
              for (const bone of new Set([
                ...weights.keys(),
                ...previous.keys(),
              ]))
                assert.ok(
                  Math.abs(
                    (weights.get(bone) ?? 0) - (previous.get(bone) ?? 0),
                  ) < 1e-4,
                  'Coincident cloth vertices must stay joined as the knee bends',
                );
            } else clothSkin.set(key, weights);
          }
        }
      }
    }
  });
  const groom = model.getObjectByName('Short_dark_hair_groom') ?? model.getObjectByName('Short dark hair groom');
  assert.ok(groom, 'The complete fitted haircut must be present');
  assert.equal(groom.parent.name, 'Bip01_Head', 'Hair must follow the head in every pose');
  assert.equal(groom.children.length, 2, 'Scalp coverage and tapered fibers must both be present');
  const straps = [];
  model.traverse((o) => { if (o.userData.strapRings) straps.push(o); });
  assert.equal(straps.length, 2, 'Both backpack straps must be present');
  for (const strap of straps) {
    assert.ok(strap.isSkinnedMesh, 'Backpack straps must deform with the body');
    const weights = strap.geometry.attributes.skinWeight;
    for (let i = 0; i < weights.count; i++) {
      let total = 0;
      for (let k = 0; k < 4; k++) {
        const w = weights.getComponent(i, k);
        assert.ok(Number.isFinite(w) && w >= 0, 'Strap influence must be finite and nonnegative');
        total += w;
      }
      assert.ok(Math.abs(total - 1) < 1e-5, 'Strap skin weights must sum to one');
    }
  }
  assert.ok(
    headTriangles > 1000,
    'The complete anatomical head must be retained',
  );
  assert.ok(clothEdges.size > 100, 'Check the actual knee surface');
  assert.equal(
    [...clothEdges.values()].filter((count) => count !== 2).length,
    0,
    'The trouser knee must have no open edges or overlapping duplicate faces',
  );
  assert.equal(
    model.getObjectByName('Dark_backpack')?.parent?.name ??
      model.getObjectByName('Dark backpack')?.parent?.name,
    'Bip01_Spine2',
  );
}
const mixer = new THREE.AnimationMixer(model),
  bounds = new THREE.Box3(),
  results = [];
for (const clip of gltf.animations) {
  mixer.stopAllAction();
  mixer.clipAction(clip).play();
  let minY = Infinity,
    maxY = -Infinity,
    drift = 0;
  for (let i = 0; i < 60; i++) {
    mixer.setTime((clip.duration * i) / 60);
    model.updateMatrixWorld(true);
    bounds.setFromObject(model, true);
    assert(
      [...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite),
    );
    assert(
      bounds.max.y < (personal ? 1.95 : 1.85) && bounds.min.y > -0.03,
      `${clip.name} pose must retain human scale and avoid sunken feet`,
    );
    const p = model.getObjectByName('Bip01').position;
    drift = Math.max(drift, Math.hypot(p.x, p.z));
    minY = Math.min(minY, bounds.min.y);
    maxY = Math.max(maxY, bounds.max.y);
  }
  assert(
    drift < 1e-7,
    `${clip.name} must not move the mesh away from its physics body`,
  );
  results.push({
    clip: clip.name,
    duration: clip.duration,
    minY,
    maxY,
    horizontalRootDrift: drift,
    sampledPoses: 60,
  });
}
console.log(JSON.stringify({ passed: true, results }, null, 2));
