import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { MeshoptSimplifier } from 'meshoptimizer';

// This is a licensed broadleaf asset for foreground rendering evaluation,
// not a surveyed UT tree or a claim that the species is a Texas live oak.
const source = path.resolve('../research/raw/foreground-trees/island_tree_02');
const output = path.resolve('public/assets/foreground-tree');
await fs.mkdir(output, { recursive: true });
await fs.cp(path.join(source, 'textures'), path.join(output, 'textures'), {
  recursive: true,
});
const sourceJson = JSON.parse(
  await fs.readFile(path.join(source, 'island_tree_02_1k.gltf')),
);
const binary = await fs.readFile(path.join(source, 'island_tree_02.bin'));
const inputManifest = JSON.parse(
  await fs.readFile(
    path.resolve('../research/raw/foreground-trees/island_tree_02-files.json'),
  ),
).gltf['1k'].gltf;
for (const [file, record] of Object.entries(inputManifest.include)) {
  const bytes = await fs.readFile(path.join(source, file));
  if (
    bytes.length !== record.size ||
    crypto.createHash('md5').update(bytes).digest('hex') !== record.md5
  )
    throw Error(`Source verification failed: ${file}`);
}
const dimensions = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function readAccessor(id) {
  const a = sourceJson.accessors[id],
    v = sourceJson.bufferViews[a.bufferView];
  const size = dimensions[a.type],
    offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const bytes = a.componentType === 5123 ? 2 : 4,
    stride = v.byteStride ?? size * bytes;
  const out =
    a.componentType === 5126
      ? new Float32Array(a.count * size)
      : new Uint32Array(a.count * size);
  for (let i = 0; i < a.count; i++)
    for (let j = 0; j < size; j++) {
      const start = offset + i * stride + j * bytes;
      out[i * size + j] =
        a.componentType === 5126
          ? binary.readFloatLE(start)
          : bytes === 2
            ? binary.readUInt16LE(start)
            : binary.readUInt32LE(start);
    }
  return out;
}
await MeshoptSimplifier.ready;
const stats = [];
for (const [lod, targets, error] of [
  ['near', [5000, 100000, 40000], 0.016],
  ['mid', [1600, 30000, 10000], 0.055],
  ['far', [500, 8000, 3000], 0.13],
]) {
  const json = {
    asset: {
      version: '2.0',
      generator: 'UT foreground-tree LOD preparation / meshoptimizer 1.2.0',
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: `Broadleaf_${String(lod)}` }],
    meshes: [{ primitives: [] }],
    materials: sourceJson.materials,
    images: sourceJson.images,
    textures: sourceJson.textures,
    samplers: sourceJson.samplers,
    accessors: [],
    bufferViews: [],
    buffers: [],
  };
  if (sourceJson.extensionsUsed)
    json.extensionsUsed = sourceJson.extensionsUsed;
  const chunks = [];
  let byteLength = 0,
    triangles = 0;
  function add(array, type, target, bounds = false) {
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    const padding = Buffer.alloc((4 - (bytes.length % 4)) % 4);
    const view =
      json.bufferViews.push({
        buffer: 0,
        byteOffset: byteLength,
        byteLength: bytes.length,
        target,
      }) - 1;
    chunks.push(bytes, padding);
    byteLength += bytes.length + padding.length;
    const accessor = {
      bufferView: view,
      componentType: array instanceof Float32Array ? 5126 : 5125,
      type,
      count: array.length / dimensions[type],
    };
    if (bounds) {
      accessor.min = Array(dimensions[type]).fill(Infinity);
      accessor.max = Array(dimensions[type]).fill(-Infinity);
      for (let i = 0; i < array.length; i++) {
        const k = i % dimensions[type];
        accessor.min[k] = Math.min(accessor.min[k], array[i]);
        accessor.max[k] = Math.max(accessor.max[k], array[i]);
      }
    }
    return json.accessors.push(accessor) - 1;
  }
  for (const primitive of sourceJson.meshes[0].primitives) {
    const attributes = Object.fromEntries(
      Object.entries(primitive.attributes).map(([name, id]) => [
        name,
        { array: readAccessor(id), type: sourceJson.accessors[id].type },
      ]),
    );
    const p = attributes.POSITION.array,
      uv = attributes.TEXCOORD_0.array;
    const indices = readAccessor(primitive.indices);
    const [reduced, actualError] = MeshoptSimplifier.simplifyWithAttributes(
      indices,
      p,
      3,
      uv,
      2,
      [0.1, 0.1],
      null,
      targets[primitive.material] * 3,
      error,
      ['Permissive', 'Prune'],
    );
    const remap = new Map();
    const compact = Uint32Array.from(reduced, (i) => {
      if (!remap.has(i)) remap.set(i, remap.size);
      return remap.get(i);
    });
    const attrs = {};
    for (const [name, { array, type }] of Object.entries(attributes)) {
      const size = dimensions[type],
        dst = new Float32Array(remap.size * size);
      for (const [from, to] of remap)
        dst.set(array.subarray(from * size, (from + 1) * size), to * size);
      attrs[name] = add(dst, type, 34962, name === 'POSITION');
    }
    json.meshes[0].primitives.push({
      attributes: attrs,
      indices: add(compact, 'SCALAR', 34963),
      material: primitive.material,
    });
    triangles += reduced.length / 3;
    console.log(
      lod,
      sourceJson.materials[primitive.material].name,
      reduced.length / 3,
      actualError.toFixed(4),
    );
  }
  json.buffers.push({ byteLength });
  const body = Buffer.concat(chunks),
    text = Buffer.from(JSON.stringify(json));
  const padded = Buffer.concat([
    text,
    Buffer.alloc((4 - (text.length % 4)) % 4, 32),
  ]);
  const header = Buffer.alloc(20),
    binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + padded.length + body.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  binHeader.writeUInt32LE(body.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  const file = Buffer.concat([header, padded, binHeader, body]);
  await fs.writeFile(path.join(output, `${String(lod)}.glb`), file);
  stats.push({
    lod,
    triangles,
    bytes: file.length,
    sha256: crypto.createHash('sha256').update(file).digest('hex'),
  });
}
await fs.writeFile(
  path.join(output, 'sources.json'),
  JSON.stringify(
    {
      title: 'Island Tree 02',
      source: 'https://polyhaven.com/a/island_tree_02',
      license: 'CC0',
      role: 'Broadleaf foreground rendering asset; not a botanical or surveyed reproduction of UT live oaks',
      preparation:
        'Three meshoptimizer LODs; original 1K PBR textures retained',
      inputManifest,
      lods: stats,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(stats));
