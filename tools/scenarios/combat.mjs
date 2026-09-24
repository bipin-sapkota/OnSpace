import { lowSettings, startGame, sim } from './common.mjs';
export default async (page, shot) => {
  await lowSettings(page);
  await startGame(page);
  // storm
  await page.evaluate(() => { const g = window.game; const p = g.player.planet; const w = g.weather.stateFor(p); w.kind = 'rain'; w.target = 1; w.intensity = 1; w.storm = true; w.timer = 999; g.player.pitch = 0.1; });
  await sim(page, 1);
  await shot('c1_storm');
  // wardens
  const wl = await page.evaluate(() => { const g = window.game; g.player.planet.desc.wardenLevel = 0.8; g.wardens.raise(g, 1.3, g.player.pos); return g.wardens.stars; });
  console.log('warden stars', wl);
  await sim(page, 4);
  await page.evaluate(() => { const g = window.game; g.cameraRig.thirdPersonFoot = true; g.player.pitch = 0.25; });
  await sim(page, 0.2);
  await shot('c2_wardens');
  console.log(JSON.stringify(await page.evaluate(() => ({ health: window.game.player.health, hostiles: window.game.wardens.activeHostiles }))));
  await page.evaluate(() => { const g = window.game; g.cameraRig.thirdPersonFoot = false; const w = g.weather.stateFor(g.player.planet); w.target = 0; w.intensity = 0; w.storm = false; });
  // signal monolith
  const mono = await page.evaluate(() => {
    const g = window.game; const planet = g.world.system.planets.find(p => p.desc.hasSignal);
    const poi = g.pois.generate(planet, g).find(p => p.isSignal);
    const up = poi.dir.clone(); const side = new up.constructor(0, 1, 0).cross(up).normalize();
    const u = planet.toUniverse(poi.local.clone().addScaledVector(side, 22));
    g.player.placeAt(u, planet, planet.toUniverse(poi.local).sub(u));
    g.player.pitch = 0.15;
    return planet.desc.name + ' ' + planet.desc.archetype;
  });
  console.log('mono on', mono);
  for (let i = 0; i < 8; i++) { await page.waitForTimeout(4000); await sim(page, 0.3); }
  await shot('c3_monolith');
  await page.evaluate(() => { const g = window.game; const pl = g.player.planet; const poi = g.pois.pois.find(p => p.isSignal); const it = poi.interactables[0]; if (it) it.action(g); });
  await page.waitForTimeout(500);
  await shot('c4_lore');
  console.log(JSON.stringify(await page.evaluate(() => ({ bp: window.game.state.data.blueprints, quest: window.game.quest.title(window.game) }))));
  await page.evaluate(() => window.game.ui.closeAll());
  // space combat
  await page.evaluate(() => { const g = window.game; g.boardShip(); const p = g.world.system.planets[0]; g.ship.landedPlanet = null; g.ship.pos.copy(p.position).add(new p.position.constructor(0, p.radius + 9000, 0)); g.ship.setMode('flying'); g.npcs.spawnPirates(g, 3); });
  await sim(page, 6, "g.input['down'].add('Mouse0'); Object.defineProperty(g.input, 'locked', { get: () => true, configurable: true });");
  await page.waitForTimeout(2000); await sim(page, 0.2);
  await shot('c5_dogfight');
  console.log(JSON.stringify(await page.evaluate(() => ({ hull: window.game.state.ship.hull, pirates: window.game.npcs.hostileCount, lock: !!window.game.lockedTarget }))));
};
