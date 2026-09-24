import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Galaxy } from '../src/universe/Galaxy';
import { TerrainGen } from '../src/world/terrain/TerrainGen';
import { buildChunk, TOTAL_VERTS } from '../src/world/terrain/ChunkBuilder';
import { RNG, hashCombine } from '../src/core/Random';
import { Noise3 } from '../src/procgen/noise';

test('rng is deterministic per seed', () => {
  const a = new RNG(42), b = new RNG(42), c = new RNG(43);
  const sa = [a.next(), a.next(), a.next()];
  assert.deepEqual(sa, [b.next(), b.next(), b.next()]);
  assert.notDeepEqual(sa, [c.next(), c.next(), c.next()]);
  assert.equal(hashCombine(1, 2, 3), hashCombine(1, 2, 3));
});

test('noise is bounded and deterministic', () => {
  const n = new Noise3(7);
  for (let i = 0; i < 1000; i++) {
    const v = n.noise(i * 0.37, i * 0.11, -i * 0.23);
    assert.ok(v >= -1.01 && v <= 1.01);
  }
  assert.equal(new Noise3(7).fbm(0.3, 0.2, 0.1, 5), n.fbm(0.3, 0.2, 0.1, 5));
});

test('galaxy and systems regenerate identically from a seed', () => {
  const g1 = new Galaxy(1234);
  const g2 = new Galaxy(1234);
  assert.equal(g1.startSystemId, g2.startSystemId);
  const s1 = g1.getSystem(g1.startSystemId);
  const s2 = g2.getSystem(g2.startSystemId);
  assert.deepEqual(JSON.parse(JSON.stringify(s1)), JSON.parse(JSON.stringify(s2)));
  // starting system is guaranteed habitable with a signal world
  assert.equal(s1.planets[0].archetype, 'verdant');
  assert.equal(s1.planets.filter((p) => p.hasSignal).length, 1);
  assert.ok(s1.stations.length >= 1);
  assert.ok(g1.neighbours(g1.startSystemId, 100).length >= 4, 'start system must have reachable neighbours');
});

test('different seeds produce different galaxies', () => {
  assert.notEqual(new Galaxy(1).systems[5].name + new Galaxy(1).systems[6].name, new Galaxy(2).systems[5].name + new Galaxy(2).systems[6].name);
});

test('terrain heights are deterministic and within bounds', () => {
  const g = new Galaxy(99);
  for (const p of g.getSystem(g.startSystemId).planets) {
    const t1 = new TerrainGen(p.terrain);
    const t2 = new TerrainGen(p.terrain);
    for (let i = 0; i < 50; i++) {
      const d = new RNG(i).unitVector();
      const h = t1.height(d[0], d[1], d[2]);
      assert.equal(h, t2.height(d[0], d[1], d[2]));
      assert.ok(Number.isFinite(h));
      assert.ok(Math.abs(h) < p.terrain.heightScale * 4 + 200, `height ${h} out of range for ${p.archetype}`);
    }
  }
});

test('chunk builder produces consistent geometry', () => {
  const g = new Galaxy(5);
  const p = g.getSystem(g.startSystemId).planets[0];
  const gen = new TerrainGen(p.terrain);
  const r = buildChunk(gen, { planet: 'x', face: 2, level: 6, ix: 20, iy: 30, scatter: true, scatterSeed: 1 });
  assert.equal(r.positions.length, TOTAL_VERTS * 3);
  assert.equal(r.normals.length, TOTAL_VERTS * 3);
  for (let i = 0; i < r.positions.length; i++) assert.ok(Number.isFinite(r.positions[i]));
  const r2 = buildChunk(gen, { planet: 'x', face: 2, level: 6, ix: 20, iy: 30, scatter: true, scatterSeed: 1 });
  assert.deepEqual(Array.from(r.scatter!), Array.from(r2.scatter!));
});
