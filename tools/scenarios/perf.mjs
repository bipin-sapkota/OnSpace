import { lowSettings, startGame, sim } from './common.mjs';
export default async (page, shot) => {
  await lowSettings(page);
  await startGame(page);
  await sim(page, 10);
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => {
    const g = window.game; const out = {};
    const time = (name, fn, n = 30) => { const t0 = performance.now(); for (let i = 0; i < n; i++) fn(); out[name] = ((performance.now() - t0) / n).toFixed(2) + 'ms'; };
    time('simulate', () => { g.simulate(0.016); g.input.endFrame(); });
    time('hud', () => g.ui.update(0.016));
    time('terrainUpdate', () => g.world.env.planet.terrain.update(g.world.env.planet.camLocal, 0));
    time('heightQuery', () => g.world.env.planet.altitudeAt(g.player.pos), 300);
    out.creatures = g.creatures.creatures.length; out.targets = g.combat.targets.size;
    return out;
  });
  console.log(JSON.stringify(r));
};
