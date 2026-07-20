import * as THREE from 'three';
import { WebGPURenderer, PostProcessing } from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { BackendType } from '../types';

// ============================================================================
// RendererManager — owns the renderer (WebGPU or WebGL2), the scene, sizing,
// device-pixel-ratio / render-scale handling, and optional bloom post-processing.
// ============================================================================

export interface RendererInfo {
  type: BackendType;
  adapterInfo: string;
}

export class RendererManager {
  renderer!: THREE.WebGLRenderer | WebGPURenderer;
  scene: THREE.Scene;
  type: BackendType = 'webgl2';
  canvas: HTMLCanvasElement;

  private width = 1;
  private height = 1;
  private pixelRatio = 1;

  // bloom
  private bloomEnabled = false;
  private bloomStrength = 0.6;
  private composer: EffectComposer | null = null;
  private bloomPassWebGL: UnrealBloomPass | null = null;
  private postProcessing: PostProcessing | null = null;
  private bloomCamera: THREE.Camera | null = null;
  bloomAvailable = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#050507');
  }

  async init(preferWebGPU: boolean): Promise<RendererInfo> {
    let adapterInfo = 'unknown';
    if (preferWebGPU && 'gpu' in navigator && navigator.gpu) {
      try {
        const renderer = new WebGPURenderer({
          canvas: this.canvas,
          antialias: true,
          powerPreference: 'high-performance',
          alpha: false,
        });
        await renderer.init();
        this.renderer = renderer;
        this.type = 'webgpu';
        const info = (renderer.backend as unknown as { adapter?: GPUAdapter })?.adapter?.info;
        if (info) adapterInfo = [info.vendor, info.architecture].filter(Boolean).join(' ') || 'WebGPU';
        else adapterInfo = 'WebGPU';
      } catch (err) {
        console.warn('WebGPU init failed, falling back to WebGL2', err);
      }
    }

    if (!this.renderer) {
      const renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        powerPreference: 'high-performance',
        alpha: false,
      });
      if (!renderer.capabilities.isWebGL2) {
        renderer.dispose();
        throw new Error('WebGL2 is not available in this browser.');
      }
      renderer.setClearColor(0x050507, 1);
      this.renderer = renderer;
      this.type = 'webgl2';
      const gl = renderer.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) adapterInfo = (gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string) || 'WebGL2';
      else adapterInfo = 'WebGL2';
    }

    return { type: this.type, adapterInfo };
  }

  setBackground(color: string): void {
    (this.scene.background as THREE.Color).set(color);
    if (this.renderer instanceof THREE.WebGLRenderer) this.renderer.setClearColor(new THREE.Color(color), 1);
  }

  resize(width: number, height: number, pixelRatioCap: number, renderScale: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, pixelRatioCap) * renderScale;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.pixelRatio);
      this.composer.setSize(this.width, this.height);
    }
    if (this.postProcessing) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.postProcessing as any).setSize?.(this.width, this.height);
    }
  }

  getPixelRatio(): number {
    return this.pixelRatio;
  }

  /** Configure bloom. Rebuilds the post pipeline for the current camera. */
  configureBloom(enabled: boolean, strength: number, camera: THREE.Camera): void {
    this.bloomEnabled = enabled && this.bloomAvailable;
    this.bloomStrength = strength;
    if (this.bloomEnabled) {
      this.buildBloom(camera);
    } else {
      this.teardownBloom();
    }
  }

  private buildBloom(camera: THREE.Camera): void {
    this.teardownBloom();
    this.bloomCamera = camera;
    try {
      if (this.type === 'webgpu') {
        const pp = new PostProcessing(this.renderer as WebGPURenderer);
        const scenePass = pass(this.scene, camera);
        const bloomPass = bloom(scenePass, this.bloomStrength, 0.4, 0.1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (pp as any).outputNode = (scenePass as any).add(bloomPass);
        this.postProcessing = pp;
      } else {
        const renderer = this.renderer as THREE.WebGLRenderer;
        const composer = new EffectComposer(renderer);
        composer.addPass(new RenderPass(this.scene, camera) as unknown as never);
        const bp = new UnrealBloomPass(new THREE.Vector2(this.width, this.height), this.bloomStrength, 0.4, 0.05);
        this.bloomPassWebGL = bp;
        composer.addPass(bp as unknown as never);
        composer.addPass(new OutputPass() as unknown as never);
        composer.setPixelRatio(this.pixelRatio);
        composer.setSize(this.width, this.height);
        this.composer = composer;
      }
    } catch (err) {
      console.warn('Bloom setup failed; disabling bloom.', err);
      this.bloomAvailable = false;
      this.bloomEnabled = false;
      this.teardownBloom();
    }
  }

  private teardownBloom(): void {
    this.composer?.dispose();
    this.composer = null;
    this.bloomPassWebGL?.dispose();
    this.bloomPassWebGL = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.postProcessing as any)?.dispose?.();
    this.postProcessing = null;
    this.bloomCamera = null;
  }

  setBloomStrength(strength: number): void {
    this.bloomStrength = strength;
    if (this.bloomPassWebGL) this.bloomPassWebGL.strength = strength;
    if (this.postProcessing && this.bloomCamera) this.buildBloom(this.bloomCamera);
  }

  render(camera: THREE.Camera): void {
    if (this.bloomEnabled) {
      if (this.bloomCamera !== camera) this.buildBloom(camera);
      if (this.composer) {
        this.composer.render();
        return;
      }
      if (this.postProcessing) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.postProcessing as any).render();
        return;
      }
    }
    this.renderer.render(this.scene, camera);
  }

  dispose(): void {
    this.teardownBloom();
    this.renderer.dispose();
  }
}
