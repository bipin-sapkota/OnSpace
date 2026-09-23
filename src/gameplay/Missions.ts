import type { Game } from '../core/Game';
import type { MissionState } from './GameState';
import { RNG, hashCombine } from '../core/Random';
import { getItem } from './Items';
import { events } from '../core/EventBus';
import { generateWord } from '../procgen/names';

/**
 * Procedural mission board. Stations offer a rotating set of contracts
 * generated from the system seed and a time cycle; progress is tracked via
 * game events.
 */
const CYCLE = 900; // seconds of game time per board refresh

export class Missions {
  constructor(game: Game) {
    events.on('enemy:killed', (e) => {
      for (const m of this.active(game)) {
        if ((m.kind === 'pirates' && e.kind === 'pirate') || (m.kind === 'predators' && e.kind === 'predator') || (m.kind === 'wardens' && e.kind === 'warden')) this.progress(game, m, 1);
      }
    });
    events.on('discovery', (e) => {
      for (const m of this.active(game)) {
        if (m.kind === 'survey' && e.kind === 'fauna' && e.id.startsWith(String(m.target.planetKey))) this.progress(game, m, 1);
      }
    });
    events.on('ship:docked', () => {
      for (const m of this.active(game)) {
        if (m.kind === 'courier' && game.state.data.systemId === m.target.systemId) this.progress(game, m, 1);
      }
    });
  }

  active(game: Game): MissionState[] {
    return game.state.data.missions.filter((m) => m.status === 'active');
  }

  cycle(game: Game): number {
    return Math.floor(game.time / CYCLE);
  }

  /** Mission offers at the current system's station. */
  board(game: Game): MissionState[] {
    const sysId = game.state.data.systemId;
    const sys = game.galaxy.getSystem(sysId);
    const rng = new RNG(hashCombine(sys.seed, this.cycle(game), 0x3155));
    const out: MissionState[] = [];
    const giver = `${generateWord(rng, 2, 2)} ${rng.pick(['Guild', 'Consortium', 'Collective', 'Syndicate', 'Survey Office'])}`;
    const wealth = 0.7 + sys.wealth * 0.6;
    const planets = sys.planets;
    const kinds = ['gather', 'gather', 'survey', 'explore', 'pirates', 'predators', 'courier', 'wardens'];
    for (let i = 0; i < 5; i++) {
      const kind = rng.pick(kinds);
      const id = `m${sysId}-${this.cycle(game)}-${i}`;
      let m: MissionState | null = null;
      if (kind === 'gather') {
        const item = rng.pick(['ferrox', 'biomass', 'hydrex', 'voltium', 'silex', 'astrium', 'aerolite', 'pyrocite', 'cryolite', 'chitin', 'alloy_plate']);
        const it = getItem(item);
        const n = it.category === 'component' ? rng.int(2, 5) : rng.int(6, 16) * 10;
        m = { id, kind, title: `Supply Run: ${it.name}`, description: `Deliver ${n} ${it.name} to any station in this system.`, systemId: sysId, target: { item }, progress: 0, goal: n, reward: { credits: Math.round(it.value * n * 1.9 * wealth + 300) }, status: 'active', giver };
      } else if (kind === 'survey') {
        const p = rng.pick(planets.filter((pl) => pl.faunaDensity > 0.1).length ? planets.filter((pl) => pl.faunaDensity > 0.1) : planets);
        if (p.faunaDensity <= 0.1) continue;
        const n = rng.int(2, 3);
        m = { id, kind, title: `Xenobiology Survey: ${p.name}`, description: `Analyse ${n} new fauna species on ${p.name}.`, systemId: sysId, target: { planetKey: `${sys.seed}:${p.id}`, planet: p.name }, progress: 0, goal: n, reward: { credits: Math.round(2500 * n * wealth), items: { tech_fragment: 1 } }, status: 'active', giver };
      } else if (kind === 'explore') {
        const p = rng.pick(planets);
        const poi = rng.pick(['crash', 'ruins', 'outpost']);
        const label = { crash: 'a crash site', ruins: 'ancient ruins', outpost: 'an abandoned outpost' }[poi]!;
        m = { id, kind, title: `Reconnaissance: ${p.name}`, description: `Locate and visit ${label} on ${p.name}. Use your scanner and beacons to find it.`, systemId: sysId, target: { planetKey: `${sys.seed}:${p.id}`, planet: p.name, poi }, progress: 0, goal: 1, reward: { credits: Math.round(3000 * wealth), items: { tech_fragment: 1 } }, status: 'active', giver };
      } else if (kind === 'pirates') {
        const n = rng.int(2, 4);
        m = { id, kind, title: 'Bounty: Pirate Raiders', description: `Destroy ${n} pirate ships. Raiders will intercept you once you launch.`, systemId: sysId, target: { spawn: n }, progress: 0, goal: n, reward: { credits: Math.round(2200 * n * wealth), items: { tech_fragment: 2 } }, status: 'active', giver };
      } else if (kind === 'predators') {
        const n = rng.int(2, 4);
        m = { id, kind, title: 'Cull: Apex Predators', description: `Eliminate ${n} aggressive predators on any planet.`, systemId: sysId, target: {}, progress: 0, goal: n, reward: { credits: Math.round(1600 * n * wealth) }, status: 'active', giver };
      } else if (kind === 'wardens') {
        const n = rng.int(2, 4);
        m = { id, kind, title: 'Salvage: Warden Components', description: `Destroy ${n} Warden drones and recover their components.`, systemId: sysId, target: {}, progress: 0, goal: n, reward: { credits: Math.round(1800 * n * wealth), items: { circuit: 1 } }, status: 'active', giver };
      } else if (kind === 'courier') {
        const range = Math.max(game.state.jumpRange, 70);
        const nb = game.galaxy.neighbours(sysId, range);
        if (!nb.length) continue;
        const dest = rng.pick(nb.slice(0, 6));
        m = { id, kind, title: `Courier: ${dest.name}`, description: `Carry a sealed data package to the station in the ${dest.name} system. Requires a hyperdrive.`, systemId: sysId, target: { systemId: dest.id, system: dest.name }, progress: 0, goal: 1, reward: { credits: Math.round(9000 * wealth), items: { tech_fragment: 2 } }, status: 'active', giver };
      }
      if (m) out.push(m);
    }
    return out.filter((m) => !game.state.data.missions.some((x) => x.id === m.id));
  }

  accept(game: Game, m: MissionState): void {
    if (this.active(game).length >= 6) {
      events.emit('notify', { text: 'Mission log full (6 active)', kind: 'warn' });
      return;
    }
    game.state.data.missions.push({ ...m });
    events.emit('notify', { text: `Mission accepted: ${m.title}`, kind: 'info' });
    events.emit('mission:updated', { id: m.id });
    game.audio.play('ui_confirm');
    if (m.kind === 'pirates') game.pendingPirates += Number(m.target.spawn ?? 2);
  }

  abandon(game: Game, id: string): void {
    const m = game.state.data.missions.find((x) => x.id === id);
    if (m) m.status = 'failed';
    events.emit('mission:updated', { id });
  }

  progress(game: Game, m: MissionState, n: number): void {
    m.progress = Math.min(m.goal, m.progress + n);
    events.emit('mission:updated', { id: m.id });
    if (m.progress >= m.goal && m.kind !== 'gather') this.complete(game, m);
    else events.emit('notify', { text: `${m.title}: ${m.progress}/${m.goal}`, kind: 'info' });
  }

  /** Gather missions are turned in at a station. */
  turnIn(game: Game, m: MissionState): boolean {
    const item = String(m.target.item);
    if (game.state.count(item) < m.goal) {
      events.emit('notify', { text: `Need ${m.goal} ${getItem(item).name}`, kind: 'bad' });
      return false;
    }
    game.state.take(item, m.goal);
    m.progress = m.goal;
    this.complete(game, m);
    return true;
  }

  onPOIVisited(game: Game, planetKey: string, type: string): void {
    for (const m of this.active(game)) {
      if (m.kind === 'explore' && m.target.planetKey === planetKey && m.target.poi === type) this.progress(game, m, 1);
    }
  }

  complete(game: Game, m: MissionState): void {
    m.status = 'complete';
    game.state.addCredits(m.reward.credits);
    for (const [id, n] of Object.entries(m.reward.items ?? {})) game.state.give(id, n);
    events.emit('mission:completed', { id: m.id, title: m.title });
    events.emit('notify', { text: `Mission complete: ${m.title} · +${m.reward.credits.toLocaleString()} credits`, kind: 'good' });
    game.audio.play('discovery', 0.6);
    game.state.stat('missionsCompleted');
  }
}
