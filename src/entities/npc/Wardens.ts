import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { Planet } from '../../world/Planet';
import type { Damageable, Faction } from '../../gameplay/Combat';
import { GeoBuilder, sphere, box, trs, column } from '../../render/GeoKit';
import { propMaterial } from '../../render/Materials';
import { events } from '../../core/EventBus';

/**
 * Wardens: ancient automated custodians that patrol worlds. Excessive mining
 * or attacks on wildlife raise the alert level and summon hostile drones.
 */
class Drone implements Damageable {
  readonly group: THREE.Group;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly local = new THREE.Vector3();
  radius = 1.3;
  faction: Faction = 'hostile';
  alive = true;
  label = 'Warden Drone';
  health: number;
  maxHealth: number;
  hostile: boolean;
  fireTimer = 1 + Math.random();
  strafe = Math.random() < 0.5 ? 1 : -1;
  eye: THREE.Mesh;
  bobPhase = Math.random() * 10;
  planet: Planet;

  constructor(planet: Planet, hostile: boolean, heavy: boolean, geo: THREE.BufferGeometry, mat: THREE.Material) {
    this.planet = planet;
    this.hostile = hostile;
    this.faction = hostile ? 'hostile' : 'neutral';
    this.health = this.maxHealth = heavy ? 140 : 70;
    this.group = new THREE.Group();
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    if (heavy) m.scale.setScalar(1.6);
    this.radius = heavy ? 2.1 : 1.3;
    this.group.add(m);
    this.eye = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.6, 0.2) }));
    this.eye.position.set(0, 0, -0.95 * (heavy ? 1.6 : 1));
    this.group.add(this.eye);
  }

  get hpFrac(): number {
    return this.health / this.maxHealth;
  }

  hit(damage: number, fromPlayer: boolean, game: Game): void {
    if (!this.alive) return;
    this.health -= damage;
    if (fromPlayer) game.wardens.raise(game, 0.6, this.pos);
    if (this.health <= 0) {
      this.alive = false;
      game.effects.explosion(this.pos, 1.2);
      game.audio.play('explosion', 0.7);
      const volt = 10 + Math.floor(Math.random() * 20);
      game.state.give('voltium', volt);
      if (Math.random() < 0.45) game.state.give('tech_fragment', 1);
      events.emit('notify', { text: `Warden drone destroyed (+${volt} Voltium)`, kind: 'good' });
      events.emit('enemy:killed', { kind: 'warden', reward: 0 });
      game.state.stat('wardensDestroyed');
    }
  }
}

export class WardenManager {
  alert = 0; // 0..3
  private drones: Drone[] = [];
  private planet: Planet | null = null;
  private geo: THREE.BufferGeometry;
  private mat: THREE.MeshStandardMaterial;
  private patrolTimer = 5;
  private calm = 0;

  constructor() {
    const b = new GeoBuilder();
    const shell = new THREE.Color(0.75, 0.72, 0.66);
    const dark = new THREE.Color(0.15, 0.15, 0.17);
    b.add(sphere(0.9, 12, 8), shell);
    b.add(column(1.25, 1.25, 16), dark, trs(0, -0.12, 0, 0, 0, 0, 1, 0.24, 1));
    b.add(box(0.2, 0.8, 0.2), dark, trs(0, -1.1, 0));
    b.add(box(1.8, 0.08, 0.3), new THREE.Color(1, 0.4, 0.15), trs(0, 0, 0), 2.5);
    this.geo = b.build();
    this.mat = propMaterial({ roughness: 0.35, metalness: 0.6 });
  }

  get stars(): number {
    return Math.floor(this.alert);
  }

  get activeHostiles(): number {
    return this.drones.filter((d) => d.alive && d.hostile).length;
  }

  raise(game: Game, amount: number, at: THREE.Vector3): void {
    const planet = game.player.planet;
    if (!planet || planet.desc.wardenLevel <= 0.02) return;
    const before = this.stars;
    this.alert = Math.min(3, this.alert + amount);
    this.calm = 0;
    if (this.stars > before) {
      events.emit('notify', { text: `Warden alert level ${this.stars}`, kind: 'bad' });
      game.audio.play('alarm', 0.8);
      const n = this.stars === 1 ? 2 : this.stars === 2 ? 3 : 4;
      for (let i = 0; i < n; i++) this.spawn(game, planet, true, this.stars >= 3 && i === 0, at);
      for (const d of this.drones) {
        d.hostile = true;
        d.faction = 'hostile';
      }
    }
  }

  onHarvest(game: Game, at: THREE.Vector3): void {
    const p = game.player.planet;
    if (!p) return;
    this.raise(game, 0.06 * p.desc.wardenLevel * p.desc.wardenLevel * 1.5, at);
  }

  onAttackWildlife(game: Game, at: THREE.Vector3): void {
    const p = game.player.planet;
    if (!p) return;
    this.raise(game, 0.35 * p.desc.wardenLevel, at);
  }

  private spawn(game: Game, planet: Planet, hostile: boolean, heavy: boolean, near: THREE.Vector3): void {
    const d = new Drone(planet, hostile, heavy, this.geo, this.mat);
    const up = near.clone().sub(planet.position).normalize();
    const side = new THREE.Vector3().randomDirection().addScaledVector(up, -0.9).normalize();
    const u = near.clone().addScaledVector(side, 60 + Math.random() * 40).addScaledVector(up, 25);
    planet.toLocal(u, d.local);
    planet.root.add(d.group);
    this.drones.push(d);
    game.combat.register(d);
    game.effects.glowAt(u, new THREE.Color(3, 1, 0.3), 3, 0.5);
  }

  clear(game: Game): void {
    for (const d of this.drones) {
      d.group.removeFromParent();
      game.combat.unregister(d);
    }
    this.drones.length = 0;
  }

  update(dt: number, game: Game): void {
    const onFoot = game.mode === 'foot';
    const planet = onFoot ? game.player.planet : null;
    if (planet !== this.planet) {
      this.clear(game);
      this.alert = 0;
      this.planet = planet;
    }
    if (!planet) return;
    const playerLocal = planet.toLocal(game.player.eye, new THREE.Vector3());

    // passive patrols on guarded worlds
    this.patrolTimer -= dt;
    if (this.patrolTimer <= 0) {
      this.patrolTimer = 20;
      const patrols = this.drones.filter((d) => d.alive).length;
      if (patrols < Math.round(planet.desc.wardenLevel * 2) && Math.random() < planet.desc.wardenLevel) this.spawn(game, planet, false, false, game.player.pos);
    }

    // alert decay when no hostiles remain
    if (this.activeHostiles === 0) {
      this.calm += dt;
      if (this.calm > 8) this.alert = Math.max(0, this.alert - dt * 0.15);
    }

    for (let i = this.drones.length - 1; i >= 0; i--) {
      const d = this.drones[i];
      if (!d.alive) {
        d.group.removeFromParent();
        game.combat.unregister(d);
        this.drones.splice(i, 1);
        continue;
      }
      const up = d.local.clone().normalize();
      const to = playerLocal.clone().sub(d.local);
      const dist = to.length();
      if (dist > 500) {
        d.group.removeFromParent();
        game.combat.unregister(d);
        this.drones.splice(i, 1);
        continue;
      }
      let desired = new THREE.Vector3();
      if (d.hostile) {
        const flat = to.clone().addScaledVector(up, -to.dot(up));
        const fd = flat.length();
        const fn = flat.normalize();
        const tangent = new THREE.Vector3().crossVectors(up, fn).multiplyScalar(d.strafe);
        desired.addScaledVector(fn, (fd - 18) * 0.8).addScaledVector(tangent, 5);
        d.fireTimer -= dt;
        if (d.fireTimer <= 0 && dist < 90) {
          d.fireTimer = 1.1 + Math.random() * 0.8;
          const origin = planet.toUniverse(d.local, new THREE.Vector3());
          const target = game.player.eye.clone().addScaledVector(game.player.vel, dist / 120);
          const dir = target.sub(origin).normalize();
          dir.x += (Math.random() - 0.5) * 0.04;
          dir.y += (Math.random() - 0.5) * 0.04;
          game.combat.fire({ owner: 'enemy', origin, dir, speed: 120, damage: 7, life: 1.5, color: new THREE.Color(3.5, 0.5, 0.2), width: 0.08, length: 1.4 });
          game.audio.play('enemy_laser', 0.5);
        }
        if (Math.random() < dt * 0.3) d.strafe *= -1;
      } else {
        // patrol: drift around the player at a distance
        const tangent = new THREE.Vector3().crossVectors(up, to.clone().normalize());
        desired.addScaledVector(tangent, 4).addScaledVector(to.normalize(), dist > 90 ? 3 : -1);
      }
      // hover height
      const ground = planet.surfaceRadius(up);
      const hTarget = ground + (d.hostile ? 7 : 12) + Math.sin(game.time * 1.3 + d.bobPhase) * 1.2;
      desired.addScaledVector(up, (hTarget - d.local.length()) * 2);
      d.vel.lerp(desired, 1 - Math.exp(-dt * 2));
      d.local.addScaledVector(d.vel, dt);
      d.group.position.copy(d.local);
      const look = new THREE.Matrix4().lookAt(new THREE.Vector3(), (dist > 0.1 ? to : up).clone().normalize(), up);
      d.group.quaternion.slerp(new THREE.Quaternion().setFromRotationMatrix(look), 1 - Math.exp(-dt * 4));
      planet.toUniverse(d.local, d.pos);
      (d.eye.material as THREE.MeshBasicMaterial).color.setRGB(d.hostile ? 4 : 0.4, d.hostile ? 0.5 : 2, d.hostile ? 0.2 : 3);
    }
  }
}
