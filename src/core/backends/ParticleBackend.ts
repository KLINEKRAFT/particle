import type * as THREE from 'three';
import type { BackendType, ParticleTarget, SimUniforms } from '../../types';

// Common surface implemented by both the WebGPU and WebGL2 particle backends.
// The ParticleEngine talks only to this interface.
export interface ParticleBackend {
  readonly type: BackendType;

  /** The renderable object added to the scene (Points or instanced sprites). */
  getObject(): THREE.Object3D;

  /** Allocate GPU buffers for `count` particles. Disposes prior allocation. */
  allocate(count: number): void;

  /** Push new target positions/colors. `snap` teleports particles instead of springing. */
  setTargets(target: ParticleTarget, snap: boolean): void;

  /** Apply a morph impulse (scatter/explode/spiral) with a strength 0..1. */
  applyMorphImpulse(style: number, strength: number): void;

  /** Update per-frame simulation + visual uniforms. */
  setUniforms(u: SimUniforms): void;

  /** Advance the simulation by one step (runs compute / GPGPU passes). */
  step(dt: number, elapsed: number): void;

  /** Current allocated particle count. */
  getCount(): number;

  dispose(): void;
}
