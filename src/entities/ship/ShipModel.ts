import * as THREE from 'three';
import { RNG } from '../../core/Random';
import { GeoBuilder, box, column, cone, trs, sphere, ico } from '../../render/GeoKit';
import { propMaterial } from '../../render/Materials';
import type { ShipClass } from './ShipDefs';

/**
 * Procedural starship model. Forward is -Z, up is +Y. Each class has a
 * distinct silhouette; the seed varies proportions, livery and greebles.
 */
export interface ShipModel {
  group: THREE.Group;
  engineGlow: THREE.Mesh[];
  gear: THREE.Group;
  muzzles: THREE.Vector3[];
  engineNozzles: THREE.Vector3[];
  length: number;
  gearHeight: number;
  radius: number;
}

let sharedMat: THREE.MeshStandardMaterial | null = null;
function shipMaterial(): THREE.MeshStandardMaterial {
  if (!sharedMat) sharedMat = propMaterial({ roughness: 0.38, metalness: 0.55 });
  return sharedMat;
}

export function buildShipModel(cls: ShipClass, seed: number): ShipModel {
  const rng = new RNG(seed);
  const hue = rng.next();
  const main = new THREE.Color().setHSL(hue, rng.range(0.1, 0.5), rng.range(0.45, 0.7));
  const second = new THREE.Color().setHSL((hue + rng.range(0.3, 0.6)) % 1, rng.range(0.4, 0.8), rng.range(0.35, 0.55));
  const dark = new THREE.Color(0.1, 0.11, 0.13);
  const glass = new THREE.Color(0.25, 0.55, 0.8);
  const engineCol = new THREE.Color().setHSL(rng.pick([0.55, 0.58, 0.08, 0.75]), 0.9, 0.6);
  const b = new GeoBuilder();
  const muzzles: THREE.Vector3[] = [];
  const nozzles: THREE.Vector3[] = [];
  let length = 16;
  let gearHeight = 1.8;

  const cockpit = (z: number, y: number, s: number) => {
    b.add(sphere(1.1 * s, 10, 6), glass, trs(0, y, z, 0, 0, 0, 1, 0.65, 1.7), 1.3);
  };

  switch (cls.style) {
    case 'fighter': {
      length = 15;
      const w = rng.range(5, 7);
      b.add(box(2.2, 1.4, 11), main, trs(0, 0, 0));
      b.add(cone(1.2, 6), main, trs(0, 0, -5.5, -Math.PI / 2, 0, 0, 1, 5, 0.9));
      cockpit(-3.5, 0.9, 1);
      for (const s of [-1, 1]) {
        b.add(box(w, 0.25, 4), second, trs(s * (w / 2 + 0.8), -0.1, 1.5, 0, s * 0.35, s * -0.08));
        b.add(box(0.4, 2.2, 3), main, trs(s * (w + 0.5), 0.6, 2.5, 0, 0, s * 0.3));
        b.add(column(0.18, 0.18, 6), dark, trs(s * (w * 0.6), -0.1, -1.5, -Math.PI / 2, 0, 0, 1, 4, 1));
        muzzles.push(new THREE.Vector3(s * (w * 0.6), -0.1, -5.6));
        nozzles.push(new THREE.Vector3(s * 0.8, 0, 5.8));
      }
      b.add(box(3, 1.2, 2.5), dark, trs(0, 0, 5));
      break;
    }
    case 'hauler': {
      length = 22;
      b.add(box(6, 4.5, 16), main, trs(0, 0.5, 1));
      b.add(box(4.5, 3, 5), second, trs(0, 1, -9));
      cockpit(-10.5, 1.6, 1.3);
      for (let i = 0; i < 3; i++) b.add(box(6.6, 0.6, 1.2), second, trs(0, 0.5, -3 + i * 4.5));
      for (const s of [-1, 1]) {
        b.add(box(1.4, 3.8, 14), dark, trs(s * 3.7, 0.3, 1));
        b.add(column(1.1, 1.3, 8), dark, trs(s * 2.2, -0.4, 9, Math.PI / 2, 0, 0, 1, 2.5, 1));
        nozzles.push(new THREE.Vector3(s * 2.2, -0.4, 11.6));
        muzzles.push(new THREE.Vector3(s * 2.6, -1.8, -10));
      }
      gearHeight = 2.4;
      break;
    }
    case 'explorer': {
      length = 18;
      b.add(column(1.3, 1.9, 8), main, trs(0, 0, 5, -Math.PI / 2, 0, 0, 1, 14, 1));
      b.add(cone(1.3, 8), main, trs(0, 0, -9, -Math.PI / 2, 0, 0, 1, 3, 1));
      cockpit(-6.5, 1.1, 1);
      b.add(box(12, 0.3, 3), second, trs(0, -0.4, 2, 0, 0, 0));
      for (const s of [-1, 1]) {
        b.add(column(0.9, 0.9, 8), dark, trs(s * 5.5, -0.3, 5, -Math.PI / 2, 0, 0, 1, 6, 1));
        b.add(box(0.2, 2.5, 3.5), second, trs(s * 5.5, 1.1, 4, 0, 0, 0));
        nozzles.push(new THREE.Vector3(s * 5.5, -0.3, 5.3));
        muzzles.push(new THREE.Vector3(s * 1.4, -0.6, -8));
      }
      // sensor dish
      b.add(sphere(1.2, 10, 5), dark, trs(0, 2.0, 1, 0, 0, 0, 1, 0.35, 1));
      b.add(column(0.1, 0.1, 4), dark, trs(0, 1.3, 1, 0, 0, 0, 1, 1.5, 1));
      break;
    }
    case 'exotic': {
      length = 16;
      b.add(ico(1.8, 1), main, trs(0, 0, 0, 0, 0, 0, 1, 0.7, 3.2), 1.05);
      cockpit(-2.2, 0.8, 0.9);
      for (const s of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          b.add(cone(0.5, 5), second, trs(s * (2 + k * 1.8), 0, 1 + k * 1.2, Math.PI / 2 - 0.2, s * (0.8 + k * 0.25), 0, 1, 5 - k, 0.4), 1.2);
        }
        nozzles.push(new THREE.Vector3(s * 0.6, 0, 5.6));
        muzzles.push(new THREE.Vector3(s * 1.2, -0.2, -5));
      }
      b.add(ico(0.6, 0), engineCol, trs(0, 0, 4.5), 3);
      break;
    }
    default: {
      // shuttle
      length = 16;
      const wing = rng.range(4, 5.5);
      b.add(box(3.2, 2.2, 10), main, trs(0, 0, 0.5));
      b.add(box(2.6, 1.6, 3), main, trs(0, -0.2, -6, 0.12, 0, 0));
      cockpit(-4.5, 1.1, 1);
      b.add(box(3.4, 0.5, 8), second, trs(0, 1.25, 1));
      for (const s of [-1, 1]) {
        b.add(box(wing, 0.35, 3.8), main, trs(s * (1.6 + wing / 2), -0.4, 2.2, 0, 0, s * -0.12));
        b.add(box(0.6, 0.6, 3.2), second, trs(s * (1.6 + wing - 0.2), -0.7, 2.2));
        b.add(column(0.75, 0.9, 8), dark, trs(s * 1.2, 0, 5.6, Math.PI / 2, 0, 0, 1, 1.5, 1));
        nozzles.push(new THREE.Vector3(s * 1.2, 0, 7.2));
        muzzles.push(new THREE.Vector3(s * (1.6 + wing - 0.2), -0.7, -0.5));
      }
      b.add(box(0.3, 2, 2.5), second, trs(0, 1.8, 4.5, -0.3, 0, 0));
    }
  }
  // greebles
  for (let i = 0; i < 8; i++) {
    b.add(box(rng.range(0.3, 0.9), rng.range(0.15, 0.4), rng.range(0.3, 1.2)), dark, trs(rng.range(-1.2, 1.2), rng.range(0.6, 1.3), rng.range(-3, 4)));
  }
  // navigation lights
  b.add(ico(0.12, 0), new THREE.Color(1, 0.15, 0.1), trs(-3.5, 0, 1.5), 5);
  b.add(ico(0.12, 0), new THREE.Color(0.2, 1, 0.3), trs(3.5, 0, 1.5), 5);

  const group = new THREE.Group();
  const hull = new THREE.Mesh(b.build(), shipMaterial());
  hull.castShadow = true;
  hull.receiveShadow = true;
  group.add(hull);

  const engineGlow: THREE.Mesh[] = [];
  const glowGeo = new THREE.SphereGeometry(0.7, 12, 8);
  for (const n of nozzles) {
    const m = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ color: engineCol.clone().multiplyScalar(4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.copy(n);
    m.scale.set(1, 1, 2.2);
    group.add(m);
    engineGlow.push(m);
  }

  const gear = new THREE.Group();
  const gb = new GeoBuilder();
  const legs = [[-1.4, -3], [1.4, -3], [-1.8, 3], [1.8, 3]];
  for (const [x, z] of legs) {
    gb.add(column(0.12, 0.15, 5), dark, trs(x, -gearHeight, z, 0, 0, 0, 1, gearHeight, 1));
    gb.add(box(0.8, 0.12, 0.8), dark, trs(x, -gearHeight, z));
  }
  const gearMesh = new THREE.Mesh(gb.build(), shipMaterial());
  gearMesh.castShadow = true;
  gear.add(gearMesh);
  group.add(gear);

  return { group, engineGlow, gear, muzzles, engineNozzles: nozzles, length, gearHeight, radius: length * 0.55 };
}
