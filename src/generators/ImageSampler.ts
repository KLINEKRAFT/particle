import type { ImageSettings, ParticleTarget } from '../types';
import { RNG } from '../util/rng';
import { hexToRgb } from '../util/color';

// ============================================================================
// ImageSampler — turns an ImageBitmap into a 2.5D particle relief.
// Runs inside a Web Worker using OffscreenCanvas. Pure function: no DOM.
// ============================================================================

interface Decoded {
  w: number;
  h: number;
  data: Uint8ClampedArray; // RGBA
}

function drawToCanvas(bitmap: ImageBitmap, s: ImageSettings): Decoded {
  const res = Math.max(32, Math.min(1024, Math.round(s.sampleResolution)));
  const canvas = new OffscreenCanvas(res, res);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not create 2D context');

  ctx.clearRect(0, 0, res, res);
  ctx.save();
  ctx.translate(res / 2, res / 2);
  ctx.rotate((s.rotation * Math.PI) / 180);
  ctx.scale(s.flipH ? -1 : 1, s.flipV ? -1 : 1);
  ctx.scale(s.scale, s.scale);

  const iw = bitmap.width;
  const ih = bitmap.height;
  const aspect = iw / ih;
  let dw = res;
  let dh = res;
  if (s.fit === 'fit') {
    if (aspect > 1) dh = res / aspect;
    else dw = res * aspect;
  } else if (s.fit === 'fill') {
    if (aspect > 1) dw = res * aspect;
    else dh = res / aspect;
  } else {
    // original — clamp longest side to res
    if (aspect > 1) {
      dw = res;
      dh = res / aspect;
    } else {
      dh = res;
      dw = res * aspect;
    }
  }
  ctx.drawImage(bitmap, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();

  const img = ctx.getImageData(0, 0, res, res);
  return { w: res, h: res, data: img.data };
}

function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// Sobel edge magnitude over the luminance field.
function computeEdges(dec: Decoded): Float32Array {
  const { w, h, data } = dec;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    lum[i] = luminance(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  }
  const edges = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -lum[i - w - 1] - 2 * lum[i - 1] - lum[i + w - 1] +
        lum[i - w + 1] + 2 * lum[i + 1] + lum[i + w + 1];
      const gy =
        -lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1] +
        lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1];
      edges[i] = Math.min(1, Math.hypot(gx, gy));
    }
  }
  return edges;
}

function applyAdjust(r: number, g: number, b: number, s: ImageSettings): [number, number, number] {
  // brightness
  let rr = r * s.brightness;
  let gg = g * s.brightness;
  let bb = b * s.brightness;
  // contrast around 0.5
  rr = (rr - 0.5) * s.contrast + 0.5;
  gg = (gg - 0.5) * s.contrast + 0.5;
  bb = (bb - 0.5) * s.contrast + 0.5;
  // saturation
  const gray = 0.299 * rr + 0.587 * gg + 0.114 * bb;
  rr = gray + (rr - gray) * s.saturation;
  gg = gray + (gg - gray) * s.saturation;
  bb = gray + (bb - gray) * s.saturation;
  return [Math.max(0, Math.min(1, rr)), Math.max(0, Math.min(1, gg)), Math.max(0, Math.min(1, bb))];
}

export function sampleImage(
  bitmap: ImageBitmap,
  s: ImageSettings,
  count: number,
  seed: number,
  depthMapBitmap: ImageBitmap | null,
): ParticleTarget {
  const dec = drawToCanvas(bitmap, s);
  const { w, h, data } = dec;
  const rng = new RNG(seed);
  const edges = s.depthMode === 'edge' || s.edgeEmphasis > 0 ? computeEdges(dec) : null;

  let depthMap: Decoded | null = null;
  if (depthMapBitmap) {
    depthMap = drawToCanvas(depthMapBitmap, { ...s, useImageColor: true });
  }

  // background color sampled from top-left corner for bg removal
  const bgR = data[0] / 255;
  const bgG = data[1] / 255;
  const bgB = data[2] / 255;

  // Build the list of valid pixels with a cumulative weight for even sampling.
  const valid: number[] = [];
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3] / 255;
    if (a < s.alphaThreshold) continue;
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    const lum = luminance(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    let keep = lum >= s.brightnessThreshold;
    if (s.invertMask) keep = !keep && a >= s.alphaThreshold;
    if (s.bgRemoval > 0) {
      const dist = Math.hypot(r - bgR, g - bgG, b - bgB);
      if (dist < s.bgRemoval) keep = false;
    }
    if (keep) valid.push(i);
  }

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const solid = hexToRgb(s.solidColor);
  const half = w / 2;

  if (valid.length === 0) {
    // Nothing passed the mask — produce a flat plane so the user sees feedback.
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (rng.next() - 0.5) * 2;
      positions[i * 3 + 1] = (rng.next() - 0.5) * 2;
      positions[i * 3 + 2] = 0;
      colors[i * 3] = solid[0];
      colors[i * 3 + 1] = solid[1];
      colors[i * 3 + 2] = solid[2];
    }
    return { positions, colors, count, hasColor: true, bounds: { min: [-1, -1, 0], max: [1, 1, 0] } };
  }

  const norm = 3.0 / w; // scale pixel coords into ~[-1.5,1.5]
  for (let i = 0; i < count; i++) {
    // Even sampling: stride through the valid list; jitter repeats when count>valid.
    let pi: number;
    if (count <= valid.length) {
      pi = valid[Math.floor((i / count) * valid.length)];
    } else {
      pi = valid[i % valid.length];
    }
    const px = pi % w;
    const py = Math.floor(pi / w);
    const jitter = count > valid.length ? (rng.next() - 0.5) : (rng.next() - 0.5) * 0.5;
    const jx = jitter;
    const jy = rng.next() - 0.5;

    const x = (px - half + jx) * norm;
    const y = -(py - half + jy) * norm; // flip so image is upright

    const r = data[pi * 4] / 255;
    const g = data[pi * 4 + 1] / 255;
    const b = data[pi * 4 + 2] / 255;
    const lum = luminance(data[pi * 4], data[pi * 4 + 1], data[pi * 4 + 2]);

    let depth = 0;
    switch (s.depthMode) {
      case 'flat':
        depth = 0;
        break;
      case 'luminance':
        depth = Math.pow(lum, s.depthCurve);
        break;
      case 'invLuminance':
        depth = Math.pow(1 - lum, s.depthCurve);
        break;
      case 'edge':
        depth = edges ? edges[pi] : 0;
        break;
      case 'radial': {
        const dx = x;
        const dy = y;
        depth = 1 - Math.min(1, Math.hypot(dx, dy) / 1.5);
        break;
      }
      case 'layered': {
        const layer = Math.floor(lum * s.layers) / Math.max(1, s.layers);
        depth = layer;
        break;
      }
      case 'wave':
        depth = 0.5 + 0.5 * Math.sin(x * 4 + y * 4);
        break;
      case 'noise':
        depth = rng.next();
        break;
    }
    if (depthMap) {
      const dmLum = luminance(depthMap.data[pi * 4], depthMap.data[pi * 4 + 1], depthMap.data[pi * 4 + 2]);
      depth = dmLum;
    }
    let z = (depth - 0.5) * 2 * s.depthAmount * s.depthDirection;
    if (s.edgeEmphasis > 0 && edges) z += edges[pi] * s.edgeEmphasis * 0.3;
    if (s.noiseDepth > 0) z += (rng.next() - 0.5) * s.noiseDepth;

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    if (s.useImageColor) {
      const [cr, cg, cb] = applyAdjust(r, g, b, s);
      colors[i * 3] = cr;
      colors[i * 3 + 1] = cg;
      colors[i * 3 + 2] = cb;
    } else {
      colors[i * 3] = solid[0];
      colors[i * 3 + 1] = solid[1];
      colors[i * 3 + 2] = solid[2];
    }
  }

  let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < minx) minx = x; if (y < miny) miny = y; if (z < minz) minz = z;
    if (x > maxx) maxx = x; if (y > maxy) maxy = y; if (z > maxz) maxz = z;
  }

  return {
    positions,
    colors,
    count,
    hasColor: true,
    bounds: { min: [minx, miny, minz], max: [maxx, maxy, maxz] },
  };
}
