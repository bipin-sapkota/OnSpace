import type { Game } from '../core/Game';
import { allItems, getItem, type ItemDef } from './Items';
import { hashCombine } from '../core/Random';
import type { EconomyType } from '../universe/types';
import { events } from '../core/EventBus';

/**
 * Per-system trade economy. Prices derive from item value, the system's
 * economy type and wealth, a deterministic local variance, and a supply
 * pressure term that reacts to the player's trading and recovers over time.
 */
const ECON_MOD: Record<EconomyType, (it: ItemDef) => number> = {
  mining: (it) => (it.category === 'resource' ? 0.82 : 1.08),
  industrial: (it) => (it.category === 'component' ? 1.22 : it.category === 'resource' ? 0.95 : 1),
  scientific: (it) => (it.category === 'trade' || it.id === 'nullite' ? 1.3 : 1),
  trading: () => 1.0,
  agricultural: (it) => (it.id === 'biomass' || it.id === 'aerolite' ? 0.7 : it.category === 'component' ? 1.1 : 1),
  lawless: (it) => (it.category === 'trade' ? 1.35 : 1.1),
};

export const ECON_LABEL: Record<EconomyType, string> = {
  mining: 'Mining',
  industrial: 'Industrial',
  scientific: 'Scientific',
  trading: 'Trade Hub',
  agricultural: 'Agricultural',
  lawless: 'Lawless',
};

export class Economy {
  price(game: Game, itemId: string, systemId = game.state.data.systemId): number {
    const sys = game.galaxy.getSystem(systemId);
    const it = getItem(itemId);
    const variance = 0.85 + ((hashCombine(sys.seed, itemId.length, itemId.charCodeAt(0), itemId.charCodeAt(1)) % 1000) / 1000) * 0.3;
    const pressure = game.state.data.trade[systemId]?.[itemId] ?? 0;
    const wealth = 0.8 + sys.wealth * 0.35;
    return Math.max(1, it.value * ECON_MOD[sys.economy](it) * variance * wealth * (1 + pressure));
  }

  buyPrice(game: Game, id: string): number {
    const spread = game.galaxy.getSystem(game.state.data.systemId).economy === 'trading' ? 1.06 : 1.15;
    return Math.ceil(this.price(game, id) * spread);
  }

  sellPrice(game: Game, id: string): number {
    const spread = game.galaxy.getSystem(game.state.data.systemId).economy === 'trading' ? 0.94 : 0.85;
    return Math.floor(this.price(game, id) * spread);
  }

  /** Items this station stocks. */
  stock(game: Game): string[] {
    const sys = game.galaxy.getSystem(game.state.data.systemId);
    const list = allItems()
      .filter((i) => i.category !== 'special' || i.id === 'tech_fragment')
      .filter((i) => i.category !== 'trade')
      .filter((i) => (hashCombine(sys.seed, i.id.charCodeAt(0), i.id.length) % 100) < 75 || i.rarity === 0 || i.id === 'tech_fragment');
    return list.map((i) => i.id);
  }

  private pressure(game: Game, id: string, delta: number): void {
    const t = (game.state.data.trade[game.state.data.systemId] ??= {});
    t[id] = Math.max(-0.45, Math.min(0.6, (t[id] ?? 0) + delta));
  }

  buy(game: Game, id: string, n: number): boolean {
    const cost = this.buyPrice(game, id) * n;
    if (game.state.data.credits < cost) {
      events.emit('notify', { text: 'Insufficient credits', kind: 'bad' });
      return false;
    }
    const space = game.state.suit.spaceFor(id) + game.state.cargo.spaceFor(id);
    if (space < n) {
      events.emit('notify', { text: 'Not enough inventory space', kind: 'bad' });
      return false;
    }
    game.state.addCredits(-cost);
    game.state.give(id, n);
    this.pressure(game, id, n * 0.002);
    return true;
  }

  sell(game: Game, id: string, n: number): boolean {
    const have = game.state.count(id);
    n = Math.min(n, have);
    if (n <= 0) return false;
    const gain = this.sellPrice(game, id) * n;
    game.state.take(id, n);
    game.state.addCredits(gain);
    this.pressure(game, id, -n * 0.0025);
    game.state.stat('traded', gain);
    return true;
  }

  /** Market recovery over time. */
  update(dt: number, game: Game): void {
    for (const sys of Object.values(game.state.data.trade)) {
      for (const k of Object.keys(sys)) {
        const v = sys[k];
        sys[k] = Math.abs(v) < 0.001 ? 0 : v - Math.sign(v) * Math.min(Math.abs(v), dt * 0.0004);
      }
    }
  }
}
