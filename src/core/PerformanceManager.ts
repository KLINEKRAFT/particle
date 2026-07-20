import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import type { PerfStats, BackendType } from '../types';

// ============================================================================
// PerformanceManager — measures FPS / frame time, reads renderer draw stats,
// and drives adaptive quality (render-scale reduction) and optional automatic
// particle-count reduction when the frame rate stays below target.
// ============================================================================
export class PerformanceManager {
  private frames = 0;
  private accum = 0;
  fps = 60;
  frameMs = 16;
  private frameMsSmoothed = 16;

  private lowStreak = 0;
  private highStreak = 0;

  constructor(private renderer: THREE.WebGLRenderer | WebGPURenderer, private backend: BackendType) {}

  beginFrame(): number {
    return performance.now();
  }

  endFrame(start: number, dtMs: number): void {
    const ms = performance.now() - start;
    this.frameMsSmoothed = this.frameMsSmoothed * 0.9 + ms * 0.1;
    this.frameMs = this.frameMsSmoothed;
    this.frames++;
    this.accum += dtMs;
    if (this.accum >= 500) {
      this.fps = (this.frames * 1000) / this.accum;
      this.frames = 0;
      this.accum = 0;
    }
  }

  /**
   * Adaptive quality: returns a suggested render-scale delta and whether an
   * automatic particle reduction should fire. Called ~2x/second.
   */
  evaluate(
    targetFps: number,
    currentScale: number,
    autoReduce: boolean,
  ): { newScale: number; reduceParticles: boolean } {
    let newScale = currentScale;
    let reduceParticles = false;
    if (this.fps < targetFps * 0.8) {
      this.lowStreak++;
      this.highStreak = 0;
      if (this.lowStreak >= 3) {
        newScale = Math.max(0.5, currentScale - 0.1);
        if (newScale === currentScale && autoReduce) reduceParticles = true;
        this.lowStreak = 0;
      }
    } else if (this.fps > targetFps * 1.15) {
      this.highStreak++;
      this.lowStreak = 0;
      if (this.highStreak >= 6) {
        newScale = Math.min(1, currentScale + 0.1);
        this.highStreak = 0;
      }
    } else {
      this.lowStreak = 0;
      this.highStreak = 0;
    }
    return { newScale, reduceParticles };
  }

  getStats(count: number, renderScale: number, pixelRatio: number): PerfStats {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const info = (this.renderer as any).info;
    const render = info?.render ?? {};
    const memory = info?.memory ?? {};
    const drawCalls = render.calls ?? render.drawCalls ?? 0;
    const points = render.points ?? count;
    // Rough GPU memory estimate: ~40 bytes/particle across buffers/textures.
    const memMb = (count * 40) / (1024 * 1024) + (memory.textures ?? 0) * 0.5;
    return {
      fps: this.fps,
      frameMs: this.frameMs,
      gpuMs: 0,
      drawCalls,
      points,
      count,
      backend: this.backend,
      renderScale,
      pixelRatio,
      memoryMb: memMb,
    };
  }
}
