import type { ParticleTarget, ShapeSettings } from '../types';
import { RNG } from '../util/rng';

// ============================================================================
// ShapeGenerator — deterministic CPU generation of particle target positions
// for each mathematical shape. Runs inside a Web Worker (see imageTextWorker).
// Output positions are roughly normalised to fit within a ~1.5 unit radius so
// the camera framing is consistent across shapes.
// ============================================================================

function computeBounds(positions: Float32Array, count: number): ParticleTarget['bounds'] {
  let minx = Infinity;
  let miny = Infinity;
  let minz = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  let maxz = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (x < minx) minx = x;
    if (y < miny) miny = y;
    if (z < minz) minz = z;
    if (x > maxx) maxx = x;
    if (y > maxy) maxy = y;
    if (z > maxz) maxz = z;
  }
  return { min: [minx, miny, minz], max: [maxx, maxy, maxz] };
}

export function generateShape(settings: ShapeSettings, count: number, seed: number): ParticleTarget {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3).fill(1);
  const rng = new RNG(seed);

  switch (settings.kind) {
    case 'cube':
      genCube(positions, count, settings, rng);
      break;
    case 'sphere':
      genSphere(positions, count, settings, rng);
      break;
    case 'helix':
      genHelix(positions, count, settings, rng);
      break;
    case 'torus':
      genTorus(positions, count, settings, rng);
      break;
    case 'knot':
      genKnot(positions, count, settings, rng);
      break;
    case 'lorenz':
      genLorenz(positions, count, settings, rng);
      break;
  }

  return {
    positions,
    colors,
    count,
    hasColor: false,
    bounds: computeBounds(positions, count),
  };
}

// ---------------------------------------------------------------------------
function genCube(pos: Float32Array, count: number, s: ShapeSettings, rng: RNG): void {
  const { width, height, depth, filled, edgeConcentration, cornerRadius } = s.cube;
  const hw = width / 2;
  const hh = height / 2;
  const hd = depth / 2;
  const tmp: [number, number, number] = [0, 0, 0];

  for (let i = 0; i < count; i++) {
    if (filled) {
      tmp[0] = rng.range(-hw, hw);
      tmp[1] = rng.range(-hh, hh);
      tmp[2] = rng.range(-hd, hd);
    } else {
      // Pick a face weighted by area, place point, then bias toward edges.
      const face = Math.floor(rng.next() * 6);
      const u = rng.next() * 2 - 1;
      const v = rng.next() * 2 - 1;
      // Edge concentration: push u,v toward ±1 using a power curve.
      const bias = (t: number): number => {
        const sign = t < 0 ? -1 : 1;
        const a = Math.abs(t);
        return sign * Math.pow(a, 1 - Math.min(0.95, edgeConcentration) * 0.9);
      };
      const bu = bias(u);
      const bv = bias(v);
      switch (face) {
        case 0: tmp[0] = hw; tmp[1] = bu * hh; tmp[2] = bv * hd; break;
        case 1: tmp[0] = -hw; tmp[1] = bu * hh; tmp[2] = bv * hd; break;
        case 2: tmp[1] = hh; tmp[0] = bu * hw; tmp[2] = bv * hd; break;
        case 3: tmp[1] = -hh; tmp[0] = bu * hw; tmp[2] = bv * hd; break;
        case 4: tmp[2] = hd; tmp[0] = bu * hw; tmp[1] = bv * hh; break;
        default: tmp[2] = -hd; tmp[0] = bu * hw; tmp[1] = bv * hh; break;
      }
    }

    // Corner rounding: clamp toward a rounded-box surface.
    if (cornerRadius > 0.001) {
      const r = cornerRadius * Math.min(width, height, depth);
      roundBox(tmp, hw - r, hh - r, hd - r, r);
    }

    pos[i * 3] = tmp[0];
    pos[i * 3 + 1] = tmp[1];
    pos[i * 3 + 2] = tmp[2];
  }
}

function roundBox(p: [number, number, number], ex: number, ey: number, ez: number, r: number): void {
  const qx = Math.max(Math.abs(p[0]) - ex, 0);
  const qy = Math.max(Math.abs(p[1]) - ey, 0);
  const qz = Math.max(Math.abs(p[2]) - ez, 0);
  const len = Math.hypot(qx, qy, qz);
  if (len > r && len > 1e-6) {
    const k = r / len;
    p[0] = Math.sign(p[0]) * (ex + qx * k);
    p[1] = Math.sign(p[1]) * (ey + qy * k);
    p[2] = Math.sign(p[2]) * (ez + qz * k);
  }
}

// ---------------------------------------------------------------------------
function genSphere(pos: Float32Array, count: number, s: ShapeSettings, rng: RNG): void {
  const { radius, filled, hemisphere } = s.sphere;
  const dir: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    rng.onSphere(dir); // uniform on unit sphere — no pole bunching
    let r = radius;
    if (filled) r = radius * Math.cbrt(rng.next());
    let y = dir[1];
    if (hemisphere) y = Math.abs(y);
    pos[i * 3] = dir[0] * r;
    pos[i * 3 + 1] = y * r;
    pos[i * 3 + 2] = dir[2] * r;
  }
}

// ---------------------------------------------------------------------------
function genHelix(pos: Float32Array, count: number, s: ShapeSettings, rng: RNG): void {
  const { radius, height, turns, pitch, strandThickness, doubleHelix } = s.helix;
  const totalAngle = turns * Math.PI * 2 * Math.max(0.1, pitch);
  const strands = doubleHelix ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const t = rng.next();
    const angle = t * totalAngle;
    const strand = doubleHelix ? i % 2 : 0;
    const phase = (strand / strands) * Math.PI * 2;
    // tube offset for strand thickness
    const tubeAngle = rng.next() * Math.PI * 2;
    const tubeR = strandThickness * Math.sqrt(rng.next());
    const cx = Math.cos(angle + phase) * radius;
    const cz = Math.sin(angle + phase) * radius;
    const cy = (t - 0.5) * height;
    // offset in a plane roughly perpendicular to the strand
    const ox = Math.cos(tubeAngle) * tubeR;
    const oy = Math.sin(tubeAngle) * tubeR;
    pos[i * 3] = cx + ox * Math.cos(angle + phase + Math.PI / 2);
    pos[i * 3 + 1] = cy + oy;
    pos[i * 3 + 2] = cz + ox * Math.sin(angle + phase + Math.PI / 2);
  }
}

// ---------------------------------------------------------------------------
function genTorus(pos: Float32Array, count: number, s: ShapeSettings, rng: RNG): void {
  const { majorRadius, minorRadius, tubeThickness, filled } = s.torus;
  for (let i = 0; i < count; i++) {
    const u = rng.next() * Math.PI * 2;
    const v = rng.next() * Math.PI * 2;
    let rr = minorRadius;
    if (filled) {
      rr = minorRadius * Math.sqrt(rng.next());
    } else {
      // shell of given thickness
      rr = minorRadius * (1 - tubeThickness * rng.next());
    }
    const cu = Math.cos(u);
    const su = Math.sin(u);
    const cv = Math.cos(v);
    pos[i * 3] = (majorRadius + rr * cv) * cu;
    pos[i * 3 + 1] = rr * Math.sin(v);
    pos[i * 3 + 2] = (majorRadius + rr * cv) * su;
  }
}

// ---------------------------------------------------------------------------
function genKnot(pos: Float32Array, count: number, s: ShapeSettings, rng: RNG): void {
  const { p, q, majorRadius, tubeRadius, twist, thickness } = s.knot;
  for (let i = 0; i < count; i++) {
    const t = rng.next() * Math.PI * 2;
    // curve point
    const r = majorRadius * (2 + Math.cos((q / p) * t));
    const cx = r * Math.cos(t);
    const cy = r * Math.sin(t);
    const cz = majorRadius * 1.2 * Math.sin((q / p) * t);

    // approximate tangent via finite difference for a local frame
    const dt = 0.001;
    const t2 = t + dt;
    const r2 = majorRadius * (2 + Math.cos((q / p) * t2));
    const tx = r2 * Math.cos(t2) - cx;
    const ty = r2 * Math.sin(t2) - cy;
    const tz = majorRadius * 1.2 * Math.sin((q / p) * t2) - cz;
    const tl = Math.hypot(tx, ty, tz) || 1;
    const nx = tx / tl;
    const ny = ty / tl;
    const nz = tz / tl;

    // build an orthonormal basis around the tangent
    let ax = 0;
    let ay = 1;
    let az = 0;
    if (Math.abs(ny) > 0.9) {
      ax = 1;
      ay = 0;
    }
    // b1 = normalize(cross(tangent, up))
    let b1x = ny * az - nz * ay;
    let b1y = nz * ax - nx * az;
    let b1z = nx * ay - ny * ax;
    const b1l = Math.hypot(b1x, b1y, b1z) || 1;
    b1x /= b1l;
    b1y /= b1l;
    b1z /= b1l;
    // b2 = cross(tangent, b1)
    const b2x = ny * b1z - nz * b1y;
    const b2y = nz * b1x - nx * b1z;
    const b2z = nx * b1y - ny * b1x;

    const ang = rng.next() * Math.PI * 2 + twist * t;
    const rad = (tubeRadius * thickness) * Math.sqrt(rng.next()) + tubeRadius * 0.0;
    const offx = (Math.cos(ang) * b1x + Math.sin(ang) * b2x) * rad;
    const offy = (Math.cos(ang) * b1y + Math.sin(ang) * b2y) * rad;
    const offz = (Math.cos(ang) * b1z + Math.sin(ang) * b2z) * rad;

    const scale = 0.42; // normalise the (2+cos) knot into view
    pos[i * 3] = (cx + offx) * scale;
    pos[i * 3 + 1] = (cy + offy) * scale;
    pos[i * 3 + 2] = (cz + offz) * scale;
  }
}

// ---------------------------------------------------------------------------
function genLorenz(pos: Float32Array, count: number, s: ShapeSettings, rng: RNG): void {
  const { sigma, rho, beta, step, scale, jitter } = s.lorenz;
  // Integrate the attractor to trace out its shape, then distribute particles
  // along the traced path. We trace a long path and sample points from it.
  const traceLen = Math.min(count, 200000);
  const trace = new Float32Array(traceLen * 3);
  let x = 0.1;
  let y = 0;
  let z = 0;
  // warm-up so we start on the attractor
  for (let i = 0; i < 1000; i++) {
    const dx = sigma * (y - x);
    const dy = x * (rho - z) - y;
    const dz = x * y - beta * z;
    x += dx * step;
    y += dy * step;
    z += dz * step;
  }
  for (let i = 0; i < traceLen; i++) {
    const dx = sigma * (y - x);
    const dy = x * (rho - z) - y;
    const dz = x * y - beta * z;
    x += dx * step;
    y += dy * step;
    z += dz * step;
    trace[i * 3] = x;
    trace[i * 3 + 1] = z - 27; // center vertically (attractor sits ~z=27)
    trace[i * 3 + 2] = y;
  }

  for (let i = 0; i < count; i++) {
    const idx = count <= traceLen ? i : Math.floor(rng.next() * traceLen);
    const j = idx % traceLen;
    const jx = (rng.next() - 0.5) * jitter * 30;
    const jy = (rng.next() - 0.5) * jitter * 30;
    const jz = (rng.next() - 0.5) * jitter * 30;
    pos[i * 3] = (trace[j * 3] + jx) * scale;
    pos[i * 3 + 1] = (trace[j * 3 + 1] + jy) * scale;
    pos[i * 3 + 2] = (trace[j * 3 + 2] + jz) * scale;
  }
}
