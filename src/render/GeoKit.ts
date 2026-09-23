import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG } from '../core/Random';

/**
 * Procedural modelling toolkit. All game models (flora, ships, stations,
 * creatures, structures) are assembled from these primitives with baked
 * vertex colours, giving the game a consistent stylised-faceted art direction.
 */
export type ColorLike = THREE.Color | [number, number, number] | number;

function toColor(c: ColorLike): THREE.Color {
  if (c instanceof THREE.Color) return c;
  if (typeof c === 'number') return new THREE.Color(c);
  return new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
}

export class GeoBuilder {
  private parts: THREE.BufferGeometry[] = [];

  /** Add a geometry with a solid colour (intensity > 1 produces glow via bloom). */
  add(geo: THREE.BufferGeometry, color: ColorLike, matrix?: THREE.Matrix4, intensity = 1): this {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g === geo) g = geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    for (const k of Object.keys(g.attributes)) {
      if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    const c = toColor(color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r * intensity;
      col[i * 3 + 1] = c.g * intensity;
      col[i * 3 + 2] = c.b * intensity;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts.push(g);
    geo !== g && geo.dispose();
    return this;
  }

  /** Add with per-vertex colour function. */
  addColored(geo: THREE.BufferGeometry, fn: (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color, matrix?: THREE.Matrix4): this {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    for (const k of Object.keys(g.attributes)) {
      if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const col = new Float32Array(pos.count * 3);
    const p = new THREE.Vector3();
    const nn = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      nn.fromBufferAttribute(nor, i);
      const c = fn(p, nn);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts.push(g);
    geo.dispose();
    return this;
  }

  get empty(): boolean {
    return this.parts.length === 0;
  }

  build(flat = true): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false) ?? new THREE.BufferGeometry();
    for (const p of this.parts) p.dispose();
    this.parts = [];
    if (flat) merged.computeVertexNormals();
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export function trs(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(sx, sy, sz));
}

/** Matrix that places a unit Y-aligned primitive between two points. */
export function between(a: THREE.Vector3, b: THREE.Vector3, thicknessX = 1, thicknessZ = thicknessX): THREE.Matrix4 {
  const dir = b.clone().sub(a);
  const len = dir.length();
  _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return _m.clone().compose(a.clone().add(b).multiplyScalar(0.5), _q.clone(), new THREE.Vector3(thicknessX, len, thicknessZ));
}

/** Randomly displace vertices of a geometry (keeps shared positions coherent). */
export function jitterGeometry(geo: THREE.BufferGeometry, rng: RNG, amount: number, scale = new THREE.Vector3(1, 1, 1)): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  const map = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let d = map.get(k);
    if (!d) {
      d = [rng.range(-amount, amount), rng.range(-amount, amount), rng.range(-amount, amount)];
      map.set(k, d);
    }
    pos.setXYZ(i, (x + d[0]) * scale.x, (y + d[1]) * scale.y, (z + d[2]) * scale.z);
  }
  pos.needsUpdate = true;
  return geo;
}

export function rockGeometry(rng: RNG, detail = 1, flatten = 0.7): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  jitterGeometry(g, rng, 0.28, new THREE.Vector3(rng.range(0.8, 1.3), flatten * rng.range(0.8, 1.2), rng.range(0.8, 1.3)));
  return g;
}

/** Cylinder with base at y=0, top at y=1 (for convenient scaling). */
export function column(radiusTop: number, radiusBottom: number, sides = 6, heightSegs = 1): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radiusTop, radiusBottom, 1, sides, heightSegs);
  g.translate(0, 0.5, 0);
  return g;
}

export function cone(radius: number, sides = 6): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(radius, 1, sides);
  g.translate(0, 0.5, 0);
  return g;
}

export function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

export function sphere(r: number, w = 8, h = 6): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, w, h);
}

export function ico(r: number, detail = 0): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(r, detail);
}

export function color(c: ColorLike): THREE.Color {
  return toColor(c).clone();
}
