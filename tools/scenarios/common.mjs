export async function lowSettings(page) {
  await page.addInitScript(() => {
    localStorage.setItem('onspace.settings.v1', JSON.stringify({ quality: 'low', renderScale: 0.45, shadows: true, atmosphereSteps: 6, bloom: true, antialias: false, vegetationDensity: 0.8, terrainDetail: 1, showFps: true }));
  });
}
export async function startGame(page, seed = '4242') {
  await page.goto(process.env.GAME_URL || 'http://localhost:4173/');
  await page.waitForSelector('[data-m="new"]');
  await page.waitForTimeout(1000);
  await page.click('[data-m="new"]');
  await page.fill('[data-seed]', seed);
  await page.click('[data-go]');
  await page.waitForFunction(() => window.game && window.game.isPlaying && !document.getElementById('loading'), null, { timeout: 180000 });
  for (let i = 0; i < 10; i++) {
    const b = await page.$('[data-action="next"]');
    if (!b) break;
    await b.click();
    await page.waitForTimeout(400);
  }
}
/** Advance the game by simulated seconds regardless of real frame rate. */
export async function sim(page, seconds, before) {
  await page.evaluate(({ seconds, before }) => {
    const g = window.game;
    const steps = Math.ceil(seconds / 0.05);
    for (let i = 0; i < steps; i++) {
      if (before) new Function('g', before)(g);
      g.frame(0.05);
      g.input.endFrame();
    }
  }, { seconds, before });
}
