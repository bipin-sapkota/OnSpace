import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { Planet } from '../../world/Planet';
import { RNG, hashCombine } from '../../core/Random';
import { GeoBuilder, box, column, cone, sphere, trs, rockGeometry, ico } from '../../render/GeoKit';
import { planetPropMaterial } from '../../render/Materials';
import { buildShipModel } from '../ship/ShipModel';
import { allShipClasses } from '../ship/ShipDefs';
import { events } from '../../core/EventBus';
import { getItem } from '../../gameplay/Items';
import { PropFactory, disposeOwnedGeometry } from '../../assets/PropFactory';
import { CRASH_LOGS, MONOLITH_LORE, RUIN_LORE, TERMINAL_LOGS } from '../../gameplay/Lore';

/**
 * Points of interest. Each planet has a deterministic set of sites generated
 * from its seed. Sites are instantiated only near the player, provide
 * colliders and interactables, and remember what has been looted.
 */
export type POIType = 'crash' | 'monolith' | 'outpost' | 'beacon' | 'pod' | 'deposit' | 'ruins';

export const POI_INFO: Record<POIType, { label: string; icon: string; color: string }> = {
  crash: { label: 'Crash Site', icon: '✈', color: '#ff9f4a' },
  monolith: { label: 'Veil Monolith', icon: '◆', color: '#c58cff' },
  outpost: { label: 'Abandoned Outpost', icon: '⌂', color: '#7fd6ff' },
  beacon: { label: 'Signal Beacon', icon: '⟟', color: '#58ffb0' },
  pod: { label: 'Drop Pod', icon: '⬡', color: '#ffd24a' },
  deposit: { label: 'Rich Deposit', icon: '✦', color: '#ffe38a' },
  ruins: { label: 'Ancient Ruins', icon: '⌬', color: '#e0c9a6' },
};

export interface POI {
  id: string;
  type: POIType;
  name: string;
  dir: THREE.Vector3; // planet-local unit direction
  local: THREE.Vector3; // planet-local ground position
  seed: number;
  isSignal: boolean;
  known: boolean;
  visited: boolean;
  group: THREE.Group | null;
  colliders: { local: THREE.Vector3; radius: number; height: number }[];
  interactables: Interactable[];
  shelterRadius: number;
  item?: string;
}

export interface Interactable {
  key: string;
  local: THREE.Vector3;
  radius: number;
  prompt: string;
  action: (game: Game) => void;
}

const _v = new THREE.Vector3();

export class POIManager {
  pois: POI[] = [];
  private planet: Planet | null = null;
  private mat: THREE.MeshStandardMaterial | null = null;
  private props: PropFactory | null = null;
  private smokeTimer = 0;
  private cache = new Map<string, POI[]>();

  /** Deterministic POI list for any planet (used by maps & missions without loading). */
  generate(planet: Planet, game: Game): POI[] {
    const cached = this.cache.get(planet.key);
    if (cached) return cached;
    const rng = new RNG(planet.desc.seed ^ 0x9015);
    const list: POI[] = [];
    const count = planet.desc.isMoon ? 10 : 16;
    const types: POIType[] = ['crash', 'outpost', 'beacon', 'pod', 'deposit', 'ruins', 'monolith'];
    const weights = [2.2, 2.2, 1.4, 1.6, 2, 1.2, 0.6];
    let tries = 0;
    while (list.length < count && tries++ < 400) {
      const dir = new THREE.Vector3(...rng.unitVector());
      const r = planet.surfaceRadius(dir);
      if (planet.gen.hasSea && r < planet.seaRadius + 4) continue;
      const isSignal = planet.desc.hasSignal && list.length === 0;
      const type: POIType = isSignal ? 'monolith' : rng.weighted(types, weights);
      const seed = hashCombine(planet.desc.seed, list.length, 0x901);
      const id = `${planet.key}:poi${list.length}`;
      const poi: POI = {
        id, type, seed, isSignal,
        name: isSignal ? 'Signal Monolith' : POI_INFO[type].label,
        dir: dir.clone(),
        local: dir.clone().multiplyScalar(r),
        known: isSignal || game.state.data.looted.includes(`${id}:known`),
        visited: game.state.data.looted.includes(`${id}:visited`),
        group: null, colliders: [], interactables: [], shelterRadius: 0,
      };
      if (type === 'deposit') poi.item = rng.pick(['aurium', 'nullite', 'voltium', planet.desc.terrain.resourceNodes[0]?.item ?? 'ferrox']);
      list.push(poi);
    }
    this.cache.set(planet.key, list);
    return list;
  }

  private setPlanet(planet: Planet | null, game: Game): void {
    if (planet === this.planet) return;
    for (const p of this.pois) this.unbuild(p);
    this.mat?.dispose();
    this.mat = null;
    this.props?.dispose();
    this.props = null;
    this.planet = planet;
    this.pois = planet ? this.generate(planet, game) : [];
    if (planet) {
      this.mat = planetPropMaterial(planet.lu, { roughness: 0.6, metalness: 0.3, key: 'poi' });
      this.props = new PropFactory(planet.lu, 'poi-asset');
    }
  }

  markKnown(poi: POI, game: Game): void {
    if (poi.known) return;
    poi.known = true;
    game.state.data.looted.push(`${poi.id}:known`);
  }

  revealNear(u: THREE.Vector3, radius: number, game: Game): number {
    if (!this.planet) return 0;
    const local = this.planet.toLocal(u, new THREE.Vector3());
    let n = 0;
    for (const p of this.pois) {
      if (!p.known && p.local.distanceTo(local) < radius) {
        this.markKnown(p, game);
        n++;
      }
    }
    if (n > 0) events.emit('notify', { text: `${n} point${n > 1 ? 's' : ''} of interest revealed`, kind: 'info' });
    return n;
  }

  /** Reveal the nearest unknown POI of preferred types (beacons, terminals). */
  revealNearestUnknown(u: THREE.Vector3, game: Game, prefer?: POIType[]): POI | null {
    if (!this.planet) return null;
    const local = this.planet.toLocal(u, new THREE.Vector3());
    let best: POI | null = null;
    let bd = Infinity;
    for (const p of this.pois) {
      if (p.known) continue;
      const d = p.local.distanceTo(local) * (prefer && prefer.includes(p.type) ? 0.3 : 1);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best) {
      this.markKnown(best, game);
      events.emit('notify', { text: `Signal decoded: ${best.name} located`, kind: 'discovery' });
    }
    return best;
  }

  universePos(p: POI, out = new THREE.Vector3()): THREE.Vector3 {
    return this.planet ? this.planet.toUniverse(p.local, out) : out.set(0, 0, 0);
  }

  get current(): Planet | null {
    return this.planet;
  }

  update(dt: number, game: Game): void {
    const onPlanet = game.mode === 'foot' ? game.player.planet : game.mode === 'ship' && game.ship.altitude < 8000 ? game.ship.nearPlanet : null;
    this.setPlanet(onPlanet ?? null, game);
    if (!this.planet) return;
    const focus = game.mode === 'foot' ? game.player.pos : game.ship.pos;
    const local = this.planet.toLocal(focus, new THREE.Vector3());
    this.smokeTimer -= dt;
    let shelter = false;
    for (const p of this.pois) {
      const d = p.local.distanceTo(local);
      if (d < 1800 && !p.group) this.build(p, game);
      else if (d > 2400 && p.group) this.unbuild(p);
      if (d < 70 && game.mode === 'foot') {
        this.markKnown(p, game);
        if (!p.visited) {
          p.visited = true;
          game.state.data.looted.push(`${p.id}:visited`);
          game.discovery.discover(game, 'poi', `${p.id}`, `${p.name}`, this.planet.desc.name, 150);
          game.quest.onPOIVisited(p, game);
        }
      }
      if (p.shelterRadius > 0 && d < p.shelterRadius) shelter = true;
      if (p.type === 'crash' && p.group && this.smokeTimer <= 0 && d < 900) {
        const up = p.dir;
        const u = this.planet.toUniverse(_v.copy(p.local).addScaledVector(up, 3), new THREE.Vector3());
        game.effects.puff(u, new THREE.Color(0.1, 0.1, 0.1), 2, 3, 6, 1.5, this.planet.localDirToUniverse(up), 0.35);
      }
    }
    if (this.smokeTimer <= 0) this.smokeTimer = 0.3;
    game.player.sheltered = shelter && game.mode === 'foot';
  }

  /** Interactable nearest to a universe point within range. */
  nearestInteractable(u: THREE.Vector3, range = 3.2): Interactable | null {
    if (!this.planet) return null;
    const local = this.planet.toLocal(u, new THREE.Vector3());
    let best: Interactable | null = null;
    let bd = range;
    for (const p of this.pois) {
      if (!p.group) continue;
      for (const it of p.interactables) {
        const d = it.local.distanceTo(local) - it.radius;
        if (d < bd) {
          bd = d;
          best = it;
        }
      }
    }
    return best;
  }

  /** Push a planet-local point out of structure colliders. */
  collide(local: THREE.Vector3, radius: number): boolean {
    let hit = false;
    for (const p of this.pois) {
      if (!p.group) continue;
      for (const c of p.colliders) {
        const up = c.local.clone().normalize();
        _v.copy(local).sub(c.local);
        const h = _v.dot(up);
        if (h < -0.5 || h > c.height) continue;
        _v.addScaledVector(up, -h);
        const d = _v.length();
        const r = c.radius + radius;
        if (d < r && d > 1e-4) {
          local.addScaledVector(_v, (r - d) / d);
          hit = true;
        }
      }
    }
    return hit;
  }

  private looted(game: Game, key: string): boolean {
    return game.state.data.looted.includes(key);
  }

  private setLooted(game: Game, key: string): void {
    if (!this.looted(game, key)) game.state.data.looted.push(key);
  }

  private unbuild(p: POI): void {
    if (!p.group) return;
    disposeOwnedGeometry(p.group);
    p.group.removeFromParent();
    p.group = null;
    p.colliders = [];
    p.interactables = [];
  }

  private build(p: POI, game: Game): void {
    const planet = this.planet!;
    const rng = new RNG(p.seed);
    const up = p.dir.clone();
    const group = new THREE.Group();
    // orient: local Y up
    const tangent = new THREE.Vector3().crossVectors(up, Math.abs(up.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), tangent, up);
    group.quaternion.setFromRotationMatrix(m);
    group.rotateY(rng.range(0, Math.PI * 2));
    // sit on the lowest nearby point to avoid floating on slopes
    let minR = Infinity;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const off = new THREE.Vector3(Math.cos(a) * 6, 0, Math.sin(a) * 6).applyQuaternion(group.quaternion);
      minR = Math.min(minR, planet.surfaceRadius(p.local.clone().add(off).normalize()));
    }
    minR = Math.min(minR, planet.surfaceRadius(up));
    p.local.copy(up).multiplyScalar(minR);
    group.position.copy(p.local);
    const toLocal = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(group.quaternion).add(group.position);
    const mat = this.mat!;
    const addMesh = (geo: THREE.BufferGeometry, cast = true) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };
    const b = new GeoBuilder();
    const metal = new THREE.Color(0.6, 0.62, 0.66);
    const dark = new THREE.Color(0.14, 0.15, 0.17);
    const warm = new THREE.Color(1, 0.6, 0.25);
    const cyan = new THREE.Color(0.3, 0.9, 1.0);
    const lootKey = `${p.id}:loot`;
    /** Place an imported prop (CC0 / NASA model); returns false when unavailable. */
    const prop = (key: string, size: number, x: number, y: number, z: number, yaw = 0, axis: 'y' | 'max' = 'max', tilt?: THREE.Euler): boolean => {
      const o = this.props?.make(key, size, axis);
      if (!o) return false;
      o.position.set(x, y, z);
      if (tilt) o.rotation.copy(tilt);
      o.rotateY(yaw);
      group.add(o);
      return true;
    };

    switch (p.type) {
      case 'crash': {
        const lander = rng.chance(0.3) && prop('nasa/lunar_module', 7.5, 0, -0.4, 0, rng.range(0, 6), 'max', new THREE.Euler(rng.range(0.15, 0.35), 0, rng.range(-0.3, 0.3)));
        for (let i = 0; i < 3; i++) {
          const a = rng.range(0, Math.PI * 2);
          const r = rng.range(7, 14);
          prop(i === 0 ? 'scifi/Prop_Barrel_Large' : 'scifi/Prop_Crate4', i === 0 ? 1.1 : 1.0, Math.cos(a) * r, -0.1, Math.sin(a) * r, rng.range(0, 6), 'y', new THREE.Euler(rng.range(-0.5, 0.5), 0, rng.range(-1.2, 1.2)));
        }
        if (lander) {
          prop('scifi/Prop_Chest', 1.6, 4, 0, 3, 0.4);
        } else {
        const cls = allShipClasses()[rng.int(0, 3)];
        const model = buildShipModel(cls, p.seed);
        model.group.traverse((o) => {
          const mm = o as THREE.Mesh;
          if (mm.isMesh && mm.material instanceof THREE.MeshBasicMaterial) mm.visible = false;
        });
        model.gear.visible = false;
        model.group.position.set(0, 0.6, 0);
        model.group.rotation.set(rng.range(-0.25, 0.1), rng.range(0, 3), rng.range(0.2, 0.6));
        model.group.scale.setScalar(1.15);
        group.add(model.group);
        }
        for (let i = 0; i < 12; i++) {
          const a = rng.range(0, Math.PI * 2);
          const r = rng.range(6, 22);
          b.add(rockGeometry(rng, 0, 0.5), i % 3 ? dark : metal, trs(Math.cos(a) * r, 0.1, Math.sin(a) * r, 0, 0, 0, rng.range(0.3, 1.2)));
        }
        if (!lander) {
          b.add(box(1.2, 0.8, 0.8), dark, trs(4, 0.4, 3));
          b.add(box(0.3, 0.1, 0.3), warm, trs(4, 0.85, 3), 3);
        }
        addMesh(b.build());
        p.colliders.push({ local: toLocal(0, 0, 0), radius: 5, height: 5 });
        if (!this.looted(game, lootKey)) {
          p.interactables.push({
            key: lootKey, local: toLocal(4, 0.5, 3), radius: 1.5, prompt: 'Salvage wreck',
            action: (g) => {
              this.setLooted(g, lootKey);
              const frags = 1 + rng.int(0, 2);
              g.state.give('tech_fragment', frags);
              g.state.give(rng.pick(['alloy_plate', 'data_core', 'shield_cell']), 1);
              g.state.give(rng.pick(['ferrox', 'voltium', 'astrium']), 30 + rng.int(0, 40));
              g.ui.showLore('Wreck Salvaged', CRASH_LOGS[rng.int(0, CRASH_LOGS.length - 1)], `Recovered ${frags} Tech Fragment${frags > 1 ? 's' : ''} and components.`);
              g.audio.play('pickup');
              p.interactables = p.interactables.filter((i) => i.key !== lootKey);
              g.quest.onLoot('crash', g);
            },
          });
        }
        break;
      }
      case 'monolith': {
        const stone = new THREE.Color(0.08, 0.07, 0.1);
        const glyph = new THREE.Color(0.75, 0.45, 1.0);
        b.add(box(3, 14, 1.4), stone, trs(0, 7, 0));
        for (let i = 0; i < 6; i++) b.add(box(2.2, 0.12, 1.45), glyph, trs(0, 3 + i * 1.7, 0), 3);
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          b.add(box(1, rng.range(1.5, 3.5), 0.8), stone, trs(Math.cos(a) * 11, 1, Math.sin(a) * 11, 0, -a, rng.range(-0.1, 0.1)));
        }
        b.add(column(12, 12.5, 24), new THREE.Color(0.2, 0.18, 0.22), trs(0, -0.3, 0, 0, 0, 0, 1, 0.5, 1));
        for (let i = 0; i < 5; i++) {
          const a = rng.range(0, Math.PI * 2);
          b.add(ico(0.5, 0), glyph, trs(Math.cos(a) * 3.5, 9 + rng.range(-2, 3), Math.sin(a) * 3.5, rng.range(0, 3), rng.range(0, 3), 0), 2.5);
        }
        addMesh(b.build());
        p.colliders.push({ local: toLocal(0, 0, 0), radius: 2.2, height: 14 });
        const k = `${p.id}:commune`;
        if (!this.looted(game, k)) {
          p.interactables.push({
            key: k, local: toLocal(0, 1, 1.5), radius: 2, prompt: p.isSignal ? 'Attune to the Signal' : 'Commune with the monolith',
            action: (g) => {
              this.setLooted(g, k);
              p.interactables = p.interactables.filter((i) => i.key !== k);
              g.audio.play('monolith', 1);
              g.quest.onMonolith(p, g);
            },
          });
        }
        break;
      }
      case 'outpost': {
        const wall = new THREE.Color().setHSL(rng.next(), 0.1, 0.6);
        // KayKit modular base when available, procedural dome otherwise
        const kit = prop(rng.pick(['spacebase/basemodule_E', 'spacebase/basemodule_A', 'spacebase/basemodule_D']), 10, 0, 0, 0, Math.PI);
        if (kit) {
          prop(rng.pick(['spacebase/cargodepot_A', 'spacebase/cargodepot_B', 'spacebase/basemodule_garage']), 7, 8.5, 0, 0, -Math.PI / 2);
          prop('spacebase/landingpad_large', 10, -4, -0.15, 12);
          prop('spacebase/roofmodule_solarpanels', 4.5, 8.5, 3.2, 0);
          prop(rng.pick(['spacebase/windturbine_tall', 'spacebase/structure_tall']), 8, -9, 0, -6, rng.range(0, 6), 'y');
          if (rng.chance(0.5)) prop('nasa/habitat', 11, -14, 0, 4, rng.range(0, 6));
          if (rng.chance(0.6)) prop(rng.pick(['nasa/sev_rover', 'spacebase/spacetruck_large']), 6, 12, 0, 11, rng.range(0, 6));
          else prop('spacebase/lander_A', 5, 12, 0, 11, rng.range(0, 6));
          prop('nasa/eva_suit', 1.85, 3.6, 0, 6.2, -0.5, 'y');
          prop('scifi/Prop_Light_Floor', 1.3, -1.6, 0, 5.8);
          prop('scifi/Prop_Barrel_Large', 1.1, 5, 0, -5, 0, 'y');
          prop('scifi/Prop_Barrel_Large', 1.1, 5.6, 0, -4.3, 1, 'y');
        } else {
          b.add(sphere(5, 16, 8), wall, trs(0, 0, 0, 0, 0, 0, 1, 0.8, 1));
          b.add(box(3, 2.4, 0.2), dark, trs(0, 1.2, 4.9));
          b.add(box(2.6, 0.2, 0.25), warm, trs(0, 2.5, 5.0), 3);
          b.add(box(6, 3, 4), wall, trs(8, 1.5, 0));
          b.add(box(6.1, 0.3, 4.1), dark, trs(8, 3, 0));
          for (let i = 0; i < 3; i++) b.add(box(0.8, 0.5, 0.1), cyan, trs(6.2 + i * 1.4, 2, 2.05), 2);
          b.add(column(5, 5, 16), new THREE.Color(0.25, 0.26, 0.28), trs(-4, 0, 12, 0, 0, 0, 1, 0.3, 1));
          for (let i = 0; i < 6; i++) b.add(box(0.3, 0.1, 0.3), cyan, trs(-4 + Math.cos(i) * 4.6, 0.35, 12 + Math.sin(i) * 4.6), 3);
        }
        b.add(column(0.15, 0.2, 5), dark, trs(-6, 0, -3, 0, 0, 0, 1, 12, 1));
        b.add(ico(0.35, 0), new THREE.Color(1, 0.2, 0.2), trs(-6, 12.2, -3), 4);
        addMesh(b.build());
        if (kit) {
          p.colliders.push({ local: toLocal(0, 0, 0), radius: 4.6, height: 5 });
          p.colliders.push({ local: toLocal(-9, 0, -6), radius: 1.2, height: 8 });
        }
        p.colliders.push({ local: toLocal(8, 0, 0), radius: 3.3, height: 3 });
        p.colliders.push({ local: toLocal(-6, 0, -3), radius: 0.4, height: 12 });
        p.shelterRadius = 6;
        // crates
        const crates = 2 + rng.int(0, 1);
        for (let c = 0; c < crates; c++) {
          const ck = `${p.id}:crate${c}`;
          const cx = rng.range(-3, 3), cz = rng.range(-10, -5);
          const cb = new GeoBuilder();
          if (!prop(c % 2 ? 'scifi/Prop_Crate3' : 'scifi/Prop_Chest', c % 2 ? 1.0 : 1.5, cx, 0, cz, rng.range(-0.3, 0.3))) cb.add(box(1.2, 0.8, 0.8), new THREE.Color(0.35, 0.37, 0.4), trs(cx, 0.4, cz));
          if (!this.looted(game, ck)) cb.add(box(1.25, 0.08, 0.1), warm, trs(cx, c % 2 ? 1.05 : 1.0, cz + 0.2), 3);
          addMesh(cb.build());
          if (!this.looted(game, ck)) {
            p.interactables.push({
              key: ck, local: toLocal(cx, 0.4, cz), radius: 1, prompt: 'Open supply crate',
              action: (g) => {
                this.setLooted(g, ck);
                p.interactables = p.interactables.filter((i) => i.key !== ck);
                const roll = rng.next();
                if (roll < 0.35) {
                  const cr = 200 + rng.int(0, 800);
                  g.state.addCredits(cr);
                  events.emit('notify', { text: `+${cr} credits`, kind: 'good' });
                } else {
                  const it = rng.pick(['life_pack', 'shield_cell', 'hazard_pack', 'launch_fuel', 'alloy_plate', 'voltium', 'aurium']);
                  const n = getItem(it).category === 'resource' ? 15 + rng.int(0, 30) : 1;
                  g.state.give(it, n);
                  events.emit('notify', { text: `Found ${n} ${getItem(it).name}`, kind: 'good', icon: it });
                }
                if (rng.chance(0.3)) g.state.give('tech_fragment', 1);
                g.audio.play('pickup');
                g.quest.onLoot('crate', g);
              },
            });
          }
        }
        const tk = `${p.id}:terminal`;
        if (!prop('scifi/Prop_Computer', 1.6, 2.5, 0, 5.5, Math.PI, 'y')) {
          const tb = new GeoBuilder().add(box(0.8, 1.4, 0.4), dark, trs(2.5, 0.7, 5.5)).add(box(0.6, 0.4, 0.05), cyan, trs(2.5, 1.2, 5.72, -0.3, 0, 0), 2.5);
          addMesh(tb.build());
        }
        if (!this.looted(game, tk)) {
          p.interactables.push({
            key: tk, local: toLocal(2.5, 1, 5.5), radius: 1, prompt: 'Access terminal',
            action: (g) => {
              this.setLooted(g, tk);
              p.interactables = p.interactables.filter((i) => i.key !== tk);
              const found = this.revealNearestUnknown(g.player.pos, g, ['crash', 'monolith', 'ruins']);
              g.ui.showLore('Terminal', TERMINAL_LOGS[rng.int(0, TERMINAL_LOGS.length - 1)], found ? `Map data recovered: ${found.name}` : 'No new map data.');
              g.audio.play('ui_confirm');
            },
          });
        }
        break;
      }
      case 'beacon': {
        b.add(column(0.4, 1.2, 6), metal, trs(0, 0, 0, 0, 0, 0, 1, 9, 1));
        b.add(box(2, 0.3, 2), dark, trs(0, 0.15, 0));
        b.add(ico(0.7, 1), new THREE.Color(0.3, 1, 0.6), trs(0, 9.5, 0), 3);
        b.add(box(0.8, 1.2, 0.5), dark, trs(1.4, 0.6, 0));
        b.add(box(0.5, 0.3, 0.05), new THREE.Color(0.3, 1, 0.6), trs(1.4, 0.9, 0.26), 3);
        addMesh(b.build());
        // survey team left their equipment behind
        if (rng.chance(0.65)) {
          prop('nasa/perseverance', 3.1, 5, 0, 3, rng.range(0, 6));
          prop('nasa/ingenuity', 1.2, -3.5, 0, 4, rng.range(0, 6));
          p.colliders.push({ local: toLocal(5, 0, 3), radius: 1.6, height: 2 });
        } else {
          prop('spacebase/solarpanel', 2.6, -3, 0, 2, rng.range(0, 6));
          prop('spacebase/cargo_A_stacked', 1.8, 3, 0, -2.5, rng.range(0, 6));
        }
        p.colliders.push({ local: toLocal(0, 0, 0), radius: 1, height: 9 });
        const bk = `${p.id}:beacon`;
        if (!this.looted(game, bk)) {
          p.interactables.push({
            key: bk, local: toLocal(1.4, 0.8, 0), radius: 1, prompt: 'Activate beacon',
            action: (g) => {
              this.setLooted(g, bk);
              p.interactables = p.interactables.filter((i) => i.key !== bk);
              let n = 0;
              for (let i = 0; i < 3; i++) if (this.revealNearestUnknown(g.player.pos, g)) n++;
              g.audio.play('scan');
              g.effects.wave(g.player.pos, 400, 2, new THREE.Color(0.3, 1, 0.6));
              if (n === 0) events.emit('notify', { text: 'Beacon found nothing new nearby', kind: 'info' });
            },
          });
        }
        break;
      }
      case 'pod': {
        b.add(sphere(1.4, 10, 8), new THREE.Color(0.8, 0.78, 0.7), trs(0, 1.1, 0, 0.3, 0, 0.2, 1, 1.4, 1));
        b.add(box(1.4, 0.15, 0.2), warm, trs(0, 1.6, 1.25, 0.3, 0, 0), 3);
        for (let i = 0; i < 6; i++) {
          const a = rng.range(0, Math.PI * 2);
          b.add(rockGeometry(rng, 0, 0.5), dark, trs(Math.cos(a) * 2.5, 0, Math.sin(a) * 2.5, 0, 0, 0, 0.5));
        }
        addMesh(b.build());
        p.colliders.push({ local: toLocal(0, 0, 0), radius: 1.3, height: 3 });
        const pk = `${p.id}:pod`;
        if (!this.looted(game, pk)) {
          p.interactables.push({
            key: pk, local: toLocal(0, 1, 1.4), radius: 1.2, prompt: 'Open drop pod',
            action: (g) => {
              this.setLooted(g, pk);
              p.interactables = p.interactables.filter((i) => i.key !== pk);
              const lvl = g.state.level('suit_cargo');
              if (lvl < 5) {
                g.state.data.upgrades.suit_cargo = lvl + 1;
                g.state.refreshCapacities();
                events.emit('notify', { text: 'Exosuit expanded: +4 cargo slots', kind: 'discovery' });
                events.emit('upgrade:installed', { id: 'suit_cargo', level: lvl + 1 });
              } else {
                g.state.give('tech_fragment', 3);
              }
              g.audio.play('ui_confirm');
            },
          });
        }
        break;
      }
      case 'deposit': {
        const col = new THREE.Color(getItem(p.item ?? 'aurium').color);
        for (let i = 0; i < 9; i++) {
          const a = rng.range(0, Math.PI * 2);
          const r = rng.range(0, 4);
          const len = rng.range(2, 6);
          b.add(cone(0.7, 6), col, trs(Math.cos(a) * r, 0, Math.sin(a) * r, rng.range(-0.4, 0.4), 0, rng.range(-0.4, 0.4), 1, len, 1), 1.8);
        }
        b.add(rockGeometry(rng, 1, 0.5), dark, trs(0, 0, 0, 0, 0, 0, 3.5));
        addMesh(b.build());
        p.colliders.push({ local: toLocal(0, 0, 0), radius: 3, height: 5 });
        if (prop('spacebase/drill_structure', 7, 7, 0, -2, rng.range(0, 6), 'y')) p.colliders.push({ local: toLocal(7, 0, -2), radius: 3, height: 7 });
        prop('spacebase/cargo_B_packed', 1.2, 5, 0, 3, rng.range(0, 6));
        const dk = `${p.id}:deposit`;
        if (!this.looted(game, dk)) {
          p.interactables.push({
            key: dk, local: toLocal(0, 1, 3.5), radius: 1.5, prompt: `Extract ${getItem(p.item!).name}`,
            action: (g) => {
              this.setLooted(g, dk);
              p.interactables = p.interactables.filter((i) => i.key !== dk);
              const n = getItem(p.item!).rarity >= 2 ? 25 + rng.int(0, 20) : 90 + rng.int(0, 60);
              g.state.give(p.item!, n);
              events.emit('notify', { text: `Extracted ${n} ${getItem(p.item!).name}`, kind: 'good', icon: p.item });
              g.audio.play('harvest');
              g.effects.spark(this.universePos(p), g.player.up, col.clone().multiplyScalar(2), 40, 8, 0.2, 1);
              g.wardens.onHarvest(g, g.player.pos);
            },
          });
        }
        break;
      }
      case 'ruins': {
        const stone = new THREE.Color(0.62, 0.56, 0.46);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const h = rng.range(1.5, 6);
          b.add(column(0.6, 0.7, 7), stone, trs(Math.cos(a) * 8, 0, Math.sin(a) * 8, rng.range(-0.1, 0.1), 0, rng.range(-0.1, 0.1), 1, h, 1));
          if (i % 2 === 0 && h > 4) b.add(box(3, 0.6, 1), stone, trs(Math.cos(a + 0.2) * 8, h, Math.sin(a + 0.2) * 8, 0, -a, 0));
        }
        b.add(box(4, 0.8, 4), stone, trs(0, 0.4, 0));
        b.add(box(1.2, 1.8, 0.4), stone.clone().multiplyScalar(0.8), trs(0, 1.7, 0));
        b.add(box(0.8, 0.1, 0.42), new THREE.Color(0.9, 0.8, 0.5), trs(0, 2.1, 0), 2);
        addMesh(b.build());
        p.colliders.push({ local: toLocal(0, 0, 0), radius: 2.8, height: 1 });
        const rk = `${p.id}:ruin`;
        if (!this.looted(game, rk)) {
          p.interactables.push({
            key: rk, local: toLocal(0, 1.5, 0.6), radius: 1.2, prompt: 'Examine inscription',
            action: (g) => {
              this.setLooted(g, rk);
              p.interactables = p.interactables.filter((i) => i.key !== rk);
              const relic = rng.chance(0.6);
              if (relic) g.state.give('veil_relic', 1);
              g.state.give('nullite', 4 + rng.int(0, 6));
              g.ui.showLore('Ancient Ruins', RUIN_LORE[rng.int(0, RUIN_LORE.length - 1)], relic ? 'You recovered a Veil Relic.' : 'You recovered traces of Nullite.');
              g.audio.play('ui_confirm');
            },
          });
        }
        break;
      }
    }
    planet.root.add(group);
    group.updateMatrixWorld(true);
    p.group = group;
  }

  lore(): string[] {
    return MONOLITH_LORE;
  }
}
