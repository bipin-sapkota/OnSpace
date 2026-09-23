/**
 * Technology upgrade registry. Each tech has levels with escalating costs and
 * produces stat modifiers consumed by player/ship/tool systems through
 * `stat()`. New tech can be registered without touching consumers.
 */
export type TechGroup = 'suit' | 'tool' | 'ship';

export interface Cost {
  items: Record<string, number>;
  credits: number;
}

export interface TechDef {
  id: string;
  group: TechGroup;
  name: string;
  description: string;
  maxLevel: number;
  /** Blueprint that must be known before level 1 can be installed. */
  requires?: string;
  cost(level: number): Cost;
  /** Per-level effect description. */
  effect(level: number): string;
}

const techs = new Map<string, TechDef>();

export function registerTech(t: TechDef): void {
  techs.set(t.id, t);
}

export function getTech(id: string): TechDef {
  const t = techs.get(id);
  if (!t) throw new Error(`Unknown tech ${id}`);
  return t;
}

export function allTech(): TechDef[] {
  return [...techs.values()];
}

const scale = (base: Record<string, number>, level: number, credits: number, fragBase = 0): Cost => {
  const items: Record<string, number> = {};
  for (const [k, v] of Object.entries(base)) items[k] = Math.round(v * (1 + (level - 1) * 0.9));
  if (fragBase > 0) items.tech_fragment = Math.round(fragBase * level);
  return { items, credits: Math.round(credits * Math.pow(level, 1.6)) };
};

registerTech({
  id: 'suit_life', group: 'suit', name: 'Life Support Array', maxLevel: 4,
  description: 'Larger oxygen reserves and more efficient recycling.',
  cost: (l) => scale({ aerolite: 40, ferrox: 40 }, l, 2500, 1),
  effect: (l) => `+${l * 35}% life support capacity`,
});
registerTech({
  id: 'suit_hazard', group: 'suit', name: 'Hazard Shielding', maxLevel: 4,
  description: 'Environmental shielding against heat, cold, toxins and radiation.',
  cost: (l) => scale({ silex: 40, voltium: 20 }, l, 3000, 1),
  effect: (l) => `-${l * 18}% hazard drain`,
});
registerTech({
  id: 'suit_jetpack', group: 'suit', name: 'Jetpack Thrusters', maxLevel: 4,
  description: 'Stronger jetpack thrust and larger fuel reserve.',
  cost: (l) => scale({ hydrex: 40, ferrox: 30 }, l, 2000, 1),
  effect: (l) => `+${l * 30}% jetpack power & fuel`,
});
registerTech({
  id: 'suit_cargo', group: 'suit', name: 'Exosuit Cargo Pods', maxLevel: 5,
  description: 'Additional inventory slots in your exosuit.',
  cost: (l) => scale({ ferrox: 50, alloy_plate: 1 }, l, 5000, 1),
  effect: (l) => `+${l * 4} suit slots`,
});
registerTech({
  id: 'suit_shield', group: 'suit', name: 'Personal Deflector', maxLevel: 3,
  description: 'An energy barrier that absorbs damage before your health.',
  cost: (l) => scale({ voltium: 40, alloy_plate: 1 }, l, 4000, 2),
  effect: (l) => `+${l * 40} personal shield`,
});
registerTech({
  id: 'tool_mining', group: 'tool', name: 'Mining Beam Amplifier', maxLevel: 4,
  description: 'Faster mining and slower beam overheating.',
  cost: (l) => scale({ ferrox: 50, voltium: 20 }, l, 2500, 1),
  effect: (l) => `+${l * 35}% mining speed`,
});
registerTech({
  id: 'tool_blaster', group: 'tool', name: 'Boltcaster Coils', maxLevel: 4,
  description: 'More powerful combat bolts.',
  cost: (l) => scale({ ferrox: 40, voltium: 30 }, l, 3500, 2),
  effect: (l) => `+${l * 30}% weapon damage`,
});
registerTech({
  id: 'tool_scanner', group: 'tool', name: 'Survey Scanner', maxLevel: 3,
  description: 'Longer scanner range and richer survey data.',
  cost: (l) => scale({ voltium: 20, biomass: 30 }, l, 2000, 1),
  effect: (l) => `+${l * 50}% scan range, +${l * 25}% discovery rewards`,
});
registerTech({
  id: 'ship_hull', group: 'ship', name: 'Reinforced Hull', maxLevel: 4,
  description: 'Heavier plating for your starship.',
  cost: (l) => scale({ ferrox: 80, alloy_plate: 2 }, l, 6000, 2),
  effect: (l) => `+${l * 30}% hull`,
});
registerTech({
  id: 'ship_shield', group: 'ship', name: 'Deflector Grid', maxLevel: 4,
  description: 'Stronger starship shields with faster regeneration.',
  cost: (l) => scale({ voltium: 60, alloy_plate: 1 }, l, 6000, 2),
  effect: (l) => `+${l * 30}% ship shields`,
});
registerTech({
  id: 'ship_lasers', group: 'ship', name: 'Photon Cannons', maxLevel: 4,
  description: 'Higher damage starship cannons and mining lasers.',
  cost: (l) => scale({ voltium: 50, ferrox: 50 }, l, 7000, 2),
  effect: (l) => `+${l * 30}% ship weapon damage`,
});
registerTech({
  id: 'ship_thrusters', group: 'ship', name: 'Vector Thrusters', maxLevel: 4,
  description: 'Improved speed and manoeuvrability.',
  cost: (l) => scale({ hydrex: 60, alloy_plate: 1 }, l, 6000, 1),
  effect: (l) => `+${l * 12}% speed, +${l * 10}% agility`,
});
registerTech({
  id: 'ship_pulse', group: 'ship', name: 'Pulse Drive Tuning', maxLevel: 3,
  description: 'More efficient and faster pulse drive.',
  cost: (l) => scale({ astrium: 60, voltium: 20 }, l, 5000, 1),
  effect: (l) => `-${l * 25}% pulse fuel use, +${l * 15}% pulse speed`,
});
registerTech({
  id: 'ship_hyperdrive', group: 'ship', name: 'Hyperdrive', maxLevel: 4,
  requires: 'hyperdrive',
  description: 'Faster-than-light engine. Each level extends jump range.',
  cost: (l) => scale({ alloy_plate: 2, circuit: 1, nullite: 15 }, l, 5000, 2),
  effect: (l) => `Jump range ${hyperRange(l)} ly`,
});
registerTech({
  id: 'ship_cargo', group: 'ship', name: 'Cargo Bulkheads', maxLevel: 4,
  description: 'Additional cargo slots in your ship.',
  cost: (l) => scale({ alloy_plate: 2, ferrox: 60 }, l, 8000, 1),
  effect: (l) => `+${l * 6} cargo slots`,
});

export function hyperRange(level: number): number {
  return level <= 0 ? 0 : [0, 70, 120, 190, 300][Math.min(4, level)];
}
