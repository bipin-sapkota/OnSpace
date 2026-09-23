import * as THREE from 'three';
import { RNG } from '../core/Random';
import { GeoBuilder, column, cone, ico, rockGeometry, trs, jitterGeometry, between } from '../render/GeoKit';
import type { TerrainParams, RGB } from '../universe/types';
import { ScatterType, SCATTER_TYPE_COUNT } from './terrain/ChunkBuilder';
import { getItem } from '../gameplay/Items';

/**
 * Builds the per-planet library of flora, rock and crystal meshes. Geometry is
 * generated from the planet seed and its flora style so each world has its own
 * recognisable plant life while sharing one visual language.
 */
export const VARIANTS = 2;

export interface ScatterTypeInfo {
  harvest: { item: string; min: number; max: number } | null;
  health: number;
  collide: number; // collision radius factor (x scale), 0 = none
  hitRadius: number; // targeting radius factor
  height: number; // approx height factor for targeting centre
  sway: number;
  maxDist: number; // render distance for the chunk group
}

const lin = (c: RGB) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);

export class FloraLibrary {
  readonly geometries: THREE.BufferGeometry[][] = [];
  readonly info: ScatterTypeInfo[] = [];

  constructor(params: TerrainParams, archetype: string) {
    const rng = new RNG(params.seed ^ 0xf10a);
    const fc = params.floraColors;
    const style = params.floraStyle;
    const bark = lin(params.palette.cliff).multiplyScalar(0.8);
    const rockCol = lin(params.palette.cliff).lerp(lin(params.palette.mid), 0.35);
    const crystalItem = archetype === 'volcanic' ? 'pyrocite' : archetype === 'frozen' ? 'cryolite' : archetype === 'toxic' ? 'toxalite' : 'hydrex';
    const crystalCol = new THREE.Color(getItem(crystalItem).color);

    for (let t = 0; t < SCATTER_TYPE_COUNT; t++) this.geometries.push([]);
    for (let v = 0; v < VARIANTS; v++) {
      const vr = new RNG(rng.fork());
      const leaf = lin(fc[(v * 2) % 4]);
      const leaf2 = lin(fc[(v * 2 + 1) % 4]);
      const accent = lin(fc[4]);
      this.geometries[ScatterType.Tree].push(this.tree(vr, style, bark, leaf, leaf2, accent));
      this.geometries[ScatterType.Bush].push(this.bush(vr, style, leaf2, leaf, accent));
      this.geometries[ScatterType.Grass].push(this.grass(vr, style, leaf, leaf2, accent));
      this.geometries[ScatterType.Rock].push(new GeoBuilder().add(rockGeometry(vr, 0, 0.65), rockCol).build());
      this.geometries[ScatterType.Boulder].push(this.boulder(vr, rockCol));
      this.geometries[ScatterType.Crystal].push(this.crystal(vr, crystalCol));
      this.geometries[ScatterType.Node].push(this.node(vr));
      this.geometries[ScatterType.OxyPlant].push(this.oxyPlant(vr, leaf));
    }

    const inf = (o: Partial<ScatterTypeInfo>): ScatterTypeInfo => ({ harvest: null, health: 1, collide: 0, hitRadius: 1, height: 1, sway: 0, maxDist: 1e9, ...o });
    this.info[ScatterType.Tree] = inf({ harvest: { item: 'biomass', min: 14, max: 26 }, health: 1.4, collide: 0.45, hitRadius: 1.4, height: 3, sway: 0.06, maxDist: 2200 });
    this.info[ScatterType.Bush] = inf({ harvest: { item: 'biomass', min: 4, max: 9 }, health: 0.5, hitRadius: 1.0, height: 0.6, sway: 0.1, maxDist: 700 });
    this.info[ScatterType.Grass] = inf({ sway: 0.25, maxDist: 190 });
    this.info[ScatterType.Rock] = inf({ harvest: { item: 'ferrox', min: 6, max: 12 }, health: 0.8, hitRadius: 1.0, height: 0.3, maxDist: 600 });
    this.info[ScatterType.Boulder] = inf({ harvest: { item: 'ferrox', min: 30, max: 55 }, health: 3.2, collide: 0.9, hitRadius: 1.1, height: 0.6, maxDist: 2500 });
    this.info[ScatterType.Crystal] = inf({ harvest: { item: crystalItem, min: 12, max: 22 }, health: 1.1, hitRadius: 0.9, height: 1.0, maxDist: 1200 });
    this.info[ScatterType.Node] = inf({ harvest: { item: 'ferrox', min: 35, max: 65 }, health: 3.0, collide: 0.8, hitRadius: 1.4, height: 0.8, maxDist: 2500 });
    this.info[ScatterType.OxyPlant] = inf({ harvest: { item: 'aerolite', min: 14, max: 24 }, health: 0.7, hitRadius: 0.9, height: 0.8, sway: 0.05, maxDist: 900 });
  }

  private tree(rng: RNG, style: number, bark: THREE.Color, leaf: THREE.Color, leaf2: THREE.Color, accent: THREE.Color): THREE.BufferGeometry {
    const b = new GeoBuilder();
    const h = rng.range(5, 9);
    switch (style) {
      case 1: { // conifer / spire
        b.add(column(0.18, 0.32, 5), bark, trs(0, 0, 0, 0, 0, 0, 1, h * 0.5, 1));
        const tiers = rng.int(3, 5);
        for (let i = 0; i < tiers; i++) {
          const t = i / tiers;
          const r = (1 - t) * rng.range(1.6, 2.2) + 0.4;
          b.add(jitterGeometry(cone(1, 7), rng, 0.08), i % 2 ? leaf : leaf2, trs(0, h * 0.25 + t * h * 0.62, 0, 0, rng.range(0, 3), 0, r, h * 0.35, r));
        }
        break;
      }
      case 2: { // cactus / succulent column
        const c = leaf.clone().lerp(leaf2, 0.4);
        b.add(column(0.45, 0.55, 8), c, trs(0, 0, 0, 0, 0, 0, 1, h * 0.55, 1));
        b.add(ico(0.5, 1), c, trs(0, h * 0.55, 0, 0, 0, 0, 1, 0.6, 1));
        const arms = rng.int(1, 3);
        for (let i = 0; i < arms; i++) {
          const a = rng.range(0, Math.PI * 2);
          const y = rng.range(h * 0.2, h * 0.4);
          const out = new THREE.Vector3(Math.cos(a) * 1.1, y + 0.2, Math.sin(a) * 1.1);
          b.add(column(0.28, 0.3, 6), c, between(new THREE.Vector3(0, y, 0), out, 1, 1));
          b.add(column(0.28, 0.3, 6), c, trs(out.x, out.y, out.z, 0, 0, 0, 1, rng.range(1.2, 2.2), 1));
          b.add(ico(0.35, 0), accent, trs(out.x, out.y + 2.0, out.z), 1.4);
        }
        break;
      }
      case 3: { // giant fungus
        const stem = leaf2.clone().lerp(new THREE.Color(0.9, 0.85, 0.75), 0.5);
        b.add(column(0.35, 0.6, 7), stem, trs(0, 0, 0, rng.range(-0.1, 0.1), 0, rng.range(-0.1, 0.1), 1, h * 0.7, 1));
        const capR = rng.range(2.2, 3.4);
        const cap = new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
        b.add(jitterGeometry(cap, rng, 0.05), leaf, trs(0, h * 0.68, 0, 0, 0, 0, capR, capR * 0.45, capR));
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2 + rng.range(0, 0.4);
          const rr = capR * rng.range(0.4, 0.8);
          b.add(ico(0.18, 0), accent, trs(Math.cos(a) * rr, h * 0.68 + capR * 0.35, Math.sin(a) * rr), 2.2);
        }
        break;
      }
      case 4: { // crystal tree
        const n = rng.int(3, 6);
        for (let i = 0; i < n; i++) {
          const a = rng.range(0, Math.PI * 2);
          const tilt = rng.range(0.05, 0.4);
          const len = h * rng.range(0.4, 0.9);
          const g = column(0.0, 0.35, 5);
          b.add(g, i % 2 ? leaf : accent, trs(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3, Math.cos(a) * tilt, 0, Math.sin(a) * tilt, 1, len, 1), 1.25);
        }
        break;
      }
      case 5: { // coral / tendril tree
        const segs = rng.int(4, 6);
        const branches = rng.int(2, 4);
        for (let br = 0; br < branches; br++) {
          let p = new THREE.Vector3(0, 0, 0);
          const a = rng.range(0, Math.PI * 2);
          for (let s = 0; s < segs; s++) {
            const t = s / segs;
            const q = p.clone().add(new THREE.Vector3(Math.cos(a) * 0.5 * t + rng.range(-0.3, 0.3), h / segs, Math.sin(a) * 0.5 * t + rng.range(-0.3, 0.3)));
            b.add(column(0.18 * (1 - t) + 0.08, 0.2 * (1 - t) + 0.1, 5), s % 2 ? leaf : leaf2, between(p, q, 1, 1));
            p = q;
          }
          b.add(ico(0.55, 1), accent, trs(p.x, p.y, p.z), 1.6);
        }
        break;
      }
      default: { // broadleaf
        b.add(column(0.2, 0.38, 6), bark, trs(0, 0, 0, 0, 0, 0, 1, h * 0.62, 1));
        const lobes = rng.int(3, 5);
        for (let i = 0; i < lobes; i++) {
          const a = rng.range(0, Math.PI * 2);
          const r = rng.range(0.4, 1.3);
          const s = rng.range(1.4, 2.3);
          b.add(jitterGeometry(ico(1, 1), rng, 0.15), i % 2 ? leaf : leaf2, trs(Math.cos(a) * r, h * 0.62 + rng.range(-0.4, 1.2), Math.sin(a) * r, 0, 0, 0, s, s * 0.8, s));
        }
        // branches
        for (let i = 0; i < 2; i++) {
          const a = rng.range(0, Math.PI * 2);
          b.add(column(0.07, 0.12, 4), bark, between(new THREE.Vector3(0, h * 0.35, 0), new THREE.Vector3(Math.cos(a) * 1.2, h * 0.58, Math.sin(a) * 1.2), 1, 1));
        }
      }
    }
    return b.build();
  }

  private bush(rng: RNG, style: number, leaf: THREE.Color, leaf2: THREE.Color, accent: THREE.Color): THREE.BufferGeometry {
    const b = new GeoBuilder();
    if (style === 4) {
      for (let i = 0; i < 4; i++) {
        const a = rng.range(0, Math.PI * 2);
        b.add(column(0, 0.15, 5), i % 2 ? leaf : accent, trs(Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2, Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4, 1, rng.range(0.6, 1.3), 1), 1.3);
      }
    } else if (style === 3) {
      for (let i = 0; i < 3; i++) {
        const a = rng.range(0, Math.PI * 2);
        const x = Math.cos(a) * 0.4, z = Math.sin(a) * 0.4;
        const hh = rng.range(0.4, 0.9);
        b.add(column(0.07, 0.1, 5), leaf2, trs(x, 0, z, 0, 0, 0, 1, hh, 1));
        b.add(new THREE.SphereGeometry(0.35, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), i === 0 ? accent : leaf, trs(x, hh, z, 0, 0, 0, 1, 0.6, 1), i === 0 ? 1.8 : 1);
      }
    } else {
      const n = rng.int(3, 5);
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, Math.PI * 2);
        const r = rng.range(0.1, 0.5);
        const s = rng.range(0.45, 0.8);
        b.add(jitterGeometry(ico(1, 0), rng, 0.12), i % 2 ? leaf : leaf2, trs(Math.cos(a) * r, s * 0.6, Math.sin(a) * r, 0, 0, 0, s, s * 0.85, s));
      }
      if (rng.chance(0.6)) {
        for (let i = 0; i < 3; i++) {
          const a = rng.range(0, Math.PI * 2);
          b.add(ico(0.1, 0), accent, trs(Math.cos(a) * 0.5, 0.9, Math.sin(a) * 0.5), 1.5);
        }
      }
    }
    return b.build();
  }

  private grass(rng: RNG, style: number, leaf: THREE.Color, leaf2: THREE.Color, accent: THREE.Color): THREE.BufferGeometry {
    const b = new GeoBuilder();
    const blades = style === 2 ? 3 : 7;
    for (let i = 0; i < blades; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(0, 0.35);
      const h = rng.range(0.35, 0.8) * (style === 2 ? 0.6 : 1);
      const g = new THREE.BufferGeometry();
      const w = 0.07;
      g.setAttribute('position', new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, 0, h, 0, w, 0, 0, -w, 0, 0, 0, h, 0], 3));
      const c = (i % 3 === 0 ? leaf2 : leaf).clone().multiplyScalar(rng.range(0.85, 1.15));
      b.add(g, c, trs(Math.cos(a) * r, 0, Math.sin(a) * r, rng.range(-0.3, 0.3), a, rng.range(-0.3, 0.3)));
    }
    if (rng.chance(0.25) && style !== 2) b.add(ico(0.06, 0), accent, trs(0, 0.55, 0), 1.6);
    const g = b.build();
    // grass lit like the ground beneath it: normals point up
    const n = g.attributes.normal;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
    return g;
  }

  private boulder(rng: RNG, c: THREE.Color): THREE.BufferGeometry {
    const b = new GeoBuilder();
    b.add(rockGeometry(rng, 1, 0.75), c);
    if (rng.chance(0.6)) b.add(rockGeometry(rng, 0, 0.7), c.clone().multiplyScalar(0.9), trs(rng.range(-0.8, 0.8), 0.1, rng.range(-0.8, 0.8), 0, 0, 0, 0.5));
    return b.build();
  }

  private crystal(rng: RNG, c: THREE.Color): THREE.BufferGeometry {
    const b = new GeoBuilder();
    const n = rng.int(4, 7);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const tilt = i === 0 ? 0 : rng.range(0.2, 0.7);
      const len = i === 0 ? rng.range(1.3, 1.8) : rng.range(0.5, 1.2);
      const g = new GeoBuilder()
        .add(column(0.22, 0.22, 6), c, trs(0, 0, 0, 0, 0, 0, 1, len * 0.8, 1))
        .add(cone(0.22, 6), c.clone().multiplyScalar(1.3), trs(0, len * 0.8, 0, 0, 0, 0, 1, len * 0.3, 1))
        .build(false);
      b.add(g, c, trs(Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15, Math.cos(a) * tilt, 0, Math.sin(a) * tilt), 1.6);
    }
    b.add(rockGeometry(rng, 0, 0.5), new THREE.Color(0.25, 0.25, 0.28), trs(0, 0, 0, 0, 0, 0, 0.6));
    return b.build();
  }

  private node(rng: RNG): THREE.BufferGeometry {
    const b = new GeoBuilder();
    b.add(rockGeometry(rng, 1, 0.8), new THREE.Color(0.42, 0.42, 0.45), trs(0, 0.2, 0));
    const n = rng.int(5, 8);
    for (let i = 0; i < n; i++) {
      const dir = new THREE.Vector3(rng.range(-1, 1), rng.range(0.3, 1), rng.range(-1, 1)).normalize();
      const p = dir.clone().multiplyScalar(0.75);
      b.add(ico(rng.range(0.18, 0.35), 0), new THREE.Color(1, 1, 1), trs(p.x, p.y + 0.2, p.z, rng.range(0, 3), rng.range(0, 3), 0), 1.7);
    }
    return b.build();
  }

  private oxyPlant(rng: RNG, leaf: THREE.Color): THREE.BufferGeometry {
    const b = new GeoBuilder();
    const red = new THREE.Color(0.95, 0.22, 0.18);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      b.add(cone(0.16, 4), leaf, trs(Math.cos(a) * 0.25, 0, Math.sin(a) * 0.25, Math.cos(a) * 0.7, 0, Math.sin(a) * 0.7, 1, 0.9, 0.4));
    }
    b.add(column(0.06, 0.08, 5), leaf, trs(0, 0, 0, 0, 0, 0, 1, 0.7, 1));
    b.add(jitterGeometry(ico(0.35, 1), rng, 0.04), red, trs(0, 0.85, 0, 0, 0, 0, 1, 1.2, 1), 1.5);
    return b.build();
  }

  dispose(): void {
    for (const arr of this.geometries) for (const g of arr) g.dispose();
  }
}
