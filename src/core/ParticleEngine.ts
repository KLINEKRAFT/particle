import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import type { ParticleBackend } from './backends/ParticleBackend';
import { WebGLParticleBackend } from './backends/WebGLParticleBackend';
import { WebGPUParticleBackend } from './backends/WebGPUParticleBackend';
import type { RendererManager } from './RendererManager';
import type { AppSettings, ParticleTarget, SimUniforms, BackendType } from '../types';
import { STYLE_ID, COLOR_MODE_ID, MOTION_MODE_ID } from './backends/enums';
import { hexToRgb } from '../util/color';

// Parse a hex color into a preallocated tuple to avoid per-frame allocation.
function hexInto(hex: string, out: [number, number, number]): void {
  const h = hex.charCodeAt(0) === 35 ? hex.slice(1) : hex;
  if (h.length >= 6) {
    const int = parseInt(h.slice(0, 6), 16);
    out[0] = ((int >> 16) & 255) / 255;
    out[1] = ((int >> 8) & 255) / 255;
    out[2] = (int & 255) / 255;
  } else {
    const rgb = hexToRgb(hex);
    out[0] = rgb[0];
    out[1] = rgb[1];
    out[2] = rgb[2];
  }
}

// ============================================================================
// ParticleEngine — creates the correct backend, feeds it targets and per-frame
// uniforms derived from AppSettings, and exposes framing info to the camera.
// ============================================================================

export class ParticleEngine {
  private backend: ParticleBackend;
  readonly type: BackendType;
  private count = 0;
  private boundRadius = 1.5;
  private pointer = new THREE.Vector3();
  private pointerActive = 0;
  private hasImageColor = false;

  // Reused each frame to avoid allocations in the animation loop.
  private u: SimUniforms = {
    dt: 0, time: 0, motionMode: 0, motionStrength: 0, motionScale: 0.5, motionSpeed: 0.3,
    damping: 0.9, returnForce: 2.4, pointer: [0, 0, 0], pointerActive: 0, pointerRadius: 1.2,
    pointerStrength: 3, seed: 1, morphActive: 0, size: 1, sizeAttenuation: 1, opacity: 0.9,
    softEdge: 0.5, glow: 0.4, distanceFade: 0.15, styleId: 0, colorMode: 1,
    color1: [1, 1, 1], color2: [1, 1, 1], color3: [1, 1, 1], hueShift: 0, saturation: 1,
    brightness: 1, contrast: 1, colorAnimSpeed: 0, gradientRotation: 90, boundRadius: 1.5,
  };

  constructor(rm: RendererManager) {
    if (rm.type === 'webgpu') {
      this.backend = new WebGPUParticleBackend(rm.renderer as WebGPURenderer, rm.scene);
      this.type = 'webgpu';
    } else {
      this.backend = new WebGLParticleBackend(rm.renderer as THREE.WebGLRenderer, rm.scene);
      this.type = 'webgl2';
    }
  }

  getCount(): number {
    return this.count;
  }

  getBoundRadius(): number {
    return this.boundRadius;
  }

  hasColorData(): boolean {
    return this.hasImageColor;
  }

  allocate(count: number): void {
    this.count = count;
    this.backend.allocate(count);
  }

  setTarget(target: ParticleTarget, snap: boolean): void {
    this.hasImageColor = target.hasColor;
    // framing radius = furthest point from origin (with small margin)
    const b = target.bounds;
    const ext = Math.max(
      Math.abs(b.min[0]), Math.abs(b.max[0]),
      Math.abs(b.min[1]), Math.abs(b.max[1]),
      Math.abs(b.min[2]), Math.abs(b.max[2]),
    );
    this.boundRadius = Math.max(0.5, ext);
    this.backend.setTargets(target, snap);
  }

  applyMorphImpulse(styleId: number, strength: number): void {
    this.backend.applyMorphImpulse(styleId, strength);
  }

  setPointer(world: THREE.Vector3 | null): void {
    if (world) {
      this.pointer.copy(world);
      this.pointerActive = 1;
    } else {
      this.pointerActive = 0;
    }
  }

  /** Push all per-frame uniforms derived from settings. */
  applySettings(s: AppSettings, elapsed: number): void {
    const motion = s.motion;
    const col = s.color;
    const part = s.particles;

    // If the current source carries per-particle image colors and the user has
    // not chosen an explicit color mode override, use image colors.
    let colorMode = COLOR_MODE_ID[col.mode];
    if (col.mode === 'image' && !this.hasImageColor) {
      colorMode = COLOR_MODE_ID.solid;
    }

    const u = this.u;
    u.time = elapsed;
    u.motionMode = motion.enabled ? MOTION_MODE_ID[motion.mode] : 0;
    u.motionStrength = motion.enabled ? motion.strength : 0;
    u.motionScale = motion.scale;
    u.motionSpeed = motion.speed;
    u.damping = motion.damping;
    u.returnForce = motion.returnForce;
    u.pointer[0] = this.pointer.x;
    u.pointer[1] = this.pointer.y;
    u.pointer[2] = this.pointer.z;
    u.pointerActive = this.pointerActive;
    u.pointerRadius = motion.radius;
    u.pointerStrength = motion.pointerRepel ? -Math.abs(motion.pointerStrength) : Math.abs(motion.pointerStrength);
    u.seed = motion.seed % 1000;
    u.size = part.size;
    u.sizeAttenuation = part.sizeAttenuation ? 1 : 0;
    u.opacity = part.opacity;
    u.softEdge = part.softEdge;
    u.glow = part.glow;
    u.distanceFade = part.distanceFade;
    u.styleId = STYLE_ID[part.style];
    u.colorMode = colorMode;
    hexInto(col.color1, u.color1);
    hexInto(col.color2, u.color2);
    hexInto(col.color3, u.color3);
    u.hueShift = col.hueShift;
    u.saturation = col.saturation;
    u.brightness = col.brightness;
    u.contrast = col.contrast;
    u.colorAnimSpeed = col.animationSpeed;
    u.gradientRotation = col.gradientRotation;
    u.boundRadius = this.boundRadius;
    this.backend.setUniforms(u);

    // Blending / depth test are material-level; both backends expose setBlending.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.backend as any).setBlending?.(part.blend === 'additive', part.depthTest);
  }

  step(dt: number, elapsed: number): void {
    this.backend.step(dt, elapsed);
  }

  /** Rigid turntable rotation of the whole particle cloud (degrees/sec). */
  spin(dt: number, sx: number, sy: number, sz: number): void {
    if (sx === 0 && sy === 0 && sz === 0) return;
    const o = this.backend.getObject();
    const k = (Math.PI / 180) * dt;
    o.rotation.x += sx * k;
    o.rotation.y += sy * k;
    o.rotation.z += sz * k;
  }

  dispose(): void {
    this.backend.dispose();
  }
}
