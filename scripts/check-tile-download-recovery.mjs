import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import { TilesRendererBase, DownloadPriorityQueue, PriorityQueue, LRUCache, UNLOADED } from '3d-tiles-renderer/core';
registerHooks({ load(url, context, next) {
  if (!url.endsWith('.ts')) return next(url, context);
  return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText };
} });
const { TileDownloadRecovery, resetRateLimitedTiles } = await import('../lib/campus/tile-download-recovery.ts');
const frames = [];
globalThis.requestAnimationFrame = callback => frames.push(callback);
let now = 0, resets = 0, requests = 0;
const recovery = new TileDownloadRecovery(() => resets++, () => now);
const other = new TileDownloadRecovery(() => assert.fail('unrelated scene reset'), () => now);
recovery.failure('429');
assert.equal(recovery.queue.maxJobsPerOrigin, 0);
assert.equal(other.queue.maxJobsPerOrigin, 6, 'a rate limit does not pause another renderer');
const pending = recovery.queue.add('https://tiles.example.test/content', {}, async () => ++requests);
for (const queue of recovery.queue.originQueues.values()) queue.tryRunJobs();
assert.equal(requests, 0, 'queued downloads stop during cooldown');
now = 10_000; recovery.failure('429');
now = 59_999; recovery.update(); assert.equal(resets, 0);
now = 60_000; recovery.update();
assert.equal(resets, 1, 'an in-flight error burst consumes one recovery attempt');
assert.equal(recovery.queue.maxJobsPerOrigin, 4);
for (const queue of recovery.queue.originQueues.values()) queue.tryRunJobs();
assert.equal(await pending, 1, 'already queued work resumes');
const waits = [];
for (const delay of [120_000, 240_000]) {
  now++; recovery.failure('429'); waits.push(recovery.snapshot().retryInSeconds);
  now += delay - 1; recovery.update(); const previous = resets;
  now++; recovery.update(); assert.equal(resets, previous + 1);
}
recovery.failure('429');
now += 1_000_000; recovery.update();
assert.equal(resets, 3, 'persistent rejection has a finite retry budget');
assert.equal(recovery.snapshot().state, 'paused');
assert.equal(recovery.queue.maxJobsPerOrigin, 0);
let forbiddenResets = 0;
const mixed = new TileDownloadRecovery(() => forbiddenResets++, () => now);
mixed.failure('403'); mixed.failure('429'); now += 60_000; mixed.update();
assert.equal(forbiddenResets, 0, 'resetFailedTiles must not repeat an authorization rejection');
assert.equal(mixed.queue.maxJobsPerOrigin, 4, 'unfailed queued work may resume');
let disposedResets = 0;
const disposed = new TileDownloadRecovery(() => disposedResets++, () => now);
disposed.failure('429'); disposed.dispose(); now += 60_000; disposed.update();
assert.equal(disposedResets, 0, 'disposed scenes cannot resume');
assert.equal(disposed.queue.maxJobsPerOrigin, 0);
let recoveredResets = 0;
const recovered = new TileDownloadRecovery(() => recoveredResets++, () => now);
recovered.failure('429'); now += 60_000; recovered.update();
now += 120_001; recovered.success(); recovered.failure('429');
assert.equal(recovered.snapshot().retryInSeconds, 60, 'sustained successful loading resets the consecutive-attempt budget');
const report = { passed: true, initialWaitSeconds: 60, subsequentWaitSeconds: waits,
  boundedRetries: resets, queuedWorkResumed: requests, independentQueue: other.snapshot(),
  permanentFailuresNotRetried: forbiddenResets === 0, disposedSceneNotRetried: disposedResets === 0,
  networkRequests: 0, limits: 'Local fake-clock and real queue checks; provider quota recovery still requires browser evidence.' };
for (const item of [recovery, other, mixed, disposed, recovered]) item.dispose();
// Reproduce the pinned renderer's failed-cache behavior with actual request,
// parse and eviction paths. The fetch plugin returns local Response fixtures.
globalThis.window = { location: { href: 'https://fixtures.example.test/' } };
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = clearTimeout;
const renderer = new TilesRendererBase();
renderer.downloadQueue = new DownloadPriorityQueue(); renderer.parseQueue = new PriorityQueue(); renderer.lruCache = new LRUCache();
const tile = { boundingVolume: { sphere: [0,0,0,1] }, geometricError: 1, refine: 'REPLACE', content: { uri: 'content.json' } };
renderer.preprocessNode(tile, 'https://fixtures.example.test'); renderer.rootTileset = { asset: { version: '1.0' }, root: tile };
let fetches = 0;
renderer.registerPlugin({ name: 'FIXTURE_FETCH', fetchData: async () => {
  fetches++;return fetches === 1 ? new Response('', { status: 429 }) : Response.json({ asset: { version: '1.0' }, root: { boundingVolume: { sphere: [0,0,0,1] }, geometricError: 0 } });
} });
const originalError = console.error;
try {
  console.error = () => {}; // expected synthetic 429, never a live provider error
  await renderer.requestTileContents(tile);
} finally { console.error = originalError; }
assert.equal(fetches, 1); assert(renderer.lruCache.has(tile));
const failedBeforeBulkReset = renderer.stats.failed;
renderer.resetFailedTiles();
assert.equal(tile.internal.loadingState, UNLOADED);
await renderer.requestTileContents(tile);
assert.equal(fetches, 1, 'resetting status alone leaves the failed cached tile unable to retry');
const lazyChild = { boundingVolume: { sphere: [0,0,0,1] }, geometricError: 0 };
tile.children.push(lazyChild);
// Restore the real failure counter changed by the preceding comparison, so
// the lazy-child case starts with the same pending failure as a fresh load.
renderer.stats.failed = failedBeforeBulkReset;
assert.throws(() => renderer.resetFailedTiles(), /loadingState/, 'the library bulk reset also fails on uninitialized children');
const unrelated = {}; let unrelatedDisposed = false;
renderer.lruCache.add(unrelated, () => { unrelatedDisposed = true; });
const failed = new Set([tile]);resetRateLimitedTiles(renderer, failed);
assert(!renderer.lruCache.has(tile)); assert(renderer.lruCache.has(unrelated));assert(!unrelatedDisposed);
assert.equal(lazyChild.internal, undefined, 'targeted recovery does not traverse or initialize unrelated lazy metadata');
assert.equal(renderer.stats.failed, 0, 'failed accounting is balanced after targeted eviction');
await renderer.requestTileContents(tile);
assert.equal(fetches, 2, 'evicting the failed tile permits the real library request path to retry');
assert.equal(tile.children.length, 2, 'successful retry parses the external tileset while preserving the existing child');
assert.equal(failed.size, 0);
report.failedCacheReproduction = { requestsBeforeEviction: 1, requestsAfterEviction: fetches, parsedChildren: 1, unrelatedEntryPreserved: true, lazyChildPreserved: true, failedAccounting: renderer.stats.failed };
renderer.lruCache.remove(tile);renderer.lruCache.remove(unrelated);renderer.dispose();
writeFileSync('evidence/iteration-25-tile-download-recovery-check.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
