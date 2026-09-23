import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { Planet } from '../../world/Planet';
import { events } from '../../core/EventBus';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);

/**
 * On-foot player: spherical-gravity character controller, jetpack, swimming,
 * collisions with scatter and structures, and survival stats.
 */
export class Player {
  readonly pos = new THREE.Vector3(); // feet, universe coordinates
  readonly vel = new THREE.Vector3();
  readonly body = new THREE.Quaternion(); // local +Y = up, -Z = facing
  pitch = 0;
  onGround = false;
  swimming = false;
  planet: Planet | null = null;
  readonly eyeHeight = 1.7;
  readonly radius = 0.45;
  health = 100;
  shield = 0;
  lifeSupport = 1;
  hazard = 1;
  jetpack = 1;
  sprinting = false;
  private jumpTimer = 0;
  private stepDist = 0;
  private lastDamage = 0;
  landingDip = 0;
  bob = 0;
  hazardExposure = 0; // current hazard intensity (0..)
  sheltered = false;
  dead = false;
  private jetLoop: ReturnType<Game['audio']['loop']> | null = null;

  get up(): THREE.Vector3 {
    if (!this.planet) return _v2.set(0, 1, 0).applyQuaternion(this.body);
    return _v2.copy(this.pos).sub(this.planet.position).normalize();
  }

  get eye(): THREE.Vector3 {
    return new THREE.Vector3(0, this.eyeHeight - this.landingDip + Math.sin(this.bob) * 0.04, 0).applyQuaternion(this.body).add(this.pos);
  }

  get lookQuat(): THREE.Quaternion {
    return this.body.clone().multiply(_q.setFromAxisAngle(X, this.pitch));
  }

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.lookQuat);
  }

  /** Place the player standing on the surface at a universe position. */
  placeAt(u: THREE.Vector3, planet: Planet | null, facing?: THREE.Vector3): void {
    this.planet = planet;
    this.pos.copy(u);
    this.vel.set(0, 0, 0);
    if (planet) {
      const up = _v.copy(u).sub(planet.position).normalize();
      const a = planet.altitudeAt(u);
      this.pos.copy(planet.position).addScaledVector(up, a.ground + 0.05);
      this.body.setFromUnitVectors(Y, up);
      if (facing) {
        const f = facing.clone().addScaledVector(up, -facing.dot(up)).normalize();
        const cur = new THREE.Vector3(0, 0, -1).applyQuaternion(this.body);
        const ang = Math.atan2(cur.clone().cross(f).dot(up), cur.dot(f));
        this.body.premultiply(_q.setFromAxisAngle(up, ang));
      }
    }
    this.pitch = 0;
    this.onGround = true;
  }

  damage(amount: number, source: string, game: Game): void {
    if (this.dead || amount <= 0) return;
    this.lastDamage = game.time;
    let left = amount;
    if (this.shield > 0) {
      const s = Math.min(this.shield, left);
      this.shield -= s;
      left -= s;
      game.audio.play('shield_hit', 0.6);
    }
    if (left > 0) {
      this.health = Math.max(0, this.health - left);
      game.audio.play('hurt', 0.8);
      game.cameraRig.shake(Math.min(1, left / 25));
      game.renderer.finalMat.uniforms.uDamage.value = Math.min(0.7, game.renderer.finalMat.uniforms.uDamage.value + left / 40);
    }
    events.emit('player:damaged', { amount, source });
    if (this.health <= 0) {
      this.dead = true;
      events.emit('player:died', { cause: source });
    }
  }

  update(dt: number, game: Game): void {
    const input = game.input;
    const planet = this.planet;
    if (!planet) return;

    // carry with planet spin
    this.pos.sub(planet.position).applyQuaternion(planet.spinDelta).add(planet.position);
    this.body.premultiply(planet.spinDelta);

    // realign body to local up
    const up = _v.copy(this.pos).sub(planet.position).normalize().clone();
    const bodyUp = _v2.set(0, 1, 0).applyQuaternion(this.body);
    this.body.premultiply(_q.setFromUnitVectors(bodyUp, up)).normalize();

    // look
    if (input.locked && !game.uiBlocking) {
      const m = input.consumeMouse();
      this.body.multiply(_q.setFromAxisAngle(Y, -m.dx * 0.0022));
      this.pitch = THREE.MathUtils.clamp(this.pitch - m.dy * 0.0022, -1.5, 1.5);
    }

    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.body);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.body);
    const mv = new THREE.Vector3();
    if (!game.uiBlocking) {
      mv.addScaledVector(fwd, input.axis('back', 'forward'));
      mv.addScaledVector(right, input.axis('left', 'right'));
    }
    if (mv.lengthSq() > 1) mv.normalize();
    this.sprinting = input.isDown('sprint') && mv.lengthSq() > 0.1 && !this.swimming;

    // water state
    const seaR = planet.seaRadius;
    const liquid = planet.desc.terrain.liquid;
    const r = this.pos.distanceTo(planet.position);
    this.swimming = (liquid === 'water' || liquid === 'acid') && r < seaR - 0.9;
    const inLava = liquid === 'lava' && r < seaR + 0.2;
    if (inLava) this.damage(35 * dt, 'lava', game);
    if (liquid === 'acid' && r < seaR) this.damage(6 * dt, 'acid', game);

    const g = planet.desc.gravity;
    const speed = this.swimming ? 3.2 : this.sprinting ? 10.5 : 6.2;
    const tangVel = this.vel.clone().addScaledVector(up, -this.vel.dot(up));
    const vertVel = this.vel.dot(up);
    const desired = mv.multiplyScalar(speed);
    const accel = this.onGround ? 14 : this.swimming ? 4 : 2.2;
    tangVel.lerp(desired, 1 - Math.exp(-accel * dt));
    let vv = vertVel;

    // jump / jetpack
    const jetLevel = game.state.level('suit_jetpack');
    this.jumpTimer -= dt;
    const jetting = !this.onGround && input.isDown('jump') && this.jetpack > 0 && this.jumpTimer < 0 && !game.uiBlocking;
    if (this.onGround && input.wasPressed('jump') && !game.uiBlocking) {
      vv = 5.2;
      this.onGround = false;
      this.jumpTimer = 0.25;
    }
    if (jetting) {
      vv += (19 + jetLevel * 5) * dt;
      vv = Math.min(vv, 9 + jetLevel * 2);
      tangVel.addScaledVector(fwd, 4 * dt);
      this.jetpack = Math.max(0, this.jetpack - dt / (3.2 * (1 + jetLevel * 0.3)));
      if (Math.random() < 0.6) {
        const nozzle = this.pos.clone().addScaledVector(up, 1.0).addScaledVector(fwd, -0.4);
        game.effects.spark(nozzle, up.clone().negate(), new THREE.Color(0.6, 0.8, 1.5), 1, 5, 0.12, 0.3);
      }
    } else if (this.onGround) {
      this.jetpack = Math.min(1, this.jetpack + dt * 0.55);
    }
    if (!this.jetLoop && game.audio.ready) this.jetLoop = game.audio.loop('jetpack');
    this.jetLoop?.set(jetting ? 0.35 : 0, 1, 1600);

    if (this.swimming) {
      vv += (g * 0.15) * dt; // buoyancy
      vv *= 1 - Math.min(1, dt * 2.5);
      if (input.isDown('jump')) vv = Math.min(vv + 12 * dt, 2.5);
    } else vv -= g * dt;

    this.vel.copy(tangVel).addScaledVector(up, vv);
    this.pos.addScaledVector(this.vel, dt);

    // colliders: scatter (in planet local)
    const local = planet.toLocal(this.pos, new THREE.Vector3());
    if (planet.scatter.collide(local, this.radius)) planet.toUniverse(local, this.pos);
    game.collideStructures(this.pos, this.radius, up);

    // ground
    const alt = planet.altitudeAt(this.pos);
    const wasGround = this.onGround;
    if (alt.altitude <= 0.02) {
      this.pos.addScaledVector(up, -alt.altitude);
      const vn = this.vel.dot(up);
      if (vn < 0) {
        if (!wasGround && -vn > 14) this.damage((-vn - 14) * 4, 'fall', game);
        if (!wasGround && -vn > 4) {
          this.landingDip = Math.min(0.35, -vn * 0.03);
          game.audio.play('thud', Math.min(1, -vn / 15));
        }
        this.vel.addScaledVector(up, -vn);
      }
      this.onGround = true;
    } else if (alt.altitude > 0.25) {
      this.onGround = false;
    } else if (this.onGround && this.vel.dot(up) <= 0.1) {
      // stick to slopes when walking downhill
      this.pos.addScaledVector(up, -alt.altitude);
    }
    this.landingDip = Math.max(0, this.landingDip - dt * 1.2);

    // footsteps & head bob
    if (this.onGround) {
      const sp = tangVel.length();
      this.stepDist += sp * dt;
      this.bob += sp * dt * 1.8;
      if (this.stepDist > (this.sprinting ? 2.4 : 1.9)) {
        this.stepDist = 0;
        game.audio.play('footstep', 0.7, 0, 0.8 + Math.random() * 0.4);
      }
      game.state.stat('distanceWalked', sp * dt);
    }

    this.updateSurvival(dt, game);
  }

  private updateSurvival(dt: number, game: Game): void {
    const st = game.state;
    const planet = this.planet!;
    // life support
    const lifeCap = 1 + st.level('suit_life') * 0.35;
    const breathable = planet.desc.archetype === 'verdant' || planet.desc.archetype === 'ocean';
    const lsRate = (breathable ? 0.6 : 1) / (330 * lifeCap);
    this.lifeSupport = Math.max(0, this.lifeSupport - lsRate * dt * (this.jetpack < 1 ? 1.15 : 1));
    // hazards
    const weatherMul = game.weather.hazardMultiplier;
    const night = 1 - game.world.env.day;
    let hz = planet.desc.hazardLevel * weatherMul;
    if (planet.desc.hazard === 'heat') hz *= 1 - night * 0.6;
    if (planet.desc.hazard === 'cold') hz *= 1 + night * 0.5;
    if (this.sheltered) hz *= 0.1;
    this.hazardExposure = hz;
    const prot = 1 - st.level('suit_hazard') * 0.18;
    if (hz > 0.01) this.hazard = Math.max(0, this.hazard - (hz * prot * dt) / 180);
    else this.hazard = Math.min(1, this.hazard + dt / 60);

    if (this.lifeSupport <= 0) this.damage(3.5 * dt, 'suffocation', game);
    if (this.hazard <= 0 && hz > 0.01) this.damage(4 * hz * dt, planet.desc.hazard, game);

    // shields & regen
    const maxShield = st.maxSuitShield;
    if (game.time - this.lastDamage > 4 && this.shield < maxShield) this.shield = Math.min(maxShield, this.shield + 10 * dt);
    if (game.time - this.lastDamage > 6 && this.lifeSupport > 0 && (this.hazard > 0 || hz < 0.01)) this.health = Math.min(100, this.health + 2 * dt);
  }

  /** Recharge while in the ship cockpit or docked. */
  rechargeInShip(dt: number): void {
    this.lifeSupport = Math.min(1, this.lifeSupport + dt / 40);
    this.hazard = Math.min(1, this.hazard + dt / 20);
    this.jetpack = Math.min(1, this.jetpack + dt);
  }

  stopSounds(): void {
    this.jetLoop?.set(0);
  }
}
