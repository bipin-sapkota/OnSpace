import * as THREE from 'three';
import { RNG } from '../core/Random';
import { GeoBuilder, box, column, trs, sphere, ico } from '../render/GeoKit';
import { propMaterial } from '../render/Materials';
import type { StationDesc } from '../universe/types';

/**
 * Orbital trading station. Procedurally assembled: armoured core, rotating
 * habitat ring, solar arrays, antenna masts and a lit hangar the player can
 * dock in.
 */
export class Station {
  readonly desc: StationDesc;
  readonly root = new THREE.Group();
  readonly position: THREE.Vector3;
  private ring: THREE.Mesh;
  private beacons: THREE.Mesh;
  private mat: THREE.MeshStandardMaterial;
  /** Hangar entrance and landing pad in station-local space. */
  readonly bayEntrance = new THREE.Vector3(0, 0, 260);
  readonly bayPad = new THREE.Vector3(0, -18, 120);
  readonly collisionRadius = 190;

  constructor(desc: StationDesc) {
    this.desc = desc;
    this.position = new THREE.Vector3(...desc.position);
    this.root.position.copy(this.position);
    const rng = new RNG(desc.seed);
    this.mat = propMaterial({ roughness: 0.45, metalness: 0.6 });
    const hull = new THREE.Color().setHSL(rng.range(0, 1), 0.08, 0.55);
    const dark = new THREE.Color(0.12, 0.13, 0.15);
    const accent = new THREE.Color().setHSL(rng.pick([0.08, 0.55, 0.95, 0.33]), 0.8, 0.55);
    const light = new THREE.Color(1.0, 0.92, 0.75);

    const core = new GeoBuilder();
    // central spine
    core.add(column(55, 70, 10, 1), hull, trs(0, -160, 0, 0, 0, 0, 1, 320, 1));
    core.add(sphere(85, 16, 10), hull, trs(0, 0, 0, 0, 0, 0, 1, 0.8, 1));
    core.add(ico(40, 1), dark, trs(0, 170, 0));
    core.add(column(8, 8, 6), dark, trs(0, 160, 0, 0, 0, 0, 1, 180, 1));
    // armour plates
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      core.add(box(40, 120, 12), i % 2 ? hull : hull.clone().multiplyScalar(0.8), trs(Math.cos(a) * 72, -60, Math.sin(a) * 72, 0, -a + Math.PI / 2, 0));
    }
    // hangar block facing +Z
    core.add(box(170, 70, 12), hull, trs(0, -18 + 35 + 6, 170));
    core.add(box(170, 12, 190), hull, trs(0, -18 - 6, 170));
    core.add(box(12, 70, 190), hull, trs(-85, -18 + 29, 170));
    core.add(box(12, 70, 190), hull, trs(85, -18 + 29, 170));
    core.add(box(170, 70, 12), dark, trs(0, -18 + 29, 75));
    // hangar lights and landing guide
    for (let i = 0; i < 6; i++) {
      core.add(box(150, 1.5, 2), light, trs(0, 40, 90 + i * 30), 2.5);
      core.add(box(4, 1, 4), accent, trs(-60, -11.5, 90 + i * 30), 4);
      core.add(box(4, 1, 4), accent, trs(60, -11.5, 90 + i * 30), 4);
    }
    core.add(column(22, 22, 16), accent.clone().multiplyScalar(0.8), trs(0, -17.8, 120, 0, 0, 0, 1, 0.5, 1), 1.5);
    // entrance frame lights
    core.add(box(180, 3, 3), accent, trs(0, 55, 266), 4);
    core.add(box(180, 3, 3), accent, trs(0, -26, 266), 4);
    core.add(box(3, 80, 3), accent, trs(-90, 14, 266), 4);
    core.add(box(3, 80, 3), accent, trs(90, 14, 266), 4);
    // solar arrays
    for (const s of [-1, 1]) {
      core.add(column(4, 4, 6), dark, trs(s * 20, -250, 0, 0, 0, (s * Math.PI) / 2, 1, 220, 1));
      for (let k = 0; k < 3; k++) {
        core.add(box(60, 2, 140), new THREE.Color(0.1, 0.16, 0.35), trs(s * (100 + k * 70), -250, 0), 1);
      }
    }
    // antenna masts
    for (let i = 0; i < 4; i++) {
      const a = rng.range(0, Math.PI * 2);
      const len = rng.range(60, 140);
      core.add(column(1.5, 3, 5), dark, trs(Math.cos(a) * 40, 60, Math.sin(a) * 40, Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5, 1, len, 1));
    }
    const coreMesh = new THREE.Mesh(core.build(), this.mat);
    coreMesh.castShadow = true;
    coreMesh.receiveShadow = true;
    this.root.add(coreMesh);

    // rotating habitat ring
    const ringB = new GeoBuilder();
    const segs = 24;
    const rr = 360;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      ringB.add(box(96, 40, 50), i % 3 === 0 ? hull.clone().multiplyScalar(0.85) : hull, trs(Math.cos(a) * rr, 0, Math.sin(a) * rr, 0, -a + Math.PI / 2, 0));
      // window strip
      ringB.add(box(80, 4, 1), light, trs(Math.cos(a) * (rr - 25.5), 6, Math.sin(a) * (rr - 25.5), 0, -a + Math.PI / 2, 0), 2.2);
      ringB.add(box(80, 4, 1), light, trs(Math.cos(a) * (rr + 25.5), 6, Math.sin(a) * (rr + 25.5), 0, -a + Math.PI / 2, 0), 2.2);
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      ringB.add(column(6, 6, 6), dark, trs(0, 0, 0, 0, -a, Math.PI / 2, 1, rr, 1));
    }
    this.ring = new THREE.Mesh(ringB.build(), this.mat);
    this.ring.position.y = -120;
    this.ring.castShadow = true;
    this.root.add(this.ring);

    const bb = new GeoBuilder();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      bb.add(ico(3, 0), i % 2 ? new THREE.Color(1, 0.2, 0.15) : new THREE.Color(0.3, 1, 0.4), trs(Math.cos(a) * 100, -330, Math.sin(a) * 100), 6);
    }
    bb.add(ico(4, 0), new THREE.Color(1, 0.2, 0.15), trs(0, 260, 0), 6);
    this.beacons = new THREE.Mesh(bb.build(), this.mat);
    this.root.add(this.beacons);

    this.root.rotation.set(rng.range(-0.2, 0.2), rng.range(0, Math.PI * 2), rng.range(-0.2, 0.2));
    this.root.updateMatrixWorld();
  }

  update(time: number): void {
    this.ring.rotation.y = time * 0.05;
    this.beacons.visible = Math.floor(time * 1.2) % 2 === 0;
  }

  /** Universe-space position of a station-local point. */
  toUniverse(local: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(local).applyQuaternion(this.root.quaternion).add(this.position);
  }

  get quaternion(): THREE.Quaternion {
    return this.root.quaternion;
  }

  dispose(): void {
    this.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.mat.dispose();
    this.root.removeFromParent();
  }
}
