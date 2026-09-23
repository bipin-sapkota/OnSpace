import * as THREE from 'three';
import { RNG, hashCombine } from '../../core/Random';
import { generateSpeciesName } from '../../procgen/names';
import type { PlanetDesc } from '../../universe/types';

/**
 * Procedural fauna species. A species is pure data derived from the planet
 * seed; bodies are assembled from it by CreatureBuilder.
 */
export type BodyPlan = 'quadruped' | 'biped' | 'hexapod' | 'hopper' | 'flyer' | 'serpent';
export type Temperament = 'passive' | 'skittish' | 'aggressive';

export interface Species {
  id: string;
  seed: number;
  name: string;
  plan: BodyPlan;
  size: number; // approx shoulder height in metres
  bodyLen: number;
  legLen: number;
  neck: number;
  headSize: number;
  tail: number;
  horns: number;
  primary: THREE.Color;
  secondary: THREE.Color;
  eye: THREE.Color;
  temperament: Temperament;
  herd: [number, number];
  walkSpeed: number;
  runSpeed: number;
  health: number;
  drop: string;
  dropAmount: number;
  nocturnal: boolean;
  rarity: number; // spawn weight
  diet: string;
  notes: string;
}

const DIETS = ['Herbivore', 'Omnivore', 'Carnivore', 'Lithovore', 'Photosynthetic', 'Filter feeder'];
const NOTES = [
  'Communicates with low harmonic pulses.',
  'Grazes in the cool hours before dawn.',
  'Highly territorial during storms.',
  'Its hide shimmers under direct starlight.',
  'Nests in the shadow of large rocks.',
  'Appears to follow travellers out of curiosity.',
  'Sheds its outer plates each season.',
  'Can sense seismic activity through its feet.',
];

export function generateSpecies(planet: PlanetDesc): Species[] {
  if (planet.faunaDensity <= 0) return [];
  const rng = new RNG(planet.seed ^ 0xfa0a);
  const count = Math.max(2, Math.round(3 + planet.faunaDensity * 4));
  const hostile = planet.archetype === 'volcanic' || planet.archetype === 'toxic' || planet.archetype === 'exotic' ? 0.35 : 0.18;
  const hue = rng.next();
  const out: Species[] = [];
  for (let i = 0; i < count; i++) {
    const seed = hashCombine(planet.seed, i, 0xc2ea);
    const r = new RNG(seed);
    const plan: BodyPlan = i === count - 1 && rng.chance(0.8) ? 'flyer' : r.weighted<BodyPlan>(['quadruped', 'biped', 'hexapod', 'hopper', 'serpent'], [5, 2, 2, 1.5, 1]);
    const small = r.chance(0.45);
    const size = plan === 'flyer' ? r.range(0.4, 1.2) : small ? r.range(0.35, 0.9) : r.range(1.0, 3.4);
    const temperament: Temperament = size > 0.8 && r.chance(hostile) ? 'aggressive' : r.chance(0.45) ? 'skittish' : 'passive';
    const h = (hue + r.range(-0.18, 0.18) + 1) % 1;
    out.push({
      id: `sp${i}`,
      seed,
      name: generateSpeciesName(seed),
      plan,
      size,
      bodyLen: r.range(0.9, 1.8),
      legLen: r.range(0.7, 1.3),
      neck: r.range(0, 0.8),
      headSize: r.range(0.6, 1.2),
      tail: r.range(0, 1.2),
      horns: r.chance(0.4) ? r.range(0.3, 1) : 0,
      primary: new THREE.Color().setHSL(h, r.range(0.25, 0.7), r.range(0.3, 0.55)),
      secondary: new THREE.Color().setHSL((h + r.range(0.3, 0.6)) % 1, r.range(0.3, 0.8), r.range(0.45, 0.7)),
      eye: new THREE.Color().setHSL(r.next(), 0.9, 0.6),
      temperament,
      herd: plan === 'flyer' ? [1, 3] : temperament === 'aggressive' ? [1, 2] : [2, 6],
      walkSpeed: 1.2 + size * 0.6,
      runSpeed: (plan === 'hopper' ? 7 : 5) + size * 2,
      health: 25 + size * 35,
      drop: r.chance(0.6) ? 'chitin' : 'biomass',
      dropAmount: Math.round(8 + size * 14),
      nocturnal: r.chance(0.25),
      rarity: r.range(0.4, 1.2) * (small ? 1.3 : 1),
      diet: temperament === 'aggressive' ? 'Carnivore' : r.pick(DIETS),
      notes: r.pick(NOTES),
    });
  }
  return out;
}
