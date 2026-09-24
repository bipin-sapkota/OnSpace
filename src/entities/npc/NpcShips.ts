import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { Damageable, Faction } from '../../gameplay/Combat';
import { buildShipModel, type ShipModel } from '../ship/ShipModel';
import { allShipClasses } from '../ship/ShipDefs';
import { generatePirateName, generateShipName } from '../../procgen/names';
import { events } from '../../core/EventBus';

type Role = 'trader' | 'pirate';

const _q = new THREE.Quaternion();
const Y = new THREE.Vector3(0, 1, 0);

class NpcShip implements Damageable {
  readonly root = new THREE.Group();
  readonly model: ShipModel;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  radius: number;
  faction: Faction;
  alive = true;
  label: string;
  role: Role;
  health: number;
  maxHealth: number;
  shield: number;
  speed: number;
  agility: number;
  fireTimer = 2;
  muzzle = 0;
  target = new THREE.Vector3();
  breakOff = 0;
  life = 0;
  hostileToPlayer: boolean;

  constructor(role: Role, seed: number) {
    const classes = allShipClasses().filter((c) => c.style !== 'exotic');
    const cls = role === 'pirate' ? classes.find((c) => c.style === 'fighter')! : classes[seed % classes.length];
    this.model = buildShipModel(cls, seed);
    this.root.add(this.model.group);
    this.role = role;
    this.radius = this.model.radius;
    this.faction = role === 'pirate' ? 'hostile' : 'neutral';
    this.hostileToPlayer = role === 'pirate';
    this.label = role === 'pirate' ? generatePirateName(seed) : generateShipName(seed);
    this.maxHealth = this.health = role === 'pirate' ? 110 + (seed % 60) : 160;
    this.shield = role === 'pirate' ? 60 : 40;
    this.speed = role === 'pirate' ? 250 : 160;
    this.agility = role === 'pirate' ? 1.3 : 0.7;
  }

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat);
  }

  get hpFrac(): number {
    return this.health / this.maxHealth;
  }

  hit(damage: number, fromPlayer: boolean, game: Game): void {
    if (!this.alive) return;
    if (this.shield > 0) {
      const s = Math.min(this.shield, damage);
      this.shield -= s;
      damage -= s;
    }
    this.health -= damage;
    if (fromPlayer && !this.hostileToPlayer) {
      this.hostileToPlayer = true;
      this.faction = 'hostile';
      events.emit('notify', { text: `${this.label} is now hostile!`, kind: 'bad' });
    }
    if (this.health <= 0) {
      this.alive = false;
      game.effects.explosion(this.pos, 2.5);
      game.audio.play('explosion', 1);
      if (fromPlayer) {
        const credits = this.role === 'pirate' ? 900 + Math.floor(Math.random() * 1400) : 300;
        game.state.addCredits(credits);
        game.state.give(Math.random() < 0.5 ? 'astrium' : 'voltium', 20 + Math.floor(Math.random() * 30), true);
        if (Math.random() < 0.35) game.state.give('tech_fragment', 1 + Math.floor(Math.random() * 2), true);
        events.emit('notify', { text: `${this.label} destroyed · +${credits} credits`, kind: 'good' });
        events.emit('enemy:killed', { kind: this.role === 'pirate' ? 'pirate' : 'trader', reward: credits });
        game.state.stat(this.role === 'pirate' ? 'piratesDestroyed' : 'tradersDestroyed');
      }
    }
  }
}

/**
 * Space traffic and hostile encounters.
 */
export class NpcShips {
  readonly ships: NpcShip[] = [];
  private parent: THREE.Object3D;
  private trafficTimer = 5;
  private ambushTimer = 90;
  private seq = 1;

  constructor(parent: THREE.Object3D) {
    this.parent = parent;
  }

  get hostileCount(): number {
    return this.ships.filter((s) => s.alive && s.hostileToPlayer).length;
  }

  clear(game: Game): void {
    for (const s of this.ships) {
      s.root.removeFromParent();
      game.combat.unregister(s);
    }
    this.ships.length = 0;
  }

  spawnPirates(game: Game, count: number): void {
    const p = game.ship.pos;
    const base = new THREE.Vector3().randomDirection();
    for (let i = 0; i < count; i++) {
      const s = new NpcShip('pirate', (Date.now() + this.seq++ * 7919) >>> 0);
      s.pos.copy(p).addScaledVector(base, 2600).add(new THREE.Vector3().randomDirection().multiplyScalar(200));
      s.quat.setFromRotationMatrix(new THREE.Matrix4().lookAt(s.pos, p, Y));
      s.vel.copy(s.forward).multiplyScalar(s.speed);
      this.add(s, game);
    }
    events.emit('notify', { text: `Pirate ambush! ${count} raiders inbound`, kind: 'bad' });
    game.audio.play('alarm', 1);
  }

  private add(s: NpcShip, game: Game): void {
    this.parent.add(s.root);
    this.ships.push(s);
    game.combat.register(s);
  }

  private spawnTrader(game: Game): void {
    const sys = game.world.system!;
    const station = sys.stations[0];
    if (!station) return;
    const s = new NpcShip('trader', (this.seq++ * 104729 + sys.desc.seed) >>> 0);
    const fromStation = Math.random() < 0.5;
    const planet = sys.planets[Math.floor(Math.random() * sys.planets.length)];
    const a = fromStation ? station.toUniverse(station.bayEntrance) : planet.position.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(planet.atmosphereRadius + 1500));
    const b = fromStation ? planet.position.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(planet.atmosphereRadius + 1500)) : station.toUniverse(station.bayEntrance);
    s.pos.copy(a);
    s.target.copy(b);
    s.quat.setFromRotationMatrix(new THREE.Matrix4().lookAt(a, b, Y));
    s.vel.copy(s.forward).multiplyScalar(s.speed);
    this.add(s, game);
  }

  update(dt: number, game: Game): void {
    const sys = game.world.system;
    if (!sys) return;
    const inSpace = game.mode === 'ship' && (game.ship.mode === 'flying' || game.ship.mode === 'pulse');
    const playerPos = game.mode === 'ship' || game.mode === 'docked' ? game.ship.pos : game.player.pos;
    const inAtmo = game.world.env.inAtmosphere > 0.05;

    // traffic near the station
    this.trafficTimer -= dt;
    const station = sys.stations[0];
    if (this.trafficTimer <= 0 && station && playerPos.distanceTo(station.position) < 40000) {
      this.trafficTimer = 12 + Math.random() * 10;
      if (this.ships.filter((s) => s.role === 'trader').length < 5) this.spawnTrader(game);
    }

    // pirate ambushes scale with system conflict
    if (inSpace && !inAtmo) {
      this.ambushTimer -= dt * (0.4 + sys.desc.conflict);
      if (this.ambushTimer <= 0) {
        this.ambushTimer = 150 + Math.random() * 200;
        const nearStation = station && game.ship.pos.distanceTo(station.position) < 8000;
        if (!nearStation && game.state.data.quest.step >= 4 && this.hostileCount === 0) this.spawnPirates(game, 1 + Math.floor(Math.random() * (1 + sys.desc.conflict * 3)));
      }
    }

    for (let i = this.ships.length - 1; i >= 0; i--) {
      const s = this.ships[i];
      s.life += dt;
      const far = s.pos.distanceTo(playerPos) > 60000;
      if (!s.alive || far || (s.role === 'trader' && !s.hostileToPlayer && s.pos.distanceTo(s.target) < 300)) {
        s.root.removeFromParent();
        game.combat.unregister(s);
        this.ships.splice(i, 1);
        continue;
      }
      if (s.hostileToPlayer && (game.mode === 'ship') && game.ship.mode !== 'docked') this.fight(s, dt, game);
      else this.cruise(s, s.hostileToPlayer ? s.pos.clone().addScaledVector(s.forward, 1000) : s.target, dt);
      s.pos.addScaledVector(s.vel, dt);
      s.root.position.copy(s.pos);
      s.root.quaternion.copy(s.quat);
      for (const m of s.model.engineGlow) m.scale.set(0.8, 0.8, 2.6);
      s.shield = Math.min(s.role === 'pirate' ? 60 : 40, s.shield + dt * 3);
    }
  }

  private steer(s: NpcShip, dir: THREE.Vector3, dt: number): void {
    const target = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), dir, new THREE.Vector3(0, 1, 0).applyQuaternion(s.quat)));
    const angle = s.quat.angleTo(target);
    const step = Math.min(1, (s.agility * 1.4 * dt) / Math.max(angle, 1e-3));
    s.quat.slerp(target, step);
  }

  private cruise(s: NpcShip, target: THREE.Vector3, dt = 1 / 60): void {
    const dir = target.clone().sub(s.pos).normalize();
    this.steer(s, dir, dt);
    s.vel.lerp(s.forward.multiplyScalar(s.speed), 1 - Math.exp(-dt * 1.5));
  }

  private fight(s: NpcShip, dt: number, game: Game): void {
    const tp = game.ship.pos;
    const to = tp.clone().sub(s.pos);
    const dist = to.length();
    const lead = tp.clone().addScaledVector(game.ship.vel, dist / 1600);
    let dir = lead.sub(s.pos).normalize();
    s.breakOff -= dt;
    if (dist < 250 && s.breakOff <= 0) s.breakOff = 2.5 + Math.random() * 1.5;
    if (s.breakOff > 0) {
      dir = to.clone().normalize().negate().add(new THREE.Vector3(0, 1, 0).applyQuaternion(s.quat)).normalize();
    }
    this.steer(s, dir, dt);
    const sp = s.speed * (dist > 1500 ? 1.6 : 1);
    s.vel.lerp(s.forward.multiplyScalar(sp), 1 - Math.exp(-dt * 1.8));
    s.fireTimer -= dt;
    const facing = s.forward.dot(to.clone().normalize());
    if (s.fireTimer <= 0 && facing > 0.97 && dist < 1600 && s.breakOff <= 0) {
      s.fireTimer = 0.35 + Math.random() * 0.4;
      const m = s.model.muzzles[s.muzzle++ % s.model.muzzles.length];
      const origin = m.clone().applyQuaternion(s.quat).add(s.pos);
      const aim = s.forward.add(new THREE.Vector3().randomDirection().multiplyScalar(0.015)).normalize();
      game.combat.fire({ owner: 'enemy', origin, dir: aim, speed: 1600, inherit: s.vel, damage: 6, life: 1.4, color: new THREE.Color(3.5, 0.4, 0.2), width: 0.3, length: 10 });
      const d = s.pos.distanceTo(game.cameraRig.posU);
      game.audio.play('enemy_laser', Math.max(0, 1 - d / 2500) * 0.6);
    }
    void _q;
  }
}
