import { lowSettings, startGame, sim } from './common.mjs';
async function visit(page, shot, type, name) {
  const found = await page.evaluate((type) => {
    const g = window.game; const planet = g.world.system.planets[0];
    const poi = g.pois.generate(planet, g).find(p => p.type === type);
    if (!poi) return null;
    // advance the clock until the site is in daylight
    for (let k = 0; k < 96; k++) {
      planet.update(g.time, 0, g.cameraRig.posU, g.renderer.camera, g.world.origin, g.world.system.star.color);
      if (planet.sunElevation(planet.toUniverse(poi.local)) > 0.45) break;
      g.time += planet.desc.dayLength / 48;
    }
    const up = poi.dir.clone(); const side = new up.constructor(0.3, 1, 0.2).cross(up).normalize();
    const u = planet.toUniverse(poi.local.clone().addScaledVector(side, 28));
    g.player.placeAt(u, planet, planet.toUniverse(poi.local).sub(u)); g.player.pitch = -0.05;
    return true;
  }, type);
  if (!found) { console.log('no', type); return; }
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(4000); await sim(page, 0.3); }
  await shot(name);
}
export default async (page, shot) => {
  await lowSettings(page);
  await startGame(page);
  await visit(page, shot, 'crash', 'p1_crash');
  await visit(page, shot, 'outpost', 'p2_outpost');
  await visit(page, shot, 'ruins', 'p3_ruins');
  await visit(page, shot, 'beacon', 'p3_beacon');
  await visit(page, shot, 'deposit', 'p3_deposit');
  // asteroid field near the station
  await page.evaluate(() => { const g = window.game; Object.defineProperty(g.input, 'locked', { get: () => true, configurable: true }); g.boardShip(); const b = g.world.system.desc.belts[1]; g.ship.landedPlanet = null; g.ship.pos.set(b.center[0], b.center[1], b.center[2]); g.ship.setMode('flying'); g.ship.throttle = 0; });
  await sim(page, 0.5);
  const n = await page.evaluate(() => { const g = window.game; const a = g.world.system.asteroids.asteroids.filter(x => !x.depleted).sort((x, y) => x.pos.distanceTo(g.ship.pos) - y.pos.distanceTo(g.ship.pos))[0]; if (!a) return 0; const to = a.pos.clone().sub(g.ship.pos); const d = to.length(); g.ship.pos.copy(a.pos).addScaledVector(to.normalize(), -(a.radius + 120)); const dir = a.pos.clone().sub(g.ship.pos).normalize(); g.ship.quat.setFromRotationMatrix(new g.renderer.camera.matrix.constructor().lookAt(new dir.constructor(), dir, new dir.constructor(0,1,0))); window.__a = a; return g.world.system.asteroids.asteroids.length; });
  console.log('asteroids', n);
  await sim(page, 0.3);
  await shot('p4_asteroids');
  await sim(page, 8, "g.input['down'].add('Mouse0'); const a = window.__a; const dir = a.pos.clone().sub(g.ship.pos).normalize(); g.ship.quat.setFromRotationMatrix(new g.renderer.camera.matrix.constructor().lookAt(new dir.constructor(), dir, new dir.constructor(0,1,0))); g.ship.throttle = 0; g.ship.vel.set(0,0,0);");
  await shot('p5_mined');
  console.log(JSON.stringify(await page.evaluate(() => ({ depleted: window.__a.depleted, health: window.__a.health, astrium: window.game.state.count('astrium'), item: window.__a.item, cnt: window.game.state.count(window.__a.item) }))));
};
