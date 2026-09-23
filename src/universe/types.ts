/**
 * Plain-data descriptors for everything in the universe. Descriptors are
 * produced deterministically from seeds by the generators and are consumed by
 * the runtime world objects. They must stay JSON/structured-clone friendly so
 * they can be shipped to workers and persisted.
 */
export type Vec3T = [number, number, number];
export type RGB = [number, number, number];

export type HazardType = 'none' | 'heat' | 'cold' | 'toxic' | 'radiation';
export type WeatherKind = 'clear' | 'rain' | 'snow' | 'dust' | 'ash' | 'toxic' | 'spores';

export interface TerrainParams {
  seed: number;
  radius: number;
  /** Maximum displacement amplitude in metres. */
  heightScale: number;
  /** Sea level as a fraction of heightScale, or null for no ocean. */
  seaLevel: number | null;
  /** Liquid kind rendered at sea level. */
  liquid: 'water' | 'lava' | 'acid' | 'ice' | 'none';
  continentFreq: number;
  mountainAmount: number;
  mountainFreq: number;
  warp: number;
  detail: number;
  craterAmount: number;
  mesaAmount: number;
  dunes: number;
  spires: number;
  /** Biome colour palette (linear-ish sRGB 0..1). */
  palette: {
    deep: RGB;
    shallow: RGB;
    beach: RGB;
    low: RGB;
    lowAlt: RGB;
    mid: RGB;
    high: RGB;
    peak: RGB;
    cliff: RGB;
  };
  /** 0..1 how much snow/ice collects on peaks and poles. */
  snowAmount: number;
  /** Vegetation / scatter parameters. */
  floraDensity: number;
  rockDensity: number;
  crystalDensity: number;
  floraStyle: number; // index into flora archetype set
  floraColors: RGB[];
  resourceNodes: { item: string; weight: number }[];
}

export interface AtmosphereParams {
  enabled: boolean;
  /** Atmosphere thickness in metres above radius. */
  height: number;
  /** Rayleigh scattering coefficients (per metre, will be scaled). */
  rayleigh: RGB;
  mie: number;
  mieG: number;
  density: number;
  /** Tint applied to ambient fog on surface. */
  fogColor: RGB;
  cloudCoverage: number;
  cloudColor: RGB;
}

export interface PlanetDesc {
  id: string;
  seed: number;
  name: string;
  archetype: string;
  archetypeLabel: string;
  isMoon: boolean;
  parentId: string | null;
  position: Vec3T;
  radius: number;
  axis: Vec3T;
  dayLength: number;
  gravity: number;
  temperature: number; // celsius typical
  hazard: HazardType;
  hazardLevel: number; // 0..1 drain multiplier
  weather: WeatherKind[];
  stormChance: number;
  faunaDensity: number;
  wardenLevel: number; // 0..1 hostility of automated drones
  terrain: TerrainParams;
  atmosphere: AtmosphereParams;
  description: string;
  hasSignal: boolean;
}

export interface StationDesc {
  id: string;
  seed: number;
  name: string;
  position: Vec3T;
  orbitOf: string;
}

export interface AsteroidBeltDesc {
  id: string;
  seed: number;
  center: Vec3T;
  radius: number;
  thickness: number;
  width: number;
  density: number;
  rich: string[];
}

export interface StarDesc {
  classLabel: string;
  color: RGB;
  radius: number;
  intensity: number;
}

export type EconomyType = 'mining' | 'industrial' | 'scientific' | 'trading' | 'agricultural' | 'lawless';

export interface StarSystemDesc {
  id: number;
  seed: number;
  name: string;
  galaxyPos: Vec3T;
  star: StarDesc;
  planets: PlanetDesc[];
  stations: StationDesc[];
  belts: AsteroidBeltDesc[];
  economy: EconomyType;
  wealth: number;
  conflict: number;
  nebula: { colorA: RGB; colorB: RGB; density: number; seed: number };
}

export interface GalaxySystemEntry {
  id: number;
  seed: number;
  name: string;
  pos: Vec3T;
  starColor: RGB;
  starClass: string;
  economy: EconomyType;
  conflict: number;
}
