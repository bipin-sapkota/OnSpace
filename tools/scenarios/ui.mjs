import { lowSettings, startGame, sim } from './common.mjs';
export default async (page, shot) => {
  await lowSettings(page);
  await startGame(page);
  await page.evaluate(() => { const g = window.game; g.state.give('hydrex', 60); g.state.give('voltium', 40); g.state.give('aerolite', 30); });
  await page.evaluate(() => window.game.ui.openExosuit('inventory'));
  await page.click('[data-action="slot:suit-0"]');
  await page.waitForTimeout(500); await shot('u1_inv');
  await page.click('[data-action="tab:crafting"]'); await page.waitForTimeout(500); await shot('u2_craft');
  await page.click('[data-action="craft:r_launch|1"]');
  await page.click('[data-action="tab:tech"]'); await page.waitForTimeout(500); await shot('u3_tech');
  await page.click('[data-action="tab:ship"]'); await page.waitForTimeout(500); await shot('u4_ship');
  await page.evaluate(() => window.game.ui.closeAll());
  await page.evaluate(() => window.game.ui.openMap());
  await page.waitForTimeout(3000); await shot('u5_map');
  await page.click('[data-action="tab:system"]'); await page.waitForTimeout(800); await shot('u6_sysmap');
  await page.evaluate(() => window.game.ui.closeAll());
  await page.evaluate(() => window.game.ui.openGalaxy());
  await page.waitForTimeout(3000); await page.mouse.click(640, 360); await page.waitForTimeout(2000); await shot('u7_galaxy');
  await page.evaluate(() => window.game.ui.closeAll());
  // mining test
  const r = await page.evaluate(() => {
    const g = window.game; const p = g.player; const planet = p.planet; const T = p.pos.constructor;
    const local = planet.toLocal(p.pos);
    let best = null; for (const rec of planet.scatter.nearby(local, 60)) { if (rec.item && (!best || rec.pos.distanceTo(local) < best.pos.distanceTo(local))) best = rec; }
    if (!best) return 'no target';
    // stand 4m from it and face it
    const target = planet.toUniverse(best.pos.clone().addScaledVector(best.up, 0.5));
    const up = planet.toUniverse(best.pos).sub(planet.position).normalize();
    const side = new T(1, 0, 0); side.addScaledVector(up, -side.dot(up)).normalize();
    p.placeAt(target.clone().addScaledVector(side, 3 + best.scale), planet, side.clone().negate());
    window.__rec = best; return { type: best.type, item: best.item, h: best.health };
  });
  console.log('target', JSON.stringify(r));
  await sim(page, 0.1);
  await page.evaluate(() => { const g = window.game; const rec = window.__rec; const p = g.player; const eye = p.eye; const tgt = g.player.planet.toUniverse(rec.pos.clone().addScaledVector(rec.up, rec.scale * 0.8)); const dir = tgt.sub(eye).normalize(); const f = p.forward; const up = p.up; p.pitch = Math.asin(Math.max(-1, Math.min(1, dir.dot(up)))); });
  await page.evaluate(() => { const i = window.game.input; Object.defineProperty(i, 'locked', { get: () => true }); });
  await sim(page, 4, "g.input.down = g.input.down || new Set(); g.input['down'].add('Mouse0');");
  await shot('u8_mine');
  console.log(JSON.stringify(await page.evaluate(() => ({ dep: window.__rec.depleted, heat: window.game.mining.heat, inv: window.game.state.count(window.__rec.item), creatures: window.game.creatures.creatures.length, target: !!window.game.mining.target }))));
  await sim(page, 20, "g.input['down'].delete('Mouse0');");
  await page.waitForTimeout(3000);
  await sim(page, 0.2);
  console.log(JSON.stringify(await page.evaluate(() => ({ creatures: window.game.creatures.creatures.map(c => c.species.name + ':' + c.local.distanceTo(window.game.player.planet.toLocal(window.game.player.pos)).toFixed(0)).slice(0, 6) }))));
  await page.evaluate(() => { const g = window.game; const c = g.creatures.creatures[0]; if (c) { g.cameraRig.thirdPersonFoot = true; const p = g.player; p.placeAt(c.pos.clone().addScaledVector(p.up, 0).add(new p.pos.constructor(0,0,0)), p.planet); } });
  await page.evaluate(() => { const g = window.game; const c = g.creatures.creatures[0]; if (!c) return; const p = g.player; const up = p.up; const d = new p.pos.constructor().randomDirection(); d.addScaledVector(up, -d.dot(up)).normalize(); p.placeAt(c.pos.clone().addScaledVector(d, 8 + c.species.size * 3), p.planet, d.clone().negate()); g.cameraRig.thirdPersonFoot = false; p.pitch = -0.1; });
  await sim(page, 0.3);
  await shot('u9_creature');
};
