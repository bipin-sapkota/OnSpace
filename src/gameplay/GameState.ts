import { Inventory, type Slot } from './Inventory';
import { getShipClass } from '../entities/ship/ShipDefs';
import { hyperRange } from './Upgrades';
import { events } from '../core/EventBus';
import { getItem } from './Items';

/**
 * Serializable game state: everything that must survive save/load lives here.
 * Runtime systems read from and write to this object; the SaveSystem simply
 * serializes it.
 */
export type Vec3A = [number, number, number];
export type QuatA = [number, number, number, number];

export interface ShipState {
  id: string;
  classId: string;
  seed: number;
  name: string;
  hull: number;
  shield: number;
  launchFuel: number; // 0..1
  pulseFuel: number; // 0..1
  cargo: (Slot | null)[];
}

export interface DiscoveryEntry {
  id: string;
  kind: 'system' | 'planet' | 'fauna' | 'flora' | 'mineral' | 'poi';
  name: string;
  where: string;
  reward: number;
  uploaded: boolean;
  time: number;
  meta?: Record<string, string | number>;
}

export interface MissionState {
  id: string;
  kind: string;
  title: string;
  description: string;
  systemId: number;
  target: Record<string, string | number>;
  progress: number;
  goal: number;
  reward: { credits: number; items?: Record<string, number> };
  status: 'active' | 'complete' | 'failed';
  giver: string;
}

export interface SaveData {
  version: number;
  seed: number;
  created: number;
  playTime: number;
  credits: number;
  systemId: number;
  mode: 'foot' | 'ship' | 'docked';
  player: {
    pos: Vec3A;
    /** When on a planet, planet-local position is authoritative (planets spin). */
    planetId: string | null;
    localPos: Vec3A | null;
    look: [number, number]; // yaw, pitch relative to local up
    health: number;
    shield: number;
    lifeSupport: number;
    hazard: number;
    jetpack: number;
  };
  suit: (Slot | null)[];
  ships: ShipState[];
  activeShip: number;
  shipPose: {
    pos: Vec3A;
    quat: QuatA;
    landed: { planetId: string; localPos: Vec3A; localQuat: QuatA } | null;
    dockedAt: string | null;
  };
  upgrades: Record<string, number>;
  blueprints: string[];
  discoveries: DiscoveryEntry[];
  missions: MissionState[];
  missionSeq: number;
  quest: { step: number; flags: Record<string, number> };
  depleted: Record<string, string[]>;
  asteroidsDepleted: string[];
  visited: number[];
  looted: string[];
  trade: Record<string, Record<string, number>>;
  stats: Record<string, number>;
}

export const SAVE_VERSION = 1;

export function newGameData(seed: number, systemId: number): SaveData {
  const shipClass = getShipClass('shuttle');
  return {
    version: SAVE_VERSION,
    seed,
    created: Date.now(),
    playTime: 0,
    credits: 1200,
    systemId,
    mode: 'foot',
    player: { pos: [0, 0, 0], planetId: null, localPos: null, look: [0, 0], health: 100, shield: 0, lifeSupport: 0.8, hazard: 1, jetpack: 1 },
    suit: [
      { id: 'ferrox', count: 25 },
      { id: 'life_pack', count: 1 },
      null, null, null, null, null, null, null, null, null, null, null, null, null, null,
    ],
    ships: [{
      id: 'ship0', classId: 'shuttle', seed: seed ^ 0x51, name: 'Silent Heron',
      hull: shipClass.hull * 0.55, shield: 0, launchFuel: 0, pulseFuel: 0.35, cargo: new Array(shipClass.cargo).fill(null),
    }],
    activeShip: 0,
    shipPose: { pos: [0, 0, 0], quat: [0, 0, 0, 1], landed: null, dockedAt: null },
    upgrades: {},
    blueprints: [],
    discoveries: [],
    missions: [],
    missionSeq: 1,
    quest: { step: 0, flags: {} },
    depleted: {},
    asteroidsDepleted: [],
    visited: [systemId],
    looted: [],
    trade: {},
    stats: {},
  };
}

/**
 * Convenience wrapper around SaveData with derived stats and inventory
 * helpers. Systems use this rather than touching raw arrays.
 */
export class GameState {
  data: SaveData;
  suit: Inventory;
  cargo: Inventory;

  constructor(data: SaveData) {
    this.data = data;
    this.suit = new Inventory(this.suitCapacity, data.suit);
    this.cargo = new Inventory(this.cargoCapacity, this.ship.cargo);
  }

  get ship(): ShipState {
    return this.data.ships[this.data.activeShip];
  }

  get shipClass() {
    return getShipClass(this.ship.classId);
  }

  level(tech: string): number {
    return this.data.upgrades[tech] ?? 0;
  }

  get suitCapacity(): number {
    return 16 + this.level('suit_cargo') * 4;
  }

  get cargoCapacity(): number {
    return this.shipClass.cargo + this.level('ship_cargo') * 6;
  }

  get maxHull(): number {
    return this.shipClass.hull * (1 + this.level('ship_hull') * 0.3);
  }

  get maxShipShield(): number {
    return this.shipClass.shield * (1 + this.level('ship_shield') * 0.3);
  }

  get maxSuitShield(): number {
    return this.level('suit_shield') * 40;
  }

  get jumpRange(): number {
    const l = this.level('ship_hyperdrive');
    return l > 0 ? hyperRange(l) + this.shipClass.hyperBonus : 0;
  }

  hasBlueprint(id: string): boolean {
    return this.data.blueprints.includes(id);
  }

  learnBlueprint(id: string): boolean {
    if (this.hasBlueprint(id)) return false;
    this.data.blueprints.push(id);
    return true;
  }

  /** Sync inventories back into the raw save data. */
  sync(): void {
    this.data.suit = this.suit.toJSON();
    this.ship.cargo = this.cargo.toJSON();
  }

  refreshCapacities(): void {
    this.suit.resize(this.suitCapacity);
    this.cargo.resize(this.cargoCapacity);
  }

  count(id: string): number {
    return this.suit.count(id) + this.cargo.count(id);
  }

  /** Give items to the player, suit first then ship cargo. Returns amount stored. */
  give(id: string, amount: number, preferShip = false): number {
    const first = preferShip ? this.cargo : this.suit;
    const second = preferShip ? this.suit : this.cargo;
    let added = first.add(id, amount);
    if (added < amount) added += second.add(id, amount - added);
    if (added > 0) {
      events.emit('item:added', { id, amount: added, to: preferShip ? 'ship' : 'suit' });
      events.emit('inventory:changed', { which: 'suit' });
    }
    if (added < amount) events.emit('notify', { text: `Inventory full — ${amount - added} ${getItem(id).name} lost`, kind: 'warn' });
    return added;
  }

  /** Remove items from suit then ship. Returns true only if all were available. */
  take(id: string, amount: number): boolean {
    if (this.count(id) < amount) return false;
    let left = amount - this.suit.remove(id, amount);
    if (left > 0) left -= this.cargo.remove(id, left);
    events.emit('item:removed', { id, amount });
    events.emit('inventory:changed', { which: 'suit' });
    return left <= 0;
  }

  canAfford(items: Record<string, number>, credits = 0): boolean {
    if (this.data.credits < credits) return false;
    for (const [id, n] of Object.entries(items)) if (this.count(id) < n) return false;
    return true;
  }

  pay(items: Record<string, number>, credits = 0): boolean {
    if (!this.canAfford(items, credits)) return false;
    for (const [id, n] of Object.entries(items)) this.take(id, n);
    if (credits) this.addCredits(-credits);
    return true;
  }

  addCredits(delta: number): void {
    this.data.credits = Math.max(0, Math.round(this.data.credits + delta));
    events.emit('credits:changed', { value: this.data.credits, delta });
  }

  stat(key: string, add = 1): void {
    this.data.stats[key] = (this.data.stats[key] ?? 0) + add;
  }

  depletedSet(key: string): Set<string> {
    // live Set backed by the save array
    const arr = (this.data.depleted[key] ??= []);
    const set = new Set(arr);
    const origAdd = set.add.bind(set);
    set.add = (v: string) => {
      if (!set.has(v)) arr.push(v);
      return origAdd(v);
    };
    return set;
  }
}
