import { DownloadPriorityQueue } from '3d-tiles-renderer/core';
import type { Tile, TilesRendererBase } from '3d-tiles-renderer/core';

export function resetRateLimitedTiles(
  renderer: Pick<TilesRendererBase, 'lruCache'>,
  failed: Set<Tile>,
) {
  // 0.5.2's bulk reset both retains failed cache entries and traverses lazy
  // children without internal state. Eviction resets each tracked tile through
  // the renderer's own abort/disposal callback, without visiting the whole tree.
  const count = failed.size;
  for (const tile of failed) renderer.lruCache.remove(tile);
  failed.clear();
  // The pinned library's eviction callback updates inCache/loading counts but
  // omits failed. This narrow compatibility adjustment balances those failures;
  // it does not change loading state or visit unrelated/uninitialized tiles.
  const stats = (renderer as typeof renderer & { stats?: { failed: number } }).stats;
  if (stats) stats.failed = Math.max(0, stats.failed - count);
}

// Own the queue: the renderer's default queue is shared between instances.
// Pausing this scene must not pause another renderer or survive a disposed game.
export class TileDownloadRecovery {
  readonly queue = new DownloadPriorityQueue();
  private nextRetry = 0;
  private attempts = 0;
  private totalRetries = 0;
  private lastLimit = -Infinity;
  private blocked = false;
  private disposed = false;
  private retryableFailuresOnly = true;

  constructor(private retryFailed: () => void, private now = () => performance.now()) {
    this.queue.maxJobsPerOrigin = 6;
  }

  failure(status?: string) {
    if (this.disposed) return;
    // Keep automatic recovery scoped to a run of known quota failures.
    if (status !== '429') {
      this.retryableFailuresOnly = false;
      return;
    }
    this.lastLimit = this.now();
    this.queue.maxJobsPerOrigin = 0;
    if (this.blocked || this.nextRetry) return; // one pause for an in-flight burst
    if (this.attempts >= 3) this.blocked = true;
    else this.nextRetry = this.now() + 60_000 * 2 ** this.attempts;
  }

  success() {
    if (!this.nextRetry && !this.blocked && this.now() - this.lastLimit > 120_000) {
      this.attempts = 0;
    }
  }

  update() {
    if (this.disposed || this.blocked || !this.nextRetry || this.now() < this.nextRetry) return;
    this.nextRetry = 0;
    this.attempts++;
    this.totalRetries++;
    this.queue.maxJobsPerOrigin = 4;
    if (this.retryableFailuresOnly) this.retryFailed();
    // The queue's concurrency setter does not wake already queued work.
    for (const queue of this.queue.originQueues.values()) queue.scheduleJobRun();
  }

  snapshot() {
    return {
      state: this.blocked ? 'paused' as const : this.nextRetry ? 'cooldown' as const : 'ready' as const,
      retryInSeconds: this.nextRetry ? Math.max(0, Math.ceil((this.nextRetry - this.now()) / 1000)) : 0,
      retryWaves: this.totalRetries,
      canRetryFailedTiles: this.retryableFailuresOnly,
      concurrentPerOrigin: this.queue.maxJobsPerOrigin,
    };
  }

  dispose() {
    this.disposed = true;
    this.nextRetry = 0;
    this.queue.maxJobsPerOrigin = 0;
  }
}
