import { lowSettings, startGame, sim } from './common.mjs';
export default async (page, shot) => {
  await lowSettings(page);
  await startGame(page);
  for (const arch of ['frozen', 'volcanic', 'toxic', 'exotic', 'ocean', 'barren', 'arid']) {
    const found = await page.evaluate((arch) => {
      const g = window.game;
      for (let id = 0; id < g.galaxy.systems.length; id++) {
        const sys = g.galaxy.getSystem(id);
        const p = sys.planets.find(p => p.archetype === arch && !p.isMoon) || sys.planets.find(p => p.archetype === arch);
        if (!p) continue;
        g.arriveInSystem(id);
        const planet = g.world.system.planet(p.id);
        // find a dry spot facing the sun
        const sun = planet.sunDir(); let best = null;
        for (let k = 0; k < 200; k++) { const d = planet.universeDirToLocal(sun.clone().add(new sun.constructor().randomDirection().multiplyScalar(0.6)).normalize()); const r = planet.surfaceRadius(d); if (!planet.gen.hasSea || r > planet.seaRadius + 3) { best = d; break; } }
        if (!best) best = planet.universeDirToLocal(sun);
        const u = planet.toUniverse(best.clone().multiplyScalar(planet.radius));
        const up = u.clone().sub(planet.position).normalize();
        const t = new up.constructor(0, 1, 0).cross(up).normalize();
        g.player.placeAt(u, planet, t);
        g.setMode('foot', false);
        g.player.pitch = 0.05;
        return `${sys.name} / ${p.name} (${arch})`;
      }
      return null;
    }, arch);
    console.log(arch, found);
    if (!found) continue;
    for (let i = 0; i < 7; i++) { await page.waitForTimeout(4000); await sim(page, 0.2); }
    await shot('a_' + arch);
  }
};
