export default async (page, shot) => {
  await page.waitForTimeout(2000);
  await page.click('[data-m="new"]');
  await page.fill('[data-seed]', '4242');
  await page.click('[data-go]');
  await page.waitForFunction(() => window.game && window.game.mode === 'foot', null, { timeout: 90000 });
  for (let i = 0; i < 6; i++) { const b = await page.$('[data-action="next"]'); if (b) await b.click(); await page.waitForTimeout(200); }
  await page.waitForTimeout(3000);
  const info = await page.evaluate(() => {
    const g = window.game; const THREE = g.renderer.camera.constructor;
    const cam = g.renderer.camera;
    const fwd = cam.getWorldDirection(new cam.position.constructor());
    const up = g.player.up.clone();
    const bodyUp = new cam.position.constructor(0,1,0).applyQuaternion(g.player.body);
    return { fwdDotUp: fwd.dot(up), bodyUpDot: bodyUp.dot(up), pitch: g.player.pitch, camQ: cam.quaternion.toArray(), rigQ: g.cameraRig.quat.toArray(), look: g.player.lookQuat.toArray() };
  });
  console.log(JSON.stringify(info));
};
