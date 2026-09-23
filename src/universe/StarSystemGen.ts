import { RNG, hashCombine } from '../core/Random';
import { generatePlanetName, generateStationName, generateSystemName } from '../procgen/names';
import { hsl } from '../procgen/color';
import { allArchetypes, getArchetype } from './PlanetArchetypes';
import type { EconomyType, PlanetDesc, RGB, StarDesc, StarSystemDesc, Vec3T, GalaxySystemEntry } from './types';

export const STAR_CLASSES: { label: string; color: RGB; weight: number; heat: number }[] = [
  { label: 'M', color: [1.0, 0.55, 0.35], weight: 3, heat: -1 },
  { label: 'K', color: [1.0, 0.75, 0.5], weight: 3, heat: -0.5 },
  { label: 'G', color: [1.0, 0.93, 0.8], weight: 3, heat: 0 },
  { label: 'F', color: [0.98, 0.97, 0.95], weight: 2, heat: 0.3 },
  { label: 'A', color: [0.8, 0.88, 1.0], weight: 1, heat: 0.6 },
  { label: 'B', color: [0.62, 0.74, 1.0], weight: 0.5, heat: 1 },
  { label: 'X', color: [0.75, 0.5, 1.0], weight: 0.25, heat: 0.2 },
];

const ECONOMIES: EconomyType[] = ['mining', 'industrial', 'scientific', 'trading', 'agricultural', 'lawless'];

export function starClassFor(seed: number) {
  const rng = new RNG(seed ^ 0x57a2);
  return rng.weighted(STAR_CLASSES, STAR_CLASSES.map((s) => s.weight));
}

export function economyFor(seed: number): { economy: EconomyType; wealth: number; conflict: number } {
  const rng = new RNG(seed ^ 0xec0);
  const economy = rng.weighted(ECONOMIES, [2, 2, 1.5, 2, 1.5, 0.8]);
  const wealth = rng.range(0.3, 1);
  const conflict = economy === 'lawless' ? rng.range(0.7, 1) : rng.range(0.05, 0.5);
  return { economy, wealth, conflict };
}

function randomAxis(rng: RNG): Vec3T {
  const tilt = rng.range(0, 0.45);
  const az = rng.range(0, Math.PI * 2);
  return [Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az)];
}

function makePlanet(
  rng: RNG,
  systemSeed: number,
  index: number,
  archetypeId: string,
  position: Vec3T,
  isMoon: boolean,
  parentId: string | null,
  radius: number,
): PlanetDesc {
  const seed = hashCombine(systemSeed, index, isMoon ? 77 : 11);
  const prng = new RNG(seed);
  const arch = getArchetype(archetypeId);
  const r = arch.generate(prng, isMoon);
  const atmosphere = { ...r.atmosphere, height: radius * 0.22 };
  return {
    id: `p${index}`,
    seed,
    name: generatePlanetName(seed),
    archetype: arch.id,
    archetypeLabel: arch.label,
    isMoon,
    parentId,
    position,
    radius,
    axis: randomAxis(prng),
    dayLength: prng.range(900, 1800),
    gravity: 7 + (radius / 3000) * 4 + prng.range(-1, 1),
    temperature: Math.round(r.temperature),
    hazard: r.hazard,
    hazardLevel: r.hazardLevel,
    weather: r.weather,
    stormChance: r.stormChance,
    faunaDensity: r.faunaDensity,
    wardenLevel: r.wardenLevel,
    terrain: { ...r.terrain, seed, radius },
    atmosphere,
    description: r.description,
    hasSignal: false,
  };
}

function pickArchetype(rng: RNG, zone: 0 | 1 | 2, isMoon: boolean, heat: number): string {
  const list = allArchetypes();
  const weights = list.map((a) => {
    const z = Math.min(2, Math.max(0, zone + (heat > 0.5 ? -1 : heat < -0.5 ? 1 : 0))) as 0 | 1 | 2;
    const w = a.zoneWeights[z];
    return isMoon ? w * 0.4 + a.moonWeight : w;
  });
  return rng.weighted(list, weights).id;
}

export function generateStarSystem(entry: GalaxySystemEntry, isStart: boolean): StarSystemDesc {
  const rng = new RNG(entry.seed);
  const sc = STAR_CLASSES.find((s) => s.label === entry.starClass) ?? STAR_CLASSES[2];
  const star: StarDesc = {
    classLabel: sc.label,
    color: sc.color,
    radius: rng.range(14000, 22000),
    intensity: 1.0 + sc.heat * 0.15,
  };

  const planets: PlanetDesc[] = [];
  const planetCount = isStart ? 3 : rng.int(2, 5);
  let orbit = rng.range(260000, 320000);
  let idx = 0;
  for (let i = 0; i < planetCount; i++) {
    const zone: 0 | 1 | 2 = i === 0 ? 0 : i < 3 ? 1 : 2;
    let arch = pickArchetype(rng, zone, false, sc.heat);
    if (isStart && i === 0) arch = 'verdant';
    if (isStart && i === 1) arch = rng.pick(['arid', 'frozen', 'toxic']);
    if (isStart && i === 2) arch = rng.pick(['exotic', 'volcanic']);
    const angle = rng.range(0, Math.PI * 2);
    const incl = rng.range(-0.08, 0.08);
    const pos: Vec3T = [Math.cos(angle) * orbit, Math.sin(incl) * orbit, Math.sin(angle) * orbit];
    const radius = isStart && i === 0 ? 9000 : rng.range(6500, 11000);
    const p = makePlanet(rng, entry.seed, idx++, arch, pos, false, null, radius);
    planets.push(p);

    const moonCount = rng.chance(isStart && i === 0 ? 1 : 0.45) ? 1 : 0;
    for (let m = 0; m < moonCount; m++) {
      const md = radius * rng.range(3.6, 4.6);
      const ma = rng.range(0, Math.PI * 2);
      const mpos: Vec3T = [pos[0] + Math.cos(ma) * md, pos[1] + rng.range(-0.3, 0.3) * md, pos[2] + Math.sin(ma) * md];
      const march = pickArchetype(rng, zone, true, sc.heat);
      planets.push(makePlanet(rng, entry.seed, idx++, march, mpos, true, p.id, rng.range(3200, 4600)));
    }
    orbit += rng.range(170000, 260000);
  }

  // Exactly one world per system carries the Veil signal.
  const signalCandidates = planets.filter((p) => !p.isMoon);
  const signalPlanet = isStart ? planets.find((p) => p.isMoon) ?? planets[1] : rng.pick(signalCandidates);
  signalPlanet.hasSignal = true;

  // Space station orbits the most hospitable large planet.
  const host = planets.find((p) => !p.isMoon && (p.archetype === 'verdant' || p.archetype === 'ocean')) ?? planets[0];
  const hostPos = host.position;
  const toStar = Math.hypot(hostPos[0], hostPos[1], hostPos[2]);
  const sd = host.radius * 2.4;
  const sAngle = rng.range(0, Math.PI * 2);
  const dx = -hostPos[0] / toStar, dz = -hostPos[2] / toStar;
  const px = -dz, pz = dx; // perpendicular in the orbital plane
  const ca = Math.cos(sAngle * 0.5 - 0.6), sa = Math.sin(sAngle * 0.5 - 0.6);
  const stationPos: Vec3T = [
    hostPos[0] + (dx * ca + px * sa) * sd,
    hostPos[1] + sd * 0.18,
    hostPos[2] + (dz * ca + pz * sa) * sd,
  ];
  const stationSeed = hashCombine(entry.seed, 0x5747);
  const stations = [{ id: 's0', seed: stationSeed, name: generateStationName(stationSeed), position: stationPos, orbitOf: host.id }];

  // Asteroid belts: one ring around the star between orbits and a dense field near the station.
  const beltRadius = orbit + rng.range(20000, 60000);
  const belts = [
    { id: 'b0', seed: hashCombine(entry.seed, 0xbe17), center: [0, 0, 0] as Vec3T, radius: beltRadius, thickness: 4000, width: 22000, density: rng.range(0.5, 1), rich: ['astrium', 'ferrox', rng.pick(['aurium', 'nullite', 'voltium'])] },
    {
      id: 'b1', seed: hashCombine(entry.seed, 0xbe18),
      center: [stationPos[0] + host.radius * 0.9, stationPos[1] + 2500, stationPos[2] + host.radius * 0.7] as Vec3T,
      radius: 0, thickness: 3500, width: 7000, density: rng.range(0.6, 1), rich: ['astrium', 'ferrox', 'voltium'],
    },
  ];

  const econ = economyFor(entry.seed);
  const nebRng = new RNG(entry.seed ^ 0x2eb);
  const nh = nebRng.next();
  return {
    id: entry.id,
    seed: entry.seed,
    name: entry.name,
    galaxyPos: entry.pos,
    star,
    planets,
    stations,
    belts,
    economy: econ.economy,
    wealth: econ.wealth,
    conflict: econ.conflict,
    nebula: {
      colorA: hsl(nh, nebRng.range(0.5, 0.8), nebRng.range(0.25, 0.4)),
      colorB: hsl(nh + nebRng.range(0.15, 0.4), nebRng.range(0.5, 0.8), nebRng.range(0.2, 0.35)),
      density: nebRng.range(0.3, 1),
      seed: nebRng.int(0, 1e6),
    },
  };
}

export function systemNameFor(seed: number): string {
  return generateSystemName(seed);
}
