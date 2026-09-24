import { lowSettings, startGame } from './common.mjs';
export default async (page, shot) => {
  await lowSettings(page);
  await startGame(page);
  await page.waitForTimeout(2000);
  const info = await page.evaluate(() => {
    const g = window.game;
    const by = {};
    g.renderer.scene.traverseVisible((o) => {
      if (!o.isMesh) return;
      const tris = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
      const n = o.isInstancedMesh ? o.count : 1;
      const key = o.userData.scatterType !== undefined ? `scatter${o.userData.scatterType}` : o.isSkinnedMesh ? 'skinned' : o.parent?.name || 'other';
      by[key] = (by[key] || 0) + tris * n;
    });
    for (const k in by) by[k] = Math.round(by[k] / 1000) + 'k';
    return by;
  });
  console.log(JSON.stringify(info));
};
