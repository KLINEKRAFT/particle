// Deterministic pseudo-random number generator (mulberry32) so that all
// generation is reproducible from a seed. Used by shape generators and samplers.

export class RNG {
  private state: number;

  constructor(seed: number) {
    // Ensure a non-zero 32-bit state.
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  next(): number {
    // mulberry32
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  // Uniform point on a unit sphere via Marsaglia's method — no pole bunching.
  onSphere(out: [number, number, number]): void {
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = this.next() * 2 - 1;
      v = this.next() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const a = 2 * Math.sqrt(1 - s);
    out[0] = u * a;
    out[1] = v * a;
    out[2] = 1 - 2 * s;
  }

  gaussian(): number {
    // Box–Muller
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

// Cheap deterministic 1D hash → [0,1) for jitter, independent of RNG stream.
export function hash1(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}
