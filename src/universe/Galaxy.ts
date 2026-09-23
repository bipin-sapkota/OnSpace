import { RNG, hashCombine } from '../core/Random';
import { generateSystemName } from '../procgen/names';
import { economyFor, generateStarSystem, starClassFor } from './StarSystemGen';
import type { GalaxySystemEntry, StarSystemDesc } from './types';

/**
 * The galaxy is a deterministic spiral of star systems generated from a single
 * seed. Only lightweight entries are generated up front; full system
 * descriptors are generated lazily and cached.
 */
export class Galaxy {
  readonly seed: number;
  readonly systems: GalaxySystemEntry[] = [];
  readonly startSystemId: number;
  readonly radius = 900;
  private cache = new Map<number, StarSystemDesc>();

  constructor(seed: number, count = 520) {
    this.seed = seed;
    const rng = new RNG(seed);
    const arms = 3;
    for (let i = 0; i < count; i++) {
      const sysSeed = hashCombine(seed, i, 0x5e5);
      // spiral arm distribution with some scatter and a denser core
      const t = Math.pow(rng.next(), 0.75);
      const r = 60 + t * (this.radius - 60);
      const arm = i % arms;
      const armAngle = (arm / arms) * Math.PI * 2;
      const twist = r * 0.0065;
      const spread = rng.gaussian() * (0.25 + 0.2 * (1 - t));
      const ang = armAngle + twist + spread;
      const y = rng.gaussian() * (14 + 30 * (1 - t));
      const sc = starClassFor(sysSeed);
      const econ = economyFor(sysSeed);
      this.systems.push({
        id: i,
        seed: sysSeed,
        name: generateSystemName(sysSeed),
        pos: [Math.cos(ang) * r, y, Math.sin(ang) * r],
        starColor: sc.color,
        starClass: sc.label,
        economy: econ.economy,
        conflict: econ.conflict,
      });
    }
    // start at a rim system of a calm G/K star
    let best = 0;
    let bestScore = -Infinity;
    for (const s of this.systems) {
      const d = Math.hypot(s.pos[0], s.pos[2]);
      const calm = s.starClass === 'G' || s.starClass === 'K' ? 60 : 0;
      const score = d + calm - s.conflict * 80;
      if (score > bestScore) {
        bestScore = score;
        best = s.id;
      }
    }
    this.startSystemId = best;
  }

  getSystem(id: number): StarSystemDesc {
    let s = this.cache.get(id);
    if (!s) {
      s = generateStarSystem(this.systems[id], id === this.startSystemId);
      this.cache.set(id, s);
    }
    return s;
  }

  distance(a: number, b: number): number {
    const pa = this.systems[a].pos;
    const pb = this.systems[b].pos;
    return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
  }

  /** Systems reachable from `from` within `range` light years, sorted by distance. */
  neighbours(from: number, range: number): GalaxySystemEntry[] {
    return this.systems
      .filter((s) => s.id !== from && this.distance(from, s.id) <= range)
      .sort((a, b) => this.distance(from, a.id) - this.distance(from, b.id));
  }

  distanceToCore(id: number): number {
    const p = this.systems[id].pos;
    return Math.hypot(p[0], p[1], p[2]);
  }
}
