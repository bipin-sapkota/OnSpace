import * as THREE from 'three';
import { assets } from '../../assets/AssetLibrary';
import { patchPlanetMaterial, type PlanetLightUniforms } from '../../render/PlanetLighting';
import type { Species } from './Species';
import type { CreatureRig } from './CreatureBuilder';

/**
 * Skinned, animated creature bodies built from the CC0 Quaternius animal and
 * monster packs. Each species gets its own palette-tinted materials, and each
 * individual its own skeleton + AnimationMixer.
 */
export type Anim = 'idle' | 'graze' | 'walk' | 'run' | 'attack' | 'death';

export interface AnimatedBody {
  mixer: THREE.AnimationMixer;
  actions: Partial<Record<Anim, THREE.AnimationAction>>;
  current: Anim | null;
  /** Locomotion speed (m/s) at which the walk / run clips look right at timeScale 1. */
  walkRef: number;
  runRef: number;
}

const PATTERNS: Record<Anim, RegExp[]> = {
  idle: [/^Idle$/, /^Flying_Idle$/, /_Idle$/, /^Idle/],
  graze: [/^Eating$/, /Idle_Headlow/i, /^Idle_2$/, /^Sit$/, /^Idle$/, /Flying_Idle/, /_Idle$/],
  walk: [/^Walk$/, /_Walk$/, /^Flying_Idle$/],
  run: [/^Gallop$/, /^Run$/, /_Run$/, /^Fast_Flying$/, /^Jump$/, /^Walk$/, /_Walk$/],
  attack: [/^Attack_Headbutt$/, /^Attack$/, /^Bite_Front$/, /_Attack$/, /^Headbutt$/, /^Punch$/, /^Attack/],
  death: [/^Death$/, /_Death$/],
};

/** Materials that keep their authored colour (eyes, teeth, hooves...). */
const KEEP = /eye|teeth|tongue|hoo[fv]|black|white|gold|strap|mouth|beak|udder/i;
const SECONDARY = /secondary|light|dark|spot|muzzle|horn|wings|hair|\.00[1-9]/i;

const speciesMaterials = new Map<string, Map<THREE.Material, THREE.Material>>();

function tintMaterial(src: THREE.Material, sp: Species, lu: PlanetLightUniforms): THREE.Material {
  const m = (src as THREE.MeshStandardMaterial).clone();
  const name = src.name ?? '';
  if (!KEEP.test(name)) {
    const target = SECONDARY.test(name) ? sp.secondary : sp.primary;
    const hsl = { h: 0, s: 0, l: 0 };
    m.color.getHSL(hsl);
    const t = { h: 0, s: 0, l: 0 };
    target.getHSL(t);
    // take the species hue & saturation, keep the model's authored value so shading detail survives
    const amount = m.map ? 0.55 : 0.7;
    const tinted = new THREE.Color().setHSL(t.h, THREE.MathUtils.lerp(hsl.s, t.s, amount), THREE.MathUtils.lerp(hsl.l, t.l, amount * 0.5));
    if (m.map) {
      // textured: colour multiplies the texture, so keep it bright
      tinted.setHSL(t.h, t.s * 0.6, 0.75);
      m.color.lerp(tinted, amount);
    } else m.color.copy(tinted);
  }
  m.roughness = Math.max(0.6, m.roughness);
  m.metalness = Math.min(0.1, m.metalness);
  patchPlanetMaterial(m, lu, { key: 'creature-model' });
  return m;
}

function findClip(clips: THREE.AnimationClip[], anim: Anim): THREE.AnimationClip | null {
  for (const re of PATTERNS[anim]) {
    const c = clips.find((cl) => re.test(cl.name));
    if (c) return c;
  }
  return null;
}

/** Build an animated rig, or null when the model is unavailable. */
export function buildModelCreature(sp: Species, lu: PlanetLightUniforms): { rig: CreatureRig; anim: AnimatedBody } | null {
  if (!sp.model) return null;
  const a = assets.skinned(sp.model);
  if (!a) return null;
  let mats = speciesMaterials.get(`${sp.seed}`);
  if (!mats) {
    mats = new Map();
    speciesMaterials.set(`${sp.seed}`, mats);
  }
  a.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material as THREE.Material;
    let m = mats!.get(src);
    if (!m) {
      m = tintMaterial(src, sp, lu);
      mats!.set(src, m);
    }
    mesh.material = m;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // skinned bounds do not follow the animation; never cull a visible animal
    mesh.frustumCulled = false;
  });
  const flyer = sp.plan === 'flyer';
  const targetH = sp.size * (flyer ? 1.3 : sp.plan === 'biped' ? 1.6 : 1.35);
  const s = targetH / a.height;
  const body = new THREE.Group();
  a.scene.scale.setScalar(s);
  // Quaternius models face +Z; the creature rig faces -Z
  a.scene.rotation.y = Math.PI;
  body.add(a.scene);
  const root = new THREE.Group();
  root.add(body);
  const head = new THREE.Group();
  body.add(head);

  const mixer = new THREE.AnimationMixer(a.scene);
  const actions: AnimatedBody['actions'] = {};
  for (const k of Object.keys(PATTERNS) as Anim[]) {
    const clip = findClip(a.clips, k);
    if (!clip) continue;
    const act = mixer.clipAction(clip);
    if (k === 'attack' || k === 'death') {
      act.setLoop(THREE.LoopOnce, 1);
      act.clampWhenFinished = true;
    }
    actions[k] = act;
  }
  const rig: CreatureRig = { root, body, head, legs: [], legPhase: [], tail: null, wings: [], hipHeight: 0 };
  // stride length grows with body size
  const walkRef = 1.1 * Math.sqrt(Math.max(0.2, sp.size));
  return { rig, anim: { mixer, actions, current: null, walkRef, runRef: walkRef * 3.2 } };
}

/** Cross-fade to an animation. One-shot clips restart each call. */
export function playAnim(b: AnimatedBody, anim: Anim, fade = 0.25): void {
  const next = b.actions[anim] ?? (anim === 'graze' ? b.actions.idle : anim === 'run' ? b.actions.walk : null);
  if (!next) return;
  const cur = b.current ? b.actions[b.current] : null;
  if (b.current === anim && anim !== 'attack') return;
  next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(fade).play();
  if (cur && cur !== next) cur.fadeOut(fade);
  b.current = anim;
}

export function disposeSpeciesMaterials(): void {
  for (const map of speciesMaterials.values()) for (const m of map.values()) m.dispose();
  speciesMaterials.clear();
}
