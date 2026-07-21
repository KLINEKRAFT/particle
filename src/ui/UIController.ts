import type { AppSettings, PerfStats, Preset, SourceKind } from '../types';
import {
  ControlContext, buttonRow, clearRefreshers, colorInput, group, refreshAllControls,
  select, slider, textInput, toggle, getPath, setPath,
} from './controls';

// ============================================================================
// UIController — builds the entire DOM control surface (toolbar, collapsible
// groups, performance HUD, timeline, presets, drag & drop) and forwards user
// intent to the AppController via callbacks. Kept fully decoupled from the
// render engine.
// ============================================================================

export interface UICallbacks {
  onChange: (path: string, regen: boolean) => void;
  onSourceChange: (source: SourceKind) => void;
  onGenerate: () => void;
  onMorph: () => void;
  onCountChange: (count: number) => void;
  onImageFile: (file: File) => void;
  onDepthMapFile: (file: File) => void;
  onFontFile: (file: File) => void;
  onModelFile: (file: File) => void;
  onCamera: (action: 'reset' | 'frame' | 'front' | 'side' | 'top' | 'iso') => void;
  onPreset: (action: 'apply' | 'save' | 'rename' | 'duplicate' | 'delete' | 'export' | 'import' | 'reset', name?: string) => void;
  onPresentation: () => void;
  onPause: () => void;
  onFullscreen: () => void;
  onLaunchDual: () => void;
  onSpanDual: () => void;
  onSpanExit: () => void;
  onMirror: () => void;
  onCopyLink: () => void;
}

const COUNT_MIN = 1000;
const COUNT_MAX = 1000000;

export class UIController {
  root: HTMLElement;
  private ctx: ControlContext;
  private cb: UICallbacks;
  private panel!: HTMLElement;
  private sourceLabel!: HTMLElement;
  private perfHud!: HTMLElement;
  private morphBar!: HTMLDivElement;
  private presetSelect!: HTMLSelectElement;
  private toast!: HTMLElement;
  private pauseBtn!: HTMLButtonElement;
  private fileInput!: HTMLInputElement;
  private depthInput!: HTMLInputElement;
  private fontInput!: HTMLInputElement;
  private shapeSections: HTMLElement[] = [];
  private shapeGroup!: HTMLElement;
  private imageGroup!: HTMLElement;
  private textGroup!: HTMLElement;
  private modelGroup!: HTMLElement;
  private modelInput!: HTMLInputElement;

  constructor(root: HTMLElement, settings: AppSettings, defaults: AppSettings, cb: UICallbacks) {
    this.root = root;
    this.cb = cb;
    this.ctx = { settings, defaults, onChange: cb.onChange };
    this.build();
  }

  private build(): void {
    clearRefreshers();
    this.shapeSections = [];
    this.buildToolbar();
    this.buildPanel();
    this.buildPerfHud();
    this.buildTimeline();
    this.buildToast();
    this.buildHiddenInputs();
    this.updateSourceVisibility();
    this.updateShapeVisibility();
  }

  // ---- Toolbar -------------------------------------------------------------
  private buildToolbar(): void {
    const bar = document.createElement('div');
    bar.className = 'toolbar';
    bar.setAttribute('role', 'toolbar');

    const brand = document.createElement('div');
    brand.className = 'brand';
    brand.innerHTML = '<span class="brand-dot"></span> Particle <b>Studio</b>';
    bar.appendChild(brand);

    this.sourceLabel = document.createElement('div');
    this.sourceLabel.className = 'source-label';
    this.sourceLabel.textContent = 'Sphere';
    bar.appendChild(this.sourceLabel);

    const spacer = document.createElement('div');
    spacer.className = 'spacer';
    bar.appendChild(spacer);

    this.pauseBtn = this.iconBtn('❚❚', 'Pause / resume simulation (Space)', () => this.cb.onPause());
    bar.appendChild(this.pauseBtn);
    bar.appendChild(this.iconBtn('▣', 'Toggle interface (H)', () => this.cb.onPresentation()));
    bar.appendChild(this.iconBtn('⛶', 'Fullscreen (F)', () => this.cb.onFullscreen()));
    bar.appendChild(this.iconBtn('☰', 'Collapse panel', () => this.togglePanel()));

    this.root.appendChild(bar);
  }

  private iconBtn(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'icon-btn';
    btn.textContent = label;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.addEventListener('click', onClick);
    return btn;
  }

  private togglePanel(): void {
    this.panel.classList.toggle('collapsed');
  }

  // ---- Left panel ----------------------------------------------------------
  private buildPanel(): void {
    const panel = document.createElement('aside');
    panel.className = 'panel';
    panel.setAttribute('aria-label', 'Controls');
    this.panel = panel;

    panel.appendChild(this.groupSource());
    this.shapeGroup = this.groupShape();
    this.imageGroup = this.groupImage();
    this.textGroup = this.groupText();
    this.modelGroup = this.groupModel();
    panel.appendChild(this.shapeGroup);
    panel.appendChild(this.imageGroup);
    panel.appendChild(this.textGroup);
    panel.appendChild(this.modelGroup);
    panel.appendChild(this.groupParticles());
    panel.appendChild(this.groupMotion());
    panel.appendChild(this.groupColor());
    panel.appendChild(this.groupCamera());
    panel.appendChild(this.groupDisplay());
    panel.appendChild(this.groupPerformance());
    panel.appendChild(this.groupPresets());

    this.root.appendChild(panel);
  }

  private groupSource(): HTMLElement {
    const src = select(this.ctx, {
      label: 'Source type',
      path: 'source',
      regen: true,
      options: [
        { value: 'shape', label: 'Shape' },
        { value: 'image', label: 'Image' },
        { value: 'text', label: 'Text' },
        { value: 'model', label: 'Model (3D / GLB)' },
      ],
    });
    // Override source select to route through onSourceChange
    const sel = src.querySelector('select')!;
    sel.addEventListener('change', () => {
      this.cb.onSourceChange(sel.value as SourceKind);
      this.updateSourceVisibility();
    });

    const apply = buttonRow([
      { label: 'Apply / Generate', onClick: () => this.cb.onGenerate(), title: 'Regenerate the current source' },
      { label: 'Morph', onClick: () => this.cb.onMorph(), title: 'Morph into the current source' },
    ]);
    apply.classList.add('primary-buttons');
    return group('Source', true, [src, apply]);
  }

  private groupShape(): HTMLElement {
    const c = this.ctx;
    const kind = select(c, {
      label: 'Shape', path: 'shape.kind', regen: true, options: [
        { value: 'cube', label: 'Cube' }, { value: 'sphere', label: 'Sphere' },
        { value: 'helix', label: 'Helix' }, { value: 'torus', label: 'Torus' },
        { value: 'knot', label: 'Knot' }, { value: 'lorenz', label: 'Lorenz attractor' },
      ],
    });
    // Only the active shape's parameters are shown (see updateShapeVisibility).
    kind.querySelector('select')!.addEventListener('change', () => this.updateShapeVisibility());

    const section = (shapeKind: string, controls: HTMLElement[]): HTMLElement => {
      const el = document.createElement('div');
      el.className = 'shape-sub';
      el.dataset.shape = shapeKind;
      controls.forEach((x) => el.appendChild(x));
      this.shapeSections.push(el);
      return el;
    };

    const children = [
      kind,
      section('cube', [
        slider(c, { label: 'Width', path: 'shape.cube.width', min: 0.2, max: 4, step: 0.05, regen: true }),
        slider(c, { label: 'Height', path: 'shape.cube.height', min: 0.2, max: 4, step: 0.05, regen: true }),
        slider(c, { label: 'Depth', path: 'shape.cube.depth', min: 0.2, max: 4, step: 0.05, regen: true }),
        toggle(c, { label: 'Filled volume', path: 'shape.cube.filled', regen: true }),
        slider(c, { label: 'Edge concentration', path: 'shape.cube.edgeConcentration', min: 0, max: 1, step: 0.01, regen: true }),
        slider(c, { label: 'Corner rounding', path: 'shape.cube.cornerRadius', min: 0, max: 0.5, step: 0.01, regen: true }),
      ]),
      section('sphere', [
        slider(c, { label: 'Radius', path: 'shape.sphere.radius', min: 0.3, max: 3, step: 0.05, regen: true }),
        toggle(c, { label: 'Filled volume', path: 'shape.sphere.filled', regen: true }),
        toggle(c, { label: 'Hemisphere', path: 'shape.sphere.hemisphere', regen: true }),
        toggle(c, { label: 'Even distribution', path: 'shape.sphere.latitudeCorrection', regen: true, tooltip: 'Avoid pole bunching' }),
      ]),
      section('helix', [
        slider(c, { label: 'Radius', path: 'shape.helix.radius', min: 0.2, max: 2.5, step: 0.05, regen: true }),
        slider(c, { label: 'Height', path: 'shape.helix.height', min: 0.5, max: 6, step: 0.1, regen: true }),
        slider(c, { label: 'Turns', path: 'shape.helix.turns', min: 1, max: 20, step: 1, regen: true }),
        slider(c, { label: 'Pitch', path: 'shape.helix.pitch', min: 0.2, max: 3, step: 0.05, regen: true }),
        slider(c, { label: 'Strand thickness', path: 'shape.helix.strandThickness', min: 0, max: 0.4, step: 0.01, regen: true }),
        toggle(c, { label: 'Double helix', path: 'shape.helix.doubleHelix', regen: true }),
      ]),
      section('torus', [
        slider(c, { label: 'Major radius', path: 'shape.torus.majorRadius', min: 0.4, max: 2.5, step: 0.05, regen: true }),
        slider(c, { label: 'Minor radius', path: 'shape.torus.minorRadius', min: 0.1, max: 1.2, step: 0.05, regen: true }),
        slider(c, { label: 'Tube thickness', path: 'shape.torus.tubeThickness', min: 0.05, max: 1, step: 0.05, regen: true }),
        toggle(c, { label: 'Filled volume', path: 'shape.torus.filled', regen: true }),
      ]),
      section('knot', [
        slider(c, { label: 'P', path: 'shape.knot.p', min: 1, max: 8, step: 1, regen: true }),
        slider(c, { label: 'Q', path: 'shape.knot.q', min: 1, max: 8, step: 1, regen: true }),
        slider(c, { label: 'Major radius', path: 'shape.knot.majorRadius', min: 0.4, max: 2, step: 0.05, regen: true }),
        slider(c, { label: 'Tube radius', path: 'shape.knot.tubeRadius', min: 0.05, max: 1, step: 0.05, regen: true }),
        slider(c, { label: 'Twist', path: 'shape.knot.twist', min: 0, max: 6, step: 0.1, regen: true }),
        slider(c, { label: 'Thickness', path: 'shape.knot.thickness', min: 0.02, max: 1, step: 0.02, regen: true }),
      ]),
      section('lorenz', [
        slider(c, { label: 'Sigma', path: 'shape.lorenz.sigma', min: 1, max: 30, step: 0.1, regen: true }),
        slider(c, { label: 'Rho', path: 'shape.lorenz.rho', min: 1, max: 60, step: 0.1, regen: true }),
        slider(c, { label: 'Beta', path: 'shape.lorenz.beta', min: 0.5, max: 6, step: 0.01, regen: true }),
        slider(c, { label: 'Integration step', path: 'shape.lorenz.step', min: 0.001, max: 0.02, step: 0.001, regen: true }),
        slider(c, { label: 'Scale', path: 'shape.lorenz.scale', min: 0.01, max: 0.15, step: 0.005, regen: true }),
        slider(c, { label: 'Jitter', path: 'shape.lorenz.jitter', min: 0, max: 0.2, step: 0.005, regen: true }),
      ]),
    ];
    return group('Shape', true, children);
  }

  private updateShapeVisibility(): void {
    const active = getPath(this.ctx.settings, 'shape.kind') as string;
    for (const el of this.shapeSections) {
      el.style.display = el.dataset.shape === active ? '' : 'none';
    }
  }

  private updateSourceVisibility(): void {
    const src = getPath(this.ctx.settings, 'source') as string;
    if (this.shapeGroup) this.shapeGroup.style.display = src === 'shape' ? '' : 'none';
    if (this.imageGroup) this.imageGroup.style.display = src === 'image' ? '' : 'none';
    if (this.textGroup) this.textGroup.style.display = src === 'text' ? '' : 'none';
    if (this.modelGroup) this.modelGroup.style.display = src === 'model' ? '' : 'none';
  }

  private groupImage(): HTMLElement {
    const c = this.ctx;
    // Drop zone
    const dz = document.createElement('div');
    dz.className = 'dropzone';
    dz.tabIndex = 0;
    dz.setAttribute('role', 'button');
    dz.setAttribute('aria-label', 'Upload image: drop a file or click to browse');
    dz.innerHTML = '<div class="dz-inner"><b>Drop image</b><span>PNG · JPG · WebP · SVG</span></div>';
    dz.addEventListener('click', () => this.fileInput.click());
    dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') this.fileInput.click(); });
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('drag');
      const f = e.dataTransfer?.files?.[0];
      if (f) this.cb.onImageFile(f);
    });

    const depthBtn = buttonRow([
      { label: 'Upload depth map', onClick: () => this.depthInput.click(), title: 'Optional grayscale depth map' },
    ]);

    const children = [
      dz,
      slider(c, { label: 'Sampling resolution', path: 'image.sampleResolution', min: 64, max: 1024, step: 16, regen: true }),
      slider(c, { label: 'Alpha threshold', path: 'image.alphaThreshold', min: 0, max: 1, step: 0.01, regen: true }),
      slider(c, { label: 'Brightness threshold', path: 'image.brightnessThreshold', min: 0, max: 1, step: 0.01, regen: true }),
      toggle(c, { label: 'Invert mask', path: 'image.invertMask', regen: true }),
      slider(c, { label: 'Background removal', path: 'image.bgRemoval', min: 0, max: 1, step: 0.01, regen: true, tooltip: 'Remove pixels near the corner background color' }),
      select(c, { label: 'Fit', path: 'image.fit', regen: true, options: [
        { value: 'fit', label: 'Fit' }, { value: 'fill', label: 'Fill' }, { value: 'original', label: 'Original' }] }),
      toggle(c, { label: 'Use image colors', path: 'image.useImageColor', regen: true }),
      colorInput(c, { label: 'Solid color override', path: 'image.solidColor', regen: true }),
      slider(c, { label: 'Saturation', path: 'image.saturation', min: 0, max: 2, step: 0.05, regen: true }),
      slider(c, { label: 'Contrast', path: 'image.contrast', min: 0, max: 2, step: 0.05, regen: true }),
      slider(c, { label: 'Brightness', path: 'image.brightness', min: 0, max: 2, step: 0.05, regen: true }),
      select(c, { label: 'Depth mode', path: 'image.depthMode', regen: true, options: [
        { value: 'flat', label: 'Flat plane' }, { value: 'luminance', label: 'Luminance' },
        { value: 'invLuminance', label: 'Inverted luminance' }, { value: 'edge', label: 'Edge depth' },
        { value: 'radial', label: 'Radial' }, { value: 'layered', label: 'Layered slices' },
        { value: 'wave', label: 'Wave' }, { value: 'noise', label: 'Procedural noise' }] }),
      slider(c, { label: 'Depth amount', path: 'image.depthAmount', min: 0, max: 2, step: 0.05, regen: true }),
      slider(c, { label: 'Depth direction', path: 'image.depthDirection', min: -1, max: 1, step: 2, regen: true }),
      slider(c, { label: 'Depth curve', path: 'image.depthCurve', min: 0.2, max: 3, step: 0.05, regen: true }),
      slider(c, { label: 'Edge emphasis', path: 'image.edgeEmphasis', min: 0, max: 2, step: 0.05, regen: true }),
      slider(c, { label: 'Noise depth', path: 'image.noiseDepth', min: 0, max: 1, step: 0.02, regen: true }),
      slider(c, { label: 'Layers', path: 'image.layers', min: 2, max: 20, step: 1, regen: true }),
      slider(c, { label: 'Scale', path: 'image.scale', min: 0.3, max: 2, step: 0.05, regen: true }),
      slider(c, { label: 'Rotation', path: 'image.rotation', min: -180, max: 180, step: 1, regen: true }),
      toggle(c, { label: 'Flip horizontal', path: 'image.flipH', regen: true }),
      toggle(c, { label: 'Flip vertical', path: 'image.flipV', regen: true }),
      depthBtn,
    ];
    return group('Image', false, children);
  }

  private groupText(): HTMLElement {
    const c = this.ctx;
    const fontUpload = buttonRow([
      { label: 'Upload font (.ttf/.otf/.woff)', onClick: () => this.fontInput.click() },
    ]);
    const children = [
      textInput(c, { label: 'Text', path: 'text.content', regen: true, area: true }),
      select(c, { label: 'Font', path: 'text.fontFamily', regen: true, options: [
        { value: 'Inter, Arial, sans-serif', label: 'Inter / Sans' },
        { value: 'Georgia, serif', label: 'Serif' },
        { value: '"Courier New", monospace', label: 'Monospace' },
        { value: 'Impact, sans-serif', label: 'Impact' },
        { value: '"Times New Roman", serif', label: 'Times' },
      ] }),
      slider(c, { label: 'Font weight', path: 'text.fontWeight', min: 100, max: 900, step: 100, regen: true }),
      slider(c, { label: 'Font size', path: 'text.fontSizePx', min: 40, max: 400, step: 5, regen: true }),
      slider(c, { label: 'Letter spacing', path: 'text.letterSpacing', min: -20, max: 60, step: 1, regen: true }),
      slider(c, { label: 'Line height', path: 'text.lineHeight', min: 0.6, max: 2, step: 0.05, regen: true }),
      select(c, { label: 'Alignment', path: 'text.align', regen: true, options: [
        { value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }] }),
      slider(c, { label: 'Scale', path: 'text.scale', min: 0.3, max: 2, step: 0.05, regen: true }),
      select(c, { label: 'Depth mode', path: 'text.depthMode', regen: true, options: [
        { value: 'flat', label: 'Flat' }, { value: 'extrude', label: 'Extruded' },
        { value: 'rounded', label: 'Rounded' }, { value: 'bevel', label: 'Beveled' },
        { value: 'luminance', label: 'Gradient depth' }, { value: 'wave', label: 'Wave' },
        { value: 'random', label: 'Random' }, { value: 'layered', label: 'Layered' }] }),
      slider(c, { label: 'Extrude depth', path: 'text.extrudeDepth', min: 0, max: 1, step: 0.02, regen: true }),
      slider(c, { label: 'Bevel', path: 'text.bevel', min: 0, max: 1, step: 0.02, regen: true }),
      slider(c, { label: 'Depth noise', path: 'text.depthNoise', min: 0, max: 0.5, step: 0.01, regen: true }),
      slider(c, { label: 'Wave depth', path: 'text.waveDepth', min: 0, max: 0.5, step: 0.01, regen: true }),
      slider(c, { label: 'Edge priority', path: 'text.edgePriority', min: 0, max: 1, step: 0.05, regen: true, tooltip: 'Keep letters readable at low counts' }),
      fontUpload,
    ];
    return group('Text', false, children);
  }

  private groupModel(): HTMLElement {
    const c = this.ctx;
    const dz = document.createElement('div');
    dz.className = 'dropzone';
    dz.tabIndex = 0;
    dz.setAttribute('role', 'button');
    dz.setAttribute('aria-label', 'Upload 3D model: drop a .glb / .gltf file or click to browse');
    dz.innerHTML = '<div class="dz-inner"><b>Drop 3D model</b><span>GLB · glTF (uncompressed)</span></div>';
    dz.addEventListener('click', () => this.modelInput.click());
    dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') this.modelInput.click(); });
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('drag');
      const f = e.dataTransfer?.files?.[0];
      if (f) this.cb.onModelFile(f);
    });
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'Points are sampled across the model surface (area-weighted). Bigger particle counts capture finer detail.';
    const children = [
      dz,
      toggle(c, { label: 'Use model colors', path: 'model.useModelColor', regen: true }),
      colorInput(c, { label: 'Solid color', path: 'model.solidColor', regen: true }),
      slider(c, { label: 'Scale', path: 'model.scale', min: 0.3, max: 2, step: 0.05, regen: true }),
      note,
    ];
    return group('Model', false, children);
  }

  private groupParticles(): HTMLElement {
    const c = this.ctx;
    // Count widget (log slider + number + presets)
    const countRow = document.createElement('div');
    countRow.className = 'ctl ctl-stack';
    const lbl = document.createElement('label');
    lbl.textContent = 'Particle count';
    countRow.appendChild(lbl);

    const line = document.createElement('div');
    line.className = 'count-line';
    const slid = document.createElement('input');
    slid.type = 'range';
    slid.min = '0';
    slid.max = '1000';
    slid.step = '1';
    slid.setAttribute('aria-label', 'Particle count (logarithmic)');
    const num = document.createElement('input');
    num.type = 'number';
    num.min = String(COUNT_MIN);
    num.max = String(COUNT_MAX);
    num.step = '1000';
    num.className = 'count-num';
    num.setAttribute('aria-label', 'Particle count');
    line.append(slid, num);
    countRow.appendChild(line);

    const toLog = (v: number) => (Math.log(v / COUNT_MIN) / Math.log(COUNT_MAX / COUNT_MIN)) * 1000;
    const fromLog = (p: number) => Math.round(COUNT_MIN * Math.pow(COUNT_MAX / COUNT_MIN, p / 1000) / 1000) * 1000;
    const refreshCount = () => {
      const v = getPath(c.settings, 'particles.count') as number;
      slid.value = String(toLog(v));
      num.value = String(v);
    };
    slid.addEventListener('input', () => {
      const v = Math.max(COUNT_MIN, Math.min(COUNT_MAX, fromLog(parseFloat(slid.value))));
      setPath(c.settings, 'particles.count', v);
      num.value = String(v);
      this.cb.onCountChange(v);
    });
    num.addEventListener('change', () => {
      const v = Math.max(COUNT_MIN, Math.min(COUNT_MAX, Math.round(parseFloat(num.value) || COUNT_MIN)));
      setPath(c.settings, 'particles.count', v);
      slid.value = String(toLog(v));
      this.cb.onCountChange(v);
    });
    refreshCount();

    const presets = document.createElement('div');
    presets.className = 'ctl-buttons count-presets';
    for (const [label, val] of [['10K', 10000], ['50K', 50000], ['100K', 100000], ['250K', 250000], ['500K', 500000], ['1M', 1000000]] as [string, number][]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => {
        setPath(c.settings, 'particles.count', val);
        refreshCount();
        this.cb.onCountChange(val);
      });
      presets.appendChild(b);
    }

    // expose refresher via closure by wrapping in an element with dataset hook
    (this.refreshCountFns ||= []).push(refreshCount);

    const children = [
      countRow,
      presets,
      select(c, { label: 'Style', path: 'particles.style', options: [
        { value: 'soft', label: 'Soft circle' }, { value: 'dot', label: 'Sharp dot' },
        { value: 'square', label: 'Square' }, { value: 'disc', label: 'Glowing disc' },
        { value: 'spark', label: 'Spark' }, { value: 'sphere', label: 'Sphere (low count)' }] }),
      slider(c, { label: 'Size', path: 'particles.size', min: 0.2, max: 6, step: 0.1 }),
      slider(c, { label: 'Opacity', path: 'particles.opacity', min: 0.02, max: 1, step: 0.01 }),
      select(c, { label: 'Blending', path: 'particles.blend', options: [
        { value: 'additive', label: 'Additive' }, { value: 'normal', label: 'Normal alpha' }] }),
      toggle(c, { label: 'Size attenuation', path: 'particles.sizeAttenuation' }),
      toggle(c, { label: 'Depth test', path: 'particles.depthTest' }),
      slider(c, { label: 'Soft edge', path: 'particles.softEdge', min: 0, max: 1, step: 0.02 }),
      slider(c, { label: 'Glow', path: 'particles.glow', min: 0, max: 2, step: 0.05 }),
      slider(c, { label: 'Distance fade', path: 'particles.distanceFade', min: 0, max: 1, step: 0.02 }),
      toggle(c, { label: 'Bloom', path: 'particles.bloom' }),
      slider(c, { label: 'Bloom strength', path: 'particles.bloomStrength', min: 0, max: 2, step: 0.05 }),
    ];
    return group('Particles', true, children);
  }

  private refreshCountFns?: (() => void)[];

  private groupMotion(): HTMLElement {
    const c = this.ctx;
    const children = [
      toggle(c, { label: 'Enable motion', path: 'motion.enabled' }),
      select(c, { label: 'Mode', path: 'motion.mode', options: [
        { value: 'none', label: 'None' }, { value: 'curl', label: 'Curl noise' },
        { value: 'noise', label: 'Simplex noise' }, { value: 'brownian', label: 'Brownian' },
        { value: 'orbital', label: 'Orbital' }, { value: 'wave', label: 'Wave' },
        { value: 'vortex', label: 'Vortex' }, { value: 'gravity', label: 'Gravity' },
        { value: 'attract', label: 'Center attraction' }, { value: 'explode', label: 'Explosion' }] }),
      slider(c, { label: 'Strength', path: 'motion.strength', min: 0, max: 1, step: 0.01 }),
      slider(c, { label: 'Scale', path: 'motion.scale', min: 0.05, max: 3, step: 0.05 }),
      slider(c, { label: 'Speed', path: 'motion.speed', min: 0, max: 2, step: 0.02 }),
      slider(c, { label: 'Damping', path: 'motion.damping', min: 0.5, max: 0.99, step: 0.005 }),
      slider(c, { label: 'Return-to-shape', path: 'motion.returnForce', min: 0, max: 10, step: 0.1 }),
      slider(c, { label: 'Pointer radius', path: 'motion.radius', min: 0.2, max: 4, step: 0.1 }),
      slider(c, { label: 'Pointer strength', path: 'motion.pointerStrength', min: 0, max: 12, step: 0.1 }),
      toggle(c, { label: 'Pointer repel', path: 'motion.pointerRepel' }),
      slider(c, { label: 'Seed', path: 'motion.seed', min: 1, max: 9999, step: 1, format: (v) => v.toFixed(0) }),
    ];
    return group('Motion', false, children);
  }

  private groupColor(): HTMLElement {
    const c = this.ctx;
    const children = [
      select(c, { label: 'Color mode', path: 'color.mode', options: [
        { value: 'solid', label: 'Solid' }, { value: 'gradient2', label: 'Two-color gradient' },
        { value: 'gradient3', label: 'Three-color gradient' }, { value: 'image', label: 'Original image' },
        { value: 'position', label: 'Position' }, { value: 'depth', label: 'Depth' },
        { value: 'velocity', label: 'Velocity' }, { value: 'rainbow', label: 'Rainbow' },
        { value: 'palette', label: 'Custom palette' }] }),
      colorInput(c, { label: 'Color 1', path: 'color.color1' }),
      colorInput(c, { label: 'Color 2', path: 'color.color2' }),
      colorInput(c, { label: 'Color 3', path: 'color.color3' }),
      colorInput(c, { label: 'Background', path: 'color.background' }),
      slider(c, { label: 'Gradient rotation', path: 'color.gradientRotation', min: 0, max: 360, step: 1 }),
      slider(c, { label: 'Hue shift', path: 'color.hueShift', min: 0, max: 1, step: 0.01 }),
      slider(c, { label: 'Saturation', path: 'color.saturation', min: 0, max: 2, step: 0.02 }),
      slider(c, { label: 'Brightness', path: 'color.brightness', min: 0, max: 2, step: 0.02 }),
      slider(c, { label: 'Contrast', path: 'color.contrast', min: 0, max: 2, step: 0.02 }),
      slider(c, { label: 'Animation speed', path: 'color.animationSpeed', min: 0, max: 3, step: 0.05 }),
    ];
    return group('Color', false, children);
  }

  private groupCamera(): HTMLElement {
    const c = this.ctx;
    const views = buttonRow([
      { label: 'Front', onClick: () => this.cb.onCamera('front') },
      { label: 'Side', onClick: () => this.cb.onCamera('side') },
      { label: 'Top', onClick: () => this.cb.onCamera('top') },
      { label: 'Iso', onClick: () => this.cb.onCamera('iso') },
    ]);
    const actions = buttonRow([
      { label: 'Reset (R)', onClick: () => this.cb.onCamera('reset') },
      { label: 'Frame', onClick: () => this.cb.onCamera('frame') },
    ]);
    const children = [
      select(c, { label: 'Mode', path: 'camera.mode', options: [
        { value: 'perspective', label: 'Perspective' }, { value: 'orthographic', label: 'Orthographic' }] }),
      slider(c, { label: 'Field of view', path: 'camera.fov', min: 20, max: 100, step: 1 }),
      toggle(c, { label: 'Auto rotate', path: 'camera.autoRotate' }),
      slider(c, { label: 'Auto rotate speed', path: 'camera.autoRotateSpeed', min: 0, max: 4, step: 0.1 }),
      slider(c, { label: 'Damping', path: 'camera.damping', min: 0, max: 0.3, step: 0.01 }),
      slider(c, { label: 'Near clip', path: 'camera.near', min: 0.001, max: 1, step: 0.001 }),
      slider(c, { label: 'Far clip', path: 'camera.far', min: 10, max: 500, step: 10 }),
      views, actions,
    ];
    return group('Camera', false, children);
  }

  private groupDisplay(): HTMLElement {
    const info = document.createElement('p');
    info.className = 'note';
    info.textContent = 'Span 2 monitors works in any browser: this window becomes the left half and a second window the right half of one continuous scene — drag it to your 2nd monitor and fullscreen both (F). Auto-launch across all screens needs Chrome/Edge (Window Management API). Each window has its own GPU context.';
    const span = buttonRow([
      { label: 'Span 2 monitors', onClick: () => this.cb.onSpanDual(), title: 'Manual span — works everywhere' },
    ]);
    span.classList.add('primary-buttons');
    const spanCtl = buttonRow([
      { label: 'Auto-launch (Chrome)', onClick: () => this.cb.onLaunchDual(), title: 'Auto-place a window on every screen (Chrome/Edge)' },
      { label: 'Stop span', onClick: () => this.cb.onSpanExit() },
    ]);
    const fallbacks = buttonRow([
      { label: 'Open mirror window', onClick: () => this.cb.onMirror() },
      { label: 'Copy session link', onClick: () => this.cb.onCopyLink() },
    ]);
    return group('Display', false, [info, span, spanCtl, fallbacks]);
  }

  private groupPerformance(): HTMLElement {
    const c = this.ctx;
    const children = [
      slider(c, { label: 'Render scale', path: 'performance.renderScale', min: 0.5, max: 2, step: 0.05 }),
      slider(c, { label: 'Pixel ratio cap', path: 'performance.pixelRatioCap', min: 0.5, max: 3, step: 0.25 }),
      toggle(c, { label: 'Adaptive quality', path: 'performance.adaptiveQuality' }),
      slider(c, { label: 'Target FPS', path: 'performance.targetFps', min: 24, max: 120, step: 1 }),
      toggle(c, { label: 'Auto-reduce particles', path: 'performance.autoReduce' }),
    ];
    return group('Performance', false, children);
  }

  private groupPresets(): HTMLElement {
    const sel = document.createElement('select');
    sel.className = 'preset-select';
    sel.setAttribute('aria-label', 'Presets');
    this.presetSelect = sel;
    const selWrap = document.createElement('div');
    selWrap.className = 'ctl ctl-stack';
    const lbl = document.createElement('label');
    lbl.textContent = 'Preset';
    selWrap.append(lbl, sel);

    const applyRow = buttonRow([
      { label: 'Apply', onClick: () => this.cb.onPreset('apply', sel.value) },
      { label: 'Save as…', onClick: () => this.cb.onPreset('save') },
    ]);
    const editRow = buttonRow([
      { label: 'Duplicate', onClick: () => this.cb.onPreset('duplicate', sel.value) },
      { label: 'Rename', onClick: () => this.cb.onPreset('rename', sel.value) },
      { label: 'Delete', onClick: () => this.cb.onPreset('delete', sel.value) },
    ]);
    const ioRow = buttonRow([
      { label: 'Export JSON', onClick: () => this.cb.onPreset('export', sel.value) },
      { label: 'Import JSON', onClick: () => this.cb.onPreset('import') },
      { label: 'Reset defaults', onClick: () => this.cb.onPreset('reset') },
    ]);
    return group('Presets', false, [selWrap, applyRow, editRow, ioRow]);
  }

  // ---- Performance HUD -----------------------------------------------------
  private buildPerfHud(): void {
    const hud = document.createElement('div');
    hud.className = 'perf-hud';
    hud.setAttribute('aria-live', 'off');
    this.perfHud = hud;
    this.root.appendChild(hud);
  }

  updatePerf(stats: PerfStats, adapterInfo: string, resolution: string): void {
    const rows: [string, string][] = [
      ['FPS', stats.fps.toFixed(0)],
      ['Frame', `${stats.frameMs.toFixed(1)} ms`],
      ['Particles', stats.count.toLocaleString()],
      ['Backend', stats.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'],
      ['Draw calls', String(stats.drawCalls)],
      ['Points', stats.points.toLocaleString()],
      ['Resolution', resolution],
      ['DPR', stats.pixelRatio.toFixed(2)],
      ['Est. GPU mem', `${stats.memoryMb.toFixed(0)} MB`],
      ['Adapter', adapterInfo],
    ];
    this.perfHud.innerHTML = rows
      .map(([k, v]) => `<div class="perf-row"><span>${k}</span><b>${v}</b></div>`)
      .join('');
  }

  // ---- Bottom timeline -----------------------------------------------------
  private buildTimeline(): void {
    const tl = document.createElement('div');
    tl.className = 'timeline';
    const apply = document.createElement('button');
    apply.className = 'tl-btn';
    apply.textContent = 'Apply';
    apply.title = 'Generate & snap to the current source';
    apply.addEventListener('click', () => this.cb.onGenerate());
    const morph = document.createElement('button');
    morph.className = 'tl-btn primary';
    morph.textContent = 'Morph';
    morph.title = 'Morph into the current source';
    morph.addEventListener('click', () => this.cb.onMorph());

    const barWrap = document.createElement('div');
    barWrap.className = 'tl-bar';
    const bar = document.createElement('div');
    bar.className = 'tl-fill';
    this.morphBar = bar;
    barWrap.appendChild(bar);

    const lbl = document.createElement('div');
    lbl.className = 'tl-label';
    lbl.textContent = 'Morph progress';

    tl.append(apply, morph, lbl, barWrap);
    this.root.appendChild(tl);
  }

  setMorphProgress(p: number): void {
    this.morphBar.style.width = `${Math.round(p * 100)}%`;
  }

  // ---- Toast / status ------------------------------------------------------
  private buildToast(): void {
    const t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
    this.toast = t;
    this.root.appendChild(t);
  }

  showToast(message: string, kind: 'info' | 'error' = 'info', ms = 3200): void {
    this.toast.textContent = message;
    this.toast.className = `toast show ${kind}`;
    window.clearTimeout((this.toast as unknown as { _t?: number })._t);
    (this.toast as unknown as { _t?: number })._t = window.setTimeout(() => {
      this.toast.className = 'toast';
    }, ms);
  }

  // ---- Hidden file inputs --------------------------------------------------
  private buildHiddenInputs(): void {
    this.fileInput = this.hiddenFile('image/png,image/jpeg,image/webp,image/svg+xml', (f) => this.cb.onImageFile(f));
    this.depthInput = this.hiddenFile('image/*', (f) => this.cb.onDepthMapFile(f));
    this.fontInput = this.hiddenFile('.ttf,.otf,.woff,.woff2,font/*', (f) => this.cb.onFontFile(f));
    this.modelInput = this.hiddenFile('.glb,.gltf,model/gltf-binary,model/gltf+json', (f) => this.cb.onModelFile(f));
    this.root.append(this.fileInput, this.depthInput, this.fontInput, this.modelInput);
  }

  private hiddenFile(accept: string, onFile: (f: File) => void): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) onFile(f);
      input.value = '';
    });
    return input;
  }

  // ---- Public API ----------------------------------------------------------
  setSourceLabel(text: string): void {
    this.sourceLabel.textContent = text;
  }

  setPaused(paused: boolean): void {
    this.pauseBtn.textContent = paused ? '▶' : '❚❚';
    this.pauseBtn.classList.toggle('active', paused);
  }

  setPresetList(presets: Preset[], selected?: string): void {
    this.presetSelect.innerHTML = '';
    for (const p of presets) {
      const o = document.createElement('option');
      o.value = p.name;
      o.textContent = p.builtIn ? p.name : `★ ${p.name}`;
      this.presetSelect.appendChild(o);
    }
    if (selected) this.presetSelect.value = selected;
  }

  refresh(): void {
    refreshAllControls();
    this.refreshCountFns?.forEach((f) => f());
    this.updateSourceVisibility();
    this.updateShapeVisibility();
  }

  setInteractive(_on: boolean): void {
    /* presentation toggle handled via body class in AppController */
  }
}
