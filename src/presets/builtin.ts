import type { AppSettings, Preset } from '../types';
import { defaultSettings } from '../config/defaults';

// Deep-merge a partial settings patch onto the defaults to build a full preset.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function merge(base: any, patch: any): any {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = merge(base[k] ?? {}, v);
    else out[k] = v;
  }
  return out;
}

function preset(name: string, patch: Partial<AppSettings> | Record<string, unknown>): Preset {
  return { name, version: 1, builtIn: true, settings: merge(defaultSettings(), patch) as AppSettings };
}

export function builtinPresets(): Preset[] {
  return [
    preset('Neon Sphere', {
      source: 'shape',
      shape: { kind: 'sphere', sphere: { radius: 1.4, filled: false } },
      particles: { count: 200000, style: 'disc', size: 1.4, opacity: 0.85, glow: 0.8, bloom: true, bloomStrength: 0.9 },
      color: { mode: 'gradient2', color1: '#00e5ff', color2: '#ff00d4', background: '#04040a' },
      motion: { enabled: true, mode: 'curl', strength: 0.08, speed: 0.3, returnForce: 3 },
    }),
    preset('Glass Helix', {
      source: 'shape',
      shape: { kind: 'helix', helix: { radius: 1, height: 3.2, turns: 6, doubleHelix: true, strandThickness: 0.06 } },
      particles: { count: 160000, style: 'soft', size: 1.3, opacity: 0.55, blend: 'normal', glow: 0.2, depthTest: true },
      color: { mode: 'gradient2', color1: '#a8d8ff', color2: '#dfefff', background: '#0a0e14' },
      motion: { enabled: true, mode: 'orbital', strength: 0.05, speed: 0.2, returnForce: 4 },
      camera: { autoRotate: true, autoRotateSpeed: 0.8 },
    }),
    preset('Electric Torus', {
      source: 'shape',
      shape: { kind: 'torus', torus: { majorRadius: 1.2, minorRadius: 0.45 } },
      particles: { count: 250000, style: 'spark', size: 1.2, opacity: 0.8, glow: 0.7, bloom: true },
      color: { mode: 'velocity', color1: '#3a0ca3', color2: '#f72585' },
      motion: { enabled: true, mode: 'vortex', strength: 0.18, speed: 0.5, returnForce: 2.2, damping: 0.86 },
    }),
    preset('Lorenz Storm', {
      source: 'shape',
      shape: { kind: 'lorenz' },
      particles: { count: 300000, style: 'spark', size: 1, opacity: 0.7, glow: 0.6, bloom: true, bloomStrength: 0.7 },
      color: { mode: 'rainbow', animationSpeed: 1, background: '#04060a' },
      motion: { enabled: true, mode: 'curl', strength: 0.06, speed: 0.4, returnForce: 1.8, damping: 0.9 },
    }),
    preset('Floating Logo', {
      source: 'text',
      text: { content: '◆ AURORA', fontWeight: 900, depthMode: 'extrude', extrudeDepth: 0.3 },
      particles: { count: 180000, style: 'disc', size: 1.3, opacity: 0.9, glow: 0.5, bloom: true },
      color: { mode: 'gradient3', color1: '#ffd60a', color2: '#ff6b00', color3: '#ff006e', background: '#08060c' },
      motion: { enabled: true, mode: 'wave', strength: 0.05, speed: 0.6, returnForce: 3.2 },
      camera: { autoRotate: true, autoRotateSpeed: 0.4 },
    }),
    preset('Particle Typography', {
      source: 'text',
      text: { content: 'DESIGN\nIN MOTION', fontWeight: 800, depthMode: 'bevel', extrudeDepth: 0.2, bevel: 0.2 },
      particles: { count: 220000, style: 'soft', size: 1.1, opacity: 0.9, glow: 0.35 },
      color: { mode: 'gradient2', color1: '#ffffff', color2: '#7aa2ff', background: '#060608' },
      motion: { enabled: true, mode: 'curl', strength: 0.04, speed: 0.25, returnForce: 3.5 },
    }),
    preset('Rainbow Knot', {
      source: 'shape',
      shape: { kind: 'knot', knot: { p: 2, q: 3, majorRadius: 1.1, tubeRadius: 0.35 } },
      particles: { count: 250000, style: 'disc', size: 1.2, opacity: 0.85, glow: 0.6, bloom: true },
      color: { mode: 'position', animationSpeed: 0.5, background: '#050505' },
      motion: { enabled: true, mode: 'curl', strength: 0.05, speed: 0.3, returnForce: 3 },
      camera: { autoRotate: true, autoRotateSpeed: 0.7 },
    }),
    preset('Monochrome Image Relief', {
      source: 'image',
      image: { depthMode: 'luminance', depthAmount: 0.7, useImageColor: false, solidColor: '#e8e8e8' },
      particles: { count: 200000, style: 'soft', size: 1.1, opacity: 0.9, glow: 0.15, blend: 'normal', depthTest: true },
      color: { mode: 'solid', color1: '#e8e8e8', background: '#0a0a0a' },
      motion: { enabled: true, mode: 'none', strength: 0, returnForce: 4 },
    }),
  ];
}
