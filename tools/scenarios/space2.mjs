import { lowSettings, startGame, sim } from './common.mjs';
export default async (page, shot) => {
  await lowSettings(page);
  await startGame(page);
  await page.evaluate(() => { const g = window.game; Object.defineProperty(g.input, 'locked', { get: () => true, configurable: true }); g.boardShip(); const p = g.world.system.planets[0]; g.ship.landedPlanet = null; g.ship.pos.copy(p.position).add(new p.position.constructor(0, p.radius + 9000, 0)); g.ship.setMode('flying'); g.ship.throttle = 0.3; g.npcs.spawnPirates(g, 2); });
  // turn toward pirates
  for (let i = 0; i < 12; i++) {
    await sim(page, 1, "const t = g.npcs.ships.find(s => s.alive && s.hostileToPlayer); if (t) { const to = t.pos.clone().sub(g.ship.pos).normalize(); const m = new g.renderer.camera.matrix.constructor().lookAt(new to.constructor(), to, g.ship.upVec); const q = new g.ship.quat.constructor().setFromRotationMatrix(m); g.ship.quat.slerp(q, 0.1); } g.input['down'].add('Mouse0');");
  }
  await page.waitForTimeout(2000); await sim(page, 0.1);
  await shot('s1_dogfight');
  console.log(JSON.stringify(await page.evaluate(() => { const g = window.game; return { hull: g.state.ship.hull, shield: g.state.ship.shield, pirates: g.npcs.ships.map(s => [s.alive, Math.round(s.health), Math.round(s.pos.distanceTo(g.ship.pos))]), lock: !!g.lockedTarget }; })));
  // pulse toward planet 1
  await page.evaluate(() => { const g = window.game; g.input['down'].delete('Mouse0'); g.npcs.clear(g); const tp = g.world.system.planets[1]; const to = tp.position.clone().sub(g.ship.pos).normalize(); g.ship.quat.setFromRotationMatrix(new g.renderer.camera.matrix.constructor().lookAt(new to.constructor(), to, new to.constructor(0,1,0))); g.state.ship.pulseFuel = 1; g.input['pressed'].add('KeyR'); });
  await sim(page, 1.5);
  await shot('s2_pulse');
  const pl = await page.evaluate(() => { const g = window.game; return { mode: g.ship.mode, speed: Math.round(g.ship.speed) }; });
  console.log('pulse', JSON.stringify(pl));
  await sim(page, 60, "if (g.ship.mode !== 'pulse') return;");
  console.log(JSON.stringify(await page.evaluate(() => { const g = window.game; const tp = g.world.system.planets[1]; return { mode: g.ship.mode, distToAtmo: Math.round(tp.position.distanceTo(g.ship.pos) - tp.atmosphereRadius), fuel: g.state.ship.pulseFuel }; })));
  // descend and land on planet 1
  await page.evaluate(() => { const g = window.game; const tp = g.world.system.planets[1]; const up = g.ship.pos.clone().sub(tp.position).normalize(); const a = tp.altitudeAt(g.ship.pos); g.ship.pos.copy(tp.position).addScaledVector(up, a.ground + 300); g.ship.vel.set(0,0,0); g.ship.throttle = 0; });
  await sim(page, 1); await page.waitForTimeout(8000); await sim(page, 0.5); await page.waitForTimeout(8000); await sim(page, 0.5);
  const ok = await page.evaluate(() => window.game.ship.beginLanding(window.game));
  await sim(page, 12);
  await page.waitForTimeout(6000); await sim(page, 0.2);
  await shot('s3_landed');
  await page.evaluate(() => window.game.disembark());
  await sim(page, 0.5); await page.waitForTimeout(4000); await sim(page, 0.2);
  await page.evaluate(() => { const g = window.game; g.cameraRig.thirdPersonFoot = true; });
  await sim(page, 0.2);
  await shot('s4_newworld');
  console.log(JSON.stringify(await page.evaluate(() => { const g = window.game; return { landing: ok, mode: g.mode, ship: g.ship.mode, planet: g.player.planet?.desc.archetype }; })));
};
