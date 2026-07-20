import type { ColorMode, MotionMode, ParticleStyle } from '../../types';

// Numeric encodings shared by both backends so the same integer means the same
// thing in TSL and GLSL shaders.

export const STYLE_ID: Record<ParticleStyle, number> = {
  soft: 0,
  dot: 1,
  square: 2,
  disc: 3,
  spark: 4,
  sphere: 5,
};

export const COLOR_MODE_ID: Record<ColorMode, number> = {
  solid: 0,
  gradient2: 1,
  gradient3: 2,
  image: 3,
  position: 4,
  depth: 5,
  velocity: 6,
  rainbow: 7,
  palette: 8,
};

export const MOTION_MODE_ID: Record<MotionMode, number> = {
  none: 0,
  curl: 1,
  noise: 2,
  brownian: 3,
  orbital: 4,
  wave: 5,
  vortex: 6,
  gravity: 7,
  attract: 8,
  explode: 9,
};
