import * as THREE from 'three';
import { hash32 } from '../core/Random';

/**
 * Procedurally generated shared textures. Everything in the game is produced
 * in code so the art direction stays coherent and there are no licensing
 * concerns.
 */
function periodicValueNoise(size: number, period: number, seed: number, octaves: number): Float32Array {
  const out = new Float32Array(size * size);
  const lattice = (x: number, y: number, p: number) => hash32(((x % p + p) % p) * 73856093 ^ ((y % p + p) % p) * 19349663 ^ seed ^ (p * 83492791)) / 4294967296;
  let amp = 1;
  let norm = 0;
  let p = period;
  for (let o = 0; o < octaves; o++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * p;
        const fy = (y / size) * p;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        let tx = fx - ix;
        let ty = fy - iy;
        tx = tx * tx * (3 - 2 * tx);
        ty = ty * ty * (3 - 2 * ty);
        const a = lattice(ix, iy, p);
        const b = lattice(ix + 1, iy, p);
        const c = lattice(ix, iy + 1, p);
        const d = lattice(ix + 1, iy + 1, p);
        out[y * size + x] += (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty) * amp;
      }
    }
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function periodicCellular(size: number, cells: number, seed: number): Float32Array {
  const out = new Float32Array(size * size);
  const pts: [number, number][] = [];
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const h = hash32(i * 7919 + j * 104729 + seed);
      pts.push([(i + (h & 0xffff) / 65536) / cells, (j + (h >>> 16) / 65536) / cells]);
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let d1 = 9;
      let d2 = 9;
      const ci = Math.floor(u * cells);
      const cj = Math.floor(v * cells);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = (ci + di + cells) % cells;
          const jj = (cj + dj + cells) % cells;
          const pt = pts[jj * cells + ii];
          let dx = Math.abs(pt[0] - u);
          let dy = Math.abs(pt[1] - v);
          if (dx > 0.5) dx = 1 - dx;
          if (dy > 0.5) dy = 1 - dy;
          const d = Math.sqrt(dx * dx + dy * dy) * cells;
          if (d < d1) {
            d2 = d1;
            d1 = d;
          } else if (d < d2) d2 = d;
        }
      }
      out[y * size + x] = Math.min(1, d2 - d1);
    }
  }
  return out;
}

let noiseTex: THREE.DataTexture | null = null;

/** RGBA tileable noise: R fbm, G fbm (offset), B cellular edges, A fine grain. */
export function getNoiseTexture(): THREE.DataTexture {
  if (noiseTex) return noiseTex;
  const size = 256;
  const r = periodicValueNoise(size, 8, 1, 5);
  const g = periodicValueNoise(size, 4, 2, 6);
  const b = periodicCellular(size, 10, 3);
  const a = periodicValueNoise(size, 32, 4, 3);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.round(r[i] * 255);
    data[i * 4 + 1] = Math.round(g[i] * 255);
    data[i * 4 + 2] = Math.round(b[i] * 255);
    data[i * 4 + 3] = Math.round(a[i] * 255);
  }
  noiseTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.magFilter = THREE.LinearFilter;
  noiseTex.minFilter = THREE.LinearMipmapLinearFilter;
  noiseTex.generateMipmaps = true;
  noiseTex.anisotropy = 4;
  noiseTex.needsUpdate = true;
  return noiseTex;
}

/** Radial glow sprite texture. */
export function makeGlowTexture(size = 128, falloff = 2.2): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1;
      const dy = (y + 0.5) / size * 2 - 1;
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      const v = Math.pow(1 - d, falloff);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(v * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Soft particle texture. */
let particleTex: THREE.CanvasTexture | null = null;
export function getParticleTexture(): THREE.CanvasTexture {
  if (!particleTex) particleTex = makeGlowTexture(64, 1.8);
  return particleTex;
}
