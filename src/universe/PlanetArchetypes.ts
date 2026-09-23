import { RNG } from '../core/Random';
import { hsl, jitter, mixRGB } from '../procgen/color';
import type { AtmosphereParams, HazardType, RGB, TerrainParams, WeatherKind } from './types';

/**
 * Planet archetypes are data-driven recipes. Each produces the terrain,
 * atmosphere and ecological parameters for a world. Adding a new kind of planet
 * is a matter of registering another archetype.
 */
export interface ArchetypeResult {
  terrain: Omit<TerrainParams, 'seed' | 'radius'>;
  atmosphere: AtmosphereParams;
  temperature: number;
  hazard: HazardType;
  hazardLevel: number;
  weather: WeatherKind[];
  stormChance: number;
  faunaDensity: number;
  wardenLevel: number;
  description: string;
}

export interface Archetype {
  id: string;
  label: string;
  /** Relative spawn weight by orbital zone: inner (hot), habitable, outer (cold). */
  zoneWeights: [number, number, number];
  moonWeight: number;
  generate(rng: RNG, isMoon: boolean): ArchetypeResult;
}

const archetypes = new Map<string, Archetype>();

export function registerArchetype(a: Archetype): void {
  archetypes.set(a.id, a);
}

export function getArchetype(id: string): Archetype {
  const a = archetypes.get(id);
  if (!a) throw new Error(`Unknown archetype ${id}`);
  return a;
}

export function allArchetypes(): Archetype[] {
  return [...archetypes.values()];
}

const noAtmo = (): AtmosphereParams => ({
  enabled: false, height: 1, rayleigh: [0, 0, 0], mie: 0, mieG: 0.8, density: 0,
  fogColor: [0, 0, 0], cloudCoverage: 0, cloudColor: [1, 1, 1],
});

function atmo(rng: RNG, rayleigh: RGB, opts: Partial<AtmosphereParams> = {}): AtmosphereParams {
  return {
    enabled: true,
    height: 0,
    rayleigh: jitter(rng, rayleigh, 0.02).map((v) => Math.max(0.004, v)) as RGB,
    mie: opts.mie ?? rng.range(0.02, 0.06),
    mieG: opts.mieG ?? 0.8,
    density: opts.density ?? rng.range(0.85, 1.2),
    fogColor: opts.fogColor ?? [0.6, 0.7, 0.9],
    cloudCoverage: opts.cloudCoverage ?? rng.range(0.25, 0.55),
    cloudColor: opts.cloudColor ?? [1, 1, 1],
  };
}

function floraColors(rng: RNG, baseHue: number, spread: number, sat: number, light: number): RGB[] {
  const out: RGB[] = [];
  for (let i = 0; i < 4; i++) {
    out.push(hsl(baseHue + rng.range(-spread, spread), sat + rng.range(-0.1, 0.1), light + rng.range(-0.1, 0.1)));
  }
  // accent / flower colour
  out.push(hsl(baseHue + 0.45 + rng.range(-0.1, 0.1), 0.75, 0.6));
  return out;
}

const baseTerrain = (rng: RNG): Omit<TerrainParams, 'seed' | 'radius' | 'palette' | 'floraColors' | 'resourceNodes'> => ({
  heightScale: rng.range(320, 520),
  seaLevel: null,
  liquid: 'none',
  continentFreq: rng.range(0.9, 1.6),
  mountainAmount: rng.range(0.3, 0.7),
  mountainFreq: rng.range(2.5, 4.5),
  warp: rng.range(0.15, 0.45),
  detail: rng.range(0.4, 0.8),
  craterAmount: 0,
  mesaAmount: 0,
  dunes: 0,
  spires: 0,
  snowAmount: 0,
  floraDensity: 0,
  rockDensity: rng.range(0.4, 0.8),
  crystalDensity: rng.range(0.05, 0.15),
  floraStyle: 0,
});

registerArchetype({
  id: 'verdant',
  label: 'Verdant',
  zoneWeights: [0.2, 3, 0.3],
  moonWeight: 0.3,
  generate(rng) {
    const hue = rng.pick([0.28, 0.32, 0.36, 0.42, 0.22, 0.12]) + rng.range(-0.03, 0.03);
    const ground = hsl(hue, rng.range(0.35, 0.6), rng.range(0.28, 0.4));
    return {
      terrain: {
        ...baseTerrain(rng),
        seaLevel: rng.range(-0.05, 0.12),
        liquid: 'water',
        palette: {
          deep: hsl(0.58, 0.6, 0.12),
          shallow: hsl(0.5, 0.5, 0.35),
          beach: hsl(0.12, 0.35, 0.62),
          low: ground,
          lowAlt: hsl(hue + rng.range(-0.08, 0.08), 0.5, 0.33),
          mid: mixRGB(ground, hsl(0.08, 0.25, 0.4), 0.45),
          high: hsl(0.07, 0.12, 0.42),
          peak: [0.93, 0.95, 0.98],
          cliff: hsl(0.07, 0.15, 0.32),
        },
        snowAmount: rng.range(0.2, 0.6),
        floraDensity: rng.range(0.75, 1.0),
        floraStyle: rng.pick([0, 0, 1, 3, 5]),
        floraColors: floraColors(rng, hue, 0.06, 0.55, 0.38),
        resourceNodes: [
          { item: 'ferrox', weight: 4 }, { item: 'biomass', weight: 3 }, { item: 'aerolite', weight: 3 },
          { item: 'hydrex', weight: 2 }, { item: 'voltium', weight: 1 }, { item: 'aurium', weight: 0.08 },
        ],
      },
      atmosphere: atmo(rng, [0.055, 0.13, 0.31], { fogColor: [0.62, 0.74, 0.92], cloudCoverage: rng.range(0.35, 0.6) }),
      temperature: rng.range(12, 28),
      hazard: 'none',
      hazardLevel: 0,
      weather: ['clear', 'clear', 'rain'],
      stormChance: 0.15,
      faunaDensity: rng.range(0.8, 1),
      wardenLevel: rng.range(0.1, 0.4),
      description: 'A temperate world teeming with life. Breathable air, mild storms.',
    };
  },
});

registerArchetype({
  id: 'ocean',
  label: 'Pelagic',
  zoneWeights: [0.1, 1.2, 0.3],
  moonWeight: 0.1,
  generate(rng) {
    const hue = rng.pick([0.4, 0.46, 0.3]) + rng.range(-0.03, 0.03);
    return {
      terrain: {
        ...baseTerrain(rng),
        heightScale: rng.range(380, 560),
        seaLevel: rng.range(0.3, 0.42),
        liquid: 'water',
        mountainAmount: rng.range(0.5, 0.8),
        palette: {
          deep: hsl(0.6, 0.7, 0.1),
          shallow: hsl(0.48, 0.65, 0.38),
          beach: hsl(0.13, 0.45, 0.75),
          low: hsl(hue, 0.5, 0.35),
          lowAlt: hsl(hue + 0.05, 0.45, 0.3),
          mid: hsl(hue - 0.05, 0.3, 0.33),
          high: hsl(0.08, 0.15, 0.45),
          peak: [0.9, 0.93, 0.95],
          cliff: hsl(0.08, 0.12, 0.35),
        },
        snowAmount: 0.15,
        floraDensity: rng.range(0.7, 1),
        floraStyle: rng.pick([0, 5, 2]),
        floraColors: floraColors(rng, hue, 0.08, 0.6, 0.4),
        resourceNodes: [
          { item: 'ferrox', weight: 3 }, { item: 'biomass', weight: 3 }, { item: 'aerolite', weight: 2 },
          { item: 'hydrex', weight: 3 }, { item: 'silex', weight: 2 }, { item: 'aurium', weight: 0.1 },
        ],
      },
      atmosphere: atmo(rng, [0.05, 0.12, 0.3], { cloudCoverage: rng.range(0.45, 0.7), fogColor: [0.6, 0.75, 0.95] }),
      temperature: rng.range(16, 30),
      hazard: 'none',
      hazardLevel: 0,
      weather: ['clear', 'rain', 'rain'],
      stormChance: 0.25,
      faunaDensity: rng.range(0.6, 0.9),
      wardenLevel: rng.range(0.1, 0.3),
      description: 'A world of endless oceans broken by lush archipelagos.',
    };
  },
});

registerArchetype({
  id: 'arid',
  label: 'Arid',
  zoneWeights: [2, 1.2, 0.1],
  moonWeight: 0.6,
  generate(rng, isMoon) {
    const hue = rng.range(0.03, 0.11);
    return {
      terrain: {
        ...baseTerrain(rng),
        heightScale: rng.range(260, 440),
        mesaAmount: rng.range(0.5, 1),
        dunes: rng.range(0.4, 1),
        palette: {
          deep: hsl(hue, 0.4, 0.2),
          shallow: hsl(hue, 0.4, 0.3),
          beach: hsl(hue + 0.02, 0.55, 0.65),
          low: hsl(hue + 0.02, rng.range(0.45, 0.65), rng.range(0.55, 0.65)),
          lowAlt: hsl(hue, 0.5, 0.52),
          mid: hsl(hue - 0.01, 0.55, 0.45),
          high: hsl(hue - 0.02, 0.5, 0.36),
          peak: hsl(hue, 0.35, 0.55),
          cliff: hsl(hue - 0.02, 0.55, 0.38),
        },
        floraDensity: rng.range(0.15, 0.35),
        floraStyle: 2,
        floraColors: floraColors(rng, rng.pick([0.25, 0.1, 0.95]), 0.05, 0.4, 0.4),
        resourceNodes: [
          { item: 'ferrox', weight: 3 }, { item: 'silex', weight: 4 }, { item: 'pyrocite', weight: 2 },
          { item: 'hydrex', weight: 1 }, { item: 'voltium', weight: 1.5 }, { item: 'aurium', weight: 0.15 },
        ],
      },
      atmosphere: atmo(rng, [0.22, 0.14, 0.07], { mie: 0.1, fogColor: [0.85, 0.66, 0.45], cloudCoverage: isMoon ? 0 : rng.range(0.05, 0.2), cloudColor: [1, 0.9, 0.8], density: rng.range(0.7, 1.0) }),
      temperature: rng.range(48, 90),
      hazard: 'heat',
      hazardLevel: rng.range(0.4, 0.8),
      weather: ['clear', 'dust'],
      stormChance: 0.25,
      faunaDensity: rng.range(0.25, 0.5),
      wardenLevel: rng.range(0.2, 0.5),
      description: 'Sun-blasted mesas and shifting dune seas. Scorching days, dust storms.',
    };
  },
});

registerArchetype({
  id: 'frozen',
  label: 'Glacial',
  zoneWeights: [0, 0.3, 3],
  moonWeight: 1,
  generate(rng) {
    const hue = rng.range(0.52, 0.62);
    return {
      terrain: {
        ...baseTerrain(rng),
        seaLevel: rng.chance(0.5) ? rng.range(-0.1, 0.05) : null,
        liquid: 'ice',
        mountainAmount: rng.range(0.5, 0.9),
        palette: {
          deep: hsl(hue, 0.5, 0.55),
          shallow: hsl(hue, 0.45, 0.72),
          beach: [0.86, 0.9, 0.95],
          low: [0.9, 0.93, 0.97],
          lowAlt: hsl(hue, 0.25, 0.82),
          mid: hsl(hue, 0.18, 0.72),
          high: hsl(hue, 0.12, 0.5),
          peak: [0.97, 0.98, 1],
          cliff: hsl(hue, 0.15, 0.38),
        },
        snowAmount: 1,
        floraDensity: rng.range(0.1, 0.3),
        floraStyle: rng.pick([1, 4]),
        floraColors: floraColors(rng, rng.pick([0.55, 0.75, 0.95]), 0.05, 0.5, 0.5),
        resourceNodes: [
          { item: 'ferrox', weight: 3 }, { item: 'cryolite', weight: 3 }, { item: 'hydrex', weight: 3 },
          { item: 'voltium', weight: 1 }, { item: 'nullite', weight: 0.1 },
        ],
      },
      atmosphere: atmo(rng, [0.06, 0.12, 0.24], { fogColor: [0.78, 0.85, 0.95], cloudCoverage: rng.range(0.3, 0.6), density: rng.range(0.7, 1.1) }),
      temperature: rng.range(-110, -40),
      hazard: 'cold',
      hazardLevel: rng.range(0.4, 0.9),
      weather: ['clear', 'snow', 'snow'],
      stormChance: 0.3,
      faunaDensity: rng.range(0.15, 0.35),
      wardenLevel: rng.range(0.1, 0.4),
      description: 'Glaciers, frozen seas and howling blizzards.',
    };
  },
});

registerArchetype({
  id: 'volcanic',
  label: 'Scorched',
  zoneWeights: [2.5, 0.4, 0],
  moonWeight: 0.4,
  generate(rng) {
    return {
      terrain: {
        ...baseTerrain(rng),
        heightScale: rng.range(420, 640),
        seaLevel: rng.range(-0.15, 0.0),
        liquid: 'lava',
        mountainAmount: rng.range(0.6, 1),
        craterAmount: rng.range(0.1, 0.4),
        palette: {
          deep: [1.0, 0.35, 0.05],
          shallow: [1.0, 0.55, 0.1],
          beach: hsl(0.02, 0.2, 0.12),
          low: hsl(0.03, 0.1, 0.16),
          lowAlt: hsl(0.0, 0.25, 0.2),
          mid: hsl(0.05, 0.1, 0.22),
          high: hsl(0.05, 0.08, 0.3),
          peak: hsl(0.08, 0.1, 0.4),
          cliff: hsl(0.02, 0.1, 0.12),
        },
        floraDensity: rng.range(0.03, 0.12),
        floraStyle: 4,
        floraColors: floraColors(rng, 0.03, 0.03, 0.8, 0.5),
        crystalDensity: rng.range(0.2, 0.4),
        resourceNodes: [
          { item: 'ferrox', weight: 3 }, { item: 'pyrocite', weight: 4 }, { item: 'voltium', weight: 2 },
          { item: 'silex', weight: 1 }, { item: 'aurium', weight: 0.2 }, { item: 'nullite', weight: 0.1 },
        ],
      },
      atmosphere: atmo(rng, [0.2, 0.08, 0.04], { mie: 0.14, fogColor: [0.5, 0.25, 0.15], cloudCoverage: rng.range(0.2, 0.4), cloudColor: [0.35, 0.3, 0.28], density: rng.range(0.9, 1.3) }),
      temperature: rng.range(120, 280),
      hazard: 'heat',
      hazardLevel: rng.range(0.8, 1.2),
      weather: ['clear', 'ash', 'ash'],
      stormChance: 0.35,
      faunaDensity: rng.range(0.05, 0.2),
      wardenLevel: rng.range(0.3, 0.7),
      description: 'Rivers of magma cut through blackened basalt. Ash storms are frequent.',
    };
  },
});

registerArchetype({
  id: 'toxic',
  label: 'Caustic',
  zoneWeights: [0.8, 1.2, 0.6],
  moonWeight: 0.3,
  generate(rng) {
    const hue = rng.range(0.15, 0.25);
    return {
      terrain: {
        ...baseTerrain(rng),
        seaLevel: rng.range(-0.05, 0.1),
        liquid: 'acid',
        spires: rng.range(0.2, 0.6),
        palette: {
          deep: hsl(hue + 0.05, 0.8, 0.2),
          shallow: hsl(hue + 0.02, 0.85, 0.42),
          beach: hsl(hue, 0.35, 0.45),
          low: hsl(hue, 0.45, 0.35),
          lowAlt: hsl(hue - 0.05, 0.5, 0.3),
          mid: hsl(hue - 0.08, 0.3, 0.3),
          high: hsl(hue - 0.1, 0.2, 0.26),
          peak: hsl(hue, 0.2, 0.5),
          cliff: hsl(hue - 0.1, 0.25, 0.2),
        },
        floraDensity: rng.range(0.4, 0.7),
        floraStyle: rng.pick([3, 5]),
        floraColors: floraColors(rng, rng.pick([0.8, 0.9, 0.2]), 0.07, 0.6, 0.45),
        resourceNodes: [
          { item: 'ferrox', weight: 3 }, { item: 'toxalite', weight: 4 }, { item: 'biomass', weight: 2 },
          { item: 'hydrex', weight: 1 }, { item: 'voltium', weight: 1 }, { item: 'nullite', weight: 0.15 },
        ],
      },
      atmosphere: atmo(rng, [0.12, 0.2, 0.05], { mie: 0.12, fogColor: [0.55, 0.65, 0.3], cloudCoverage: rng.range(0.4, 0.7), cloudColor: [0.85, 0.95, 0.6], density: rng.range(1.0, 1.4) }),
      temperature: rng.range(20, 60),
      hazard: 'toxic',
      hazardLevel: rng.range(0.5, 0.9),
      weather: ['clear', 'toxic', 'toxic', 'spores'],
      stormChance: 0.3,
      faunaDensity: rng.range(0.4, 0.7),
      wardenLevel: rng.range(0.2, 0.5),
      description: 'Caustic rain and fungal forests beneath a sickly sky.',
    };
  },
});

registerArchetype({
  id: 'exotic',
  label: 'Anomalous',
  zoneWeights: [0.3, 0.5, 0.5],
  moonWeight: 0.2,
  generate(rng) {
    const hue = rng.pick([0.75, 0.82, 0.9, 0.95]) + rng.range(-0.03, 0.03);
    return {
      terrain: {
        ...baseTerrain(rng),
        seaLevel: rng.chance(0.5) ? rng.range(-0.05, 0.1) : null,
        liquid: 'water',
        spires: rng.range(0.5, 1),
        warp: rng.range(0.4, 0.8),
        palette: {
          deep: hsl(hue + 0.1, 0.7, 0.15),
          shallow: hsl(hue + 0.12, 0.7, 0.4),
          beach: hsl(hue, 0.3, 0.7),
          low: hsl(hue, 0.45, 0.45),
          lowAlt: hsl(hue + 0.08, 0.5, 0.4),
          mid: hsl(hue - 0.06, 0.4, 0.4),
          high: hsl(hue, 0.2, 0.55),
          peak: hsl(hue, 0.3, 0.85),
          cliff: hsl(hue + 0.3, 0.25, 0.3),
        },
        snowAmount: 0.2,
        floraDensity: rng.range(0.5, 0.8),
        floraStyle: rng.pick([4, 5, 3]),
        floraColors: floraColors(rng, hue + 0.4, 0.15, 0.7, 0.55),
        crystalDensity: rng.range(0.4, 0.7),
        resourceNodes: [
          { item: 'ferrox', weight: 2 }, { item: 'nullite', weight: 1.2 }, { item: 'voltium', weight: 2 },
          { item: 'biomass', weight: 1 }, { item: 'aerolite', weight: 1 }, { item: 'aurium', weight: 0.3 },
        ],
      },
      atmosphere: atmo(rng, [0.14, 0.05, 0.22], { mie: 0.06, fogColor: [0.75, 0.55, 0.9], cloudCoverage: rng.range(0.2, 0.5), cloudColor: [1, 0.85, 1] }),
      temperature: rng.range(-10, 40),
      hazard: 'radiation',
      hazardLevel: rng.range(0.3, 0.7),
      weather: ['clear', 'spores'],
      stormChance: 0.2,
      faunaDensity: rng.range(0.5, 0.8),
      wardenLevel: rng.range(0.5, 0.9),
      description: 'Reality feels thin here. Crystal spires hum with a strange resonance.',
    };
  },
});

registerArchetype({
  id: 'barren',
  label: 'Barren',
  zoneWeights: [1, 0.6, 1.5],
  moonWeight: 3,
  generate(rng, isMoon) {
    const hue = rng.range(0.02, 0.15);
    const grey = rng.range(0.35, 0.55);
    const hasThin = !isMoon && rng.chance(0.4);
    return {
      terrain: {
        ...baseTerrain(rng),
        heightScale: rng.range(240, 420),
        craterAmount: rng.range(0.5, 1),
        mountainAmount: rng.range(0.2, 0.5),
        palette: {
          deep: hsl(hue, 0.08, grey * 0.5),
          shallow: hsl(hue, 0.08, grey * 0.6),
          beach: hsl(hue, 0.1, grey),
          low: hsl(hue, 0.1, grey),
          lowAlt: hsl(hue, 0.12, grey * 0.85),
          mid: hsl(hue, 0.08, grey * 0.9),
          high: hsl(hue, 0.06, grey * 1.1),
          peak: hsl(hue, 0.05, grey * 1.25),
          cliff: hsl(hue, 0.08, grey * 0.6),
        },
        floraDensity: 0,
        floraStyle: 4,
        floraColors: floraColors(rng, 0.6, 0.1, 0.5, 0.5),
        crystalDensity: rng.range(0.1, 0.3),
        rockDensity: rng.range(0.8, 1),
        resourceNodes: [
          { item: 'ferrox', weight: 4 }, { item: 'silex', weight: 3 }, { item: 'astrium', weight: 2 },
          { item: 'voltium', weight: 1.5 }, { item: 'aurium', weight: 0.25 }, { item: 'nullite', weight: 0.2 },
        ],
      },
      atmosphere: hasThin
        ? atmo(rng, [0.03, 0.03, 0.04], { density: 0.4, cloudCoverage: 0, fogColor: [0.5, 0.5, 0.55] })
        : noAtmo(),
      temperature: rng.range(-150, 120),
      hazard: 'radiation',
      hazardLevel: rng.range(0.2, 0.5),
      weather: ['clear'],
      stormChance: 0,
      faunaDensity: 0,
      wardenLevel: rng.range(0, 0.2),
      description: 'A lifeless, cratered rock. Rich in minerals, poor in comfort.',
    };
  },
});
