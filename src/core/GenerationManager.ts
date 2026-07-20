import type { ParticleTarget, WorkerRequest, WorkerResponse } from '../types';

// Owns the generation Web Worker. Each generate() call gets a fresh jobId; only
// the newest job's result resolves — stale/cancelled jobs are dropped. This is
// the cancellation-token mechanism required for responsive count/param changes.
export class GenerationManager {
  private worker: Worker;
  private jobId = 0;
  private pending: Map<number, { resolve: (t: ParticleTarget) => void; reject: (e: Error) => void }> = new Map();

  constructor() {
    this.worker = new Worker(new URL('../workers/imageTextWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const res = ev.data;
      const entry = this.pending.get(res.jobId);
      if (!entry) return; // stale — ignore
      this.pending.delete(res.jobId);
      if (res.ok && res.positions && res.colors && res.count != null && res.bounds) {
        entry.resolve({
          positions: res.positions,
          colors: res.colors,
          count: res.count,
          hasColor: res.hasColor ?? false,
          bounds: res.bounds,
        });
      } else {
        entry.reject(new Error(res.error || 'Generation failed'));
      }
    };
    this.worker.onerror = (ev) => {
      // Reject everything outstanding on a worker-level failure.
      const err = new Error(ev.message || 'Worker error');
      for (const [, e] of this.pending) e.reject(err);
      this.pending.clear();
    };
  }

  /** Cancels all outstanding jobs (their results will be ignored). */
  cancelAll(): void {
    for (const [, e] of this.pending) e.reject(new Error('cancelled'));
    this.pending.clear();
  }

  generate(req: Omit<WorkerRequest, 'jobId'>, transfer: Transferable[] = []): Promise<ParticleTarget> {
    // Newer job supersedes older ones.
    this.cancelAll();
    const jobId = ++this.jobId;
    const full: WorkerRequest = { ...req, jobId } as WorkerRequest;
    return new Promise<ParticleTarget>((resolve, reject) => {
      this.pending.set(jobId, { resolve, reject });
      this.worker.postMessage(full, transfer);
    });
  }

  dispose(): void {
    this.cancelAll();
    this.worker.terminate();
  }
}
