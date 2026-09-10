import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { personalizeCivilian } from './personalize-civilian.mjs';

const source = path.resolve('../research/raw/rocketbox');
const personal = process.argv.includes('--personal');
const output = path.resolve(
  `public/assets/${personal ? 'personal-character' : 'civilian'}`,
);
await fs.mkdir(output, { recursive: true });
// The personal haircut is fitted geometry with vertex colors; its old card
// texture is no longer referenced. The source civilian retains its own atlas.
if (personal) await fs.rm(path.join(output, 'hair-color.png'), { force: true });
const provenance = JSON.parse(
  await fs.readFile(path.join(source, 'sources.json'), 'utf8'),
);
// FBX parsing only needs texture identities here. Image conversion is a separate
// step, and the resulting GLB references those files without a DOM/canvas shim.
class TextureIdentity extends THREE.Loader {
  load(file) {
    const texture = new THREE.Texture();
    texture.userData.file = file;
    return texture;
  }
}
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    void blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    });
  }
};
const manager = new THREE.LoadingManager().addHandler(
  /./,
  new TextureIdentity(),
);
const loader = new FBXLoader(manager);
async function read(file) {
  const buffer = await fs.readFile(path.join(source, file));
  const record = provenance.files.find((r) => r.file === file);
  if (
    !record ||
    crypto.createHash('sha256').update(buffer).digest('hex') !== record.sha256
  )
    throw Error(`Source hash mismatch: ${file}`);
  return loader.parse(
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ),
    '',
  );
}

const model = await read('Male_Adult_01.fbx');
model.name = 'UTCampusCivilian';
const lights = [];
model.traverse((object) => {
  if (object.isLight || object.isCamera) lights.push(object);
});
for (const object of lights) object.removeFromParent();
const bindBounds = new THREE.Box3().setFromObject(model);
const scale = 1.78 / (bindBounds.max.y - bindBounds.min.y);
model.scale.setScalar(scale);
model.position.y = -bindBounds.min.y * scale;
model.userData = {
  source: 'Microsoft Rocketbox Male_Adult_01',
  license: 'MIT',
  forwardAxis: '+Z',
  statureMeters: 1.78,
};
let triangles = 0;
model.traverse((object) => {
  if (!object.isMesh) return;
  object.geometry = mergeVertices(object.geometry, 1e-5);
  object.normalizeSkinWeights?.();
  triangles +=
    (object.geometry.index?.count ??
      object.geometry.attributes.position.count) / 3;
  object.material = (
    Array.isArray(object.material) ? object.material : [object.material]
  ).map((old) => {
    const hair = old.name.includes('opacity');
    const material = new THREE.MeshStandardMaterial({
      name: old.name,
      color: personal && hair ? 0x69645f : 0xffffff,
      metalness: 0,
      roughness: hair ? 0.56 : old.name.includes('head') ? 0.65 : 0.88,
      side: hair ? THREE.DoubleSide : THREE.FrontSide,
      alphaTest: hair ? 0.35 : 0,
    });
    return material;
  });
});

if (personal) {
  personalizeCivilian(model);
  triangles = 0;
  model.traverse((o) => {
    if (o.isMesh) {
      o.geometry.normalizeNormals();
      const normals = o.geometry.attributes.normal;
      for (let i = 0; i < normals.count; i++)
        if (Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) < 0.5)
          normals.setXYZ(i, 0, 1, 0);
      triangles +=
        (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
    }
  });
}

const motion = {},
  clips = [];
for (const [name, file] of Object.entries({
  Idle: 'm_idle_breathe_01.max.fbx',
  Walk: 'm_walk_fast_01.max.fbx',
  Run: 'm_run_fast_01.max.fbx',
})) {
  const animation = (await read(file)).animations[0];
  const root = animation.tracks.find(
    (track) => track.name === 'Bip01.position',
  );
  const count = root.values.length;
  motion[name] = {
    source: file,
    duration: animation.duration,
    speedMetersPerSecond:
      (Math.hypot(
        root.values[count - 3] - root.values[0],
        root.values[count - 1] - root.values[2],
      ) *
        scale) /
      animation.duration,
  };
  const tracks = animation.tracks
    .filter(
      (track) =>
        model.getObjectByName(track.name.split('.')[0]) &&
        !track.name.endsWith('.scale'),
    )
    .map((track) => track.clone());
  for (const track of tracks) {
    if (track.name !== 'Bip01.position') continue;
    // Rapier owns travel across campus. Retain the vertical hip movement, but
    // remove horizontal root translation from every frame of the animation.
    for (let i = 0; i < track.values.length; i += 3) {
      track.values[i] = 0;
      track.values[i + 2] = 0;
    }
  }
  clips.push(
    new THREE.AnimationClip(name, animation.duration, tracks).optimize(),
  );
}
model.userData.locomotion = motion;
model.updateMatrixWorld(true);
const glb = Buffer.from(
  await new GLTFExporter().parseAsync(model, {
    binary: true,
    animations: clips,
    onlyVisible: true,
  }),
);
const jsonLength = glb.readUInt32LE(12);
const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'));
const binary = glb.subarray(20 + jsonLength + 8);
json.asset.copyright =
  'Copyright (c) 2020 Microsoft. MIT License; see LICENSE.txt.';
json.samplers = [
  { magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 },
];
json.images = [];
json.textures = [];
function texture(uri) {
  const index = json.images.length;
  json.images.push({ uri });
  json.textures.push({ sampler: 0, source: index });
  return { index };
}
for (const material of json.materials) {
  if (material.name === 'Backpack woven fabric') {
    material.pbrMetallicRoughness.baseColorTexture = texture('body-color.jpg');
    continue;
  }
  if (!material.name.startsWith('m002_')) continue;
  const part = material.name.includes('body')
    ? 'body'
    : material.name.includes('head')
      ? 'head'
      : 'hair';
  material.pbrMetallicRoughness.baseColorTexture = texture(
    `${part}-color.${part === 'hair' ? 'png' : 'jpg'}`,
  );
  if (part !== 'hair' && !personal)
    material.normalTexture = { ...texture(`${part}-normal.png`), scale: 0.55 };
}
const text = Buffer.from(JSON.stringify(json));
const padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20);
text.copy(padded);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(20 + padded.length + 8 + binary.length, 8);
header.writeUInt32LE(padded.length, 12);
header.writeUInt32LE(0x4e4f534a, 16);
const binaryHeader = Buffer.alloc(8);
binaryHeader.writeUInt32LE(binary.length, 0);
binaryHeader.writeUInt32LE(0x004e4942, 4);
await fs.writeFile(
  path.join(output, 'character.glb.tmp'),
  Buffer.concat([header, padded, binaryHeader, binary]),
);
await fs.rename(
  path.join(output, 'character.glb.tmp'),
  path.join(output, 'character.glb'),
);
await fs.copyFile(
  path.join(source, 'LICENSE.md'),
  path.join(output, 'LICENSE.txt'),
);
const files = [];
for (const file of await fs.readdir(output)) {
  if (file === 'sources.json') continue;
  const buffer = await fs.readFile(path.join(output, file));
  files.push({
    file,
    bytes: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  });
}
await fs.writeFile(
  path.join(output, 'sources.json'),
  JSON.stringify(
    {
      repository: provenance.repository,
      revision: provenance.revision,
      license: personal
        ? 'Base mesh and animations: MIT. User reference and derived likeness textures are personal project assets.'
        : 'MIT',
      character: personal
        ? 'Complete human character inspired by user video'
        : 'Male_Adult_01',
      triangles,
      scale,
      motion,
      sourceFiles: provenance.files,
      files,
      processing:
        'TGA to 1K texture atlases with glTF image orientation and normal green-channel conversion; merged duplicate vertices; glTF standard materials; retained matching rig animation and vertical hip motion; removed horizontal root motion and static scale/helper tracks.',
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify(
    {
      triangles,
      scale,
      motion,
      files: files.map(({ file, bytes }) => ({ file, bytes })),
    },
    null,
    2,
  ),
);
