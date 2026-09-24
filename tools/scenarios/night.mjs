import { lowSettings, startGame, sim } from './common.mjs';
export default async (page, shot) => {
  await lowSettings(page);
  await startGame(page);
  await page.evaluate(() => {
    const g = window.game; const planet = g.world.system.planets[0];
    const poi = g.pois.generate(planet, g).find(p => p.type === 'crash');
    const up = poi.dir.clone(); const side = new up.constructor(0.3, 1, 0.2).cross(up).normalize();
    const u = planet.toUniverse(poi.local.clone().addScaledVector(side, 28));
    g.player.placeAt(u, planet, planet.toUniverse(poi.local).sub(u)); g.player.pitch = -0.05;
  });
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(4000); await sim(page, 0.3); }
  await shot('n1_night');
  await page.evaluate(() => { window.game.mining.flashlightOn = true; });
  await sim(page, 0.2);
  await shot('n2_flashlight');
  console.log(JSON.stringify(await page.evaluate(() => ({ day: window.game.world.env.day }))));
};
