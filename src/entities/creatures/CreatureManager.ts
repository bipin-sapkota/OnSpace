import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { Planet } from '../../world/Planet';
import { generateSpecies, type Species } from './Species';
import { buildCreature, type CreatureRig } from './CreatureBuilder';
import { planetPropMaterial } from '../../render/Materials';
import type { Damageable, Faction } from '../../gameplay/Combat';
import { events } from '../../core/EventBus';
import { getItem } from '../../gameplay/Items';

type State = 'idle' | 'wander' | 'graze' | 'flee' | 'attack' | 'dead' | 'follow';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const Y = new THREE.Vector3(0, 1, 0);

/**
 * A single animal. Lives in planet-local space as a child of the planet root,
 * so it rotates with the world automatically.
 */
export class Creature implements Damageable {
  readonly species: Species;
  readonly rig: CreatureRig;
  readonly local = new THREE.Vector3();
  readonly heading = new THREE.Vector3(0, 0, -1); // local tangent direction
  readonly pos = new THREE.Vector3(); // universe (updated per frame)
  readonly vel = new THREE.Vector3();
  radius: number;
  faction: Faction;
  alive = true;
  label: string;
  health: number;
  state: State = 'idle';
  stateTime = 0;
  stateDur = 2;
  speed = 0;
  gait = Math.random() * 10;
  target = new THREE.Vector3();
  leader: Creature | null = null;
  provoked = 0;
  attackCooldown = 0;
  flyHeight = 0;
  deadTime = 0;
  callTimer = 3 + Math.random() * 10;
  planet: Planet;

  constructor(sp: Species, planet: Planet, material: THREE.Material) {
    this.species = sp;
    this.planet = planet;
    this.rig = buildCreature(sp, material);
    this.radius = Math.max(0.6, sp.size * 0.7);
    this.faction = sp.temperament === 'aggressive' ? 'hostile' : 'wildlife';
    this.label = sp.name;
    this.health = sp.health;
    this.flyHeight = sp.plan === 'flyer' ? 18 + Math.random() * 30 : 0;
    this.rig.root.userData.creature = this;
  }

  get hpFrac(): number {
    return this.health / this.species.health;
  }

  hit(damage: number, fromPlayer: boolean, game: Game): void {
    if (!this.alive) return;
    this.health -= damage;
    if (fromPlayer) {
      this.provoked = 15;
      if (this.species.temperament === 'aggressive' || (this.species.size > 1.8 && Math.random() < 0.5)) this.setState('attack', 12);
      else this.setState('flee', 8);
      game.creatures.alertHerd(this, game);
      game.wardens.onAttackWildlife(game, this.pos);
    }
    if (this.health <= 0) this.die(game, fromPlayer);
  }

  die(game: Game, byPlayer: boolean): void {
    this.alive = false;
    this.state = 'dead';
    this.deadTime = 0;
    if (byPlayer) {
      const amount = this.species.dropAmount;
      game.state.give(this.species.drop, amount);
      events.emit('notify', { text: `+${amount} ${getItem(this.species.drop).name}`, kind: 'good', icon: this.species.drop });
      events.emit('enemy:killed', { kind: this.species.temperament === 'aggressive' ? 'predator' : 'creature', reward: 0 });
      game.state.stat('creaturesKilled');
    }
    game.audio.creatureCall(this.species.seed + 7, this.species.size, 0.6, 0);
  }

  setState(s: State, dur: number): void {
    this.state = s;
    this.stateTime = 0;
    this.stateDur = dur;
  }
}

/**
 * Spawns and simulates wildlife around the player on the current planet.
 */
export class CreatureManager {
  readonly creatures: Creature[] = [];
  private planet: Planet | null = null;
  private species: Species[] = [];
  private material: THREE.MeshStandardMaterial | null = null;
  private spawnTimer = 0;

  speciesFor(planet: Planet): Species[] {
    if (this.planet === planet) return this.species;
    return generateSpecies(planet.desc);
  }

  private setPlanet(planet: Planet | null, game: Game): void {
    if (planet === this.planet) return;
    this.clear(game);
    this.planet = planet;
    if (planet) {
      this.species = generateSpecies(planet.desc);
      this.material = planetPropMaterial(planet.lu, { roughness: 0.75, metalness: 0.05, key: 'creature' });
    }
  }

  clear(game: Game): void {
    for (const c of this.creatures) {
      c.rig.root.removeFromParent();
      game.combat.unregister(c);
    }
    this.creatures.length = 0;
    this.material?.dispose();
    this.material = null;
    this.planet = null;
    this.species = [];
  }

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, max: number): { c: Creature; dist: number } | null {
    let best: Creature | null = null;
    let bt = max;
    for (const c of this.creatures) {
      if (!c.alive) continue;
      const oc = _v.copy(c.pos).sub(origin);
      const t = oc.dot(dir);
      if (t < 0 || t > bt + c.radius) continue;
      const d2 = oc.lengthSq() - t * t;
      if (d2 < c.radius * c.radius && t < bt) {
        bt = t;
        best = c;
      }
    }
    return best ? { c: best, dist: bt } : null;
  }

  alertHerd(src: Creature, game: Game): void {
    for (const c of this.creatures) {
      if (c === src || !c.alive || c.species !== src.species) continue;
      if (c.local.distanceTo(src.local) < 40) {
        if (c.species.temperament === 'aggressive') c.setState('attack', 10);
        else c.setState('flee', 7);
      }
    }
    void game;
  }

  update(dt: number, game: Game): void {
    const player = game.player;
    const onFoot = game.mode === 'foot';
    const lowShip = game.mode === 'ship' && game.ship.altitude < 300;
    const planet = onFoot ? player.planet : lowShip ? game.ship.nearPlanet : null;
    this.setPlanet(planet ?? null, game);
    if (!this.planet || this.species.length === 0) return;
    const p = this.planet;
    const focus = onFoot ? player.pos : game.ship.pos;
    const focusLocal = p.toLocal(focus, new THREE.Vector3());

    // spawn / despawn
    const night = 1 - game.world.env.day;
    const maxCount = Math.round(Math.min(26, 30 * p.desc.faunaDensity));
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.creatures.filter((c) => c.alive).length < maxCount) {
      this.spawnTimer = 1.2;
      this.trySpawnHerd(focusLocal, night, game);
    }
    for (let i = this.creatures.length - 1; i >= 0; i--) {
      const c = this.creatures[i];
      const d = c.local.distanceTo(focusLocal);
      if (d > 340 || (!c.alive && c.deadTime > 12)) {
        c.rig.root.removeFromParent();
        game.combat.unregister(c);
        this.creatures.splice(i, 1);
      }
    }

    for (const c of this.creatures) this.think(c, dt, game, focusLocal, onFoot);
  }

  private trySpawnHerd(focusLocal: THREE.Vector3, night: number, game: Game): void {
    const p = this.planet!;
    const weights = this.species.map((s) => s.rarity * (s.nocturnal ? 0.3 + night : 1 - night * 0.5));
    let total = 0;
    for (const w of weights) total += w;
    let r = Math.random() * total;
    let sp = this.species[0];
    for (let i = 0; i < this.species.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        sp = this.species[i];
        break;
      }
    }
    const up = focusLocal.clone().normalize();
    const t1 = new THREE.Vector3().crossVectors(up, Math.abs(up.y) < 0.9 ? Y : new THREE.Vector3(1, 0, 0)).normalize();
    const t2 = new THREE.Vector3().crossVectors(up, t1);
    const ang = Math.random() * Math.PI * 2;
    const dist = 70 + Math.random() * 170;
    const center = focusLocal.clone().addScaledVector(t1, Math.cos(ang) * dist).addScaledVector(t2, Math.sin(ang) * dist);
    const n = sp.herd[0] + Math.floor(Math.random() * (sp.herd[1] - sp.herd[0] + 1));
    let leader: Creature | null = null;
    const room = Math.max(0, 30 - this.creatures.length);
    for (let i = 0; i < Math.min(n, room); i++) {
      const pos = center.clone().addScaledVector(t1, (Math.random() - 0.5) * 16).addScaledVector(t2, (Math.random() - 0.5) * 16);
      const dir = pos.clone().normalize();
      const r0 = p.surfaceRadius(dir);
      if (p.gen.hasSea && r0 < p.seaRadius + 0.5) continue;
      const c = new Creature(sp, p, this.material!);
      c.local.copy(dir).multiplyScalar(r0 + c.flyHeight);
      c.heading.copy(t1).applyAxisAngle(dir, Math.random() * Math.PI * 2);
      c.leader = leader;
      if (!leader) leader = c;
      c.setState('wander', 2 + Math.random() * 4);
      this.pickWanderTarget(c);
      p.root.add(c.rig.root);
      this.creatures.push(c);
      game.combat.register(c);
    }
  }

  private pickWanderTarget(c: Creature): void {
    const up = c.local.clone().normalize();
    const t = c.heading.clone().applyAxisAngle(up, (Math.random() - 0.5) * 2.5);
    const d = 10 + Math.random() * 30 + c.flyHeight;
    c.target.copy(c.local).addScaledVector(t, d);
    if (c.leader && c.leader.alive) c.target.copy(c.leader.local).addScaledVector(t, 4 + Math.random() * 6);
  }

  private think(c: Creature, dt: number, game: Game, focusLocal: THREE.Vector3, onFoot: boolean): void {
    const p = this.planet!;
    const sp = c.species;
    c.stateTime += dt;
    c.provoked = Math.max(0, c.provoked - dt);
    c.attackCooldown -= dt;
    const up = _v.copy(c.local).normalize().clone();
    const toPlayer = focusLocal.clone().sub(c.local);
    const pd = toPlayer.length();

    if (!c.alive) {
      c.deadTime += dt;
      c.rig.body.rotation.z = Math.min(Math.PI / 2, c.rig.body.rotation.z + dt * 3);
      if (c.flyHeight > 0) {
        const r = p.surfaceRadius(up);
        const cur = c.local.length();
        if (cur > r + 0.3) c.local.setLength(Math.max(r + 0.3, cur - dt * 15));
      }
      this.applyTransform(c, up, game);
      if (c.deadTime > 8) c.rig.root.scale.setScalar(Math.max(0.01, 1 - (c.deadTime - 8) / 4));
      return;
    }

    // perception
    if (onFoot) {
      if (sp.temperament === 'aggressive' && pd < 26 && c.state !== 'attack' && c.state !== 'flee') c.setState('attack', 10);
      else if (sp.temperament === 'skittish' && pd < 14 && c.state !== 'flee' && game.player.sprinting) c.setState('flee', 5);
    }

    let desiredSpeed = 0;
    switch (c.state) {
      case 'idle':
      case 'graze':
        if (c.stateTime > c.stateDur) {
          c.setState('wander', 3 + Math.random() * 6);
          this.pickWanderTarget(c);
        }
        break;
      case 'wander': {
        const to = c.target.clone().sub(c.local);
        to.addScaledVector(up, -to.dot(up));
        if (to.length() < 1.5 || c.stateTime > c.stateDur) {
          c.setState(Math.random() < 0.5 ? 'graze' : 'idle', 2 + Math.random() * 5);
        } else {
          c.heading.lerp(to.normalize(), 1 - Math.exp(-dt * 2));
          desiredSpeed = sp.walkSpeed;
        }
        break;
      }
      case 'flee': {
        const away = toPlayer.clone().negate();
        away.addScaledVector(up, -away.dot(up)).normalize();
        c.heading.lerp(away, 1 - Math.exp(-dt * 4));
        desiredSpeed = sp.runSpeed;
        if (c.stateTime > c.stateDur) c.setState('wander', 3);
        break;
      }
      case 'attack': {
        if (!onFoot) {
          c.setState('wander', 3);
          break;
        }
        const to = toPlayer.clone();
        to.addScaledVector(up, -to.dot(up));
        c.heading.lerp(to.normalize(), 1 - Math.exp(-dt * 5));
        const reach = c.radius + 1.2;
        desiredSpeed = pd > reach ? sp.runSpeed * 0.9 : 0;
        if (pd <= reach + 0.5 && c.attackCooldown <= 0) {
          c.attackCooldown = 1.3;
          const dmg = 6 + sp.size * 5;
          game.player.damage(dmg, sp.name, game);
          game.audio.creatureCall(sp.seed, sp.size, 0.8, 0);
        }
        if (c.stateTime > c.stateDur && c.provoked <= 0 && pd > 30) c.setState('wander', 4);
        if (pd > 80) c.setState('wander', 4);
        break;
      }
    }
    c.heading.addScaledVector(up, -c.heading.dot(up)).normalize();
    c.speed = THREE.MathUtils.lerp(c.speed, desiredSpeed, 1 - Math.exp(-dt * 3));
    c.local.addScaledVector(c.heading, c.speed * dt);

    // ground follow
    const dir = c.local.clone().normalize();
    let ground = p.surfaceRadius(dir);
    if (p.gen.hasSea && ground < p.seaRadius) {
      // refuse to walk into water
      ground = p.seaRadius;
      if (c.flyHeight === 0) {
        c.local.addScaledVector(c.heading, -c.speed * dt * 2);
        c.heading.negate();
      }
    }
    const targetR = ground + c.flyHeight + (c.flyHeight > 0 ? Math.sin(c.gait * 0.1) * 3 : 0);
    const curR = c.local.length();
    c.local.setLength(c.flyHeight > 0 ? THREE.MathUtils.lerp(curR, targetR, 1 - Math.exp(-dt * 2)) : targetR);

    // collisions with trees etc.
    p.scatter.collide(c.local, c.radius * 0.6);

    // animation
    c.gait += dt * (c.speed / Math.max(0.3, sp.size)) * 3.2;
    const amp = Math.min(0.7, c.speed / Math.max(0.5, sp.walkSpeed) * 0.35);
    c.rig.legs.forEach((leg, i) => {
      leg.rotation.x = Math.sin(c.gait + c.rig.legPhase[i]) * amp;
    });
    const hop = sp.plan === 'hopper' ? Math.abs(Math.sin(c.gait)) * sp.size * 0.5 * Math.min(1, c.speed / 2) : Math.abs(Math.sin(c.gait * 2)) * sp.size * 0.04 * Math.min(1, c.speed);
    c.rig.body.position.y = c.rig.hipHeight + hop;
    const grazing = c.state === 'graze';
    c.rig.head.rotation.x = THREE.MathUtils.lerp(c.rig.head.rotation.x, grazing ? 0.6 + Math.sin(c.stateTime * 3) * 0.1 : Math.sin(c.gait * 0.5) * 0.05, 1 - Math.exp(-dt * 3));
    if (c.state === 'attack' || (pd < 15 && c.state === 'idle')) {
      // look toward player
      c.rig.head.rotation.y = THREE.MathUtils.lerp(c.rig.head.rotation.y, 0, dt * 3);
    }
    if (c.rig.tail) c.rig.tail.rotation.y = Math.sin(c.gait * 0.7 + c.stateTime) * 0.4;
    for (let i = 0; i < c.rig.wings.length; i++) {
      c.rig.wings[i].rotation.z = Math.sin(game.time * 9 + c.gait * 0.2) * 0.7 * (i === 0 ? 1 : -1);
    }

    // calls
    c.callTimer -= dt;
    if (c.callTimer <= 0) {
      c.callTimer = 6 + Math.random() * 14;
      if (pd < 120) game.audio.creatureCall(sp.seed, sp.size, Math.max(0, 1 - pd / 120) * 0.7, 0);
    }
    this.applyTransform(c, dir, game);
  }

  private applyTransform(c: Creature, up: THREE.Vector3, game: Game): void {
    const root = c.rig.root;
    root.position.copy(c.local);
    // orientation: +Y = up, -Z = heading
    const f = c.heading;
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), f, up);
    _q.setFromRotationMatrix(m);
    root.quaternion.slerp(_q, 0.25);
    this.planet!.toUniverse(c.local, c.pos);
    c.pos.addScaledVector(this.planet!.localDirToUniverse(up, new THREE.Vector3()), c.species.size * 0.5);
    void game;
  }
}
