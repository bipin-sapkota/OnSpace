import * as THREE from 'three';
import { GeoBuilder, column, cone, sphere, box, trs, jitterGeometry } from '../../render/GeoKit';
import { RNG } from '../../core/Random';
import type { Species } from './Species';

/**
 * Assembles an animatable creature rig from species data. Geometry is built
 * once per species and shared by all individuals.
 */
export interface CreatureRig {
  root: THREE.Group;
  body: THREE.Object3D;
  head: THREE.Object3D;
  legs: THREE.Object3D[];
  legPhase: number[];
  tail: THREE.Object3D | null;
  wings: THREE.Object3D[];
  hipHeight: number;
}

interface SpeciesGeo {
  body: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  leg: THREE.BufferGeometry;
  tail: THREE.BufferGeometry | null;
  wing: THREE.BufferGeometry | null;
  hipHeight: number;
  legPositions: THREE.Vector3[];
  headPos: THREE.Vector3;
  tailPos: THREE.Vector3;
  wingPos: THREE.Vector3[];
}

const cache = new Map<string, SpeciesGeo>();

function buildGeo(sp: Species): SpeciesGeo {
  const key = `${sp.seed}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const rng = new RNG(sp.seed);
  const H = sp.size;
  const p = sp.primary;
  const s2 = sp.secondary;
  const legLen = sp.plan === 'flyer' ? H * 0.25 : sp.plan === 'serpent' ? 0.001 : H * 0.6 * sp.legLen * (sp.plan === 'biped' ? 1.4 : 1);
  const hip = sp.plan === 'serpent' ? H * 0.25 : legLen;
  const bodyL = H * sp.bodyLen * (sp.plan === 'biped' ? 0.6 : 1);
  const bodyR = H * 0.34;

  const body = new GeoBuilder();
  if (sp.plan === 'serpent') {
    for (let i = 0; i < 6; i++) {
      const r = bodyR * (1 - i * 0.1);
      body.add(sphere(r, 8, 6), i % 2 ? s2 : p, trs(0, 0, i * r * 1.4));
    }
  } else {
    body.add(jitterGeometry(sphere(1, 10, 7), rng, 0.05), p, trs(0, 0, 0, sp.plan === 'biped' ? -0.5 : 0, 0, 0, bodyR, bodyR * 0.9, bodyL * 0.55));
    // back plates / pattern
    const plates = rng.int(2, 5);
    for (let i = 0; i < plates; i++) {
      const z = -bodyL * 0.35 + (i / Math.max(1, plates - 1)) * bodyL * 0.7;
      body.add(cone(bodyR * 0.25, 4), s2, trs(0, bodyR * 0.8, z, -0.3, 0, 0, 1, bodyR * rng.range(0.3, 0.8), 0.6));
    }
    body.add(sphere(1, 8, 5), s2, trs(0, -bodyR * 0.35, 0, 0, 0, 0, bodyR * 0.75, bodyR * 0.5, bodyL * 0.45));
  }

  const head = new GeoBuilder();
  const hs = H * 0.26 * sp.headSize;
  head.add(jitterGeometry(sphere(1, 9, 6), rng, 0.06), p, trs(0, 0, 0, 0, 0, 0, hs, hs * 0.85, hs * 1.1));
  head.add(box(hs * 0.9, hs * 0.55, hs * 1.1), s2, trs(0, -hs * 0.2, -hs * 0.9));
  for (const sx of [-1, 1]) {
    head.add(sphere(hs * 0.2, 6, 4), sp.eye, trs(sx * hs * 0.55, hs * 0.25, -hs * 0.6), 2.2);
    if (sp.horns > 0) head.add(cone(hs * 0.18, 5), s2.clone().multiplyScalar(1.1), trs(sx * hs * 0.45, hs * 0.7, -hs * 0.1, -0.5, 0, sx * -0.4, 1, hs * 1.4 * sp.horns, 1));
  }
  if (sp.neck > 0.2 && sp.plan !== 'serpent') {
    head.add(column(hs * 0.35, hs * 0.5, 6), p, trs(0, -hs * 0.2, hs * 0.5, 1.0, 0, 0, 1, hs * 1.6 * sp.neck, 1));
  }

  const leg = new GeoBuilder();
  const lr = Math.max(0.03, H * 0.07);
  leg.add(column(lr * 0.7, lr, 5), p.clone().multiplyScalar(0.85), trs(0, -legLen, 0, 0, 0, 0, 1, legLen, 1));
  leg.add(sphere(lr * 1.3, 6, 4), s2, trs(0, -legLen, -lr * 0.5, 0, 0, 0, 1, 0.6, 1.4));

  let tail: THREE.BufferGeometry | null = null;
  if (sp.tail > 0.15 && sp.plan !== 'serpent') {
    tail = new GeoBuilder().add(cone(bodyR * 0.35, 5), p, trs(0, 0, 0, Math.PI / 2 + 0.3, 0, 0, 1, H * sp.tail, 1)).build();
  }
  let wing: THREE.BufferGeometry | null = null;
  if (sp.plan === 'flyer') {
    const wb = new GeoBuilder();
    wb.add(box(H * 1.6, H * 0.04, H * 0.7), s2, trs(H * 0.8, 0, 0));
    wb.add(box(H * 0.9, H * 0.05, H * 0.4), p, trs(H * 0.45, 0.01, -H * 0.1));
    wing = wb.build();
  }

  const legPositions: THREE.Vector3[] = [];
  const nLegs = sp.plan === 'biped' || sp.plan === 'hopper' ? 2 : sp.plan === 'hexapod' ? 6 : sp.plan === 'serpent' ? 0 : sp.plan === 'flyer' ? 2 : 4;
  const pairs = nLegs / 2;
  for (let i = 0; i < pairs; i++) {
    const z = pairs === 1 ? (sp.plan === 'hopper' ? bodyL * 0.2 : 0) : -bodyL * 0.35 + (i / (pairs - 1)) * bodyL * 0.7;
    legPositions.push(new THREE.Vector3(-bodyR * 0.7, 0, z), new THREE.Vector3(bodyR * 0.7, 0, z));
  }
  const g: SpeciesGeo = {
    body: body.build(),
    head: head.build(),
    leg: leg.build(),
    tail,
    wing,
    hipHeight: hip,
    legPositions,
    headPos: sp.plan === 'serpent' ? new THREE.Vector3(0, bodyR * 0.3, -bodyR * 1.2) : new THREE.Vector3(0, bodyR * (sp.plan === 'biped' ? 1.3 : 0.5) + sp.neck * hs, -bodyL * 0.55 - hs * 0.5),
    tailPos: new THREE.Vector3(0, bodyR * 0.2, bodyL * 0.5),
    wingPos: sp.plan === 'flyer' ? [new THREE.Vector3(bodyR * 0.5, bodyR * 0.3, 0), new THREE.Vector3(-bodyR * 0.5, bodyR * 0.3, 0)] : [],
  };
  cache.set(key, g);
  return g;
}

export function buildCreature(sp: Species, material: THREE.Material): CreatureRig {
  const g = buildGeo(sp);
  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  bodyPivot.position.y = g.hipHeight;
  root.add(bodyPivot);
  const body = new THREE.Mesh(g.body, material);
  body.castShadow = true;
  bodyPivot.add(body);
  const head = new THREE.Group();
  head.position.copy(g.headPos);
  const headMesh = new THREE.Mesh(g.head, material);
  headMesh.castShadow = true;
  head.add(headMesh);
  bodyPivot.add(head);
  const legs: THREE.Object3D[] = [];
  const legPhase: number[] = [];
  g.legPositions.forEach((lp, i) => {
    const pivot = new THREE.Group();
    pivot.position.copy(lp);
    const m = new THREE.Mesh(g.leg, material);
    m.castShadow = true;
    pivot.add(m);
    bodyPivot.add(pivot);
    legs.push(pivot);
    const pair = Math.floor(i / 2);
    legPhase.push((i % 2) * Math.PI + pair * Math.PI * 0.5);
  });
  let tail: THREE.Object3D | null = null;
  if (g.tail) {
    tail = new THREE.Group();
    tail.position.copy(g.tailPos);
    tail.add(new THREE.Mesh(g.tail, material));
    bodyPivot.add(tail);
  }
  const wings: THREE.Object3D[] = [];
  if (g.wing) {
    g.wingPos.forEach((wp, i) => {
      const w = new THREE.Group();
      w.position.copy(wp);
      const m = new THREE.Mesh(g.wing!, material);
      if (i === 1) m.scale.x = -1;
      w.add(m);
      bodyPivot.add(w);
      wings.push(w);
    });
  }
  return { root, body: bodyPivot, head, legs, legPhase, tail, wings, hipHeight: g.hipHeight };
}
