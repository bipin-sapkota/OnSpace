import { RNG } from '../core/Random';

/**
 * Procedural name generation. Syllable sets give the galaxy a consistent
 * "linguistic" feel while still producing endless variety.
 */
const ONSETS = ['', 'k', 'v', 'th', 'dr', 'z', 'm', 'n', 's', 'r', 'l', 'qu', 'x', 'h', 'b', 'g', 'y', 'sh', 'kr', 'tr', 'vel', 'or', 'ae', 'c', 'p'];
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'ae', 'io', 'ea', 'y', 'ou', 'ai', 'oa'];
const CODAS = ['', '', '', 'n', 'r', 's', 'x', 'th', 'l', 'm', 'rn', 'sk', 'nd', 'q', 'v', 'ss'];
const SUFFIXES = ['', '', '', ' Prime', ' Minor', ' Major', ' IV', ' VII', '-9', ' Tau', ' Obscura', ' Nova'];
const SPECIES_SUFFIX = ['us', 'ia', 'or', 'ax', 'ium', 'ops', 'ex', 'yx', 'ae', 'ith'];

function syllable(rng: RNG): string {
  return rng.pick(ONSETS) + rng.pick(VOWELS) + rng.pick(CODAS);
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function generateWord(rng: RNG, minSyl = 2, maxSyl = 3): string {
  const n = rng.int(minSyl, maxSyl);
  let w = '';
  for (let i = 0; i < n; i++) w += syllable(rng);
  // avoid overly long / awkward words
  if (w.length > 11) w = w.slice(0, 7 + rng.int(0, 3));
  return capitalise(w);
}

export function generateSystemName(seed: number): string {
  const rng = new RNG(seed ^ 0x51f15e);
  const base = generateWord(rng, 2, 3);
  return base + rng.pick(SUFFIXES);
}

export function generatePlanetName(seed: number): string {
  const rng = new RNG(seed ^ 0x9a1e7);
  const base = generateWord(rng, 2, 3);
  if (rng.chance(0.2)) return `${base} ${String.fromCharCode(65 + rng.int(0, 7))}${rng.int(1, 9)}`;
  return base;
}

export function generateSpeciesName(seed: number): string {
  const rng = new RNG(seed ^ 0x5bec1e);
  const genus = generateWord(rng, 2, 2);
  const species = generateWord(rng, 1, 2).toLowerCase() + rng.pick(SPECIES_SUFFIX);
  return `${genus} ${species}`;
}

export function generateStationName(seed: number): string {
  const rng = new RNG(seed ^ 0x57a7);
  const kinds = ['Outpost', 'Waystation', 'Spire', 'Anchorage', 'Relay', 'Bastion', 'Haven', 'Exchange'];
  return `${generateWord(rng, 2, 2)} ${rng.pick(kinds)}`;
}

export function generateShipName(seed: number): string {
  const rng = new RNG(seed ^ 0x5419);
  const adj = ['Silent', 'Crimson', 'Distant', 'Wandering', 'Iron', 'Pale', 'Hollow', 'Radiant', 'Last', 'Drifting', 'Amber', 'Quiet'];
  const noun = ['Heron', 'Lantern', 'Meridian', 'Vesper', 'Comet', 'Tide', 'Warden', 'Oracle', 'Sparrow', 'Horizon', 'Ember', 'Echo'];
  return `${rng.pick(adj)} ${rng.pick(noun)}`;
}

export function generatePirateName(seed: number): string {
  const rng = new RNG(seed ^ 0xdead);
  return `${generateWord(rng, 1, 2)} ${rng.pick(['Raider', 'Marauder', 'Corsair', 'Reaver', 'Scav'])}`;
}
