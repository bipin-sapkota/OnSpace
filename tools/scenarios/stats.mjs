export default async (page, shot) => {
  await page.waitForTimeout(2000);
  await page.click('[data-m="new"]');
  await page.fill('[data-seed]', '4242');
  await page.click('[data-go]');
  await page.waitForFunction(() => window.game && window.game.mode === 'foot', null, { timeout: 90000 });
  for (let i = 0; i < 6; i++) { const b = await page.$('[data-action="next"]'); if (b) await b.click(); await page.waitForTimeout(200); }
  await page.waitForTimeout(3000);
  const hist = await page.evaluate(() => { const t = window.game.world.env.planet.terrain; const h = {}; const hv = {}; const w = (n) => { h[n.level] = (h[n.level]||0)+1; if (n.mesh && n.mesh.visible) hv[n.level] = (hv[n.level]||0)+1; if (n.children) n.children.forEach(w); }; t.roots.forEach(w); return {h, hv, max: t.maxLevel, cam: t.camLocal.length(), R: window.game.world.env.planet.radius}; }); console.log(JSON.stringify(hist));
  const info = await page.evaluate(() => {
    const g = window.game; const r = g.renderer;
    const t0 = performance.now(); r.render(g.time); const t1 = performance.now();
    let meshes = 0, inst = 0, instCount = 0; g.renderer.scene.traverse(o => { if (o.isMesh) meshes++; if (o.isInstancedMesh && o.visible) { inst++; instCount += o.count; } });
    return { calls: r.drawCalls, tris: r.triangles, renderMs: t1 - t0, meshes, inst, instCount, chunks: g.world.env.planet.terrain.visibleChunks, total: g.world.env.planet.terrain.totalChunks, shadows: g.world.sun.castShadow };
  });
  console.log(JSON.stringify(info));
};
