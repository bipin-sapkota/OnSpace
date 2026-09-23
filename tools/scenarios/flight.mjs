import { lowSettings, startGame, sim } from './common.mjs';
const wait = (page, ms) => page.waitForTimeout(ms);
export default async (page, shot) => {
  await lowSettings(page);
  await startGame(page);
  await page.evaluate(() => { const g = window.game; g.player.pos.copy(g.ship.pos); g.boardShip(); g.state.ship.launchFuel = 1; });
  await sim(page, 1.5);
  await shot('f1_board');
  await page.evaluate(() => { const g = window.game; g.ship.tryLaunch(g); });
  await sim(page, 2.5);
  await shot('f2_launch');
  await sim(page, 1.5);
  // pitch up and throttle
  await page.evaluate(() => { const g = window.game; g.ship.throttle = 1; });
  await sim(page, 4, "g.ship.stick.y = -0.5; g.ship.throttle = 1;");
  await wait(page, 3000); await sim(page, 0.2);
  await shot('f3_climb');
  console.log(JSON.stringify(await page.evaluate(() => { const g = window.game; return { mode: g.ship.mode, alt: g.ship.altitude, speed: g.ship.speed, inAtmo: g.world.env.inAtmosphere }; })));
  // teleport to high orbit looking at planet
  await page.evaluate(() => { const g = window.game; const p = g.world.system.planets[0]; const up = g.ship.pos.clone().sub(p.position).normalize(); g.ship.pos.copy(p.position).addScaledVector(up, p.radius + 5000); g.ship.throttle = 0; g.ship.vel.set(0,0,0); });
  await sim(page, 1);
  await wait(page, 4000); await sim(page, 0.3);
  await shot('f4_orbit');
  // go near station and dock
  await page.evaluate(() => { const g = window.game; const s = g.world.system.stations[0]; const e = s.toUniverse(s.bayEntrance.clone().add(s.bayEntrance.clone().normalize().multiplyScalar(500))); g.ship.pos.copy(e); g.ship.quat.setFromRotationMatrix(new g.ship.pos.constructor().constructor === undefined ? null : new (g.renderer.camera.matrix.constructor)().lookAt(e, s.position, new g.ship.pos.constructor(0,1,0))); g.ship.vel.set(0,0,0); g.ship.throttle = 0; });
  await sim(page, 1);
  await wait(page, 3000); await sim(page, 0.2);
  await shot('f5_station');
  await page.evaluate(() => { const g = window.game; const s = g.world.system.stations[0]; g.ship.beginDocking(s); });
  await sim(page, 8);
  await wait(page, 1500);
  await shot('f6_docked');
  console.log(JSON.stringify(await page.evaluate(() => ({ mode: window.game.mode, ship: window.game.ship.mode }))));
};
