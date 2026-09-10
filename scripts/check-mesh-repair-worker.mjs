import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

registerHooks({
  resolve(specifier, context, next) {
    // Queue tests inject controlled workers. The real worker runs separately in
    // browser playtests; Node does not implement Vite's ?worker import transform.
    if (specifier.endsWith('?worker'))
      return {
        url: 'data:text/javascript,export default class {}',
        shortCircuit: true,
      };
    if (
      specifier.startsWith('.') &&
      context.parentURL &&
      !/\.[a-z]+$/i.test(specifier)
    ) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.endsWith('.ts')) return next(url, context);
    return {
      format: 'module',
      shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: {
          target: ts.ScriptTarget.ES2023,
          module: ts.ModuleKind.ESNext,
        },
      }).outputText,
    };
  },
});
const {
  packGeometry,
  unpackGeometry,
  packVolumes,
  processRepair,
  transferBuffers,
} = await import('../lib/campus/mesh-repair-protocol.ts');
const { MeshRepairQueue } = await import('../lib/campus/mesh-repair-queue.ts');
const { PhotorealCampus } = await import('../lib/campus/photoreal.ts');
const { subtractVolumes } = await import('../lib/campus/clip-volume.ts');
const box = new THREE.Box3(
  new THREE.Vector3(-2, 0, -2),
  new THREE.Vector3(2, 3, 2),
);
const volumes = [
  {
    bounds: box,
    planes: [
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), -2),
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -2),
      new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -3),
      new THREE.Plane(new THREE.Vector3(0, 0, -1), -2),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -2),
    ],
  },
];
const original = new THREE.PlaneGeometry(20, 20)
  .rotateX(-Math.PI / 2)
  .translate(0, 1, 0);
original.clearGroups();
original.addGroup(0, 3, 2);
original.addGroup(3, 3, 5);
original.setAttribute(
  'color',
  new THREE.Uint8BufferAttribute(
    [255, 128, 0, 128, 255, 0, 0, 128, 255, 255, 255, 255],
    3,
    true,
  ),
);
const identity = new THREE.Matrix4();
const packet = packGeometry(original);
const transferred = structuredClone(packet, {
  transfer: transferBuffers(packet),
});
assert(
  original.attributes.position.array.byteLength > 0,
  'transferring worker data must not detach renderer-owned positions',
);
assert.equal(
  packet.attributes[0].array.byteLength,
  0,
  'the test must actually detach transferred buffers',
);
const response = processRepair({
  id: 1,
  geometry: transferred,
  matrix: identity.toArray(),
  volumes: packVolumes(volumes),
});
const actual = unpackGeometry(response.geometry),
  expected = subtractVolumes(original, identity, volumes);
assert.deepEqual(
  actual.groups,
  expected.groups,
  'material groups must survive the worker boundary',
);
for (const name of Object.keys(expected.attributes))
  assert.deepEqual(
    actual.attributes[name].array,
    expected.attributes[name].array,
    `${name} must match synchronous clipping, including normalized attributes`,
  );
assert(
  actual.boundingBox && actual.boundingSphere,
  'worker-computed bounds should not be recomputed on the rendering thread',
);
const interleaved = new THREE.InterleavedBuffer(
  new Float32Array([0, 0, 0, 1, 2, 3]),
  3,
);
const interGeometry = new THREE.BufferGeometry().setAttribute(
  'position',
  new THREE.InterleavedBufferAttribute(interleaved, 3, 0),
);
assert.deepEqual(
  [...unpackGeometry(packGeometry(interGeometry)).attributes.position.array],
  [0, 0, 0, 1, 2, 3],
);

class ControlledWorker {
  message = null;
  terminated = false;
  onmessage = null;
  onerror = null;
  postMessage(message, transfer) {
    this.message = structuredClone(message, { transfer });
  }
  finish() {
    const result = processRepair(this.message);
    const transferredResult = structuredClone(result, {
      transfer: result.geometry ? transferBuffers(result.geometry) : [],
    });
    this.onmessage?.({ data: transferredResult });
  }
  terminate() {
    this.terminated = true;
  }
}
const workers = [];
const queue = new MeshRepairQueue(() => {
  const w = new ControlledWorker();
  workers.push(w);
  return w;
});
const ownerA = {},
  ownerB = {},
  ownerC = {};
const a = queue.enqueue(ownerA, original, identity, volumes),
  b = queue.enqueue(ownerB, original, identity, volumes),
  c = queue.enqueue(ownerC, original, identity, volumes);
queue.pump();
queue.pump();
assert.equal(workers.length, 2, 'limit copied in-flight work to two workers');
assert.equal(queue.snapshot().queued, 1);
queue.cancel(ownerA);
queue.cancel(ownerC);
assert.equal(await a, null);
assert.equal(await c, null);
workers[0].finish();
workers[1].finish();
const kept = await b;
assert(kept.attributes.position.count > 0);
assert.equal(
  queue.snapshot().completed,
  1,
  'late cancelled results must be discarded',
);
assert.equal(queue.snapshot().cancelled, 2);
const pending = queue.enqueue({}, original, identity, volumes);
queue.pump();
queue.dispose();
assert.equal(await pending, null, 'dispose must settle in-flight promises');
assert(workers.every((w) => w.terminated));
workers[0].finish(); // No late application after termination/disposal.

const failureWorker = new ControlledWorker(),
  failureQueue = new MeshRepairQueue(() => failureWorker);
const failure = failureQueue.enqueue({}, original, identity, volumes);
const rejected = assert.rejects(failure, /preparation failed/);
failureQueue.pump();
failureWorker.onerror({});
await rejected;
assert.equal(failureQueue.snapshot().errors, 1);
failureQueue.dispose();

// Exercise the actual scene integration guard, not just the worker queue.
const sceneWorkers = [],
  sceneQueue = new MeshRepairQueue(() => {
    const w = new ControlledWorker();
    sceneWorkers.push(w);
    return w;
  });
const campus = Object.assign(Object.create(PhotorealCampus.prototype), {
  entries: new Map(),
  cutVolumes: volumes,
  repairQueue: sceneQueue,
  disposed: false,
  repairGeometry: new Set(),
  repairs: { meshes: 0 },
});
const mesh = new THREE.Mesh(original, new THREE.MeshBasicMaterial());
const scene = new THREE.Group().add(mesh),
  entry = { scene, triangles: 0 },
  tile = {};
campus.entries.set(tile, entry);
campus.prepareEntry(tile, entry);
sceneQueue.pump();
sceneQueue.cancel(entry);
campus.entries.delete(tile);
sceneWorkers[0].finish();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(
  mesh.geometry,
  original,
  'an unloaded tile must not receive a late geometry result',
);
assert.equal(campus.repairs.meshes, 0);
sceneQueue.dispose();

// Pending replacement tiles must retain the old collision until all desired
// replacements are ready, even when some other nearby tile is already ready.
await RAPIER.init();
const physics = new RAPIER.World({ x: 0, y: -9.8, z: 0 });
const old = physics.createCollider(RAPIER.ColliderDesc.cuboid(5, 0.1, 5));
const current = physics.createCollider(
  RAPIER.ColliderDesc.cuboid(5, 0.1, 5).setTranslation(10, 0, 0),
);
const oldEntry = {
  scene: new THREE.Group(),
  triangles: 12,
  colliders: [old],
  repaired: true,
  bounds: box,
};
const readyEntry = {
  scene: new THREE.Group(),
  triangles: 12,
  colliders: [current],
  repaired: true,
  bounds: box,
};
const pendingEntry = {
  scene: new THREE.Group(),
  triangles: 0,
  preparing: true,
  repaired: false,
  bounds: box,
};
const oldTile = { geometricError: 2 },
  readyTile = { geometricError: 2 },
  pendingTile = { geometricError: 2 };
Object.assign(campus, {
  aligned: true,
  physics,
  maxCollisionInstallMs: 0,
  collisionChanges: 0,
  entries: new Map([
    [oldTile, oldEntry],
    [readyTile, readyEntry],
    [pendingTile, pendingEntry],
  ]),
  tiles: { activeTiles: new Set([readyTile, pendingTile]) },
  repairQueue: { pump() {} },
});
assert.equal(campus.syncCollisions(new THREE.Vector3(0, 1, 0)), false);
assert(
  physics.getCollider(old.handle),
  'the old collider must remain while a replacement is pending',
);
pendingEntry.repaired = true;
pendingEntry.preparing = false;
pendingEntry.colliders = [];
assert.equal(campus.syncCollisions(new THREE.Vector3(0, 1, 0)), true);
assert.equal(
  physics.getCollider(old.handle),
  null,
  'retire the old collider after the replacement set is complete',
);
physics.free();
for (const geometry of [original, actual, expected, interGeometry, kept])
  geometry.dispose();
mesh.material.dispose();
const report = {
  checks: [
    'transfer ownership',
    'normalized and interleaved attributes',
    'UV and material group equivalence',
    'worker-computed bounds',
    'two-worker limit',
    'queued and in-flight cancellation',
    'dispose and late response',
    'worker failure rejection',
    'stale tile integration',
    'old collision retention until replacement readiness',
  ],
};
const evidencePrefix = process.argv[2] || 'current';
assert(/^[a-z0-9-]+$/.test(evidencePrefix), 'safe evidence prefix');
writeFileSync(
  new URL(`../evidence/${evidencePrefix}-worker-check.json`, import.meta.url),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(`PASS: ${report.checks.join(', ')}.`);
