import * as THREE from 'three';
import { mergeGeometries as mergeParts } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG, hashCombine } from '../core/Random';
import { GeoBuilder, rockGeometry, ico, trs } from '../render/GeoKit';
import { propMaterial } from '../render/Materials';
import type { AsteroidBeltDesc } from '../universe/types';
import { getItem } from '../gameplay/Items';
import { assets } from '../assets/AssetLibrary';

export interface Asteroid {
  id: string;
  pos: THREE.Vector3; // universe
  radius: number;
  health: number;
  item: string;
  amount: number;
  variant: number;
  index: number;
  depleted: boolean;
}

const CELL = 1600;
const VARIANTS = 3;
const CAPACITY = 1800;

/** Asteroid Bennu shape model (NASA, public domain) normalised to unit radius. */
function bennuGeometry(): THREE.BufferGeometry | null {
  const m = assets.instanceModel('nasa/bennu');
  if (!m) return null;
  const g = mergeParts(m.parts.map((p) => p.geometry));
  if (!g) return null;
  g.computeBoundingBox();
  const c = g.boundingBox!.getCenter(new THREE.Vector3());
  g.translate(-c.x, -c.y, -c.z);
  const s = 2 / Math.max(m.size.x, m.size.y, m.size.z);
  g.scale(s, s, s);
  return g;
}

/**
 * Streams asteroids around the player from deterministic cells. Belts are
 * density fields (a ring around the star, or a spherical cluster); only cells
 * near the camera are instantiated, into a fixed pool of instanced meshes.
 */
export class AsteroidField {
  readonly group = new THREE.Group();
  private belts: AsteroidBeltDesc[];
  private meshes: THREE.InstancedMesh[] = [];
  private mat: THREE.MeshStandardMaterial;
  private currentCell = new THREE.Vector3(Infinity, 0, 0);
  readonly asteroids: Asteroid[] = [];
  readonly depleted: Set<string>;
  private anchor = new THREE.Vector3();

  constructor(belts: AsteroidBeltDesc[], seed: number, depleted: Set<string>) {
    this.belts = belts;
    this.depleted = depleted;
    this.mat = propMaterial({ roughness: 0.9, metalness: 0.1 });
    const rng = new RNG(seed ^ 0xa57e);
    for (let v = 0; v < VARIANTS; v++) {
      const b = new GeoBuilder();
      const base = new THREE.Color().setHSL(rng.range(0.05, 0.1), rng.range(0.05, 0.2), rng.range(0.28, 0.4));
      b.addColored(v === 0 ? (bennuGeometry() ?? rockGeometry(rng, 2, 0.8)) : rockGeometry(rng, 2, rng.range(0.6, 0.9)), (p) => {
        const n = Math.sin(p.x * 7.1 + p.y * 3.3) * Math.sin(p.z * 5.7 - p.y * 2.1);
        return base.clone().multiplyScalar(0.85 + n * 0.2);
      });
      // mineral veins (tinted per instance)
      for (let i = 0; i < 6; i++) {
        const d = new THREE.Vector3(...rng.unitVector()).multiplyScalar(0.72);
        b.add(ico(rng.range(0.1, 0.2), 0), new THREE.Color(1, 1, 1), trs(d.x, d.y * 0.75, d.z), 1.6);
      }
      const mesh = new THREE.InstancedMesh(b.build(), this.mat, CAPACITY);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  /** Density of asteroids at a universe position (0..1). */
  density(p: THREE.Vector3): number {
    let best = 0;
    for (const b of this.belts) {
      const c = b.center;
      const dx = p.x - c[0], dy = p.y - c[1], dz = p.z - c[2];
      let d: number;
      if (b.radius > 0) {
        const rxz = Math.hypot(dx, dz);
        const radial = Math.abs(rxz - b.radius) / (b.width * 0.5);
        const vert = Math.abs(dy) / (b.thickness * 0.5);
        d = Math.max(0, 1 - Math.hypot(radial, vert));
      } else {
        const r = Math.hypot(dx, dy * 1.8, dz) / b.width;
        d = Math.max(0, 1 - r);
      }
      best = Math.max(best, d * b.density);
    }
    return best;
  }

  richItemAt(p: THREE.Vector3): string[] {
    let best: AsteroidBeltDesc | null = null;
    let bd = -1;
    for (const b of this.belts) {
      const c = new THREE.Vector3(...b.center);
      const d = -c.distanceTo(p);
      if (d > bd) {
        bd = d;
        best = b;
      }
    }
    return best?.rich ?? ['astrium'];
  }

  update(camU: THREE.Vector3): void {
    const cx = Math.floor(camU.x / CELL), cy = Math.floor(camU.y / CELL), cz = Math.floor(camU.z / CELL);
    if (cx === this.currentCell.x && cy === this.currentCell.y && cz === this.currentCell.z) return;
    this.currentCell.set(cx, cy, cz);
    this.rebuild(cx, cy, cz);
  }

  private rebuild(cx: number, cy: number, cz: number): void {
    this.asteroids.length = 0;
    const counts = new Array(VARIANTS).fill(0);
    this.anchor.set((cx + 0.5) * CELL, (cy + 0.5) * CELL, (cz + 0.5) * CELL);
    this.group.position.copy(this.anchor);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const col = new THREE.Color();
    const R = 3;
    for (let i = -R; i <= R; i++) {
      for (let j = -R; j <= R; j++) {
        for (let k = -R; k <= R; k++) {
          const gx = cx + i, gy = cy + j, gz = cz + k;
          p.set((gx + 0.5) * CELL, (gy + 0.5) * CELL, (gz + 0.5) * CELL);
          const dens = this.density(p);
          if (dens <= 0.01) continue;
          const rng = new RNG(hashCombine(gx, gy, gz, 0xa5));
          const n = Math.floor(dens * 14 * rng.range(0.6, 1.4));
          const rich = this.richItemAt(p);
          for (let a = 0; a < n; a++) {
            const pos = new THREE.Vector3((gx + rng.next()) * CELL, (gy + rng.next()) * CELL, (gz + rng.next()) * CELL);
            const big = rng.chance(0.12);
            const radius = big ? rng.range(40, 90) : rng.range(5, 28);
            const variant = rng.int(0, VARIANTS - 1);
            const itemRoll = rng.next();
            const item = itemRoll < 0.12 ? rich[2] ?? rich[0] : itemRoll < 0.55 ? rich[0] : rich[1] ?? rich[0];
            const rot = rng.unitVector();
            const ang = rng.range(0, Math.PI * 2);
            const id = `${gx},${gy},${gz}#${a}`;
            if (this.depleted.has(id)) continue;
            if (counts[variant] >= CAPACITY) continue;
            const idx = counts[variant]++;
            q.setFromAxisAngle(new THREE.Vector3(...rot), ang);
            s.set(radius, radius * rng.range(0.7, 1), radius);
            m.compose(pos.clone().sub(this.anchor), q, s);
            this.meshes[variant].setMatrixAt(idx, m);
            col.set(getItem(item).color).lerp(new THREE.Color(0.8, 0.8, 0.8), item === 'ferrox' ? 0.6 : 0.1);
            this.meshes[variant].setColorAt(idx, col);
            this.asteroids.push({ id, pos, radius, health: 1 + radius / 12, item, amount: Math.round(8 + radius * 0.8), variant, index: idx, depleted: false });
          }
        }
      }
    }
    for (let v = 0; v < VARIANTS; v++) {
      this.meshes[v].count = counts[v];
      this.meshes[v].instanceMatrix.needsUpdate = true;
      if (this.meshes[v].instanceColor) this.meshes[v].instanceColor!.needsUpdate = true;
    }
  }

  deplete(a: Asteroid): void {
    a.depleted = true;
    this.depleted.add(a.id);
    this.meshes[a.variant].setMatrixAt(a.index, new THREE.Matrix4().makeScale(0, 0, 0));
    this.meshes[a.variant].instanceMatrix.needsUpdate = true;
  }

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): { a: Asteroid; dist: number } | null {
    let best: Asteroid | null = null;
    let bt = maxDist;
    const oc = new THREE.Vector3();
    for (const a of this.asteroids) {
      if (a.depleted) continue;
      oc.copy(a.pos).sub(origin);
      const t = oc.dot(dir);
      if (t < 0 || t - a.radius > bt) continue;
      const d2 = oc.lengthSq() - t * t;
      const r = a.radius * 0.85;
      if (d2 > r * r) continue;
      const hit = t - Math.sqrt(r * r - d2);
      if (hit < bt) {
        bt = Math.max(0, hit);
        best = a;
      }
    }
    return best ? { a: best, dist: bt } : null;
  }

  /** Returns the nearest overlapping asteroid for collision response. */
  collide(p: THREE.Vector3, radius: number): Asteroid | null {
    for (const a of this.asteroids) {
      if (a.depleted) continue;
      const r = a.radius * 0.8 + radius;
      if (a.pos.distanceToSquared(p) < r * r) return a;
    }
    return null;
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.dispose();
    }
    this.mat.dispose();
    this.group.removeFromParent();
  }
}
