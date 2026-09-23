/**
 * Starship class definitions. Ship classes differ in handling, speed,
 * durability, cargo and drive efficiency, and in their procedural hull style.
 */
export interface ShipClass {
  id: string;
  name: string;
  role: string;
  description: string;
  price: number;
  hull: number;
  shield: number;
  speed: number; // cruise m/s in space
  boost: number; // boost multiplier
  agility: number; // rad/s turn rate factor
  cargo: number;
  damage: number;
  pulseEfficiency: number;
  hyperBonus: number; // ly added to range
  style: 'shuttle' | 'fighter' | 'hauler' | 'explorer' | 'exotic';
}

const classes = new Map<string, ShipClass>();

export function registerShipClass(c: ShipClass): void {
  classes.set(c.id, c);
}
export function getShipClass(id: string): ShipClass {
  return classes.get(id) ?? classes.get('shuttle')!;
}
export function allShipClasses(): ShipClass[] {
  return [...classes.values()];
}

registerShipClass({
  id: 'shuttle', name: 'Wayfarer Shuttle', role: 'Balanced', style: 'shuttle',
  description: 'A dependable all-rounder. Nothing fancy, nothing broken — mostly.',
  price: 25000, hull: 200, shield: 100, speed: 220, boost: 2.2, agility: 1.0, cargo: 12, damage: 1.0, pulseEfficiency: 1.0, hyperBonus: 0,
});
registerShipClass({
  id: 'fighter', name: 'Talon Interceptor', role: 'Combat', style: 'fighter',
  description: 'Agile and heavily armed. Built to win dogfights, not to haul ore.',
  price: 85000, hull: 240, shield: 180, speed: 270, boost: 2.6, agility: 1.45, cargo: 8, damage: 1.6, pulseEfficiency: 0.9, hyperBonus: 0,
});
registerShipClass({
  id: 'hauler', name: 'Bastion Hauler', role: 'Cargo', style: 'hauler',
  description: 'A flying warehouse with armour to match. Slow to turn, hard to kill.',
  price: 110000, hull: 420, shield: 160, speed: 190, boost: 2.0, agility: 0.7, cargo: 32, damage: 0.9, pulseEfficiency: 1.1, hyperBonus: 20,
});
registerShipClass({
  id: 'explorer', name: 'Pathfinder Explorer', role: 'Exploration', style: 'explorer',
  description: 'Long-range drives and efficient pulse engines for deep space surveys.',
  price: 140000, hull: 220, shield: 140, speed: 240, boost: 2.4, agility: 1.1, cargo: 18, damage: 1.0, pulseEfficiency: 1.6, hyperBonus: 80,
});
registerShipClass({
  id: 'exotic', name: 'Veilwing', role: 'Exotic', style: 'exotic',
  description: 'Grown, not built. Its hull remembers the Veil. Excels at everything.',
  price: 480000, hull: 320, shield: 260, speed: 300, boost: 2.8, agility: 1.35, cargo: 22, damage: 1.5, pulseEfficiency: 1.4, hyperBonus: 120,
});
