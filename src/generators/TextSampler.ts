import type { ParticleTarget, TextSettings } from '../types';
import { RNG } from '../util/rng';

// ============================================================================
// TextSampler — rasterises text to a high-resolution alpha mask and samples
// particle positions from it. Runs inside a Web Worker via OffscreenCanvas.
// Supports multi-line text, alignment, and several 3D depth modes.
// ============================================================================

interface Mask {
  w: number;
  h: number;
  alpha: Float32Array; // 0..1 coverage
  dist: Float32Array; // approximate distance-to-edge (inside), 0..1
}

function rasterize(s: TextSettings, fontFamily: string): Mask {
  const lines = s.content.split('\n');
  const fontSize = Math.max(8, s.fontSizePx);
  const lineH = fontSize * s.lineHeight;
  const pad = fontSize * 0.5;

  // Measure with a scratch canvas.
  const measureCanvas = new OffscreenCanvas(8, 8);
  const mctx = measureCanvas.getContext('2d')!;
  const fontStr = `${s.fontWeight} ${fontSize}px ${fontFamily}`;
  mctx.font = fontStr;

  let maxLineW = 1;
  const lineWidths: number[] = [];
  for (const line of lines) {
    let lw = mctx.measureText(line).width;
    lw += Math.max(0, line.length - 1) * s.letterSpacing;
    lineWidths.push(lw);
    if (lw > maxLineW) maxLineW = lw;
  }

  const width = Math.ceil(maxLineW + pad * 2);
  const height = Math.ceil(lineH * lines.length + pad * 2);
  // Cap canvas dimension for memory safety.
  const cap = 2048;
  const scale = Math.min(1, cap / Math.max(width, height));
  const cw = Math.max(8, Math.round(width * scale));
  const ch = Math.max(8, Math.round(height * scale));

  const canvas = new OffscreenCanvas(cw, ch);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cw, ch);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.font = fontStr;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const y = pad + lineH * (li + 0.5);
    let startX = pad;
    if (s.align === 'center') startX = pad + (maxLineW - lineWidths[li]) / 2;
    else if (s.align === 'right') startX = pad + (maxLineW - lineWidths[li]);

    if (s.letterSpacing !== 0) {
      let x = startX;
      for (const ch2 of line) {
        ctx.fillText(ch2, x, y);
        x += ctx.measureText(ch2).width + s.letterSpacing;
      }
    } else {
      ctx.textAlign = 'left';
      ctx.fillText(line, startX, y);
    }
  }

  const img = ctx.getImageData(0, 0, cw, ch);
  const alpha = new Float32Array(cw * ch);
  for (let i = 0; i < cw * ch; i++) {
    // white text on black — use red channel as coverage
    alpha[i] = img.data[i * 4] / 255;
  }
  const dist = distanceTransform(alpha, cw, ch);
  return { w: cw, h: ch, alpha, dist };
}

// Cheap two-pass chamfer distance transform of the interior (approx edge dist).
function distanceTransform(alpha: Float32Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = alpha[i] > 0.5 ? INF : 0;
  // forward
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) v = Math.min(v, d[i - w] + 1);
      if (x > 0 && y > 0) v = Math.min(v, d[i - w - 1] + 1.414);
      if (x < w - 1 && y > 0) v = Math.min(v, d[i - w + 1] + 1.414);
      d[i] = v;
    }
  }
  // backward
  let maxd = 1;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < h - 1) v = Math.min(v, d[i + w] + 1);
      if (x < w - 1 && y < h - 1) v = Math.min(v, d[i + w + 1] + 1.414);
      if (x > 0 && y < h - 1) v = Math.min(v, d[i + w - 1] + 1.414);
      d[i] = v;
      if (v < INF && v > maxd) maxd = v;
    }
  }
  for (let i = 0; i < w * h; i++) {
    d[i] = d[i] >= INF ? 1 : d[i] / maxd;
  }
  return d;
}

export function sampleText(s: TextSettings, count: number, seed: number, fontFamily: string): ParticleTarget {
  const mask = rasterize(s, fontFamily);
  const { w, h, alpha, dist } = mask;
  const rng = new RNG(seed);

  // Weighted valid-pixel list. Edge priority weights structural pixels higher
  // so letterforms stay readable at low counts.
  const valid: number[] = [];
  const weights: number[] = [];
  let totalW = 0;
  for (let i = 0; i < w * h; i++) {
    if (alpha[i] < 0.35) continue;
    // edge pixels have small dist; interior large. edgePriority in [0,1].
    const edgeW = 1 - dist[i];
    const wgt = 1 + s.edgePriority * 6 * edgeW;
    valid.push(i);
    weights.push(wgt);
    totalW += wgt;
  }

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3).fill(1);

  if (valid.length === 0) {
    return { positions, colors, count, hasColor: false, bounds: { min: [0, 0, 0], max: [0, 0, 0] } };
  }

  // Build a cumulative distribution for weighted sampling.
  const cdf = new Float32Array(valid.length);
  let acc = 0;
  for (let i = 0; i < valid.length; i++) {
    acc += weights[i];
    cdf[i] = acc;
  }

  const norm = 3.2 / w; // fit text width to ~[-1.6,1.6]
  const halfW = w / 2;
  const halfH = h / 2;

  for (let i = 0; i < count; i++) {
    const target = rng.next() * totalW;
    // binary search cdf
    let lo = 0;
    let hi = valid.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const pi = valid[lo];
    const px = pi % w;
    const py = Math.floor(pi / w);
    const jx = rng.next() - 0.5;
    const jy = rng.next() - 0.5;

    const x = (px - halfW + jx) * norm * s.scale;
    const y = -(py - halfH + jy) * norm * s.scale;
    const edgeDist = dist[pi]; // 0 at edge, 1 at core

    let z = 0;
    switch (s.depthMode) {
      case 'flat':
        z = 0;
        break;
      case 'extrude':
        z = (rng.next() - 0.5) * s.extrudeDepth * 2;
        break;
      case 'rounded':
        z = Math.sqrt(edgeDist) * s.extrudeDepth * (rng.next() < 0.5 ? 1 : -1);
        break;
      case 'bevel': {
        const bev = Math.min(1, edgeDist / Math.max(0.001, s.bevel));
        z = bev * s.extrudeDepth * (rng.next() < 0.5 ? 1 : -1);
        break;
      }
      case 'luminance':
        z = edgeDist * s.extrudeDepth;
        break;
      case 'wave':
        z = Math.sin(x * 5) * s.waveDepth;
        break;
      case 'random':
        z = (rng.next() - 0.5) * s.extrudeDepth * 2;
        break;
      case 'layered': {
        const layer = Math.floor(rng.next() * 3);
        z = (layer - 1) * s.extrudeDepth;
        break;
      }
    }
    if (s.depthNoise > 0) z += (rng.next() - 0.5) * s.depthNoise;
    if (s.waveDepth > 0 && s.depthMode !== 'wave') z += Math.sin(x * 5 + y * 3) * s.waveDepth * 0.5;

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
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
    hasColor: false,
    bounds: { min: [minx, miny, minz], max: [maxx, maxy, maxz] },
  };
}
