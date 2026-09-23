import { lowSettings, startGame, sim } from './common.mjs';
export default async (page, shot) => {
  await lowSettings(page);
  await startGame(page);
  await sim(page, 0.2);
  await shot('diag1');
  const near = await page.evaluate(() => {
    const g = window.game; const p = g.player; const planet = p.planet;
    const local = planet.toLocal(p.pos);
    const recs = [...planet.scatter.nearby(local, 15)].map(r => ({ t: r.type, d: r.pos.distanceTo(local).toFixed(1), s: r.scale.toFixed(2) }));
    return { recs: recs.slice(0, 10), floraStyle: planet.desc.terrain.floraStyle, sea: planet.seaRadius - planet.radius, r: local.length() - planet.radius };
  });
  console.log(JSON.stringify(near));
  await page.evaluate(() => { const g = window.game; g.cameraRig.thirdPersonFoot = true; g.player.pitch = -0.6; });
  await sim(page, 0.2);
  await shot('diag2');
};
