import * as THREE from 'three';
import type { Game } from '../core/Game';
import { events } from '../core/EventBus';

/**
 * Projectile simulation and damage routing. Any entity can register itself
 * as a `Damageable`; projectiles resolve hits with swept-sphere tests.
 */
export type Faction = 'player' | 'hostile' | 'wildlife' | 'neutral';

export interface Damageable {
  readonly pos: THREE.Vector3; // universe
  readonly vel?: THREE.Vector3;
  radius: number;
  faction: Faction;
  alive: boolean;
  /** For HUD target lock. */
  label?: string;
  /** Remaining health fraction 0..1 for HUD display. */
  readonly hpFrac?: number;
  hit(damage: number, fromPlayer: boolean, game: Game): void;
}

export interface FireParams {
  owner: 'player' | 'enemy';
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  inherit?: THREE.Vector3;
  damage: number;
  life: number;
  color: THREE.Color;
  width: number;
  length: number;
  mining?: boolean;
}

interface Projectile {
  active: boolean;
  owner: 'player' | 'enemy';
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  damage: number;
  life: number;
  mesh: THREE.Mesh;
  length: number;
  mining: boolean;
  color: THREE.Color;
}

const POOL = 160;
const UP = new THREE.Vector3(0, 1, 0);

export class Combat {
  readonly targets = new Set<Damageable>();
  private projectiles: Projectile[] = [];
  private group = new THREE.Group();
  private cursor = 0;

  constructor(parent: THREE.Object3D) {
    parent.add(this.group);
    const geo = new THREE.CylinderGeometry(1, 1, 1, 6, 1);
    geo.translate(0, -0.5, 0);
    for (let i = 0; i < POOL; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false;
      m.frustumCulled = false;
      this.group.add(m);
      this.projectiles.push({ active: false, owner: 'player', pos: new THREE.Vector3(), vel: new THREE.Vector3(), damage: 0, life: 0, mesh: m, length: 1, mining: false, color: new THREE.Color() });
    }
  }

  register(t: Damageable): void {
    this.targets.add(t);
  }

  unregister(t: Damageable): void {
    this.targets.delete(t);
  }

  hostilesNear(p: THREE.Vector3, r: number): boolean {
    for (const t of this.targets) if (t.alive && t.faction === 'hostile' && t.pos.distanceTo(p) < r) return true;
    return false;
  }

  nearestHostile(p: THREE.Vector3, dir: THREE.Vector3, maxDist: number, minDot = 0.92): Damageable | null {
    let best: Damageable | null = null;
    let bestScore = -Infinity;
    for (const t of this.targets) {
      if (!t.alive || t.faction === 'player') continue;
      const to = t.pos.clone().sub(p);
      const d = to.length();
      if (d > maxDist) continue;
      const dot = to.divideScalar(d).dot(dir);
      if (dot < minDot) continue;
      const score = dot * 2 - d / maxDist + (t.faction === 'hostile' ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  }

  fire(p: FireParams): void {
    const pr = this.projectiles[this.cursor];
    this.cursor = (this.cursor + 1) % POOL;
    pr.active = true;
    pr.owner = p.owner;
    pr.pos.copy(p.origin);
    pr.vel.copy(p.dir).normalize().multiplyScalar(p.speed);
    if (p.inherit) pr.vel.add(p.inherit);
    pr.damage = p.damage;
    pr.life = p.life;
    pr.length = p.length;
    pr.mining = !!p.mining;
    pr.color.copy(p.color);
    (pr.mesh.material as THREE.MeshBasicMaterial).color.copy(p.color);
    pr.mesh.scale.set(p.width, p.length, p.width);
    pr.mesh.visible = true;
  }

  update(dt: number, game: Game): void {
    const seg = new THREE.Vector3();
    const oc = new THREE.Vector3();
    for (const pr of this.projectiles) {
      if (!pr.active) continue;
      pr.life -= dt;
      if (pr.life <= 0) {
        pr.active = false;
        pr.mesh.visible = false;
        continue;
      }
      const start = pr.pos.clone();
      seg.copy(pr.vel).multiplyScalar(dt);
      const len = seg.length();
      const dir = seg.clone().divideScalar(len || 1);
      let hitT = len;
      let hitTarget: Damageable | null = null;
      // targets
      for (const t of this.targets) {
        if (!t.alive) continue;
        if (pr.owner === 'player' && t.faction === 'player') continue;
        if (pr.owner === 'enemy' && t.faction !== 'player') continue;
        oc.copy(t.pos).sub(start);
        const tt = oc.dot(dir);
        if (tt < -t.radius || tt > hitT + t.radius) continue;
        const d2 = oc.lengthSq() - tt * tt;
        if (d2 < t.radius * t.radius) {
          const h = Math.max(0, tt - Math.sqrt(t.radius * t.radius - d2));
          if (h < hitT) {
            hitT = h;
            hitTarget = t;
          }
        }
      }
      let hitPoint: THREE.Vector3 | null = null;
      let hitAsteroid = null as ReturnType<NonNullable<Game['world']['system']>['asteroids']['raycast']>;
      if (pr.owner === 'player' && game.world.system) {
        hitAsteroid = game.world.system.asteroids.raycast(start, dir, hitT);
        if (hitAsteroid) {
          hitTarget = null;
          hitT = hitAsteroid.dist;
        }
      }
      // terrain
      const planet = game.world.env.planet;
      if (planet && !hitTarget && !hitAsteroid) {
        const end = start.clone().addScaledVector(dir, len);
        const alt = planet.altitudeAt(end);
        if (alt.altitude < 0) {
          hitPoint = end.addScaledVector(alt.up, -alt.altitude);
          hitT = len;
        }
      }
      if (hitTarget) {
        hitPoint = start.clone().addScaledVector(dir, hitT);
        hitTarget.hit(pr.damage, pr.owner === 'player', game);
        game.effects.spark(hitPoint, dir.clone().negate(), pr.color.clone().multiplyScalar(1.5), 10, 12, 0.35, 0.4);
      } else if (hitAsteroid) {
        hitPoint = start.clone().addScaledVector(dir, hitT);
        game.mining.damageAsteroid(hitAsteroid.a, pr.damage, hitPoint, game);
      } else if (hitPoint) {
        game.effects.spark(hitPoint, dir.clone().negate(), new THREE.Color(2, 1.4, 0.8), 8, 8, 0.3, 0.5);
        game.effects.puff(hitPoint, new THREE.Color(0.35, 0.32, 0.3), 3, 1.2, 1.2, 1);
      }
      if (hitPoint) {
        pr.active = false;
        pr.mesh.visible = false;
        continue;
      }
      pr.pos.add(seg);
      pr.mesh.position.copy(pr.pos);
      pr.mesh.quaternion.setFromUnitVectors(UP, dir);
    }
    // Meshes live under the world root in universe coordinates; the root's -origin
    // translation is composed in double precision on the CPU, so this stays precise.
  }

  /** A damageable proxy for the player that follows them between ship and foot. */
  static playerTarget(game: Game): Damageable {
    return {
      get pos() {
        return game.mode === 'ship' ? game.ship.pos : game.player.eye;
      },
      get vel() {
        return game.mode === 'ship' ? game.ship.vel : game.player.vel;
      },
      get radius() {
        return game.mode === 'ship' ? game.ship.model.radius : 1;
      },
      faction: 'player',
      get alive() {
        return game.mode === 'ship' || game.mode === 'foot';
      },
      hit: (d: number, _fp: boolean, g: Game) => {
        if (g.mode === 'ship') g.ship.damage(d, g);
        else g.player.damage(d, 'weapons', g);
      },
    } as Damageable;
  }

  clear(): void {
    for (const pr of this.projectiles) {
      pr.active = false;
      pr.mesh.visible = false;
    }
  }
}

export function killReward(kind: string, reward: number): void {
  events.emit('enemy:killed', { kind, reward });
}
