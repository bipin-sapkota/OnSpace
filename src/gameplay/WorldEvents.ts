import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Planet } from '../world/Planet';
import { GeoBuilder, ico, rockGeometry, trs } from '../render/GeoKit';
import { propMaterial } from '../render/Materials';
import { buildShipModel } from '../entities/ship/ShipModel';
import { allShipClasses } from '../entities/ship/ShipDefs';
import { events } from '../core/EventBus';
import { RNG } from '../core/Random';
import { getItem } from './Items';

/**
 * Dynamic world events that make the universe feel alive: meteor strikes on
 * planets that leave rare meteorites, and derelict wrecks broadcasting
 * distress signals in space.
 */
export interface DynamicSite {
  id: string;
  label: string;
  color: string;
  pos: () => THREE.Vector3;
  radius: number;
  prompt: string;
  onlyInShip: boolean;
  action: (g: Game) => void;
  expires: number;
  object: THREE.Object3D;
}

interface Meteor {
  planet: Planet;
  from: THREE.Vector3; // planet local
  to: THREE.Vector3;
  t: number;
  dur: number;
}

export class WorldEvents {
  readonly sites: DynamicSite[] = [];
  private meteors: Meteor[] = [];
  private meteorTimer = 120;
  private derelictTimer = 90;
  private mat = propMaterial({ roughness: 0.7, metalness: 0.3 });
  private seq = 0;

  update(dt: number, game: Game): void {
    // meteor strikes while on foot
    if (game.mode === 'foot' && game.player.planet) {
      this.meteorTimer -= dt;
      if (this.meteorTimer <= 0) {
        this.meteorTimer = 240 + Math.random() * 300;
        this.spawnMeteor(game, game.player.planet);
      }
    }
    // derelicts while flying in space
    if (game.mode === 'ship' && game.world.env.inAtmosphere < 0.01 && game.ship.mode === 'flying') {
      this.derelictTimer -= dt;
      if (this.derelictTimer <= 0) {
        this.derelictTimer = 300 + Math.random() * 300;
        if (!this.sites.some((s) => s.onlyInShip)) this.spawnDerelict(game);
      }
    }
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.t += dt;
      const k = Math.min(1, m.t / m.dur);
      const local = m.from.clone().lerp(m.to, k * k);
      const u = m.planet.toUniverse(local);
      game.effects.glowAt(u, new THREE.Color(4, 2, 0.8), 6, 0.3);
      game.effects.puff(u, new THREE.Color(0.25, 0.2, 0.18), 1, 4, 3, 2, undefined, 0.4);
      if (k >= 1) {
        this.meteors.splice(i, 1);
        this.impact(game, m.planet, m.to);
      }
    }
    for (let i = this.sites.length - 1; i >= 0; i--) {
      const s = this.sites[i];
      if (game.time > s.expires) this.removeSite(i);
    }
  }

  private removeSite(i: number): void {
    const s = this.sites[i];
    s.object.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    s.object.removeFromParent();
    this.sites.splice(i, 1);
  }

  clear(): void {
    while (this.sites.length) this.removeSite(this.sites.length - 1);
    this.meteors.length = 0;
  }

  private spawnMeteor(game: Game, planet: Planet): void {
    const p = game.player;
    const up = p.up.clone();
    const side = new THREE.Vector3().randomDirection();
    side.addScaledVector(up, -side.dot(up)).normalize();
    const hitU = p.pos.clone().addScaledVector(side, 180 + Math.random() * 220);
    const hitLocal = planet.toLocal(hitU).normalize();
    hitLocal.multiplyScalar(planet.surfaceRadius(hitLocal));
    if (planet.gen.hasSea && hitLocal.length() < planet.seaRadius) return;
    const from = hitLocal.clone().normalize().multiplyScalar(hitLocal.length() + 1800).add(planet.universeDirToLocal(side).multiplyScalar(-1500));
    this.meteors.push({ planet, from, to: hitLocal, t: 0, dur: 4.5 });
    events.emit('notify', { text: 'Meteor inbound! Impact imminent', kind: 'warn' });
    game.audio.play('warp_charge', 0.4);
  }

  private impact(game: Game, planet: Planet, local: THREE.Vector3): void {
    const u = planet.toUniverse(local);
    game.effects.explosion(u, 4, new THREE.Color(1, 0.5, 0.2));
    game.audio.play('explosion', 1);
    const d = u.distanceTo(game.player.pos);
    game.cameraRig.shake(Math.max(0, 1 - d / 500));
    if (d < 25) game.player.damage(40 * (1 - d / 25), 'meteor', game);
    const item = Math.random() < 0.5 ? 'nullite' : 'aurium';
    const rng = new RNG((Date.now() & 0xffff) + this.seq);
    const b = new GeoBuilder();
    b.add(rockGeometry(rng, 1, 0.8), new THREE.Color(0.18, 0.16, 0.15), trs(0, 0.6, 0, 0, 0, 0, 1.6));
    for (let i = 0; i < 8; i++) {
      const dir = new THREE.Vector3(...rng.unitVector()).multiplyScalar(1.3);
      b.add(ico(0.35, 0), new THREE.Color(getItem(item).color), trs(dir.x, Math.abs(dir.y) + 0.6, dir.z), 2.2);
    }
    const mesh = new THREE.Mesh(b.build(), this.mat);
    mesh.position.copy(local);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), local.clone().normalize());
    planet.root.add(mesh);
    const id = `meteor${this.seq++}`;
    this.sites.push({
      id, label: 'Meteorite', color: '#ffb35c', radius: 3.5, prompt: 'Harvest meteorite', onlyInShip: false,
      pos: () => planet.toUniverse(local),
      object: mesh,
      expires: game.time + 600,
      action: (g) => {
        const n = 18 + Math.floor(Math.random() * 20);
        g.state.give(item, n);
        g.state.give('ferrox', 30);
        events.emit('notify', { text: `Meteorite harvested: +${n} ${getItem(item).name}`, kind: 'good', icon: item });
        g.audio.play('harvest');
        const idx = this.sites.findIndex((s) => s.id === id);
        if (idx >= 0) this.removeSite(idx);
      },
    });
  }

  private spawnDerelict(game: Game): void {
    const rng = new RNG((Date.now() >>> 3) + this.seq++);
    const cls = allShipClasses()[rng.int(0, 3)];
    const model = buildShipModel(cls, rng.int(0, 1e6));
    model.gear.visible = false;
    for (const g of model.engineGlow) g.visible = false;
    model.group.scale.setScalar(6);
    const pos = game.ship.pos.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(9000 + rng.range(0, 6000)));
    const holder = new THREE.Group();
    holder.add(model.group);
    holder.position.copy(pos);
    holder.rotation.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
    game.world.root.add(holder);
    const id = `derelict${this.seq}`;
    this.sites.push({
      id, label: 'Distress Signal', color: '#ff6a5c', radius: 350, prompt: 'Salvage derelict', onlyInShip: true,
      pos: () => pos,
      object: holder,
      expires: game.time + 900,
      action: (g) => {
        const credits = 1500 + rng.int(0, 3000);
        g.state.addCredits(credits);
        g.state.give('tech_fragment', 2 + rng.int(0, 2), true);
        g.state.give(rng.pick(['data_core', 'alloy_plate', 'circuit', 'warp_cell']), 1, true);
        g.ui.showLore('Derelict Salvaged', 'The crew is long gone. The flight recorder loops a fragment of the Silent Signal — and a set of coordinates pointing coreward.', `Recovered ${credits.toLocaleString()} credits and salvage.`);
        g.audio.play('ui_confirm');
        const idx = this.sites.findIndex((s) => s.id === id);
        if (idx >= 0) this.sites[idx].expires = g.time + 60; // leave the hulk drifting briefly
        const site = this.sites[idx];
        if (site) site.prompt = '';
      },
    });
    events.emit('notify', { text: 'Distress signal detected nearby', kind: 'discovery' });
    game.audio.play('scan', 0.5);
    void this.mat;
  }
}
