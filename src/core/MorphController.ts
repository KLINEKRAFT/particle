import type { EasingKind, MorphSettings, MorphStyle } from '../types';

// Easing functions for morph progress display.
const EASING: Record<EasingKind, (t: number) => number> = {
  linear: (t) => t,
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeIn: (t) => t * t * t,
  expo: (t) => (t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
  elastic: (t) => {
    const c = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c) + 1;
  },
  back: (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
};

const STYLE_IMPULSE: Record<MorphStyle, number> = {
  direct: 0,
  scatter: 1,
  explode: 2,
  spiral: 3,
  wipe: 1,
  dissolve: 1,
};

// ============================================================================
// MorphController — tracks the morph transition timeline and computes the
// initial GPU impulse. The actual particle transition is performed by the
// backend's spring-to-target integration; this class supplies the parameters
// and exposes progress for the timeline UI.
// ============================================================================
export class MorphController {
  active = false;
  private startTime = 0;
  private duration = 1.8;
  private easing: EasingKind = 'easeInOut';

  start(settings: MorphSettings, elapsed: number): { styleId: number; strength: number } {
    this.active = true;
    this.startTime = elapsed;
    this.duration = Math.max(0.05, settings.duration);
    this.easing = settings.easing;
    const styleId = STYLE_IMPULSE[settings.style];
    const strength = styleId === 0 ? 0 : settings.scatterDistance * (1 + settings.overshoot) * 2.2;
    return { styleId, strength };
  }

  /** Returns eased progress 0..1; deactivates when complete. */
  progress(elapsed: number): number {
    if (!this.active) return 1;
    const raw = (elapsed - this.startTime) / this.duration;
    if (raw >= 1) {
      this.active = false;
      return 1;
    }
    return EASING[this.easing](Math.max(0, raw));
  }

  /** Spring strength during morph → snappier settle within the duration. */
  springBoost(settings: MorphSettings): number {
    return this.active ? settings.spring : 0;
  }
}
