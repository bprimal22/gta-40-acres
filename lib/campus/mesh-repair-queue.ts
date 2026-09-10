import * as THREE from 'three';
// oxlint-disable-next-line import/default -- Vite's ?worker transform supplies this constructor export.
import RepairWorkerConstructor from './mesh-repair.worker.ts?worker';
import type { CutVolume } from './clip-volume';
import {
  packGeometry,
  packVolumes,
  transferBuffers,
  unpackGeometry,
  type RepairRequest,
  type RepairResponse,
} from './mesh-repair-protocol';

type Job = {
  id: number;
  owner: object;
  geometry: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
  volumes: CutVolume[];
  resolve: (result: THREE.BufferGeometry | null) => void;
  reject: (error: Error) => void;
  cancelled: boolean;
};
export interface RepairWorker {
  onmessage: ((event: MessageEvent<RepairResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: RepairRequest, transfer: Transferable[]): void;
  terminate(): void;
}
type Slot = { worker: RepairWorker; job?: Job };

export class MeshRepairQueue {
  private waiting: Job[] = [];
  private slots: Slot[] = [];
  private nextId = 0;
  private disposed = false;
  private failed = false;
  readonly stats = {
    completed: 0,
    cancelled: 0,
    errors: 0,
    errorName: '',
    workerMs: 0,
    maxWorkerMs: 0,
    maxTransferMs: 0,
  };
  // The explicit worker import lets Vite supply the browser URL; this project's
  // server/client transform rewrites import.meta.url to a virtual file URL.
  constructor(
    private createWorker: () => RepairWorker = () =>
      new RepairWorkerConstructor(),
  ) {}

  enqueue(
    owner: object,
    geometry: THREE.BufferGeometry,
    matrix: THREE.Matrix4,
    volumes: CutVolume[],
  ) {
    if (this.disposed) return Promise.resolve(null);
    if (this.failed)
      return Promise.reject(
        new Error('Campus surface preparation is unavailable.'),
      );
    return new Promise<THREE.BufferGeometry | null>((resolve, reject) => {
      this.waiting.push({
        id: ++this.nextId,
        owner,
        geometry,
        matrix: matrix.clone(),
        volumes,
        resolve,
        reject,
        cancelled: false,
      });
    });
  }
  // Called from the render loop with a small dispatch budget. Pending jobs hold
  // references only; copied/transferred geometry exists for at most two jobs.
  pump() {
    if (this.disposed || this.failed || !this.waiting.length) return;
    const start = performance.now();
    try {
      while (
        this.slots.length < 2 &&
        this.slots.filter((slot) => !slot.job).length < this.waiting.length
      )
        this.addWorker();
      for (const slot of this.slots) {
        if (slot.job || !this.waiting.length) continue;
        const job = this.waiting.shift()!;
        slot.job = job;
        const began = performance.now();
        const geometry = packGeometry(job.geometry);
        slot.worker.postMessage(
          {
            id: job.id,
            geometry,
            matrix: job.matrix.toArray(),
            volumes: packVolumes(job.volumes),
          },
          transferBuffers(geometry),
        );
        this.stats.maxTransferMs = Math.max(
          this.stats.maxTransferMs,
          performance.now() - began,
        );
        if (performance.now() - start > 2) break;
      }
    } catch (error) {
      this.stats.errorName =
        error instanceof Error ? error.name : 'UnknownError';
      this.fail();
    }
  }
  private addWorker() {
    const slot: Slot = { worker: this.createWorker() };
    slot.worker.onmessage = ({ data }) => {
      const job = slot.job;
      if (!job || job.id !== data.id || this.disposed) return;
      slot.job = undefined;
      if (job.cancelled) return;
      if (data.failed) {
        job.reject(new Error('Campus surface preparation failed.'));
        this.fail();
        return;
      }
      this.stats.completed++;
      this.stats.workerMs += data.milliseconds;
      this.stats.maxWorkerMs = Math.max(
        this.stats.maxWorkerMs,
        data.milliseconds,
      );
      job.resolve(data.geometry ? unpackGeometry(data.geometry) : null);
    };
    slot.worker.onerror = () => this.fail();
    this.slots.push(slot);
  }
  cancel(owner: object) {
    const cancel = (job: Job) => {
      if (job.owner !== owner || job.cancelled) return;
      job.cancelled = true;
      this.stats.cancelled++;
      job.resolve(null);
    };
    for (const job of this.waiting) cancel(job);
    this.waiting = this.waiting.filter((job) => !job.cancelled);
    for (const slot of this.slots) if (slot.job) cancel(slot.job);
  }
  private fail() {
    if (this.failed || this.disposed) return;
    this.failed = true;
    this.stats.errors++;
    for (const job of [
      ...this.waiting,
      ...this.slots.flatMap((s) => (s.job ? [s.job] : [])),
    ])
      if (!job.cancelled)
        job.reject(new Error('Campus surface preparation failed.'));
    this.waiting = [];
    for (const slot of this.slots) {
      slot.worker.terminate();
      slot.job = undefined;
    }
  }
  snapshot() {
    return {
      ...this.stats,
      queued: this.waiting.length,
      running: this.slots.filter((s) => s.job).length,
      workers: this.slots.length,
    };
  }
  dispose() {
    if (this.disposed) return;
    const owners = new Set(
      [
        ...this.waiting,
        ...this.slots.flatMap((s) => (s.job ? [s.job] : [])),
      ].map((j) => j.owner),
    );
    for (const owner of owners) this.cancel(owner);
    for (const slot of this.slots) slot.worker.terminate();
    this.slots = [];
    this.disposed = true;
  }
}
