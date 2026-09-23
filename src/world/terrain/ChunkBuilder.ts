import { TerrainGen } from './TerrainGen';
import { RNG, hashCombine } from '../../core/Random';
import type { RGB } from '../../universe/types';

/**
 * Worker-safe chunk mesh + scatter builder for the cube-sphere quadtree.
 */
export const GRID = 32; // quads per chunk side
export const VERTS_SIDE = GRID + 1;
export const GRID_VERTS = VERTS_SIDE * VERTS_SIDE;
export const SKIRT_VERTS = GRID * 4;
export const TOTAL_VERTS = GRID_VERTS + SKIRT_VERTS;

// Scatter record layout
export const SC_STRIDE = 8;
export const ScatterType = {
  Tree: 0,
  Bush: 1,
  Grass: 2,
  Rock: 3,
  Boulder: 4,
  Crystal: 5,
  Node: 6,
  OxyPlant: 7,
} as const;
export type ScatterType = (typeof ScatterType)[keyof typeof ScatterType];
export const SCATTER_TYPE_COUNT = 8;

// cube faces: normal, right, up
export const FACES: [number, number, number][][] = [
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
];

/** Map face-local (u,v) in [-1,1] to a unit direction (spherified cube). */
export function faceToDir(face: number, u: number, v: number, out: number[]): void {
  const f = FACES[face];
  const x = f[0][0] + u * f[1][0] + v * f[2][0];
  const y = f[0][1] + u * f[1][1] + v * f[2][1];
  const z = f[0][2] + u * f[1][2] + v * f[2][2];
  const x2 = x * x, y2 = y * y, z2 = z * z;
  out[0] = x * Math.sqrt(1 - y2 / 2 - z2 / 2 + (y2 * z2) / 3);
  out[1] = y * Math.sqrt(1 - z2 / 2 - x2 / 2 + (z2 * x2) / 3);
  out[2] = z * Math.sqrt(1 - x2 / 2 - y2 / 2 + (x2 * y2) / 3);
}

/** Index buffer shared by every chunk (grid + skirts). */
export function buildSharedIndices(): Uint16Array {
  const idx: number[] = [];
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const a = j * VERTS_SIDE + i;
      const b = a + 1;
      const c = a + VERTS_SIDE;
      const d = c + 1;
      // alternate diagonal for more isotropic shading
      if ((i + j) % 2 === 0) {
        idx.push(a, b, d, a, d, c);
      } else {
        idx.push(a, b, c, b, d, c);
      }
    }
  }
  // skirts: walk perimeter in order, each perimeter vertex has a skirt twin
  const perim = perimeterIndices();
  for (let k = 0; k < perim.length; k++) {
    const k2 = (k + 1) % perim.length;
    const a = perim[k];
    const b = perim[k2];
    const sa = GRID_VERTS + k;
    const sb = GRID_VERTS + k2;
    // winding so skirt faces outward (not critical: rendered double-sided-ish by skirt material? no) keep both
    idx.push(a, sa, b, b, sa, sb);
    idx.push(a, b, sa, b, sb, sa);
  }
  return new Uint16Array(idx);
}

let _perim: number[] | null = null;
export function perimeterIndices(): number[] {
  if (_perim) return _perim;
  const p: number[] = [];
  for (let i = 0; i < GRID; i++) p.push(i); // bottom edge left->right
  for (let j = 0; j < GRID; j++) p.push(j * VERTS_SIDE + GRID); // right edge bottom->top
  for (let i = GRID; i > 0; i--) p.push(GRID * VERTS_SIDE + i); // top edge right->left
  for (let j = GRID; j > 0; j--) p.push(j * VERTS_SIDE); // left edge top->bottom
  _perim = p;
  return p;
}

export interface ChunkRequest {
  planet: string;
  face: number;
  level: number;
  ix: number;
  iy: number;
  scatter: boolean;
  scatterSeed: number;
}

export interface ChunkResult {
  center: [number, number, number];
  radius: number;
  minH: number;
  maxH: number;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  water: { positions: Float32Array; normals: Float32Array; depth: Float32Array } | null;
  scatter: Float32Array | null;
}

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

export function buildChunk(gen: TerrainGen, req: ChunkRequest): ChunkResult {
  const R = gen.p.radius;
  const size = 2 / (1 << req.level);
  const u0 = -1 + req.ix * size;
  const v0 = -1 + req.iy * size;
  const S = GRID + 3; // sample grid with 1-vertex border
  const cellWorld = (size * R * 0.8) / GRID; // approximate metres between vertices
  const minWl = Math.max(0.4, cellWorld * 1.6);

  const px = new Float64Array(S * S);
  const py = new Float64Array(S * S);
  const pz = new Float64Array(S * S);
  const hs = new Float64Array(S * S);
  const dir = [0, 0, 0];
  let minH = Infinity, maxH = -Infinity;
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const u = u0 + ((i - 1) / GRID) * size;
      const v = v0 + ((j - 1) / GRID) * size;
      faceToDir(req.face, u, v, dir);
      const h = gen.height(dir[0], dir[1], dir[2], minWl);
      const k = j * S + i;
      const r = R + h;
      px[k] = dir[0] * r;
      py[k] = dir[1] * r;
      pz[k] = dir[2] * r;
      hs[k] = h;
      if (i > 0 && j > 0 && i < S - 1 && j < S - 1) {
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
      }
    }
  }

  // chunk centre on the surface
  faceToDir(req.face, u0 + size / 2, v0 + size / 2, dir);
  const cdx = dir[0], cdy = dir[1], cdz = dir[2];
  const midH = (minH + maxH) / 2;
  const cx = cdx * (R + midH), cy = cdy * (R + midH), cz = cdz * (R + midH);

  const positions = new Float32Array(TOTAL_VERTS * 3);
  const normals = new Float32Array(TOTAL_VERTS * 3);
  const colors = new Float32Array(TOTAL_VERTS * 3);
  const col: RGB = [0, 0, 0];
  let radius = 0;
  const nrm = new Float64Array(GRID_VERTS * 3);

  for (let j = 0; j < VERTS_SIDE; j++) {
    for (let i = 0; i < VERTS_SIDE; i++) {
      const k = (j + 1) * S + (i + 1);
      const vi = j * VERTS_SIDE + i;
      const x = px[k], y = py[k], z = pz[k];
      // normal from central differences
      const ax = px[k + 1] - px[k - 1], ay = py[k + 1] - py[k - 1], az = pz[k + 1] - pz[k - 1];
      const bx = px[k + S] - px[k - S], by = py[k + S] - py[k - S], bz = pz[k + S] - pz[k - S];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const rl = Math.hypot(x, y, z);
      const ux = x / rl, uy = y / rl, uz = z / rl;
      if (nx * ux + ny * uy + nz * uz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const slope = 1 - (nx * ux + ny * uy + nz * uz);
      gen.color(ux, uy, uz, hs[k], slope, col);
      positions[vi * 3] = x - cx;
      positions[vi * 3 + 1] = y - cy;
      positions[vi * 3 + 2] = z - cz;
      normals[vi * 3] = nx;
      normals[vi * 3 + 1] = ny;
      normals[vi * 3 + 2] = nz;
      nrm[vi * 3] = nx; nrm[vi * 3 + 1] = ny; nrm[vi * 3 + 2] = nz;
      colors[vi * 3] = srgbToLinear(col[0]);
      colors[vi * 3 + 1] = srgbToLinear(col[1]);
      colors[vi * 3 + 2] = srgbToLinear(col[2]);
      const d = Math.hypot(x - cx, y - cy, z - cz);
      if (d > radius) radius = d;
    }
  }

  // skirts
  const skirtDepth = Math.max(2, Math.min(cellWorld * 1.5, (maxH - minH) * 0.35 + 3));
  const perim = perimeterIndices();
  for (let k = 0; k < perim.length; k++) {
    const src = perim[k];
    const dst = GRID_VERTS + k;
    const x = positions[src * 3] + cx, y = positions[src * 3 + 1] + cy, z = positions[src * 3 + 2] + cz;
    const rl = Math.hypot(x, y, z);
    const s = (rl - skirtDepth) / rl;
    positions[dst * 3] = x * s - cx;
    positions[dst * 3 + 1] = y * s - cy;
    positions[dst * 3 + 2] = z * s - cz;
    normals[dst * 3] = normals[src * 3];
    normals[dst * 3 + 1] = normals[src * 3 + 1];
    normals[dst * 3 + 2] = normals[src * 3 + 2];
    colors[dst * 3] = colors[src * 3];
    colors[dst * 3 + 1] = colors[src * 3 + 1];
    colors[dst * 3 + 2] = colors[src * 3 + 2];
  }

  // water surface if any vertex is below the sea
  let water: ChunkResult['water'] = null;
  if (gen.hasSea && minH < gen.seaHeight) {
    const wr = R + gen.seaHeight;
    const wp = new Float32Array(TOTAL_VERTS * 3);
    const wn = new Float32Array(TOTAL_VERTS * 3);
    const wd = new Float32Array(TOTAL_VERTS);
    for (let j = 0; j < VERTS_SIDE; j++) {
      for (let i = 0; i < VERTS_SIDE; i++) {
        const k = (j + 1) * S + (i + 1);
        const vi = j * VERTS_SIDE + i;
        const rl = R + hs[k];
        const ux = px[k] / rl, uy = py[k] / rl, uz = pz[k] / rl;
        wp[vi * 3] = ux * wr - cx;
        wp[vi * 3 + 1] = uy * wr - cy;
        wp[vi * 3 + 2] = uz * wr - cz;
        wn[vi * 3] = ux; wn[vi * 3 + 1] = uy; wn[vi * 3 + 2] = uz;
        wd[vi] = gen.seaHeight - hs[k];
      }
    }
    for (let k = 0; k < perim.length; k++) {
      const src = perim[k];
      const dst = GRID_VERTS + k;
      wp[dst * 3] = wp[src * 3];
      wp[dst * 3 + 1] = wp[src * 3 + 1];
      wp[dst * 3 + 2] = wp[src * 3 + 2];
      wn[dst * 3] = wn[src * 3]; wn[dst * 3 + 1] = wn[src * 3 + 1]; wn[dst * 3 + 2] = wn[src * 3 + 2];
      wd[dst] = wd[src];
    }
    water = { positions: wp, normals: wn, depth: wd };
  }

  const scatter = req.scatter ? buildScatter(gen, req, u0, v0, size, cx, cy, cz, nrm) : null;

  return { center: [cx, cy, cz], radius, minH, maxH, positions, normals, colors, water, scatter };
}

function buildScatter(
  gen: TerrainGen,
  req: ChunkRequest,
  u0: number,
  v0: number,
  size: number,
  cx: number,
  cy: number,
  cz: number,
  nrm: Float64Array,
): Float32Array {
  const p = gen.p;
  const R = p.radius;
  const rng = new RNG(hashCombine(req.scatterSeed, req.face, req.level, req.ix, req.iy));
  const areaSide = size * R * 0.8;
  const area = areaSide * areaSide;
  const out: number[] = [];
  const dir = [0, 0, 0];
  const H = p.heightScale;

  const sampleNormalUp = (fu: number, fv: number): number => {
    const i = Math.min(GRID, Math.max(0, Math.round(fu * GRID)));
    const j = Math.min(GRID, Math.max(0, Math.round(fv * GRID)));
    const vi = j * VERTS_SIDE + i;
    return vi;
  };

  const place = (type: number, count: number, opts: {
    maxSlope: number; minAlt?: number; maxAlt?: number; moist?: number; scale: [number, number]; extra?: () => number; sink?: number;
  }) => {
    for (let n = 0; n < count; n++) {
      const fu = rng.next();
      const fv = rng.next();
      const s = rng.range(opts.scale[0], opts.scale[1]);
      const yaw = rng.range(0, Math.PI * 2);
      const variant = rng.next();
      const extra = opts.extra ? opts.extra() : 0;
      const accept = rng.next();
      faceToDir(req.face, u0 + fu * size, v0 + fv * size, dir);
      const vi = sampleNormalUp(fu, fv);
      const up = nrm[vi * 3] * dir[0] + nrm[vi * 3 + 1] * dir[1] + nrm[vi * 3 + 2] * dir[2];
      const slope = 1 - up;
      if (slope > opts.maxSlope) continue;
      const h = gen.height(dir[0], dir[1], dir[2], 0.4);
      if (gen.hasSea && h < gen.seaHeight + 0.6) continue;
      const alt = (h - (gen.hasSea ? gen.seaHeight : 0)) / H;
      if (opts.minAlt !== undefined && alt < opts.minAlt) continue;
      if (opts.maxAlt !== undefined && alt > opts.maxAlt) continue;
      if (opts.moist !== undefined) {
        const m = gen.moisture(dir[0], dir[1], dir[2]);
        if (accept > m * opts.moist + 0.15) continue;
      }
      const r = R + h - (opts.sink ?? 0) * s;
      out.push(type, dir[0] * r - cx, dir[1] * r - cy, dir[2] * r - cz, s, yaw, variant, extra);
    }
  };

  const k = area / 10000; // hectares
  const flora = p.floraDensity;
  const snowCut = p.snowAmount > 0.8 ? 2 : 0.95 - p.snowAmount * 0.3;
  if (flora > 0) {
    place(ScatterType.Tree, Math.round(26 * flora * k), { maxSlope: 0.22, maxAlt: snowCut, moist: 1.2, scale: [0.7, 1.5] });
    place(ScatterType.Bush, Math.round(60 * flora * k), { maxSlope: 0.3, maxAlt: snowCut + 0.1, moist: 1.0, scale: [0.6, 1.4] });
    place(ScatterType.Grass, Math.round(260 * flora * k), { maxSlope: 0.28, maxAlt: snowCut, scale: [0.7, 1.3] });
    place(ScatterType.OxyPlant, Math.round(3.5 * Math.max(0.35, flora) * k), { maxSlope: 0.3, scale: [0.9, 1.2] });
  }
  place(ScatterType.Rock, Math.round(30 * p.rockDensity * k), { maxSlope: 0.6, scale: [0.4, 1.3], sink: 0.2 });
  place(ScatterType.Boulder, Math.round(3.5 * p.rockDensity * k), { maxSlope: 0.4, scale: [2.2, 5.5], sink: 0.35 });
  place(ScatterType.Crystal, Math.round(6 * p.crystalDensity * k + 1.2 * k), { maxSlope: 0.4, scale: [0.8, 1.6], sink: 0.1 });
  const weights = p.resourceNodes.map((r) => r.weight);
  const idxs = p.resourceNodes.map((_, i) => i);
  place(ScatterType.Node, Math.round(2.2 * k), {
    maxSlope: 0.35, scale: [1.0, 1.7], sink: 0.25,
    extra: () => rng.weighted(idxs, weights),
  });
  return new Float32Array(out);
}
