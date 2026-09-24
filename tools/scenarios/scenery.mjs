import { lowSettings, startGame, sim } from './common.mjs';
// Close-up look at flora, terrain detail and wildlife on the start planet.
export default async (page, shot) => {
  await lowSettings(page);
  await startGame(page);
  await sim(page, 0.5);
  for (const [i, yaw] of [0, 2.1, 4.2].entries()) {
    await page.evaluate((yaw) => { const g = window.game; g.player.yaw = yaw; g.player.pitch = -0.08; }, yaw);
    await sim(page, 0.1);
    await page.waitForTimeout(2500);
    await shot('scenery_' + i);
  }
  // wildlife close-up: spawn herds and look at the nearest animal
  const c = await page.evaluate(() => {
    const g = window.game;
    const cm = g.creatures;
    for (let k = 0; k < 6; k++) cm.trySpawnHerd(g.player.planet.toLocal(g.player.pos, g.player.pos.clone()), 0, g);
    let best = null, bd = 1e9;
    for (const c of cm.creatures) { const d = c.pos.distanceTo(g.player.pos); if (d < bd) { bd = d; best = c; } }
    if (!best) return null;
    // stand 6 body-lengths away looking at it
    const planet = g.player.planet;
    const up = best.pos.clone().sub(planet.position).normalize();
    const side = best.heading.clone();
    const dir = planet.localDirToUniverse(side.cross(best.local.clone().normalize()).normalize());
    const at = best.pos.clone().addScaledVector(dir, Math.max(4, best.species.size * 5));
    g.player.placeAt(at, planet, best.pos.clone().sub(at));
    best.speed = 0;
    return { name: best.species.name, model: best.species.model, size: best.species.size, n: cm.creatures.length };
  });
  console.log('creature', JSON.stringify(c));
  await sim(page, 0.3);
  await page.waitForTimeout(2500);
  await shot('scenery_creature');
};
