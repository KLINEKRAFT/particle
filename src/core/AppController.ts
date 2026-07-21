import * as THREE from 'three';
import { RendererManager } from './RendererManager';
import { ParticleEngine } from './ParticleEngine';
import { CameraController } from './CameraController';
import { PerformanceManager } from './PerformanceManager';
import { GenerationManager } from './GenerationManager';
import { MorphController } from './MorphController';
import { PresetManager } from './PresetManager';
import { MultiScreenManager, type SyncMessage, type SecondaryConfig } from './MultiScreenManager';
import { UIController, type UICallbacks } from '../ui/UIController';
import { detectCapabilities } from '../util/capabilities';
import { defaultSettings, clone } from '../config/defaults';
import type { AppSettings, BackendCapabilities, SourceKind } from '../types';

// ============================================================================
// AppController — wires every module together, owns the animation loop, input
// handling, generation flow, morphing, presentation mode and multi-window sync.
// ============================================================================

export class AppController {
  private settings: AppSettings;
  private caps!: BackendCapabilities;
  private rm!: RendererManager;
  private engine!: ParticleEngine;
  private camera!: CameraController;
  private perf!: PerformanceManager;
  private gen = new GenerationManager();
  private morph = new MorphController();
  private presets = new PresetManager();
  private ms = new MultiScreenManager();
  private ui!: UIController;

  private canvas: HTMLCanvasElement;
  private uiRoot: HTMLElement;
  private adapterInfo = '';

  private lastTime = 0;
  private elapsed = 0;
  private running = true;
  private paused = false;
  private pageHidden = false;
  private disposed = false;

  // source assets (kept un-transferred so we can re-decode per generation)
  private imageBitmap: ImageBitmap | null = null;
  private depthBitmap: ImageBitmap | null = null;
  private fontName: string | null = null;
  private fontDataUrl: string | null = null;

  private regenTimer = 0;
  private countTimer = 0;
  private genBusy = false;
  private genQueued: boolean | null = null; // pending snap value
  private warned1M = false;

  // secondary (dual-window) mode
  private secondary: SecondaryConfig | null;
  private isSecondary: boolean;
  private remoteElapsed = 0;
  private lastBroadcast = 0;

  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private tmpVec = new THREE.Vector3();

  private boundResize = () => this.onResize();
  private boundKey = (e: KeyboardEvent) => this.onKey(e);
  private boundVisibility = () => { this.pageHidden = document.hidden; };

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.secondary = MultiScreenManager.parseSecondary();
    this.isSecondary = this.ms.isSecondary();
    const saved = this.presets.loadCurrentSettings();
    this.freshSession = !saved;
    this.settings = saved || defaultSettings();
    if (this.isSecondary) this.settings = defaultSettings();
  }

  private freshSession = false;

  async init(): Promise<void> {
    this.caps = await detectCapabilities();
    if (!this.caps.webgpu && !this.caps.webgl2) {
      this.fatal('Neither WebGPU nor WebGL2 is available in this browser. Particle Studio cannot run.');
      return;
    }

    // Choose the starting particle count from the detected hardware. A fresh
    // session (no saved settings) starts at the device's recommended count so
    // capable GPUs (e.g. Apple Silicon) get a rich scene and weak ones stay
    // smooth. Returning users keep their choice, only clamped to the max.
    if (!this.isSecondary) {
      if (this.freshSession) {
        this.settings.particles.count = this.caps.recommendedCount;
      } else if (this.settings.particles.count > this.caps.maxRecommendedCount) {
        this.settings.particles.count = this.caps.recommendedCount;
      }
    }

    // Boot the renderer + engine + camera, verifying the first frame renders.
    // If WebGPU is chosen but fails at runtime, transparently fall back to WebGL2
    // on a fresh canvas (a canvas context type cannot be changed in place).
    let booted = await this.bootGraphics(this.caps.webgpu);
    if (!booted && this.caps.webgpu && this.caps.webgl2) {
      console.warn('WebGPU render path failed; falling back to WebGL2.');
      booted = await this.bootGraphics(false);
      if (booted) this.ui?.showToast('WebGPU was unavailable on this system — using the WebGL2 renderer.', 'info', 5000);
    }
    if (!booted) {
      this.fatal('The graphics backend failed to start. Please try a different browser or update your GPU drivers.');
      return;
    }

    window.addEventListener('resize', this.boundResize);
    window.addEventListener('keydown', this.boundKey);
    document.addEventListener('visibilitychange', this.boundVisibility);

    if (this.isSecondary) this.ms.post({ t: 'hello' });

    this.lastTime = performance.now();
    this.loop();
  }

  /**
   * (Re)build the renderer, engine and camera and verify one frame renders.
   * Returns false if the graphics backend fails (so the caller can retry with
   * WebGL2). On a retry a fresh canvas replaces the old one.
   */
  private async bootGraphics(preferWebGPU: boolean): Promise<boolean> {
    // Tear down any previous attempt.
    if (this.rm) {
      this.engine?.dispose();
      this.camera?.dispose();
      this.rm.dispose();
      const fresh = document.createElement('canvas');
      fresh.id = 'scene';
      fresh.setAttribute('aria-label', '3D particle visualization');
      this.canvas.replaceWith(fresh);
      this.canvas = fresh;
    }

    try {
      this.rm = new RendererManager(this.canvas);
      const info = await this.rm.init(preferWebGPU);
      this.adapterInfo = info.adapterInfo;
      this.rm.setBackground(this.settings.color.background);
      this.engine = new ParticleEngine(this.rm);
      this.camera = new CameraController(this.canvas, this.settings.camera, !this.isSecondary);
      this.perf = new PerformanceManager(this.rm.renderer, this.rm.type);

      if (this.isSecondary) this.setupSecondary();
      else if (!this.ui) this.setupPrimaryUI();

      this.setupCanvasInput();
      this.onResize();

      this.engine.allocate(this.settings.particles.count);
      this.rm.configureBloom(this.settings.particles.bloom, this.settings.particles.bloomStrength, this.camera.active);
      await this.doGenerate(true);
      this.camera.frame(this.engine.getBoundRadius());

      // Trial frame — surfaces backend-specific render failures up front.
      this.engine.applySettings(this.settings, 0);
      this.engine.step(0.016, 0);
      this.rm.render(this.camera.active);
      return true;
    } catch (err) {
      console.error(`Graphics boot failed (preferWebGPU=${preferWebGPU})`, err);
      return false;
    }
  }

  // ---- Primary UI ----------------------------------------------------------
  private setupPrimaryUI(): void {
    const cb: UICallbacks = {
      onChange: (path, regen) => this.onSettingChange(path, regen),
      onSourceChange: (s) => this.onSourceChange(s),
      onGenerate: () => this.requestRegen(true),
      onMorph: () => this.requestRegen(false),
      onCountChange: (n) => this.requestCountChange(n),
      onImageFile: (f) => this.loadImage(f),
      onDepthMapFile: (f) => this.loadDepthMap(f),
      onFontFile: (f) => this.loadFont(f),
      onCamera: (a) => this.onCamera(a),
      onPreset: (a, name) => this.onPreset(a, name),
      onPresentation: () => this.togglePresentation(),
      onPause: () => this.togglePause(),
      onFullscreen: () => this.toggleFullscreen(),
      onLaunchDual: () => this.launchDual(),
      onMirror: () => this.openMirror(),
      onCopyLink: () => this.copyLink(),
    };
    this.ui = new UIController(this.uiRoot, this.settings, defaultSettings(), cb);
    this.ui.setPresetList(this.presets.all());
    this.ui.setSourceLabel(this.sourceLabel());

    // Controller listens for secondary hello → reply with settings.
    this.ms.onMessage = (msg: SyncMessage) => {
      if (msg.t === 'hello') this.broadcastSettings();
    };

    if (this.caps.recommendedCount < 100000) {
      this.ui.showToast(`Recommended particle count for this device: ${this.caps.recommendedCount.toLocaleString()}`, 'info', 5000);
    }
  }

  // ---- Secondary (dual-window) mode ---------------------------------------
  private setupSecondary(): void {
    document.body.classList.add('presentation', 'secondary');
    this.ms.onMessage = (msg: SyncMessage) => this.onSyncMessage(msg);
  }

  private onSyncMessage(msg: SyncMessage): void {
    if (msg.t === 'settings') {
      const prevCount = this.settings.particles.count;
      this.settings = msg.settings;
      this.rm.setBackground(this.settings.color.background);
      if (this.settings.particles.count !== prevCount) {
        this.engine.allocate(this.settings.particles.count);
      }
      this.rm.configureBloom(this.settings.particles.bloom, this.settings.particles.bloomStrength, this.camera.active);
      void this.doGenerate(true);
    } else if (msg.t === 'cam') {
      this.remoteElapsed = msg.elapsed;
      this.paused = msg.paused;
      this.camera.applyState(msg.camera);
      this.applySecondaryViewOffset();
    } else if (msg.t === 'bye') {
      window.close();
    }
  }

  private applySecondaryViewOffset(): void {
    if (!this.secondary || this.secondary.mirror) return;
    const s = this.secondary;
    this.camera.applyViewOffset(s.fullW, s.fullH, s.offX, s.offY, s.w, s.h);
  }

  // ---- Settings changes ----------------------------------------------------
  private onSettingChange(path: string, regen: boolean): void {
    if (path === 'color.background') this.rm.setBackground(this.settings.color.background);
    if (path === 'camera.mode' || path.startsWith('camera.')) this.camera.applySettings(this.settings.camera);
    if (path === 'particles.bloom') {
      // Toggling bloom rebuilds the post pipeline (expensive) — only on toggle.
      this.rm.configureBloom(this.settings.particles.bloom, this.settings.particles.bloomStrength, this.camera.active);
    } else if (path === 'particles.bloomStrength') {
      // Dragging strength must be cheap: adjust in place, don't rebuild.
      this.rm.setBloomStrength(this.settings.particles.bloomStrength);
    }
    if (regen) this.requestRegen(true);
    // Persisting to LocalStorage and broadcasting are debounced so a slider drag
    // doesn't do a JSON stringify + storage write on every input event (the main
    // cause of the UI freezing while adjusting settings).
    this.schedulePersist();
    this.scheduleBroadcast();
  }

  private persistTimer = 0;
  private broadcastTimer = 0;

  private schedulePersist(): void {
    window.clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => this.presets.saveCurrentSettings(this.settings), 400);
  }

  private scheduleBroadcast(): void {
    if (this.isSecondary) return;
    window.clearTimeout(this.broadcastTimer);
    this.broadcastTimer = window.setTimeout(() => this.broadcastSettings(), 120);
  }

  private onSourceChange(source: SourceKind): void {
    this.settings.source = source;
    this.ui.setSourceLabel(this.sourceLabel());
    this.requestRegen(true);
    this.broadcastSettings();
  }

  private requestRegen(snap: boolean): void {
    window.clearTimeout(this.regenTimer);
    this.regenTimer = window.setTimeout(() => void this.doGenerate(snap), 160);
  }

  private requestCountChange(count: number): void {
    this.settings.particles.count = count;
    if (count > this.caps.maxRecommendedCount) {
      this.ui?.showToast(`⚠ ${count.toLocaleString()} particles exceeds the recommended maximum (${this.caps.maxRecommendedCount.toLocaleString()}) for this device.`, 'error', 4500);
    }
    if (count >= 900000 && !this.warned1M) {
      this.warned1M = true;
      const ok = window.confirm('Rendering close to 1,000,000 particles is very demanding and may reduce performance or fail on some GPUs. Enable anyway?');
      if (!ok) {
        this.settings.particles.count = this.caps.recommendedCount;
        this.ui?.refresh();
      }
    }
    window.clearTimeout(this.countTimer);
    this.countTimer = window.setTimeout(() => {
      this.engine.allocate(this.settings.particles.count);
      void this.doGenerate(true);
      this.presets.saveCurrentSettings(this.settings);
      this.broadcastSettings();
    }, 280);
  }

  // ---- Generation ----------------------------------------------------------
  private async doGenerate(snap: boolean): Promise<void> {
    if (this.genBusy) {
      this.genQueued = snap;
      return;
    }
    this.genBusy = true;
    try {
      const target = await this.buildTarget();
      if (!target) return;
      const wasSnap = snap;
      this.engine.setTarget(target, wasSnap);
      if (!wasSnap) {
        const imp = this.morph.start(this.settings.morph, this.elapsed);
        if (imp.styleId > 0) this.engine.applyMorphImpulse(imp.styleId, imp.strength);
      } else {
        this.camera.frame(this.engine.getBoundRadius());
      }
      if (this.ui) this.ui.setSourceLabel(this.sourceLabel());
    } catch (err) {
      if (err instanceof Error && err.message !== 'cancelled') {
        this.ui?.showToast('Generation failed: ' + err.message, 'error');
      }
    } finally {
      this.genBusy = false;
      if (this.genQueued !== null) {
        const q = this.genQueued;
        this.genQueued = null;
        void this.doGenerate(q);
      }
    }
  }

  private async buildTarget() {
    const count = this.settings.particles.count;
    const seed = this.settings.motion.seed;
    if (this.settings.source === 'shape') {
      return this.gen.generate({ kind: 'shape', count, seed, shape: this.settings.shape });
    }
    if (this.settings.source === 'text') {
      return this.gen.generate({
        kind: 'text', count, seed, text: this.settings.text,
        fontName: this.fontName, fontDataUrl: this.fontDataUrl,
      });
    }
    // image
    if (!this.imageBitmap) {
      // No image yet — show a gentle plane placeholder is undesirable; keep prior.
      this.ui?.showToast('Drop an image in the Image panel to generate a particle relief.', 'info');
      throw new Error('cancelled');
    }
    const bmp = await createImageBitmap(this.imageBitmap);
    const transfer: Transferable[] = [bmp];
    let depthCopy: ImageBitmap | null = null;
    if (this.depthBitmap) {
      depthCopy = await createImageBitmap(this.depthBitmap);
      transfer.push(depthCopy);
    }
    return this.gen.generate(
      { kind: 'image', count, seed, image: this.settings.image, imageBitmap: bmp, depthMap: depthCopy },
      transfer,
    );
  }

  // ---- Asset loading -------------------------------------------------------
  private async loadImage(file: File): Promise<void> {
    try {
      const bmp = await this.decodeImage(file);
      this.imageBitmap?.close();
      this.imageBitmap = bmp;
      this.settings.source = 'image';
      // Show the image's own colors by default so it reads as a colored relief.
      if (this.settings.image.useImageColor) this.settings.color.mode = 'image';
      this.ui?.refresh();
      this.ui?.setSourceLabel(this.sourceLabel());
      await this.doGenerate(true);
      this.broadcastSettings();
    } catch (err) {
      this.ui?.showToast('Could not load image: ' + (err instanceof Error ? err.message : 'unsupported'), 'error');
    }
  }

  private async loadDepthMap(file: File): Promise<void> {
    try {
      this.depthBitmap?.close();
      this.depthBitmap = await this.decodeImage(file);
      this.settings.image.depthMode = 'luminance';
      await this.doGenerate(true);
    } catch (err) {
      this.ui?.showToast('Could not load depth map.', 'error');
    }
  }

  private async decodeImage(file: File): Promise<ImageBitmap> {
    const maxBytes = 40 * 1024 * 1024;
    if (file.size > maxBytes) throw new Error('image too large (>40MB)');
    if (file.type === 'image/svg+xml' || file.name.endsWith('.svg')) {
      // Rasterize SVG through an <img> element.
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        img.decoding = 'async';
        await new Promise<void>((res, rej) => {
          img.onload = () => res();
          img.onerror = () => rej(new Error('SVG decode failed'));
          img.src = url;
        });
        const w = img.naturalWidth || 512;
        const h = img.naturalHeight || 512;
        return await createImageBitmap(img, { resizeWidth: Math.min(1024, w), resizeHeight: Math.min(1024, h), resizeQuality: 'high' });
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    try {
      return await createImageBitmap(file);
    } catch {
      throw new Error('unsupported or corrupt image');
    }
  }

  private async loadFont(file: File): Promise<void> {
    try {
      const buf = await file.arrayBuffer();
      const b64 = this.arrayBufferToBase64(buf);
      const mime = file.name.endsWith('.woff2') ? 'font/woff2' : file.name.endsWith('.woff') ? 'font/woff' : file.name.endsWith('.otf') ? 'font/otf' : 'font/ttf';
      this.fontDataUrl = `data:${mime};base64,${b64}`;
      this.fontName = 'UserFont_' + file.name.replace(/[^a-z0-9]/gi, '').slice(0, 12);
      // Also register in the main document for consistency.
      try {
        const face = new FontFace(this.fontName, `url(${this.fontDataUrl})`);
        await face.load();
        document.fonts.add(face);
      } catch { /* worker still handles it */ }
      this.settings.text.fontFamily = `"${this.fontName}", sans-serif`;
      this.settings.source = 'text';
      this.ui?.refresh();
      await this.doGenerate(true);
      this.ui?.showToast('Font loaded: ' + file.name);
    } catch {
      this.ui?.showToast('Could not load font file.', 'error');
    }
  }

  private arrayBufferToBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }
    return btoa(binary);
  }

  // ---- Camera / view -------------------------------------------------------
  private onCamera(action: 'reset' | 'frame' | 'front' | 'side' | 'top' | 'iso'): void {
    if (action === 'reset') this.camera.reset();
    else if (action === 'frame') this.camera.frame(this.engine.getBoundRadius());
    else this.camera.setView(action);
  }

  // ---- Presets -------------------------------------------------------------
  private onPreset(action: string, name?: string): void {
    switch (action) {
      case 'apply': {
        if (!name) return;
        const p = this.presets.get(name);
        if (p) this.applySettings(clone(p.settings));
        break;
      }
      case 'save': {
        const n = window.prompt('Preset name:', 'My preset');
        if (n) { this.presets.save(n, this.settings); this.ui.setPresetList(this.presets.all(), n); this.ui.showToast('Preset saved'); }
        break;
      }
      case 'rename': {
        if (!name || this.presets.isBuiltIn(name)) { this.ui.showToast('Cannot rename a built-in preset', 'error'); return; }
        const n = window.prompt('New name:', name);
        if (n) { this.presets.rename(name, n); this.ui.setPresetList(this.presets.all(), n); }
        break;
      }
      case 'duplicate': {
        if (!name) return;
        const p = this.presets.duplicate(name);
        if (p) this.ui.setPresetList(this.presets.all(), p.name);
        break;
      }
      case 'delete': {
        if (!name || this.presets.isBuiltIn(name)) { this.ui.showToast('Cannot delete a built-in preset', 'error'); return; }
        this.presets.delete(name);
        this.ui.setPresetList(this.presets.all());
        break;
      }
      case 'export': {
        if (!name) return;
        const json = this.presets.exportJson(name);
        if (json) this.download(`${name}.json`, json);
        break;
      }
      case 'import': {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.addEventListener('change', async () => {
          const f = input.files?.[0];
          if (!f) return;
          try {
            const text = await f.text();
            const p = this.presets.importJson(text);
            this.ui.setPresetList(this.presets.all(), p.name);
            this.applySettings(clone(p.settings));
            this.ui.showToast('Preset imported: ' + p.name);
          } catch (err) {
            this.ui.showToast('Invalid preset file', 'error');
          }
        });
        input.click();
        break;
      }
      case 'reset': {
        this.applySettings(defaultSettings());
        break;
      }
    }
  }

  private applySettings(s: AppSettings): void {
    const prevCount = this.settings.particles.count;
    this.settings = s;
    this.rm.setBackground(s.color.background);
    this.camera.applySettings(s.camera);
    this.rm.configureBloom(s.particles.bloom, s.particles.bloomStrength, this.camera.active);
    // Rebuild UI bindings against the new settings object.
    this.rebuildUI();
    if (s.particles.count !== prevCount) this.engine.allocate(s.particles.count);
    void this.doGenerate(true);
    this.presets.saveCurrentSettings(this.settings);
    this.broadcastSettings();
  }

  private rebuildUI(): void {
    if (!this.ui) return;
    // Recreate the UI bound to the new settings object.
    this.uiRoot.innerHTML = '';
    this.setupPrimaryUI();
  }

  private download(filename: string, content: string): void {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- Dual display --------------------------------------------------------
  private async launchDual(): Promise<void> {
    const caps = MultiScreenManager.detect();
    if (!caps.windowManagement) {
      this.ui.showToast('Window Management API not supported. Use "Open mirror window" or stretch one window across both monitors.', 'error', 6000);
      return;
    }
    try {
      const reduce = this.settings.particles.count > 250000;
      if (reduce) {
        const ok = window.confirm('Dual-window mode uses a separate GPU context per window. Reduce particle count for smoother multi-window rendering?');
        if (ok) this.requestCountChange(Math.min(this.settings.particles.count, 150000));
      }
      const n = await this.ms.launchAcrossScreens();
      this.ui.showToast(`Opened ${n} synchronized display window(s).`);
      this.broadcastSettings();
    } catch (err) {
      this.ui.showToast('Dual display failed: ' + (err instanceof Error ? err.message : 'permission denied') + '. Falling back — try the mirror window.', 'error', 6000);
    }
  }

  private openMirror(): void {
    const win = this.ms.openMirrorWindow();
    if (!win) this.ui.showToast('Popup blocked. Allow popups for this site to open a second window.', 'error', 5000);
    else { this.ui.showToast('Mirror window opened. Drag it to your second monitor.'); this.broadcastSettings(); }
  }

  private async copyLink(): Promise<void> {
    const link = this.ms.sessionLink();
    try {
      await navigator.clipboard.writeText(link);
      this.ui.showToast('Session link copied to clipboard.');
    } catch {
      window.prompt('Copy this display-session link:', link);
    }
  }

  private broadcastSettings(): void {
    if (this.isSecondary) return;
    this.ms.post({ t: 'settings', settings: this.settings, sourceToken: this.elapsed });
  }

  // ---- Input ---------------------------------------------------------------
  private setupCanvasInput(): void {
    // Prevent the page from scrolling while zooming the scene.
    this.canvas.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    this.canvas.addEventListener('dblclick', () => this.camera.frame(this.engine.getBoundRadius()));
    this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.canvas.addEventListener('pointerleave', () => this.engine.setPointer(null));

    // Also accept image drops anywhere on the canvas.
    this.canvas.addEventListener('dragover', (e) => e.preventDefault());
    this.canvas.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f && f.type.startsWith('image/')) this.loadImage(f);
    });
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.isSecondary) return;
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.ndc, this.camera.active);
    const dist = this.camera.active.position.distanceTo(this.camera.controls.target);
    this.raycaster.ray.at(dist, this.tmpVec);
    this.engine.setPointer(this.tmpVec);
  }

  private onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
    switch (e.key.toLowerCase()) {
      case 'r': this.camera.reset(); break;
      case 'h': this.togglePresentation(); break;
      case 'f': this.toggleFullscreen(); break;
      case ' ': e.preventDefault(); this.togglePause(); break;
    }
  }

  private togglePresentation(): void {
    document.body.classList.toggle('presentation');
  }

  private togglePause(): void {
    this.paused = !this.paused;
    this.settings.performance.paused = this.paused;
    this.ui?.setPaused(this.paused);
  }

  private toggleFullscreen(): void {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.();
  }

  // ---- Resize --------------------------------------------------------------
  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.rm.resize(w, h, this.settings.performance.pixelRatioCap, this.settings.performance.renderScale);
    this.camera.resize(w, h);
    if (this.isSecondary) this.applySecondaryViewOffset();
  }

  // ---- Main loop -----------------------------------------------------------
  private loop = (): void => {
    if (this.disposed) return;
    requestAnimationFrame(this.loop);
    if (!this.running || this.pageHidden) return;

    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    const t0 = this.perf.beginFrame();

    if (this.isSecondary) {
      this.elapsed = this.remoteElapsed;
    } else {
      if (!this.paused) this.elapsed += dt;
    }

    this.camera.update();

    try {
      // Push uniforms and step the simulation (unless paused).
      this.engine.applySettings(this.settings, this.elapsed);
      if (!this.paused) this.engine.step(dt, this.elapsed);
      this.rm.render(this.camera.active);
    } catch (err) {
      // A GPU-level failure should stop the loop gracefully rather than spam.
      this.running = false;
      console.error('Render loop error', err);
      this.ui?.showToast('Rendering stopped due to a graphics error. Please reload the page.', 'error', 8000);
      return;
    }

    this.perf.endFrame(t0, dt * 1000);

    // Broadcast camera/playback to secondary windows (~30 Hz).
    if (!this.isSecondary && performance.now() - this.lastBroadcast > 33) {
      this.lastBroadcast = performance.now();
      this.ms.post({ t: 'cam', camera: this.camera.getState(), elapsed: this.elapsed, paused: this.paused });
    }

    // UI updates (throttled inside).
    if (!this.isSecondary && this.ui) {
      if (performance.now() - this.lastHud > 250) {
        this.lastHud = performance.now();
        const stats = this.perf.getStats(this.engine.getCount(), this.settings.performance.renderScale, this.rm.getPixelRatio());
        this.ui.updatePerf(stats, this.adapterInfo, `${Math.round(window.innerWidth * this.rm.getPixelRatio())}×${Math.round(window.innerHeight * this.rm.getPixelRatio())}`);
        this.ui.setMorphProgress(this.morph.progress(this.elapsed));
        this.maybeAdapt();
      }
    }
  };

  private lastHud = 0;

  private maybeAdapt(): void {
    if (!this.settings.performance.adaptiveQuality) return;
    const { newScale, reduceParticles } = this.perf.evaluate(
      this.settings.performance.targetFps,
      this.settings.performance.renderScale,
      this.settings.performance.autoReduce,
    );
    if (newScale !== this.settings.performance.renderScale) {
      this.settings.performance.renderScale = newScale;
      this.onResize();
      this.ui?.refresh();
    }
    if (reduceParticles && this.settings.particles.count > 20000) {
      const reduced = Math.max(20000, Math.round(this.settings.particles.count * 0.7));
      this.ui?.showToast(`Auto-reducing particles to ${reduced.toLocaleString()} to maintain frame rate.`, 'info');
      this.requestCountChange(reduced);
      this.ui?.refresh();
    }
  }

  // ---- Helpers -------------------------------------------------------------
  private sourceLabel(): string {
    if (this.settings.source === 'shape') {
      const k = this.settings.shape.kind;
      return k.charAt(0).toUpperCase() + k.slice(1);
    }
    if (this.settings.source === 'text') return 'Text';
    return 'Image';
  }

  private fatal(message: string): void {
    const el = document.createElement('div');
    el.className = 'fatal';
    el.innerHTML = `<div><h2>Unable to start</h2><p>${message}</p></div>`;
    document.body.appendChild(el);
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('resize', this.boundResize);
    window.removeEventListener('keydown', this.boundKey);
    document.removeEventListener('visibilitychange', this.boundVisibility);
    this.gen.dispose();
    this.ms.dispose();
    this.engine?.dispose();
    this.camera?.dispose();
    this.rm?.dispose();
    this.imageBitmap?.close();
    this.depthBitmap?.close();
  }
}
