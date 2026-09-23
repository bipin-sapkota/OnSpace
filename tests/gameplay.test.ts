import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Inventory } from '../src/gameplay/Inventory';
import { allTech, getTech } from '../src/gameplay/Upgrades';
import { allRecipes } from '../src/gameplay/Crafting';
import { getItem, hasItemDef } from '../src/gameplay/Items';

test('inventory stacks, overflows and removes correctly', () => {
  const inv = new Inventory(2);
  assert.equal(inv.add('ferrox', 300), 300); // 250 + 50
  assert.equal(inv.count('ferrox'), 300);
  assert.equal(inv.add('ferrox', 500), 200); // only 200 more fits
  assert.equal(inv.add('biomass', 1), 0); // full
  assert.equal(inv.remove('ferrox', 260), 260);
  assert.equal(inv.count('ferrox'), 240);
  inv.sort();
  assert.equal(inv.usedSlots, 1);
});

test('all recipes and tech costs reference known items', () => {
  for (const r of allRecipes()) {
    assert.ok(hasItemDef(r.output), r.output);
    for (const id of Object.keys(r.inputs)) assert.ok(hasItemDef(id), id);
  }
  for (const t of allTech()) {
    for (let l = 1; l <= t.maxLevel; l++) {
      const c = t.cost(l);
      assert.ok(c.credits > 0);
      for (const id of Object.keys(c.items)) assert.ok(hasItemDef(id), `${t.id}: ${id}`);
    }
  }
});

test('tech costs escalate with level', () => {
  const t = getTech('ship_hull');
  assert.ok(t.cost(2).credits > t.cost(1).credits);
  assert.equal(getItem('warp_cell').category, 'consumable');
});
