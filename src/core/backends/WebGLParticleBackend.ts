import * as THREE from 'three';
import { GPUComputationRenderer, type Variable } from 'three/addons/misc/GPUComputationRenderer.js';
import type { ParticleBackend } from './ParticleBackend';
import type { ParticleTarget, SimUniforms } from '../../types';
import { GLSL_NOISE, GLSL_MOTION, GLSL_COLOR } from './glsl';

// ============================================================================
// WebGL2 backend. Uses GPUComputationRenderer to integrate particle position &
// velocity in render-target textures (GPGPU), and renders with gl.POINTS.
// ============================================================================

const velocityFragment = /* glsl */ `
uniform sampler2D targetTex;
uniform float uDt, uReturn, uDamping, uMotionStrength, uMotionScale, uMotionSpeed, uMotionMode, uTime, uSeed;
uniform vec3 uPointer;
uniform float uPointerActive, uPointerRadius, uPointerStrength;
uniform float uImpulse, uImpulseStyle;
${GLSL_NOISE}
${GLSL_MOTION}
void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec3 pos = texture2D(texturePosition, uv).xyz;
  vec3 vel = texture2D(textureVelocity, uv).xyz;
  vec3 tgt = texture2D(targetTex, uv).xyz;

  vec3 force = (tgt - pos) * uReturn;
  if (uMotionMode > 0.5 && uMotionStrength > 0.0001) {
    force += motionForce(pos, tgt, uMotionMode, uMotionScale, uMotionSpeed, uTime, uSeed) * uMotionStrength * 6.0;
  }
  if (uPointerActive > 0.5) {
    vec3 d = pos - uPointer;
    float dist = length(d);
    if (dist < uPointerRadius) {
      float fall = 1.0 - dist / uPointerRadius;
      force += normalize(d + 1e-5) * fall * uPointerStrength;
    }
  }
  vel += force * uDt;
  vel *= uDamping;

  // one-shot morph impulse
  if (uImpulse > 0.0001) {
    float r1 = hash13(pos * 31.0 + uSeed);
    float r2 = hash13(pos * 37.0 + uSeed + 3.0);
    float r3 = hash13(pos * 41.0 + uSeed + 7.0);
    vec3 rndDir = normalize(vec3(r1, r2, r3) - 0.5 + 1e-5);
    vec3 imp = rndDir;
    if (uImpulseStyle > 1.5 && uImpulseStyle < 2.5) imp = normalize(pos + 1e-5);          // explode
    else if (uImpulseStyle > 2.5 && uImpulseStyle < 3.5) imp = cross(vec3(0.0,1.0,0.0), pos); // spiral
    vel += imp * uImpulse * (0.5 + r1);
  }
  gl_FragColor = vec4(vel, 1.0);
}
`;

const positionFragment = /* glsl */ `
uniform float uDt, uSpeed;
void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec3 pos = texture2D(texturePosition, uv).xyz;
  vec3 vel = texture2D(textureVelocity, uv).xyz;
  pos += vel * uDt * uSpeed;
  // Scrub non-finite / runaway positions so a bad particle can't streak.
  bvec3 finite = lessThan(abs(pos), vec3(1e4));
  pos = vec3(finite.x ? pos.x : 0.0, finite.y ? pos.y : 0.0, finite.z ? pos.z : 0.0);
  pos = clamp(pos, vec3(-40.0), vec3(40.0));
  gl_FragColor = vec4(pos, 1.0);
}
`;

const renderVertex = /* glsl */ `
attribute vec2 reference;
uniform sampler2D posTex;
uniform sampler2D velTex;
uniform sampler2D colorTex;
uniform float uSize, uSizeAtten, uColorMode, uBoundR, uTime, uAnimSpeed, uGradRot;
uniform float uHueShift, uSat, uBright, uContrast, uDistanceFade;
uniform vec3 uColor1, uColor2, uColor3;
varying vec3 vColor;
varying float vFade;
${GLSL_COLOR}
void main(){
  vec3 pos = texture2D(posTex, reference).xyz;
  vec3 vel = texture2D(velTex, reference).xyz;
  vec3 imgColor = texture2D(colorTex, reference).xyz;
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float dist = max(0.001, -mvPosition.z);
  float size = uSize * 2.2;
  if (uSizeAtten > 0.5) size *= (9.0 / dist);
  gl_PointSize = clamp(size, 1.0, 48.0);
  vec3 base = computeBaseColor(uColorMode, imgColor, pos, vel, uBoundR, uColor1, uColor2, uColor3, uGradRot, uTime, uAnimSpeed);
  vColor = applyColorAdjust(base, uHueShift, uSat, uBright, uContrast);
  vFade = 1.0 - clamp((dist - uBoundR) / max(0.001, uBoundR * 6.0), 0.0, 1.0) * uDistanceFade;
}
`;

const renderFragment = /* glsl */ `
precision highp float;
uniform float uOpacity, uStyle, uSoftEdge, uGlow;
varying vec3 vColor;
varying float vFade;
void main(){
  vec2 pc = gl_PointCoord - 0.5;
  float r = length(pc);
  float alpha = 1.0;
  if (uStyle < 0.5) {                       // soft
    alpha = smoothstep(0.5, 0.5 - uSoftEdge * 0.5 - 0.02, r);
  } else if (uStyle < 1.5) {                // dot (crisp)
    alpha = 1.0 - smoothstep(0.42, 0.5, r);
  } else if (uStyle < 2.5) {                // square
    alpha = step(max(abs(pc.x), abs(pc.y)), 0.5);
  } else if (uStyle < 3.5) {                // glowing disc
    alpha = pow(smoothstep(0.5, 0.0, r), 1.5);
  } else if (uStyle < 4.5) {                // spark (cross)
    float cross_ = max(smoothstep(0.08, 0.0, abs(pc.x)), smoothstep(0.08, 0.0, abs(pc.y)));
    float core = smoothstep(0.5, 0.0, r);
    alpha = max(cross_ * (1.0 - r * 1.6), core);
  } else {                                  // sphere-ish shaded
    if (r > 0.5) discard;
    float z = sqrt(max(0.0, 0.25 - r * r));
    float shade = 0.4 + 0.6 * z * 2.0;
    gl_FragColor = vec4(vColor * shade, uOpacity * vFade);
    return;
  }
  if (alpha < 0.01) discard;
  vec3 col = vColor * (1.0 + uGlow * (1.0 - r) * 0.8);
  gl_FragColor = vec4(col, alpha * uOpacity * vFade);
}
`;

export class WebGLParticleBackend implements ParticleBackend {
  readonly type = 'webgl2' as const;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private count = 0;
  private texW = 1;

  private gpu: GPUComputationRenderer | null = null;
  private posVar: Variable | null = null;
  private velVar: Variable | null = null;
  private targetTexture: THREE.DataTexture | null = null;
  private colorTexture: THREE.DataTexture | null = null;

  private points: THREE.Points | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.ShaderMaterial | null = null;

  private pendingImpulse: { style: number; strength: number } | null = null;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.renderer = renderer;
    this.scene = scene;
  }

  getObject(): THREE.Object3D {
    if (!this.points) throw new Error('Backend not allocated');
    return this.points;
  }

  getCount(): number {
    return this.count;
  }

  allocate(count: number): void {
    this.disposeGpu();
    this.count = count;
    const size = Math.ceil(Math.sqrt(count));
    this.texW = size;

    const gpu = new GPUComputationRenderer(size, size, this.renderer);
    const pos0 = gpu.createTexture();
    const vel0 = gpu.createTexture();
    // initialise velocity to zero, position to origin (real targets set later)
    const posData = pos0.image.data as Float32Array;
    const velData = vel0.image.data as Float32Array;
    posData.fill(0);
    velData.fill(0);

    const posVar = gpu.addVariable('texturePosition', positionFragment, pos0);
    const velVar = gpu.addVariable('textureVelocity', velocityFragment, vel0);
    gpu.setVariableDependencies(posVar, [posVar, velVar]);
    gpu.setVariableDependencies(velVar, [posVar, velVar]);

    // Custom uniforms.
    this.targetTexture = this.makeDataTexture(size);
    Object.assign(velVar.material.uniforms, {
      targetTex: { value: this.targetTexture },
      uDt: { value: 0.016 },
      uReturn: { value: 2.4 },
      uDamping: { value: 0.9 },
      uMotionStrength: { value: 0 },
      uMotionScale: { value: 0.5 },
      uMotionSpeed: { value: 0.3 },
      uMotionMode: { value: 0 },
      uTime: { value: 0 },
      uSeed: { value: 1.0 },
      uPointer: { value: new THREE.Vector3() },
      uPointerActive: { value: 0 },
      uPointerRadius: { value: 1.2 },
      uPointerStrength: { value: 3 },
      uImpulse: { value: 0 },
      uImpulseStyle: { value: 0 },
    });
    Object.assign(posVar.material.uniforms, {
      uDt: { value: 0.016 },
      uSpeed: { value: 1 },
    });

    const err = gpu.init();
    if (err) throw new Error('GPUComputationRenderer init failed: ' + err);

    this.gpu = gpu;
    this.posVar = posVar;
    this.velVar = velVar;

    // Build render geometry.
    this.colorTexture = this.makeDataTexture(size);
    const geometry = new THREE.BufferGeometry();
    const refs = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      refs[i * 2] = ((i % size) + 0.5) / size;
      refs[i * 2 + 1] = (Math.floor(i / size) + 0.5) / size;
    }
    // Dummy position attribute (real position read from texture in vertex shader).
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('reference', new THREE.BufferAttribute(refs, 2));
    geometry.setDrawRange(0, count);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        posTex: { value: null },
        velTex: { value: null },
        colorTex: { value: this.colorTexture },
        uSize: { value: 2 },
        uSizeAtten: { value: 1 },
        uColorMode: { value: 1 },
        uBoundR: { value: 1.5 },
        uTime: { value: 0 },
        uAnimSpeed: { value: 0 },
        uGradRot: { value: 90 },
        uHueShift: { value: 0 },
        uSat: { value: 1 },
        uBright: { value: 1 },
        uContrast: { value: 1 },
        uDistanceFade: { value: 0.15 },
        uColor1: { value: new THREE.Color(0x3a86ff) },
        uColor2: { value: new THREE.Color(0xff006e) },
        uColor3: { value: new THREE.Color(0x8338ec) },
        uOpacity: { value: 0.9 },
        uStyle: { value: 0 },
        uSoftEdge: { value: 0.5 },
        uGlow: { value: 0.4 },
      },
      vertexShader: renderVertex,
      fragmentShader: renderFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.geometry = geometry;
    this.material = material;
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  private makeDataTexture(size: number): THREE.DataTexture {
    const data = new Float32Array(size * size * 4);
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true;
    return tex;
  }

  setTargets(target: ParticleTarget, snap: boolean): void {
    if (!this.targetTexture || !this.colorTexture || !this.gpu || !this.posVar) return;
    const size = this.texW;
    const tData = this.targetTexture.image.data as Float32Array;
    const cData = this.colorTexture.image.data as Float32Array;
    const n = Math.min(target.count, this.count);
    for (let i = 0; i < n; i++) {
      tData[i * 4] = target.positions[i * 3];
      tData[i * 4 + 1] = target.positions[i * 3 + 1];
      tData[i * 4 + 2] = target.positions[i * 3 + 2];
      tData[i * 4 + 3] = 1;
      cData[i * 4] = target.colors[i * 3];
      cData[i * 4 + 1] = target.colors[i * 3 + 1];
      cData[i * 4 + 2] = target.colors[i * 3 + 2];
      cData[i * 4 + 3] = 1;
    }
    // Park any surplus allocated particles at the last valid target so they
    // never appear as stray points at the origin.
    for (let i = n; i < this.count; i++) {
      const src = (n > 0 ? n - 1 : 0);
      tData[i * 4] = target.positions[src * 3] || 0;
      tData[i * 4 + 1] = target.positions[src * 3 + 1] || 0;
      tData[i * 4 + 2] = target.positions[src * 3 + 2] || 0;
      tData[i * 4 + 3] = 1;
    }
    this.targetTexture.needsUpdate = true;
    this.colorTexture.needsUpdate = true;

    if (snap) {
      // Seed both ping-pong position targets with the target positions.
      const seed = this.makeDataTexture(size);
      const sData = seed.image.data as Float32Array;
      sData.set(tData);
      seed.needsUpdate = true;
      this.gpu.renderTexture(seed, this.posVar.renderTargets[0]);
      this.gpu.renderTexture(seed, this.posVar.renderTargets[1]);
      seed.dispose();
      if (this.velVar) {
        const zero = this.makeDataTexture(size);
        this.gpu.renderTexture(zero, this.velVar.renderTargets[0]);
        this.gpu.renderTexture(zero, this.velVar.renderTargets[1]);
        zero.dispose();
      }
    }
  }

  applyMorphImpulse(style: number, strength: number): void {
    this.pendingImpulse = { style, strength };
  }

  setUniforms(u: SimUniforms): void {
    if (!this.velVar || !this.posVar || !this.material) return;
    const vu = this.velVar.material.uniforms;
    vu.uReturn.value = u.returnForce;
    vu.uDamping.value = u.damping;
    vu.uMotionStrength.value = u.motionStrength;
    vu.uMotionScale.value = u.motionScale;
    vu.uMotionSpeed.value = u.motionSpeed;
    vu.uMotionMode.value = u.motionMode;
    vu.uSeed.value = u.seed;
    (vu.uPointer.value as THREE.Vector3).set(u.pointer[0], u.pointer[1], u.pointer[2]);
    vu.uPointerActive.value = u.pointerActive;
    vu.uPointerRadius.value = u.pointerRadius;
    vu.uPointerStrength.value = u.pointerStrength;

    const pu = this.posVar.material.uniforms;
    pu.uSpeed.value = u.motionSpeed > 0 ? 1 : 1;

    const m = this.material.uniforms;
    m.uSize.value = u.size;
    m.uSizeAtten.value = u.sizeAttenuation;
    m.uColorMode.value = u.colorMode;
    m.uBoundR.value = u.boundRadius;
    m.uAnimSpeed.value = u.colorAnimSpeed;
    m.uGradRot.value = u.gradientRotation;
    m.uHueShift.value = u.hueShift;
    m.uSat.value = u.saturation;
    m.uBright.value = u.brightness;
    m.uContrast.value = u.contrast;
    m.uDistanceFade.value = u.distanceFade;
    (m.uColor1.value as THREE.Color).setRGB(u.color1[0], u.color1[1], u.color1[2]);
    (m.uColor2.value as THREE.Color).setRGB(u.color2[0], u.color2[1], u.color2[2]);
    (m.uColor3.value as THREE.Color).setRGB(u.color3[0], u.color3[1], u.color3[2]);
    m.uOpacity.value = u.opacity;
    m.uStyle.value = u.styleId;
    m.uSoftEdge.value = u.softEdge;
    m.uGlow.value = u.glow;
  }

  setBlending(additive: boolean, depthTest: boolean): void {
    if (!this.material) return;
    this.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.material.depthTest = depthTest;
    this.material.needsUpdate = true;
  }

  step(dt: number, elapsed: number): void {
    if (!this.gpu || !this.velVar || !this.posVar || !this.material) return;
    const clampedDt = Math.min(dt, 0.05);
    this.velVar.material.uniforms.uDt.value = clampedDt;
    this.velVar.material.uniforms.uTime.value = elapsed;
    this.posVar.material.uniforms.uDt.value = clampedDt;

    if (this.pendingImpulse) {
      this.velVar.material.uniforms.uImpulse.value = this.pendingImpulse.strength;
      this.velVar.material.uniforms.uImpulseStyle.value = this.pendingImpulse.style;
    }

    this.gpu.compute();

    if (this.pendingImpulse) {
      this.velVar.material.uniforms.uImpulse.value = 0;
      this.pendingImpulse = null;
    }

    this.material.uniforms.posTex.value = this.gpu.getCurrentRenderTarget(this.posVar).texture;
    this.material.uniforms.velTex.value = this.gpu.getCurrentRenderTarget(this.velVar).texture;
    this.material.uniforms.uTime.value = elapsed;
  }

  private disposeGpu(): void {
    if (this.points) {
      this.scene.remove(this.points);
      this.points = null;
    }
    this.geometry?.dispose();
    this.geometry = null;
    this.material?.dispose();
    this.material = null;
    this.gpu?.dispose();
    this.gpu = null;
    this.posVar = null;
    this.velVar = null;
    this.targetTexture?.dispose();
    this.targetTexture = null;
    this.colorTexture?.dispose();
    this.colorTexture = null;
  }

  dispose(): void {
    this.disposeGpu();
  }
}
