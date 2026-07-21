// ============================================================================
// Particle Studio — shared type contract
// ----------------------------------------------------------------------------
// Every module (engine, backends, generators, UI, workers, presets) depends on
// these interfaces. Keep them serializable (plain data) so presets can be saved
// to LocalStorage and JSON, and so settings can be posted across BroadcastChannel
// and to Web Workers without loss.
// ============================================================================

export type BackendType = 'webgpu' | 'webgl2';

export type SourceKind = 'shape' | 'image' | 'text' | 'model';

export type ShapeKind = 'cube' | 'sphere' | 'helix' | 'torus' | 'knot' | 'lorenz';

export type ParticleStyle = 'soft' | 'dot' | 'square' | 'disc' | 'spark' | 'sphere';

export type BlendMode = 'additive' | 'normal';

export type EasingKind =
  | 'linear'
  | 'easeInOut'
  | 'easeOut'
  | 'easeIn'
  | 'expo'
  | 'elastic'
  | 'back';

export type MorphStyle =
  | 'direct'
  | 'scatter'
  | 'explode'
  | 'spiral'
  | 'wipe'
  | 'dissolve';

export type MotionMode =
  | 'none'
  | 'curl'
  | 'noise'
  | 'brownian'
  | 'orbital'
  | 'wave'
  | 'vortex'
  | 'gravity'
  | 'attract'
  | 'explode';

export type ColorMode =
  | 'solid'
  | 'gradient2'
  | 'gradient3'
  | 'image'
  | 'position'
  | 'depth'
  | 'velocity'
  | 'rainbow'
  | 'palette';

export type CameraMode = 'perspective' | 'orthographic';

// ---------------------------------------------------------------------------
// Shape settings
// ---------------------------------------------------------------------------
export interface CubeSettings {
  width: number;
  height: number;
  depth: number;
  filled: boolean;
  edgeConcentration: number; // 0..1 bias particles toward edges
  cornerRadius: number; // 0..0.5 rounded corners
}

export interface SphereSettings {
  radius: number;
  filled: boolean;
  hemisphere: boolean;
  latitudeCorrection: boolean; // even surface distribution
}

export interface HelixSettings {
  radius: number;
  height: number;
  turns: number;
  pitch: number;
  strandThickness: number;
  doubleHelix: boolean;
}

export interface TorusSettings {
  majorRadius: number;
  minorRadius: number;
  tubeThickness: number; // 0..1 shell thickness fraction
  filled: boolean;
}

export interface KnotSettings {
  p: number;
  q: number;
  majorRadius: number;
  tubeRadius: number;
  twist: number;
  thickness: number;
}

export interface LorenzSettings {
  sigma: number;
  rho: number;
  beta: number;
  step: number;
  scale: number;
  jitter: number; // thickness around the curve
}

export interface ShapeSettings {
  kind: ShapeKind;
  cube: CubeSettings;
  sphere: SphereSettings;
  helix: HelixSettings;
  torus: TorusSettings;
  knot: KnotSettings;
  lorenz: LorenzSettings;
}

// ---------------------------------------------------------------------------
// Image settings
// ---------------------------------------------------------------------------
export type ImageDepthMode =
  | 'flat'
  | 'luminance'
  | 'invLuminance'
  | 'edge'
  | 'radial'
  | 'layered'
  | 'wave'
  | 'noise';

export type ImageFit = 'fit' | 'fill' | 'original';

export interface ImageSettings {
  sampleResolution: number; // sampling grid resolution (e.g. 256)
  alphaThreshold: number; // 0..1
  brightnessThreshold: number; // 0..1
  invertMask: boolean;
  fit: ImageFit;
  useImageColor: boolean;
  solidColor: string;
  saturation: number;
  contrast: number;
  brightness: number;
  depthMode: ImageDepthMode;
  depthAmount: number;
  depthDirection: number; // +1 / -1
  depthCurve: number; // gamma-like curve for depth
  edgeEmphasis: number;
  noiseDepth: number;
  scale: number;
  rotation: number; // degrees
  flipH: boolean;
  flipV: boolean;
  bgRemoval: number; // 0..1 threshold; 0 = off
  layers: number; // slices for layered depth
}

// ---------------------------------------------------------------------------
// Text settings
// ---------------------------------------------------------------------------
export type TextDepthMode =
  | 'flat'
  | 'extrude'
  | 'rounded'
  | 'bevel'
  | 'luminance'
  | 'wave'
  | 'random'
  | 'layered';

export interface TextSettings {
  content: string;
  fontFamily: string;
  fontWeight: number;
  fontSizePx: number;
  letterSpacing: number;
  lineHeight: number;
  align: 'left' | 'center' | 'right';
  maxWidth: number; // 0 = auto
  scale: number;
  depthMode: TextDepthMode;
  extrudeDepth: number;
  bevel: number;
  density: number; // sampling grid resolution multiplier
  depthNoise: number;
  waveDepth: number;
  edgePriority: number; // prioritise edge/structural pixels
}

// ---------------------------------------------------------------------------
// Model (GLB / glTF) settings
// ---------------------------------------------------------------------------
export interface ModelSettings {
  useModelColor: boolean;
  solidColor: string;
  scale: number;
}

// ---------------------------------------------------------------------------
// Particle / render settings
// ---------------------------------------------------------------------------
export interface ParticleSettings {
  count: number;
  style: ParticleStyle;
  size: number;
  opacity: number;
  blend: BlendMode;
  sizeAttenuation: boolean;
  depthTest: boolean;
  softEdge: number;
  glow: number;
  bloom: boolean;
  bloomStrength: number;
  distanceFade: number;
}

// ---------------------------------------------------------------------------
// Motion settings
// ---------------------------------------------------------------------------
export interface MotionSettings {
  enabled: boolean;
  mode: MotionMode;
  strength: number;
  scale: number;
  speed: number;
  damping: number; // 0..1 velocity retention per frame
  returnForce: number; // spring back to target
  radius: number; // pointer influence radius
  pointerStrength: number;
  pointerRepel: boolean;
  seed: number;
}

// ---------------------------------------------------------------------------
// Color settings
// ---------------------------------------------------------------------------
export interface ColorSettings {
  mode: ColorMode;
  color1: string;
  color2: string;
  color3: string;
  palette: string[];
  background: string;
  gradientRotation: number; // degrees
  hueShift: number;
  saturation: number;
  brightness: number;
  contrast: number;
  animationSpeed: number;
}

// ---------------------------------------------------------------------------
// Morph settings
// ---------------------------------------------------------------------------
export interface MorphSettings {
  duration: number; // seconds
  easing: EasingKind;
  style: MorphStyle;
  spring: number;
  damping: number;
  turbulence: number;
  overshoot: number;
  scatterDistance: number;
  randomDelay: number;
}

// ---------------------------------------------------------------------------
// Camera settings
// ---------------------------------------------------------------------------
export interface CameraSettings {
  mode: CameraMode;
  fov: number;
  autoRotate: boolean;
  autoRotateSpeed: number;
  damping: number;
  near: number;
  far: number;
}

// ---------------------------------------------------------------------------
// Performance settings
// ---------------------------------------------------------------------------
export interface PerformanceSettings {
  renderScale: number; // 0.5..2
  pixelRatioCap: number;
  adaptiveQuality: boolean;
  targetFps: number;
  autoReduce: boolean;
  paused: boolean;
}

// ---------------------------------------------------------------------------
// Full application settings (a preset payload)
// ---------------------------------------------------------------------------
export interface AppSettings {
  source: SourceKind;
  shape: ShapeSettings;
  image: ImageSettings;
  text: TextSettings;
  model: ModelSettings;
  particles: ParticleSettings;
  motion: MotionSettings;
  color: ColorSettings;
  morph: MorphSettings;
  camera: CameraSettings;
  performance: PerformanceSettings;
}

export interface Preset {
  name: string;
  version: number;
  settings: AppSettings;
  builtIn?: boolean;
}

// ---------------------------------------------------------------------------
// Backend capabilities (from feature detection)
// ---------------------------------------------------------------------------
export interface BackendCapabilities {
  webgpu: boolean;
  webgl2: boolean;
  maxTextureSize: number;
  adapterInfo: string;
  recommendedCount: number;
  maxRecommendedCount: number;
  deviceMemoryGb: number;
  cores: number;
}

// ---------------------------------------------------------------------------
// Generated particle target payload (produced by generators / workers)
// ---------------------------------------------------------------------------
export interface ParticleTarget {
  // Interleaved-free typed arrays. positions/colors length = count*3
  positions: Float32Array;
  colors: Float32Array; // rgb 0..1; may be all-white if a color mode overrides
  count: number;
  hasColor: boolean; // whether colors carry meaningful per-particle data (image)
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

// ---------------------------------------------------------------------------
// Runtime simulation uniforms shared with the active backend each frame
// ---------------------------------------------------------------------------
export interface SimUniforms {
  dt: number;
  time: number;
  motionMode: number;
  motionStrength: number;
  motionScale: number;
  motionSpeed: number;
  damping: number;
  returnForce: number;
  pointer: [number, number, number];
  pointerActive: number;
  pointerRadius: number;
  pointerStrength: number; // signed: negative = repel
  seed: number;
  morphActive: number;
  size: number;
  sizeAttenuation: number;
  opacity: number;
  softEdge: number;
  glow: number;
  distanceFade: number;
  styleId: number;
  colorMode: number;
  color1: [number, number, number];
  color2: [number, number, number];
  color3: [number, number, number];
  hueShift: number;
  saturation: number;
  brightness: number;
  contrast: number;
  colorAnimSpeed: number;
  gradientRotation: number;
  boundRadius: number;
}

// ---------------------------------------------------------------------------
// Live performance stats
// ---------------------------------------------------------------------------
export interface PerfStats {
  fps: number;
  frameMs: number;
  gpuMs: number;
  drawCalls: number;
  points: number;
  count: number;
  backend: BackendType;
  renderScale: number;
  pixelRatio: number;
  memoryMb: number;
}

// ---------------------------------------------------------------------------
// Worker message protocol
// ---------------------------------------------------------------------------
export interface WorkerRequest {
  jobId: number;
  kind: 'image' | 'text' | 'shape';
  count: number;
  seed: number;
  // shape
  shape?: ShapeSettings;
  // image
  imageBitmap?: ImageBitmap;
  image?: ImageSettings;
  depthMap?: ImageBitmap | null;
  // text
  text?: TextSettings;
  fontDataUrl?: string | null; // uploaded font as data URL
  fontName?: string | null;
}

export interface WorkerResponse {
  jobId: number;
  ok: boolean;
  error?: string;
  positions?: Float32Array;
  colors?: Float32Array;
  count?: number;
  hasColor?: boolean;
  bounds?: { min: [number, number, number]; max: [number, number, number] };
}
