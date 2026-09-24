import { lowSettings, startGame, sim } from './common.mjs';
export default async (page, shot) => {
  await lowSettings(page);
  await startGame(page);
  await page.evaluate(() => { const g = window.game; g.player.damage(500, 'test', g); });
  await sim(page, 1);
  await shot('d1_dead');
  await page.click('#death [data-r]');
  await sim(page, 0.5);
  console.log(JSON.stringify(await page.evaluate(() => ({ mode: window.game.mode, hp: window.game.player.health, dShip: Math.round(window.game.player.pos.distanceTo(window.game.ship.pos)) }))));
  // dock and save
  await page.evaluate(() => { const g = window.game; g.boardShip(); const s = g.world.system.stations[0]; g.ship.landedPlanet = null; g.ship.pos.copy(s.toUniverse(s.bayEntrance)); g.ship.setMode('flying'); g.ship.beginDocking(s); });
  await sim(page, 8);
  console.log('saved', await page.evaluate(() => window.game.save('slot3')));
  await page.reload();
  await page.waitForSelector('[data-m="load"]');
  await page.click('[data-m="load"]');
  await page.click('[data-action="load:slot3"]');
  await page.waitForFunction(() => window.game && window.game.isPlaying && !document.getElementById('loading'), null, { timeout: 300000 });
  await sim(page, 0.5);
  await shot('d2_loaded_docked');
  console.log(JSON.stringify(await page.evaluate(() => ({ mode: window.game.mode, ship: window.game.ship.mode, station: !!document.querySelector('.screen .window h2') }))));
};
