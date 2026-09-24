import { lowSettings, startGame } from './common.mjs';
export default async (page) => {
  await lowSettings(page);
  await startGame(page);
  const info = await page.evaluate(() => {
    const lib = window.game.player.planet.scatter.library;
    const out = [];
    lib.models.forEach((vars, t) => vars.forEach((parts, v) => {
      if (!parts) return;
      let y0 = 1e9, y1 = -1e9, x0 = 1e9, x1 = -1e9;
      for (const p of parts) { p.geometry.computeBoundingBox(); const b = p.geometry.boundingBox; y0 = Math.min(y0, b.min.y); y1 = Math.max(y1, b.max.y); x0 = Math.min(x0, b.min.x); x1 = Math.max(x1, b.max.x); }
      out.push(`${t}/${v}: ${parts.map(p => p.material.name).join('+')} h=${(y1 - y0).toFixed(2)} w=${(x1 - x0).toFixed(2)}`);
    }));
    return out;
  });
  console.log(info.join('\n'));
};
