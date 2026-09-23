import type { ChunkRequest, ChunkResult } from './ChunkBuilder';
import type { TerrainParams } from '../../universe/types';

interface Job {
  id: number;
  req: ChunkRequest;
  priority: number;
  resolve: (r: ChunkResult | null) => void;
  cancelled: boolean;
}

/**
 * Pool of terrain workers with a priority queue. Jobs can be cancelled
 * before dispatch (e.g. when the camera moves away before a chunk is built).
 */
export class TerrainWorkerPool {
  private workers: Worker[] = [];
  private busy: boolean[] = [];
  private queue: Job[] = [];
  private inflight = new Map<number, Job>();
  private nextId = 1;
  private registered = new Map<string, TerrainParams>();

  constructor(count = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))) {
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e) => this.onMessage(i, e.data);
      this.workers.push(w);
      this.busy.push(false);
    }
  }

  get pending(): number {
    return this.queue.length + this.inflight.size;
  }

  register(key: string, params: TerrainParams): void {
    if (this.registered.has(key)) return;
    this.registered.set(key, params);
    for (const w of this.workers) w.postMessage({ type: 'register', key, params });
  }

  unregister(key: string): void {
    if (!this.registered.delete(key)) return;
    for (const w of this.workers) w.postMessage({ type: 'unregister', key });
    for (const j of this.queue) if (j.req.planet === key) j.cancelled = true;
  }

  request(req: ChunkRequest, priority: number): { promise: Promise<ChunkResult | null>; cancel: () => void; setPriority: (p: number) => void } {
    let job!: Job;
    const promise = new Promise<ChunkResult | null>((resolve) => {
      job = { id: this.nextId++, req, priority, resolve, cancelled: false };
    });
    this.queue.push(job);
    this.pump();
    return {
      promise,
      cancel: () => {
        job.cancelled = true;
      },
      setPriority: (p: number) => {
        job.priority = p;
      },
    };
  }

  /** Dispatch highest priority (lowest value) jobs to idle workers. */
  pump(): void {
    if (this.queue.length === 0) return;
    // drop cancelled
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const j = this.queue[i];
      if (j.cancelled) {
        this.queue.splice(i, 1);
        j.resolve(null);
      }
    }
    for (let w = 0; w < this.workers.length; w++) {
      if (this.busy[w] || this.queue.length === 0) continue;
      let best = 0;
      for (let i = 1; i < this.queue.length; i++) if (this.queue[i].priority < this.queue[best].priority) best = i;
      const job = this.queue.splice(best, 1)[0];
      this.busy[w] = true;
      this.inflight.set(job.id, job);
      this.workers[w].postMessage({ type: 'build', id: job.id, req: job.req });
    }
  }

  private onMessage(w: number, data: { type: string; id: number; res?: ChunkResult }): void {
    this.busy[w] = false;
    const job = this.inflight.get(data.id);
    this.inflight.delete(data.id);
    if (job) job.resolve(job.cancelled || data.type !== 'built' ? null : data.res!);
    this.pump();
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }
}
