import { Noise3, smoothstep, clamp } from '../../procgen/noise';
import { hash32 } from '../../core/Random';
import type { TerrainParams, RGB } from '../../universe/types';

/**
 * Deterministic planetary height + biome function. This module is pure and
 * worker-safe (no three.js). The same instance logic runs on the main thread
 * for collision queries and inside terrain workers for mesh generation, so the
 * visible surface and the physical surface always agree.
 *
 * All directions are unit vectors in planet-local space (local +Y is the
 * rotation axis). Heights are metres above the base radius.
 */
export class TerrainGen {
  readonly p: TerrainParams;
  private n1: Noise3;
  private n2: Noise3;
  private n3: Noise3;
  readonly seaHeight: number;
  private duneDir: [number, number, number];

  constructor(params: TerrainParams) {
    this.p = params;
    this.n1 = new Noise3(params.seed);
    this.n2 = new Noise3(params.seed ^ 0x5bd1e995);
    this.n3 = new Noise3(params.seed ^ 0x1b873593);
    this.seaHeight = params.seaLevel === null ? -Infinity : params.seaLevel * params.heightScale;
    const h = hash32(params.seed);
    const a = (h / 4294967296) * Math.PI * 2;
    this.duneDir = [Math.cos(a), 0.3, Math.sin(a)];
  }

  get hasSea(): boolean {
    return this.p.seaLevel !== null && this.p.liquid !== 'none';
  }

  /** Number of octaves so the finest octave is not below `minWl` metres. */
  private oct(baseWl: number, minWl: number, max: number): number {
    if (minWl <= 0) return max;
    const o = Math.ceil(Math.log2(baseWl / minWl));
    return o < 1 ? 1 : o > max ? max : o;
  }

  private fbmW(n: Noise3, x: number, y: number, z: number, f: number, oct: number, gain = 0.5): number {
    let sum = 0, amp = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += n.noise(x * f, y * f, z * f) * amp;
      norm += amp;
      amp *= gain;
      f *= 2;
    }
    return sum / norm;
  }

  private ridgedW(n: Noise3, x: number, y: number, z: number, f: number, oct: number): number {
    let sum = 0, amp = 0.5, prev = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      let v = 1 - Math.abs(n.noise(x * f, y * f, z * f));
      v *= v;
      sum += v * amp * (0.5 + 0.5 * prev);
      norm += amp;
      prev = v;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }

  private craters(x: number, y: number, z: number, freq: number, salt: number): number {
    const px = x * freq, py = y * freq, pz = z * freq;
    const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
    let result = 0;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (let k = -1; k <= 1; k++) {
          const gx = cx + i, gy = cy + j, gz = cz + k;
          let h = hash32((gx * 73856093) ^ (gy * 19349663) ^ (gz * 83492791) ^ salt);
          if ((h & 255) > 90) continue; // sparse
          h = hash32(h);
          const ox = (h & 1023) / 1023;
          h = hash32(h);
          const oy = (h & 1023) / 1023;
          h = hash32(h);
          const oz = (h & 1023) / 1023;
          h = hash32(h);
          const r = 0.18 + ((h & 1023) / 1023) * 0.3;
          const dx = px - (gx + ox), dy = py - (gy + oy), dz = pz - (gz + oz);
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / r;
          if (d < 1.4) {
            const bowl = d < 1 ? d * d - 1 : 0;
            const rim = Math.exp(-(d - 1) * (d - 1) * 18) * 0.35;
            const v = bowl * 0.9 + rim;
            if (Math.abs(v) > Math.abs(result)) result = v;
          }
        }
      }
    }
    return result;
  }

  /**
   * Terrain elevation in metres for a unit direction. `minWl` is the smallest
   * wavelength (metres) worth evaluating; coarse LODs pass larger values.
   */
  height(x: number, y: number, z: number, minWl = 0.4): number {
    const p = this.p;
    const R = p.radius;
    const H = p.heightScale;

    // domain warp for organic shapes
    const wf = 1.7;
    const warpOct = this.oct(R / wf, minWl, 3);
    const wx = this.fbmW(this.n2, x, y, z, wf, warpOct);
    const wy = this.fbmW(this.n2, x + 31.7, y - 12.3, z + 5.1, wf, warpOct);
    const wz = this.fbmW(this.n2, x - 7.9, y + 44.2, z - 19.4, wf, warpOct);
    const qx = x + wx * p.warp * 0.35;
    const qy = y + wy * p.warp * 0.35;
    const qz = z + wz * p.warp * 0.35;

    // continents
    const cf = p.continentFreq;
    const c = this.fbmW(this.n1, qx, qy, qz, cf, this.oct(R / cf, minWl, 7), 0.5);
    let e = c * 0.75 + 0.08;

    // mountain ranges on continental interiors
    const mf = p.mountainFreq;
    const mask = smoothstep(-0.02, 0.35, c);
    if (p.mountainAmount > 0 && mask > 0) {
      const m = this.ridgedW(this.n1, qx + 10.3, qy - 3.1, qz + 7.7, mf, this.oct(R / mf, minWl, 9));
      e += (m * m * 0.7 + m * 0.3) * p.mountainAmount * mask * 1.5;
    }

    // rolling hills
    const hf = 9;
    e += this.fbmW(this.n3, x, y, z, hf, this.oct(R / hf, minWl, 4)) * 0.12 * (0.6 + mask * 0.4);
    // eroded mid-scale ridges (~400 m) give the land readable relief when walking
    const rf = R / 420;
    const rr = this.ridgedW(this.n2, x + 4.1, y + 1.3, z - 2.2, rf, this.oct(420, minWl, 4));
    e += (rr - 0.35) * 0.16 * (0.35 + mask);

    // mesa terracing
    if (p.mesaAmount > 0) {
      const steps = 5;
      const t = (e + 1) * steps;
      const fl = Math.floor(t);
      const fr = t - fl;
      const terr = (fl + smoothstep(0.25, 0.55, fr)) / steps - 1;
      const mm = smoothstep(0.05, 0.3, this.n3.noise(x * 3.3, y * 3.3, z * 3.3) + 0.2);
      e = e + (terr - e) * p.mesaAmount * mm;
    }

    // alien spires
    if (p.spires > 0) {
      const s = this.n2.noise(x * 26 + 3, y * 26, z * 26 - 9);
      if (s > 0.45) {
        const k = (s - 0.45) / 0.55;
        e += k * k * k * p.spires * 1.4;
      }
    }

    let h = e * H;

    // impact craters
    if (p.craterAmount > 0) {
      const cr = this.craters(x, y, z, 7, 0x1234) * 0.55 + this.craters(x, y, z, 19, 0x9876) * 0.3;
      h += cr * p.craterAmount * H * 0.35;
    }

    // wavelength-cut metre-scale detail
    const wx2 = x * R, wy2 = y * R, wz2 = z * R;
    const dAmp = p.detail;
    if (minWl < 160) {
      h += this.fbmW(this.n3, wx2, wy2, wz2, 1 / 160, this.oct(160, minWl, 6), 0.45) * 15 * dAmp;
    }

    // dunes on lowlands
    if (p.dunes > 0 && minWl < 60) {
      const d = this.duneDir;
      const along = (wx2 * d[0] + wy2 * d[1] + wz2 * d[2]) / 38;
      const wob = this.n2.noise(wx2 / 220, wy2 / 220, wz2 / 220) * 4;
      const s = 1 - Math.abs(Math.sin(along + wob));
      const low = 1 - smoothstep(0.0, 0.35, e);
      h += s * s * 7 * p.dunes * low;
    }

    // flatten the sea floor slightly for nicer coastlines
    if (this.hasSea && h < this.seaHeight) {
      const depth = this.seaHeight - h;
      h = this.seaHeight - depth * 0.85 - 2;
    }
    return h;
  }

  /** Moisture term in [0,1] used by biome colouring and scattering. */
  moisture(x: number, y: number, z: number): number {
    return clamp(this.n2.fbm(x * 3.1 + 11, y * 3.1, z * 3.1 - 5, 4) * 0.9 + 0.5, 0, 1);
  }

  /**
   * Biome colour for a surface point. `slope` = 1 - dot(normal, up).
   * Writes sRGB 0..1 into out.
   */
  color(x: number, y: number, z: number, h: number, slope: number, out: RGB): void {
    const p = this.p;
    const pal = p.palette;
    const H = p.heightScale;
    const sea = this.hasSea ? this.seaHeight : -H * 2;
    const m = this.moisture(x, y, z);
    const var1 = this.n3.noise(x * 40, y * 40, z * 40) * 0.5 + 0.5;
    const var2 = this.n1.noise(x * 180, y * 180, z * 180) * 0.5 + 0.5;
    let r: number, g: number, b: number;
    const a = (h - sea) / H; // normalised altitude above sea

    const mix = (c1: RGB, c2: RGB, t: number) => {
      r = c1[0] + (c2[0] - c1[0]) * t;
      g = c1[1] + (c2[1] - c1[1]) * t;
      b = c1[2] + (c2[2] - c1[2]) * t;
    };
    const blendTo = (c: RGB, t: number) => {
      r += (c[0] - r) * t;
      g += (c[1] - g) * t;
      b += (c[2] - b) * t;
    };

    r = pal.low[0]; g = pal.low[1]; b = pal.low[2];
    if (this.hasSea && h < sea) {
      const depth = clamp((sea - h) / (H * 0.5), 0, 1);
      mix(pal.shallow, pal.deep, depth);
      blendTo(pal.beach, clamp(1 - depth * 8, 0, 1) * 0.7);
    } else {
      mix(pal.low, pal.lowAlt, clamp(m * 1.2 - 0.1 + (var1 - 0.5) * 0.4, 0, 1));
      const beachT = this.hasSea ? 1 - smoothstep(0.0, 0.03, a) : 0;
      blendTo(pal.beach, beachT);
      blendTo(pal.mid, smoothstep(0.25, 0.55, a + (var1 - 0.5) * 0.12));
      blendTo(pal.high, smoothstep(0.55, 0.85, a + (var1 - 0.5) * 0.1));
      // cliffs
      blendTo(pal.cliff, smoothstep(0.18, 0.42, slope));
      // snow on peaks + poles
      if (p.snowAmount > 0) {
        const lat = Math.abs(y);
        const snowLine = 1.15 - p.snowAmount * 0.9 - smoothstep(0.55, 0.95, lat) * 0.9;
        const snow = smoothstep(snowLine, snowLine + 0.12, a + (var1 - 0.5) * 0.15) * (1 - smoothstep(0.25, 0.5, slope));
        blendTo(pal.peak, snow);
      } else {
        blendTo(pal.peak, smoothstep(0.95, 1.2, a) * 0.6);
      }
    }
    const shade = 0.88 + var2 * 0.24;
    out[0] = r * shade;
    out[1] = g * shade;
    out[2] = b * shade;
  }
}
