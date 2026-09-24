import { lowSettings, startGame, sim } from './common.mjs';
export default async (page, shot) => {
  await lowSettings(page);
  await startGame(page);
  await page.evaluate(() => { const g = window.game; g.boardShip(); const p = g.world.system.planets[0]; g.ship.landedPlanet = null; g.ship.pos.copy(p.position).add(new p.position.constructor(0, p.radius + 7000, 0)); g.ship.setMode('flying'); g.ship.throttle = 1; });
  await sim(page, 3, "g.ship.throttle = 1;");
  await page.waitForTimeout(2000); await sim(page, 0.1, "g.ship.throttle = 1;");
  await shot('v1_ship');
  for (const cls of ['fighter', 'hauler', 'explorer', 'exotic']) {
    await page.evaluate((c) => { const g = window.game; g.ship.rebuild(c, 1234); }, cls);
    await sim(page, 0.3, "g.ship.throttle = 0.6;");
    await shot('v_' + cls);
  }
};
