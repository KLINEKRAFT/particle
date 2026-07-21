// @ts-nocheck — This file is Three.js TSL (node-graph) glue. The MaterialX node
// helpers (mx_rgbtohsv, mx_hsvtorgb, ...) are typed as bare `Node` and the fluent
// TSL builder API does not type-check cleanly under @types/three's strict
// generics. Type safety here would be illusory (the graph is validated by the
// shader compiler at runtime), so we opt this single glue file out of tsc while
// keeping every other module fully type-checked. esbuild strips types at build.
import * as THREE from 'three';
import { SpriteNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import {
  Fn, instancedArray, instanceIndex, uniform, vec3, float, uv, If,
  normalize, length, cross, mix, clamp, smoothstep, sin, cos, exp, pow, dot,
  max, fract, mx_noise_vec3, mx_rgbtohsv, mx_hsvtorgb, abs, step, cameraPosition,
} from 'three/tsl';
import type { ParticleBackend } from './ParticleBackend';
import type { ParticleTarget, SimUniforms } from '../../types';

// ============================================================================
// WebGPU backend. Particle state lives in GPU storage buffers (instancedArray);
// a TSL compute shader integrates position & velocity each frame. Rendering uses
// instanced camera-facing sprites (SpriteNodeMaterial) so particles have size —
// WebGPU point primitives are always 1px, so sprites are required.
// ============================================================================

export class WebGPUParticleBackend implements ParticleBackend {
  readonly type = 'webgpu' as const;

  private renderer: WebGPURenderer;
  private scene: THREE.Scene;
  private count = 0;

  // TSL node graphs are dynamically typed; we keep loose types for the glue.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  private positionBuffer: any = null;
  private velocityBuffer: any = null;
  private targetBuffer: any = null;
  private colorBuffer: any = null;
  private targetArray: Float32Array | null = null;
  private colorArray: Float32Array | null = null;

  private computeUpdate: any = null;
  private computeInit: any = null;
  private computeKick: any = null;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  private sprite: THREE.Sprite | null = null;
  private material: SpriteNodeMaterial | null = null;

  private pendingSnap = false;
  private pendingImpulse: { style: number; strength: number } | null = null;

  // Uniform nodes (JS-updatable via `.value`).
  private u = {
    dt: uniform(0.016),
    time: uniform(0),
    returnForce: uniform(2.4),
    damping: uniform(0.9),
    motionMode: uniform(0),
    motionStrength: uniform(0),
    motionScale: uniform(0.5),
    motionSpeed: uniform(0.3),
    speed: uniform(1),
    seed: uniform(1),
    pointer: uniform(new THREE.Vector3()),
    pointerActive: uniform(0),
    pointerRadius: uniform(1.2),
    pointerStrength: uniform(3),
    kickStrength: uniform(0),
    kickStyle: uniform(0),
    // visuals
    size: uniform(0.02),
    sizeAtten: uniform(1),
    opacity: uniform(0.9),
    softEdge: uniform(0.5),
    glow: uniform(0.4),
    style: uniform(0),
    distanceFade: uniform(0.15),
    boundR: uniform(1.5),
    colorMode: uniform(1),
    color1: uniform(new THREE.Color(0x3a86ff)),
    color2: uniform(new THREE.Color(0xff006e)),
    color3: uniform(new THREE.Color(0x8338ec)),
    hueShift: uniform(0),
    saturation: uniform(1),
    brightness: uniform(1),
    contrast: uniform(1),
    colorAnimSpeed: uniform(0),
    gradientRotation: uniform(90),
  };

  constructor(renderer: WebGPURenderer, scene: THREE.Scene) {
    this.renderer = renderer;
    this.scene = scene;
  }

  getObject(): THREE.Object3D {
    if (!this.sprite) throw new Error('Backend not allocated');
    return this.sprite;
  }

  getCount(): number {
    return this.count;
  }

  allocate(count: number): void {
    this.disposeGpu();
    this.count = count;

    const positionBuffer = instancedArray(count, 'vec3');
    const velocityBuffer = instancedArray(count, 'vec3');
    const targetBuffer = instancedArray(count, 'vec3');
    const colorBuffer = instancedArray(count, 'vec3');
    this.positionBuffer = positionBuffer;
    this.velocityBuffer = velocityBuffer;
    this.targetBuffer = targetBuffer;
    this.colorBuffer = colorBuffer;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.targetArray = (targetBuffer as any).value.array as Float32Array;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.colorArray = (colorBuffer as any).value.array as Float32Array;

    const u = this.u;

    // ---- init compute: copy target -> position, zero velocity ----
    this.computeInit = Fn(() => {
      const pos = positionBuffer.element(instanceIndex);
      const vel = velocityBuffer.element(instanceIndex);
      pos.assign(targetBuffer.element(instanceIndex));
      vel.assign(vec3(0, 0, 0));
    })().compute(count);

    // ---- kick compute: apply a morph impulse to velocity ----
    this.computeKick = Fn(() => {
      const pos = positionBuffer.element(instanceIndex).toVar();
      const vel = velocityBuffer.element(instanceIndex);
      const n = mx_noise_vec3(pos.mul(11.0).add(u.seed));
      const rndDir = normalize(n.add(1e-5));
      const explodeDir = normalize(pos.add(1e-5));
      const spiralDir = cross(vec3(0, 1, 0), pos);
      const dir = vec3(0).toVar();
      dir.assign(rndDir);
      If(u.kickStyle.greaterThan(1.5).and(u.kickStyle.lessThan(2.5)), () => {
        dir.assign(explodeDir);
      });
      If(u.kickStyle.greaterThan(2.5).and(u.kickStyle.lessThan(3.5)), () => {
        dir.assign(spiralDir);
      });
      vel.addAssign(dir.mul(u.kickStrength).mul(n.x.mul(0.5).add(0.75)));
    })().compute(count);

    // ---- main integration compute ----
    this.computeUpdate = Fn(() => {
      const pos = positionBuffer.element(instanceIndex);
      const vel = velocityBuffer.element(instanceIndex);
      const tgt = targetBuffer.element(instanceIndex);

      const force = tgt.sub(pos).mul(u.returnForce).toVar();

      // motion field
      If(u.motionMode.greaterThan(0.5).and(u.motionStrength.greaterThan(0.0001)), () => {
        const p = pos.mul(u.motionScale).add(u.seed).add(u.time.mul(u.motionSpeed));
        const field = vec3(0).toVar();
        const up = vec3(0, 1, 0);
        If(u.motionMode.lessThan(3.5), () => {
          // curl / noise / brownian all use fluid vector noise
          field.assign(mx_noise_vec3(p));
        });
        If(u.motionMode.greaterThan(3.5).and(u.motionMode.lessThan(4.5)), () => {
          field.assign(cross(up, pos)); // orbital
        });
        If(u.motionMode.greaterThan(4.5).and(u.motionMode.lessThan(5.5)), () => {
          field.assign(vec3(0, sin(pos.x.mul(u.motionScale).mul(4).add(u.time.mul(u.motionSpeed))), 0)); // wave
        });
        If(u.motionMode.greaterThan(5.5).and(u.motionMode.lessThan(6.5)), () => {
          field.assign(cross(up, pos).add(pos.mul(-0.25))); // vortex
        });
        If(u.motionMode.greaterThan(6.5).and(u.motionMode.lessThan(7.5)), () => {
          field.assign(vec3(0, -1, 0)); // gravity
        });
        If(u.motionMode.greaterThan(7.5).and(u.motionMode.lessThan(8.5)), () => {
          field.assign(normalize(pos.add(1e-5)).mul(-1)); // attract
        });
        If(u.motionMode.greaterThan(8.5), () => {
          field.assign(normalize(pos.add(1e-5)).mul(exp(u.time.mul(-0.6))).mul(3)); // explode
        });
        force.addAssign(field.mul(u.motionStrength).mul(6));
      });

      // pointer force
      If(u.pointerActive.greaterThan(0.5), () => {
        const d = pos.sub(u.pointer);
        const dist = length(d);
        If(dist.lessThan(u.pointerRadius), () => {
          const fall = float(1).sub(dist.div(u.pointerRadius));
          force.addAssign(normalize(d.add(1e-5)).mul(fall).mul(u.pointerStrength));
        });
      });

      vel.addAssign(force.mul(u.dt));
      vel.mulAssign(u.damping);
      pos.addAssign(vel.mul(u.dt).mul(u.speed));
    })().compute(count);

    // ---- render material (instanced sprites) ----
    const material = new SpriteNodeMaterial();
    material.positionNode = positionBuffer.toAttribute();

    // size: world-space scale. When size attenuation is ON we keep a constant
    // world size (perspective naturally shrinks distant particles). When OFF we
    // scale with camera distance to hold an (approximately) constant screen size.
    const worldPos = positionBuffer.toAttribute();
    const camDist = max(length(cameraPosition.sub(worldPos)), 0.001);
    material.scaleNode = u.size.mul(mix(camDist.mul(0.35), float(1.0), u.sizeAtten));

    // color
    const baseColor = this.buildColorNode();
    material.colorNode = baseColor;

    // soft particle alpha from sprite quad uv — wrapped in Fn() so the
    // control-flow / mutable TSL ops have a builder stack.
    material.opacityNode = Fn(() => {
      const c = uv().sub(0.5);
      const r = length(c);
      const alpha = float(1).toVar();
      // soft (default)
      alpha.assign(smoothstep(0.5, float(0.5).sub(u.softEdge.mul(0.5)).sub(0.02), r));
      If(u.style.greaterThan(0.5).and(u.style.lessThan(1.5)), () => {
        alpha.assign(float(1).sub(smoothstep(0.42, 0.5, r))); // dot
      });
      If(u.style.greaterThan(1.5).and(u.style.lessThan(2.5)), () => {
        alpha.assign(step(max(abs(c.x), abs(c.y)), 0.5)); // square
      });
      If(u.style.greaterThan(2.5).and(u.style.lessThan(3.5)), () => {
        alpha.assign(pow(smoothstep(0.5, 0.0, r), 1.5)); // glowing disc
      });
      If(u.style.greaterThan(3.5).and(u.style.lessThan(4.5)), () => {
        const crossA = max(smoothstep(0.08, 0.0, abs(c.x)), smoothstep(0.08, 0.0, abs(c.y)));
        alpha.assign(max(crossA.mul(float(1).sub(r.mul(1.6))), smoothstep(0.5, 0.0, r))); // spark
      });
      If(u.style.greaterThan(4.5), () => {
        alpha.assign(smoothstep(0.5, 0.35, r)); // sphere-ish
      });
      return alpha.mul(u.opacity);
    })();
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = false;
    material.blending = THREE.AdditiveBlending;

    this.material = material;

    const sprite = new THREE.Sprite(material);
    sprite.count = count;
    sprite.frustumCulled = false;
    // Give it a huge bounding so it never culls.
    sprite.scale.set(1, 1, 1);
    this.sprite = sprite;
    this.scene.add(sprite);
  }

  private buildColorNode() {
    const u = this.u;
    const pos = this.positionBuffer!.toAttribute();
    const vel = this.velocityBuffer!.toAttribute();
    const img = this.colorBuffer!.toAttribute();
    const boundR = u.boundR;

    const gr = u.gradientRotation.mul(Math.PI / 180);
    const dir = vec3(cos(gr), sin(gr), 0);
    const proj = clamp(dot(pos.xy, dir.xy).div(boundR.mul(2)).add(0.5), 0, 1);
    const gY = clamp(pos.y.div(boundR.mul(2)).add(0.5), 0, 1);

    // Color uniforms are typed as color nodes; treat them as vec3 for math.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const c1 = vec3(u.color1 as any);
    const c2 = vec3(u.color2 as any);
    const c3 = vec3(u.color3 as any);
    /* eslint-enable @typescript-eslint/no-explicit-any */

    // Control-flow (If) and mutable (toVar/assign) TSL ops must live inside a
    // Fn() so the builder has a stack. This node runs per-vertex/fragment.
    return Fn(() => {
      const result = vec3(0).toVar();
      result.assign(c1); // solid default
      If(u.colorMode.greaterThan(0.5).and(u.colorMode.lessThan(1.5)), () => {
        result.assign(mix(c1, c2, proj));
      });
      If(u.colorMode.greaterThan(1.5).and(u.colorMode.lessThan(2.5)), () => {
        const a = mix(c1, c2, proj.mul(2));
        const b = mix(c2, c3, proj.sub(0.5).mul(2));
        result.assign(mix(a, b, step(0.5, proj)));
      });
      If(u.colorMode.greaterThan(2.5).and(u.colorMode.lessThan(3.5)), () => {
        result.assign(img); // image color
      });
      If(u.colorMode.greaterThan(3.5).and(u.colorMode.lessThan(4.5)), () => {
        result.assign(normalize(abs(pos).add(0.15))); // position
      });
      If(u.colorMode.greaterThan(4.5).and(u.colorMode.lessThan(5.5)), () => {
        const d = clamp(pos.z.div(boundR).add(0.5), 0, 1);
        result.assign(mix(c1, c2, d)); // depth
      });
      If(u.colorMode.greaterThan(5.5).and(u.colorMode.lessThan(6.5)), () => {
        const sp = clamp(length(vel).mul(2), 0, 1);
        result.assign(mix(c1, c2, sp)); // velocity
      });
      If(u.colorMode.greaterThan(6.5).and(u.colorMode.lessThan(7.5)), () => {
        const h = fract(gY.add(u.time.mul(u.colorAnimSpeed).mul(0.1)));
        result.assign(mx_hsvtorgb(vec3(h, 0.85, 1.0))); // rainbow
      });
      If(u.colorMode.greaterThan(7.5), () => {
        const idx = fract(gY.add(u.time.mul(u.colorAnimSpeed).mul(0.05)));
        result.assign(mix(c1, mix(c2, c3, idx), idx)); // palette
      });

      // color adjustments (hue / sat / brightness / contrast)
      const hsv = mx_rgbtohsv(result).toVar();
      hsv.x.assign(fract(hsv.x.add(u.hueShift)));
      hsv.y.assign(clamp(hsv.y.mul(u.saturation), 0, 1));
      const adj = mx_hsvtorgb(hsv).toVar();
      adj.mulAssign(u.brightness);
      adj.assign(adj.sub(0.5).mul(u.contrast).add(0.5));
      return clamp(adj, 0, 1);
    })();
  }

  setTargets(target: ParticleTarget, snap: boolean): void {
    if (!this.targetArray || !this.colorArray || !this.targetBuffer || !this.colorBuffer) return;
    const n = Math.min(target.count, this.count);
    this.targetArray.set(target.positions.subarray(0, n * 3), 0);
    this.colorArray.set(target.colors.subarray(0, n * 3), 0);
    // Park surplus particles on the last valid point.
    for (let i = n; i < this.count; i++) {
      const src = n > 0 ? n - 1 : 0;
      this.targetArray[i * 3] = target.positions[src * 3] || 0;
      this.targetArray[i * 3 + 1] = target.positions[src * 3 + 1] || 0;
      this.targetArray[i * 3 + 2] = target.positions[src * 3 + 2] || 0;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.targetBuffer as any).value.needsUpdate = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.colorBuffer as any).value.needsUpdate = true;
    if (snap) this.pendingSnap = true;
  }

  applyMorphImpulse(style: number, strength: number): void {
    this.pendingImpulse = { style, strength };
  }

  setUniforms(u: SimUniforms): void {
    const t = this.u;
    t.returnForce.value = u.returnForce;
    t.damping.value = u.damping;
    t.motionMode.value = u.motionMode;
    t.motionStrength.value = u.motionStrength;
    t.motionScale.value = u.motionScale;
    t.motionSpeed.value = u.motionSpeed;
    t.seed.value = u.seed;
    (t.pointer.value as THREE.Vector3).set(u.pointer[0], u.pointer[1], u.pointer[2]);
    t.pointerActive.value = u.pointerActive;
    t.pointerRadius.value = u.pointerRadius;
    t.pointerStrength.value = u.pointerStrength;

    t.size.value = u.size * 0.012;
    t.sizeAtten.value = u.sizeAttenuation;
    t.opacity.value = u.opacity;
    t.softEdge.value = u.softEdge;
    t.glow.value = u.glow;
    t.style.value = u.styleId;
    t.distanceFade.value = u.distanceFade;
    t.boundR.value = u.boundRadius;
    t.colorMode.value = u.colorMode;
    (t.color1.value as THREE.Color).setRGB(u.color1[0], u.color1[1], u.color1[2]);
    (t.color2.value as THREE.Color).setRGB(u.color2[0], u.color2[1], u.color2[2]);
    (t.color3.value as THREE.Color).setRGB(u.color3[0], u.color3[1], u.color3[2]);
    t.hueShift.value = u.hueShift;
    t.saturation.value = u.saturation;
    t.brightness.value = u.brightness;
    t.contrast.value = u.contrast;
    t.colorAnimSpeed.value = u.colorAnimSpeed;
    t.gradientRotation.value = u.gradientRotation;
  }

  setBlending(additive: boolean, depthTest: boolean): void {
    if (!this.material) return;
    this.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.material.depthTest = depthTest;
    this.material.needsUpdate = true;
  }

  step(dt: number, elapsed: number): void {
    if (!this.computeUpdate) return;
    this.u.dt.value = Math.min(dt, 0.05);
    this.u.time.value = elapsed;

    if (this.pendingSnap && this.computeInit) {
      this.renderer.compute(this.computeInit);
      this.pendingSnap = false;
    }
    if (this.pendingImpulse && this.computeKick) {
      this.u.kickStrength.value = this.pendingImpulse.strength;
      this.u.kickStyle.value = this.pendingImpulse.style;
      this.renderer.compute(this.computeKick);
      this.pendingImpulse = null;
    }
    this.renderer.compute(this.computeUpdate);
  }

  private disposeGpu(): void {
    if (this.sprite) {
      this.scene.remove(this.sprite);
      this.sprite = null;
    }
    this.material?.dispose();
    this.material = null;
    // Storage buffers are GC'd; drop references.
    this.positionBuffer = null;
    this.velocityBuffer = null;
    this.targetBuffer = null;
    this.colorBuffer = null;
    this.targetArray = null;
    this.colorArray = null;
    this.computeUpdate = null;
    this.computeInit = null;
    this.computeKick = null;
  }

  dispose(): void {
    this.disposeGpu();
  }
}
