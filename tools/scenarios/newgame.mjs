import { lowSettings, startGame } from './common.mjs';
export default async (page, shot) => {
  await lowSettings(page);
  await startGame(page);
  await page.waitForTimeout(3000);
  await shot('foot');
  const info = await page.evaluate(() => { const g = window.game; return { mode: g.mode, ship: g.ship.pos.distanceTo(g.player.pos), alt: g.world.env.altitude, fps: g.fps, quest: g.quest.title(g), calls: g.renderer.drawCalls }; });
  console.log(JSON.stringify(info));
};
