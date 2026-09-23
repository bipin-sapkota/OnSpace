/**
 * Item registry. All resources, crafted components, consumables and trade goods
 * are defined as data here. New items can be registered from anywhere via
 * `registerItem` without touching the systems that use them.
 */
export type ItemCategory = 'resource' | 'component' | 'consumable' | 'trade' | 'special';

export interface ItemDef {
  id: string;
  name: string;
  symbol: string;
  category: ItemCategory;
  color: string;
  stack: number;
  value: number;
  description: string;
  rarity: 0 | 1 | 2 | 3; // common, uncommon, rare, exotic
}

const registry = new Map<string, ItemDef>();

export function registerItem(def: ItemDef): void {
  registry.set(def.id, def);
}

export function getItem(id: string): ItemDef {
  const d = registry.get(id);
  if (!d) throw new Error(`Unknown item: ${id}`);
  return d;
}

export function hasItemDef(id: string): boolean {
  return registry.has(id);
}

export function allItems(): ItemDef[] {
  return [...registry.values()];
}

const R = (id: string, name: string, symbol: string, color: string, value: number, rarity: ItemDef['rarity'], description: string): ItemDef => ({
  id, name, symbol, category: 'resource', color, stack: 250, value, description, rarity,
});

[
  R('ferrox', 'Ferrox', 'Fx', '#9aa3ad', 12, 0, 'Iron-rich mineral dust mined from common rock formations. The backbone of every build.'),
  R('biomass', 'Biomass', 'Bm', '#6fbf5a', 10, 0, 'Dense organic matter harvested from flora. Burns clean and feeds life-support processing.'),
  R('aerolite', 'Aerolite', 'Ae', '#e5584f', 18, 0, 'Oxygen-bearing crystals grown inside crimson plants. Recharges life support.'),
  R('hydrex', 'Hydrex', 'Hx', '#4fb2ff', 22, 0, 'Blue hydrogen crystal. Refined into launch fuel.'),
  R('voltium', 'Voltium', 'Vt', '#ffd34f', 28, 1, 'Energetic mineral that holds charge. Powers shields and electronics.'),
  R('silex', 'Silex', 'Sx', '#d8c08c', 14, 0, 'Silica-rich sand and stone common on arid and rocky worlds.'),
  R('pyrocite', 'Pyrocite', 'Py', '#ff7a2f', 42, 1, 'Heat-saturated crystal from scorched worlds. Absorbs thermal hazards.'),
  R('cryolite', 'Cryolite', 'Cr', '#bdf3ff', 42, 1, 'Supercooled mineral from frozen worlds. Buffers against extreme heat loss.'),
  R('toxalite', 'Toxalite', 'Tx', '#b4e04a', 42, 1, 'Reactive mineral from caustic worlds. Neutralises toxins.'),
  R('astrium', 'Astrium', 'As', '#c7b8ff', 30, 0, 'Metallic ore from asteroid cores. Fuels the pulse drive.'),
  R('nullite', 'Nullite', 'Nu', '#b04fff', 140, 2, 'An exotic mineral that bends space around it. Essential for warp cells.'),
  R('aurium', 'Aurium', 'Au', '#ffc24a', 260, 2, 'A rare precious metal prized by every trader in the galaxy.'),
  R('chitin', 'Chitin', 'Ch', '#d7a57a', 35, 1, 'Tough organic plating recovered from fauna.'),
].forEach(registerItem);

const C = (id: string, name: string, symbol: string, color: string, value: number, rarity: ItemDef['rarity'], description: string, category: ItemCategory = 'component', stack = 20): ItemDef => ({
  id, name, symbol, category, color, stack, value, description, rarity,
});

[
  C('alloy_plate', 'Alloy Plate', 'AP', '#aab7c9', 180, 1, 'Pressed ferrox and voltium composite. Used in repairs and upgrades.'),
  C('circuit', 'Circuit Lattice', 'CL', '#6ff0d0', 520, 2, 'Precision conductive lattice for advanced technology.'),
  C('launch_fuel', 'Launch Fuel Cell', 'LF', '#4fb2ff', 160, 0, 'Pressurised hydrex. Fully recharges launch thrusters.', 'consumable'),
  C('warp_cell', 'Warp Cell', 'WC', '#b04fff', 1800, 2, 'Contained nullite resonance. Powers a single hyperdrive jump.', 'consumable', 5),
  C('life_pack', 'Life Pack', 'LP', '#e5584f', 140, 0, 'Compressed breathable atmosphere. Restores life support.', 'consumable'),
  C('shield_cell', 'Shield Cell', 'SC', '#ffd34f', 190, 0, 'Charges personal and starship shields.', 'consumable'),
  C('hazard_pack', 'Hazard Pack', 'HP', '#ff9f3f', 170, 0, 'Universal environmental buffer. Restores hazard protection.', 'consumable'),
  C('tech_fragment', 'Tech Fragment', 'TF', '#62e3ff', 400, 2, 'Salvaged fragments of forgotten technology. Required for upgrades.', 'special', 999),
  C('veil_relic', 'Veil Relic', 'VR', '#f0e1ff', 2500, 3, 'An artifact of the vanished Veil civilisation. Collectors pay fortunes.', 'trade', 10),
  C('data_core', 'Data Core', 'DC', '#7fd0ff', 900, 2, 'Encrypted archive salvaged from a wreck. Stations buy them eagerly.', 'trade', 10),
].forEach(registerItem);

/** Which resources can be recharged into which gauges, and how much each unit adds (0..1 scale). */
export const RECHARGE_TABLE: Record<string, Record<string, number>> = {
  lifeSupport: { aerolite: 0.02, life_pack: 0.5 },
  hazard: { pyrocite: 0.03, cryolite: 0.03, toxalite: 0.03, hazard_pack: 0.5 },
  suitShield: { voltium: 0.02, shield_cell: 0.5 },
  jetpack: {},
  launch: { hydrex: 0.02, launch_fuel: 1.0 },
  pulse: { astrium: 0.01 },
  shipShield: { voltium: 0.015, shield_cell: 0.4 },
  hull: { ferrox: 0.004, alloy_plate: 0.25 },
};
