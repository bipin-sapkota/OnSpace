import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { Planet } from '../../world/Planet';
import type { Station } from '../../world/Station';
import { buildShipModel, type ShipModel } from './ShipModel';
import { getShipClass, type ShipClass } from './ShipDefs';
import { events } from '../../core/EventBus';
import type { LoopHandle } from '../../audio/AudioEngine';

export type ShipMode = 'landed' | 'launching' | 'flying' | 'landing' | 'pulse' | 'docking' | 'docked' | 'undocking' | 'warp';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const Y = new THREE.Vector3(0, 1, 0);

/**
 * The player's starship. Arcade-Newtonian flight with a virtual joystick,
 * atmospheric speed limits, terrain avoidance, auto-landing, launch thrusters,
 * pulse drive and station docking.
 */
export class PlayerShip {
  readonly root = new THREE.Group();
  model!: ShipModel;
  cls!: ShipClass;
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  readonly vel = new THREE.Vector3();
  private angVel = new THREE.Vector3();
  readonly stick = new THREE.Vector2();
  throttle = 0;
  mode: ShipMode = 'landed';
  landedPlanet: Planet | null = null;
  readonly landedLocal = new THREE.Vector3();
  readonly landedLocalQuat = new THREE.Quaternion();
  dockedAt: Station | null = null;
  private modeTime = 0;
  private fireCooldown = 0;
  private muzzleIndex = 0;
  private lastDamage = -100;
  private transitStart = new THREE.Vector3();
  private transitQuat = new THREE.Quaternion();
  boosting = false;
  pulseSpeed = 0;
  speed = 0;
  altitude = Infinity;
  nearPlanet: Planet | null = null;
  private engine: LoopHandle | null = null;
  private pulseLoop: LoopHandle | null = null;
  gearDeploy = 1;
  lockedTarget: { pos: THREE.Vector3; vel: THREE.Vector3 } | null = null;

  constructor(parent: THREE.Object3D) {
    parent.add(this.root);
  }

  rebuild(classId: string, seed: number): void {
    if (this.model) {
      this.root.remove(this.model.group);
      this.model.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    this.cls = getShipClass(classId);
    this.model = buildShipModel(this.cls, seed);
    this.root.add(this.model.group);
  }

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat);
  }

  get upVec(): THREE.Vector3 {
    return new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat);
  }

  setMode(m: ShipMode): void {
    this.mode = m;
    this.modeTime = 0;
    events.emit('mode:changed', { mode: `ship:${m}` });
  }

  /** Land the ship at a planet-local pose (used at game start and on load). */
  placeLanded(planet: Planet, localPos: THREE.Vector3, localQuat: THREE.Quaternion): void {
    this.landedPlanet = planet;
    this.landedLocal.copy(localPos);
    this.landedLocalQuat.copy(localQuat);
    this.syncLanded();
    this.vel.set(0, 0, 0);
    this.throttle = 0;
    this.gearDeploy = 1;
    this.setMode('landed');
  }

  private syncLanded(): void {
    const p = this.landedPlanet!;
    p.toUniverse(this.landedLocal, this.pos);
    this.quat.copy(p.root.quaternion).multiply(this.landedLocalQuat);
  }

  /** Find a landing pose on the ground below a universe point. */
  static groundPose(planet: Planet, u: THREE.Vector3, facing: THREE.Vector3, gearHeight: number): { local: THREE.Vector3; quat: THREE.Quaternion } {
    const localDir = planet.toLocal(u, new THREE.Vector3()).normalize();
    let r = planet.surfaceRadius(localDir);
    if (planet.gen.hasSea) r = Math.max(r, planet.seaRadius);
    // sample a few points around to avoid sinking gear on slopes
    const local = localDir.clone().multiplyScalar(r + gearHeight + 0.2);
    const upL = localDir.clone();
    const facingL = planet.universeDirToLocal(facing, new THREE.Vector3());
    const f = facingL.addScaledVector(upL, -facingL.dot(upL)).normalize();
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), f, upL);
    const quat = new THREE.Quaternion().setFromRotationMatrix(m);
    return { local, quat };
  }

  damage(amount: number, game: Game): void {
    const st = game.state.ship;
    this.lastDamage = game.time;
    let left = amount;
    if (st.shield > 0) {
      const s = Math.min(st.shield, left);
      st.shield -= s;
      left -= s;
      game.audio.play('shield_hit', 0.7);
    }
    if (left > 0) {
      st.hull = Math.max(0, st.hull - left);
      game.audio.play('hit', 0.9);
      game.cameraRig.shake(Math.min(1, left / 30));
    }
    events.emit('ship:damaged', { amount });
    if (st.hull <= 0) events.emit('ship:destroyed', {});
  }

  update(dt: number, game: Game, piloting: boolean): void {
    this.modeTime += dt;
    const sys = game.world.system!;
    const near = sys.nearestPlanet(this.pos);
    this.nearPlanet = near.planet;
    const planet = near.planet;
    const alt = planet.altitudeAt(this.pos);
    this.altitude = alt.altitude;
    const atmoH = planet.desc.atmosphere.enabled ? planet.desc.atmosphere.height : planet.desc.terrain.heightScale * 2;
    const inAtmo = alt.altitude < atmoH;
    const st = game.state.ship;

    // carry with planet rotation while low
    if (this.mode !== 'landed' && this.mode !== 'docked' && this.mode !== 'docking' && this.mode !== 'undocking' && alt.altitude < atmoH * 1.5) {
      this.pos.sub(planet.position).applyQuaternion(planet.spinDelta).add(planet.position);
      this.quat.premultiply(planet.spinDelta);
      this.vel.applyQuaternion(planet.spinDelta);
    }

    switch (this.mode) {
      case 'landed':
        if (this.landedPlanet) this.syncLanded();
        this.vel.set(0, 0, 0);
        this.gearDeploy = Math.min(1, this.gearDeploy + dt);
        if (piloting && !game.uiBlocking && (game.input.wasPressed('up') || game.input.wasPressed('forward'))) this.tryLaunch(game);
        break;
      case 'launching': {
        const up = alt.up;
        const t = this.modeTime;
        const climb = Math.min(40, 8 + t * 18);
        this.vel.lerp(up.clone().multiplyScalar(climb).addScaledVector(this.forward, t * 12), 1 - Math.exp(-dt * 3));
        this.pos.addScaledVector(this.vel, dt);
        this.gearDeploy = Math.max(0, this.gearDeploy - dt * 0.8);
        game.cameraRig.shake(0.25 * Math.max(0, 1 - t / 3));
        if (t > 3.2) {
          this.throttle = 0.35;
          this.setMode('flying');
          events.emit('ship:launched', {});
        }
        break;
      }
      case 'flying':
      case 'pulse':
        this.fly(dt, game, piloting, planet, alt, inAtmo, atmoH);
        break;
      case 'landing': {
        const target = this.landedPlanet!.toUniverse(this.landedLocal, new THREE.Vector3());
        const tq = this.landedPlanet!.root.quaternion.clone().multiply(this.landedLocalQuat);
        const d = target.clone().sub(this.pos);
        const dist = d.length();
        const sp = Math.min(dist * 1.6, 60);
        this.vel.lerp(d.normalize().multiplyScalar(sp), 1 - Math.exp(-dt * 3));
        this.pos.addScaledVector(this.vel, dt);
        this.quat.slerp(tq, 1 - Math.exp(-dt * 2.5));
        this.gearDeploy = Math.min(1, this.gearDeploy + dt * 0.7);
        this.throttle = 0;
        if (dist < 0.3 || this.modeTime > 12) {
          this.setMode('landed');
          this.syncLanded();
          game.audio.play('land', 0.8);
          events.emit('ship:landed', { planet: this.landedPlanet!.desc.id });
        }
        break;
      }
      case 'docking':
      case 'undocking': {
        const s = this.dockedAt!;
        const entrance = s.toUniverse(s.bayEntrance);
        const pad = s.toUniverse(s.bayPad.clone().add(new THREE.Vector3(0, this.model.gearHeight + 0.3, 0)));
        const outside = s.toUniverse(s.bayEntrance.clone().add(new THREE.Vector3(0, 0, 450)));
        const faceIn = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), new THREE.Vector3(0, 0, -1), Y)).premultiply(s.quaternion);
        const faceOut = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), Y)).premultiply(s.quaternion);
        const T = this.mode === 'docking' ? 7 : 5;
        const t = Math.min(1, this.modeTime / T);
        const e = t * t * (3 - 2 * t);
        if (this.mode === 'docking') {
          // bezier: start -> entrance -> pad
          const a = this.transitStart.clone().lerp(entrance, e);
          const b = entrance.clone().lerp(pad, e);
          this.pos.copy(a.lerp(b, e));
          if (e < 0.6) this.quat.copy(this.transitQuat).slerp(faceIn, e / 0.6);
          else this.quat.copy(faceIn).slerp(faceOut, (e - 0.6) / 0.4);
          this.gearDeploy = e;
          this.throttle = 0.2 * (1 - e);
          if (t >= 1) {
            this.setMode('docked');
            game.audio.play('dock');
            events.emit('ship:docked', { station: s.desc.id });
          }
        } else {
          const a = pad.clone().lerp(entrance, e);
          const b = entrance.clone().lerp(outside, e);
          this.pos.copy(a.lerp(b, e));
          this.quat.copy(faceOut);
          this.gearDeploy = 1 - e;
          this.throttle = 0.3 * e;
          if (t >= 1) {
            this.dockedAt = null;
            this.vel.copy(this.forward).multiplyScalar(60);
            this.setMode('flying');
            events.emit('ship:undocked', {});
          }
        }
        break;
      }
      case 'docked': {
        const s = this.dockedAt!;
        this.pos.copy(s.toUniverse(s.bayPad.clone().add(new THREE.Vector3(0, this.model.gearHeight + 0.3, 0))));
        this.vel.set(0, 0, 0);
        this.throttle = 0;
        break;
      }
      case 'warp':
        break;
    }

    // shields regen
    const maxShield = game.state.maxShipShield;
    if (game.time - this.lastDamage > 5 && st.shield < maxShield) st.shield = Math.min(maxShield, st.shield + maxShield * 0.08 * dt);

    this.speed = this.vel.length();
    this.root.position.copy(this.pos);
    this.root.quaternion.copy(this.quat);
    this.model.gear.visible = this.gearDeploy > 0.02;
    this.model.gear.scale.setScalar(Math.max(0.01, this.gearDeploy));
    const glow = this.mode === 'landed' || this.mode === 'docked' ? 0 : 0.12 + Math.max(0, this.throttle) * 0.9 + (this.boosting ? 0.6 : 0) + (this.mode === 'pulse' ? 1.2 : 0);
    for (const m of this.model.engineGlow) {
      m.scale.set(0.35 + glow * 0.45, 0.35 + glow * 0.45, 0.6 + glow * 3);
      (m.material as THREE.MeshBasicMaterial).opacity = Math.min(1, glow);
      m.visible = glow > 0.02;
    }
    this.updateSound(game, piloting);
  }

  private updateSound(game: Game, piloting: boolean): void {
    if (!game.audio.ready) return;
    if (!this.engine) this.engine = game.audio.loop('engine');
    if (!this.pulseLoop) this.pulseLoop = game.audio.loop('pulse');
    const active = this.mode !== 'landed' && this.mode !== 'docked';
    const near = piloting ? 1 : Math.max(0, 1 - game.player.pos.distanceTo(this.pos) / 150);
    const v = active ? (0.18 + this.throttle * 0.25 + (this.boosting ? 0.15 : 0)) * near : 0;
    this.engine.set(v, 0.7 + this.throttle * 0.8 + (this.boosting ? 0.4 : 0), 300 + this.throttle * 1500 + (this.boosting ? 800 : 0));
    this.pulseLoop.set(this.mode === 'pulse' ? 0.35 * Math.min(1, this.pulseSpeed / 3000) : 0, 1 + this.pulseSpeed / 15000, 600 + this.pulseSpeed * 0.1);
  }

  stopSounds(): void {
    this.engine?.set(0);
    this.pulseLoop?.set(0);
  }

  tryLaunch(game: Game): boolean {
    const st = game.state.ship;
    if (st.launchFuel < 0.25 - 1e-6) {
      events.emit('notify', { text: 'Launch thrusters depleted — recharge with Hydrex or a Launch Fuel Cell', kind: 'warn' });
      game.audio.play('ui_error');
      return false;
    }
    st.launchFuel = Math.max(0, st.launchFuel - 0.25);
    this.landedPlanet = null;
    this.setMode('launching');
    game.audio.play('launch', 1);
    return true;
  }

  beginLanding(game: Game): boolean {
    const planet = this.nearPlanet;
    if (!planet) return false;
    if (this.altitude > 700) {
      events.emit('notify', { text: 'Too high to land — descend below 700 m', kind: 'warn' });
      return false;
    }
    const alt = planet.altitudeAt(this.pos);
    const ahead = this.pos.clone().addScaledVector(this.forward.addScaledVector(alt.up, -this.forward.dot(alt.up)).normalize(), Math.min(60, this.speed * 1.2));
    const pose = PlayerShip.groundPose(planet, ahead, this.forward, this.model.gearHeight);
    if (planet.gen.hasSea && planet.desc.terrain.liquid !== 'ice') {
      const r = planet.surfaceRadius(pose.local.clone().normalize());
      if (r < planet.seaRadius + 0.5) {
        events.emit('notify', { text: 'Cannot land on liquid', kind: 'warn' });
        return false;
      }
    }
    this.landedPlanet = planet;
    this.landedLocal.copy(pose.local);
    this.landedLocalQuat.copy(pose.quat);
    this.setMode('landing');
    game.audio.play('land', 0.4);
    return true;
  }

  beginDocking(station: Station): void {
    this.dockedAt = station;
    this.transitStart.copy(this.pos);
    this.transitQuat.copy(this.quat);
    this.setMode('docking');
  }

  beginUndock(): void {
    this.setMode('undocking');
  }

  private fly(dt: number, game: Game, piloting: boolean, planet: Planet, alt: ReturnType<Planet['altitudeAt']>, inAtmo: boolean, atmoH: number): void {
    const input = game.input;
    const cls = this.cls;
    const st = game.state;
    const thr = st.level('ship_thrusters');
    const agility = cls.agility * (1 + thr * 0.1);
    const ctl = piloting && !game.uiBlocking;

    // virtual joystick from mouse
    if (ctl && input.locked) {
      const m = input.consumeMouse();
      this.stick.x += m.dx * 0.0032;
      this.stick.y += m.dy * 0.0032;
    }
    if (this.stick.length() > 1) this.stick.normalize();
    this.stick.multiplyScalar(Math.max(0, 1 - dt * 1.8));

    const pulsing = this.mode === 'pulse';
    const steer = pulsing ? 0.35 : 1;
    const roll = ctl ? input.axis('rollRight', 'rollLeft') : 0;
    const target = new THREE.Vector3(-this.stick.y * 1.5 * agility * steer, -this.stick.x * 1.25 * agility * steer, roll * 1.9 * agility - this.stick.x * 0.6 * agility);
    this.angVel.lerp(target, 1 - Math.exp(-dt * 6));
    _e.set(this.angVel.x * dt, this.angVel.y * dt, this.angVel.z * dt, 'XYZ');
    this.quat.multiply(_q.setFromEuler(_e)).normalize();

    // gentle auto-level in atmosphere when not rolling
    if (inAtmo && Math.abs(roll) < 0.1) {
      const up = alt.up;
      const fwd = this.forward;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat);
      const bank = right.dot(up);
      if (Math.abs(fwd.dot(up)) < 0.9) this.quat.multiply(_q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -bank * dt * 1.2));
    }

    // throttle
    if (ctl) {
      if (input.isDown('forward')) this.throttle = Math.min(1, this.throttle + dt * 0.9);
      if (input.isDown('back')) this.throttle = Math.max(-0.15, this.throttle - dt * 1.3);
    }
    this.boosting = ctl && input.isDown('boost') && this.throttle > 0.1 && !pulsing;

    const atmoFactor = inAtmo ? THREE.MathUtils.lerp(0.55, 1, THREE.MathUtils.clamp(alt.altitude / atmoH, 0, 1)) : 1;
    const maxSpeed = cls.speed * (1 + thr * 0.12) * atmoFactor;
    let targetSpeed = this.throttle * maxSpeed * (this.boosting ? cls.boost : 1);

    // pulse drive
    if (ctl && input.wasPressed('pulse')) {
      if (pulsing) this.exitPulse(game);
      else this.tryPulse(game, inAtmo);
    }
    if (this.mode === 'pulse') {
      const pl = st.level('ship_pulse');
      const top = 16000 * (1 + pl * 0.15);
      this.pulseSpeed = Math.min(top, this.pulseSpeed + dt * (1500 + this.pulseSpeed * 0.9));
      targetSpeed = this.pulseSpeed;
      st.ship.pulseFuel = Math.max(0, st.ship.pulseFuel - (dt * 0.011 * (1 - pl * 0.25)) / cls.pulseEfficiency);
      game.cameraRig.shake(0.05);
      // auto drop-out near bodies
      const sys = game.world.system!;
      let drop = st.ship.pulseFuel <= 0;
      for (const p of sys.planets) {
        const d = p.position.distanceTo(this.pos) - p.atmosphereRadius;
        const ahead = this.forward.dot(p.position.clone().sub(this.pos).normalize()) > 0;
        if (d < 3000 + (ahead ? this.pulseSpeed * 0.6 : 0)) drop = true;
      }
      for (const s of sys.stations) if (s.position.distanceTo(this.pos) < 2500 + this.pulseSpeed * 0.3 && this.forward.dot(s.position.clone().sub(this.pos)) > 0) drop = true;
      if (drop) this.exitPulse(game);
    } else this.pulseSpeed = Math.max(0, this.pulseSpeed - dt * 20000);

    // atmospheric entry: fast descent through the upper atmosphere heats the hull
    if (inAtmo && planet.desc.atmosphere.enabled && alt.altitude > atmoH * 0.25) {
      const descent = -this.vel.dot(alt.up);
      const heat = THREE.MathUtils.clamp((this.speed - 180) / 400, 0, 1) * THREE.MathUtils.clamp(descent / 80, 0, 1);
      if (heat > 0.05) {
        game.cameraRig.shake(heat * 0.12);
        const nose = this.pos.clone().addScaledVector(this.forward, this.model.length * 0.5);
        const back = this.vel.clone().normalize().negate();
        game.effects.spark(nose, back, new THREE.Color(3, 1.2, 0.4).multiplyScalar(0.5 + heat), Math.ceil(heat * 6), this.speed * 0.4, 1.2 * heat + 0.3, 0.35);
        game.effects.glowAt(nose, new THREE.Color(2.5, 1.0, 0.3), this.model.length * 0.8 * heat, 0.08);
      }
    }

    const desired = this.forward.multiplyScalar(targetSpeed);
    const accel = pulsing ? 2.5 : this.boosting ? 1.6 : 1.2;
    this.vel.lerp(desired, 1 - Math.exp(-dt * accel));

    // terrain avoidance
    const up = alt.up;
    if (alt.altitude < 40) {
      const push = (40 - alt.altitude) / 40;
      const vn = this.vel.dot(up);
      if (vn < 0) this.vel.addScaledVector(up, -vn * push * Math.min(1, dt * 8));
      if (alt.altitude < 4) {
        this.pos.addScaledVector(up, 4 - alt.altitude);
        if (this.speed > 40 && vn < -10) {
          this.damage((this.speed - 40) * 0.6, game);
          game.effects.spark(this.pos.clone().addScaledVector(up, -2), up, new THREE.Color(2, 1.5, 1), 20, 20, 0.4, 0.8);
          this.vel.addScaledVector(up, -vn * 1.4);
        }
      }
    }
    // water surface
    if (planet.gen.hasSea && planet.desc.terrain.liquid !== 'ice') {
      const r = this.pos.distanceTo(planet.position);
      if (r < planet.seaRadius + 3) this.pos.copy(planet.position).addScaledVector(up, planet.seaRadius + 3);
    }

    this.pos.addScaledVector(this.vel, dt);

    // collisions: stations and asteroids
    const sys = game.world.system!;
    for (const s of sys.stations) {
      const d = this.pos.distanceTo(s.position);
      if (d < s.collisionRadius) {
        const n = this.pos.clone().sub(s.position).normalize();
        this.pos.copy(s.position).addScaledVector(n, s.collisionRadius);
        const vn = this.vel.dot(n);
        if (vn < 0) {
          if (-vn > 30) this.damage(-vn * 0.4, game);
          this.vel.addScaledVector(n, -vn * 1.5);
        }
      }
    }
    const ast = sys.asteroids.collide(this.pos, this.model.radius);
    if (ast) {
      const n = this.pos.clone().sub(ast.pos).normalize();
      this.pos.copy(ast.pos).addScaledVector(n, ast.radius * 0.8 + this.model.radius);
      const vn = this.vel.dot(n);
      if (vn < 0) {
        this.damage(Math.max(5, -vn * 0.5), game);
        this.vel.addScaledVector(n, -vn * 1.6);
        if (this.mode === 'pulse') this.exitPulse(game);
      }
    }

    // weapons
    this.fireCooldown -= dt;
    if (ctl && input.isDown('fire') && this.fireCooldown <= 0 && !pulsing) {
      this.fireCooldown = 0.11;
      const muzzle = this.model.muzzles[this.muzzleIndex++ % this.model.muzzles.length];
      const origin = muzzle.clone().applyQuaternion(this.quat).add(this.pos);
      let dir = this.forward;
      // light aim assist toward locked target
      if (this.lockedTarget) {
        const to = this.lockedTarget.pos.clone().sub(origin);
        const t = to.length() / 2400;
        const lead = to.addScaledVector(this.lockedTarget.vel, t).normalize();
        if (lead.dot(dir) > 0.985) dir = lead;
      }
      const dmg = 11 * cls.damage * (1 + st.level('ship_lasers') * 0.3);
      game.combat.fire({ owner: 'player', origin, dir, speed: 2400, inherit: this.vel, damage: dmg, life: 1.5, color: new THREE.Color(0.5, 1.8, 3.0), width: 0.35, length: 14, mining: true });
      game.audio.play('laser', 0.45);
    }
    void _v;
  }

  private tryPulse(game: Game, inAtmo: boolean): void {
    if (inAtmo) {
      events.emit('notify', { text: 'Pulse drive unavailable inside an atmosphere', kind: 'warn' });
      game.audio.play('ui_error');
      return;
    }
    const sys = game.world.system!;
    for (const s of sys.stations) {
      if (s.position.distanceTo(this.pos) < 1500) {
        events.emit('notify', { text: 'Pulse drive blocked — too close to station', kind: 'warn' });
        return;
      }
    }
    if (game.state.ship.pulseFuel <= 0.01) {
      events.emit('notify', { text: 'Pulse drive needs fuel — recharge with Astrium', kind: 'warn' });
      game.audio.play('ui_error');
      return;
    }
    if (game.combat.hostilesNear(this.pos, 3000)) {
      events.emit('notify', { text: 'Pulse drive jammed by hostile ships', kind: 'bad' });
      game.audio.play('ui_error');
      return;
    }
    this.setMode('pulse');
    this.pulseSpeed = Math.max(this.speed, 300);
    game.audio.play('pulse_start', 0.8);
  }

  exitPulse(game: Game): void {
    if (this.mode !== 'pulse') return;
    this.setMode('flying');
    this.throttle = 0.6;
    this.vel.setLength(Math.min(this.vel.length(), 600));
    this.pulseSpeed = 0;
    game.audio.play('pulse_stop', 0.7);
  }

  /** Planet-local pose for saving when landed. */
  landedPose(): { planetId: string; localPos: [number, number, number]; localQuat: [number, number, number, number] } | null {
    if (this.mode !== 'landed' || !this.landedPlanet) return null;
    return {
      planetId: this.landedPlanet.desc.id,
      localPos: this.landedLocal.toArray() as [number, number, number],
      localQuat: this.landedLocalQuat.toArray() as [number, number, number, number],
    };
  }
}
