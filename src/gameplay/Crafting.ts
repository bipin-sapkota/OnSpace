/**
 * Crafting recipe registry.
 */
export interface Recipe {
  id: string;
  output: string;
  amount: number;
  inputs: Record<string, number>;
  /** Blueprint required, if any. */
  blueprint?: string;
  time: number;
}

const recipes: Recipe[] = [];

export function registerRecipe(r: Recipe): void {
  recipes.push(r);
}

export function allRecipes(): Recipe[] {
  return recipes;
}

const BASE_RECIPES: Recipe[] = [
  { id: 'r_launch', output: 'launch_fuel', amount: 1, inputs: { hydrex: 40, ferrox: 20 }, time: 1 },
  { id: 'r_life', output: 'life_pack', amount: 1, inputs: { aerolite: 25, biomass: 20 }, time: 1 },
  { id: 'r_shield', output: 'shield_cell', amount: 1, inputs: { voltium: 30, ferrox: 20 }, time: 1 },
  { id: 'r_hazard', output: 'hazard_pack', amount: 1, inputs: { silex: 30, voltium: 10 }, time: 1 },
  { id: 'r_alloy', output: 'alloy_plate', amount: 1, inputs: { ferrox: 30, voltium: 10 }, time: 1.5 },
  { id: 'r_circuit', output: 'circuit', amount: 1, inputs: { voltium: 25, aurium: 2, alloy_plate: 1 }, blueprint: 'circuit', time: 2 },
  { id: 'r_warp', output: 'warp_cell', amount: 1, inputs: { nullite: 12, astrium: 50, alloy_plate: 1 }, blueprint: 'warp_cell', time: 2.5 },
];
BASE_RECIPES.forEach(registerRecipe);
