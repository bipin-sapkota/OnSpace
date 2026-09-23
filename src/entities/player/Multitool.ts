import * as THREE from 'three';
import type { Game } from '../../core/Game';
import { GeoBuilder, box, column, trs, ico } from '../../render/GeoKit';
import { propMaterial } from '../../render/Materials';
import type { ScatterRecord } from '../../world/ScatterManager';
import type { Asteroid } from '../../world/AsteroidField';
import { events } from '../../core/EventBus';
import { getItem } from '../../gameplay/Items';
import type { LoopHandle } from '../../audio/AudioEngine';

export type ToolMode = 'mine' | 'combat';

/**
 * The multitool: mining beam with heat management, boltcaster for combat,
 * scanner pulse, and a first-person viewmodel with sway, bob and recoil.
 * Also owns the resource yield logic for scatter and asteroids.
 */
export class Multitool {
  mode: ToolMode = 'mine';
  heat = 0;
  overheated = false;
  private overheatTimer = 0;
  private fireCooldown = 0;
  readonly viewmodel = new THREE.Group();
  private emitter: THREE.Mesh;
  private recoil = 0;
  private swayX = 0;
  private swayY = 0;
  target: ScatterRecord | null = null;
  targetDist = 0;
  mining = false;
  scanCooldown = 0;
  private beamLoop: LoopHandle | null = null;
  private lastYieldTime = 0;
  /** Scanner-highlighted resources: record + expiry time. */
  readonly highlights: { rec: ScatterRecord; until: number }[] = [];

  constructor(camera: THREE.Camera) {
    const b = new GeoBuilder();
    const bodyCol = new THREE.Color(0.82, 0.8, 0.74);
    const dark = new THREE.Color(0.15, 0.16, 0.18);
    const accent = new THREE.Color(1.0, 0.5, 0.15);
    b.add(box(0.06, 0.07, 0.34), bodyCol, trs(0, 0, -0.05));
    b.add(box(0.05, 0.11, 0.06), dark, trs(0, -0.08, 0.06, 0.35, 0, 0));
    b.add(column(0.022, 0.03, 8), dark, trs(0, 0.005, -0.22, -Math.PI / 2, 0, 0, 1, 0.16, 1));
    b.add(box(0.09, 0.02, 0.18), accent, trs(0, 0.045, -0.05));
    b.add(box(0.03, 0.04, 0.12), dark, trs(0.045, 0.01, 0.0));
    b.add(box(0.03, 0.04, 0.12), dark, trs(-0.045, 0.01, 0.0));
    for (let i = 0; i < 3; i++) b.add(box(0.012, 0.03, 0.02), new THREE.Color(0.3, 0.9, 1.0), trs(0.048, 0.02, -0.02 + i * 0.03), 2.5);
    const mesh = new THREE.Mesh(b.build(), propMaterial({ roughness: 0.4, metalness: 0.5 }));
    this.viewmodel.add(mesh);
    this.emitter = new THREE.Mesh(new GeoBuilder().add(ico(0.02, 1), new THREE.Color(1, 1, 1)).build(), new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 1.2, 0.4) }));
    this.emitter.position.set(0, 0.005, -0.385);
    this.viewmodel.add(this.emitter);
    this.viewmodel.position.set(0.19, -0.17, -0.32);
    this.viewmodel.scale.setScalar(0.62);
    this.viewmodel.visible = false;
    camera.add(this.viewmodel);
    mesh.renderOrder = 50;
  }

  /** World-space muzzle position. */
  muzzle(game: Game): THREE.Vector3 {
    const p = new THREE.Vector3();
    this.emitter.getWorldPosition(p);
    return p.add(game.world.origin);
  }

  toggleMode(game: Game): void {
    this.mode = this.mode === 'mine' ? 'combat' : 'mine';
    events.emit('notify', { text: this.mode === 'mine' ? 'Mining beam' : 'Boltcaster', kind: 'info' });
    game.audio.play('ui_click');
  }

  update(dt: number, game: Game): void {
    const active = game.mode === 'foot' && !game.cameraRig.thirdPersonFoot;
    this.viewmodel.visible = active;
    this.scanCooldown = Math.max(0, this.scanCooldown - dt);
    this.fireCooldown -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 6);
    // prune highlights
    for (let i = this.highlights.length - 1; i >= 0; i--) {
      const h = this.highlights[i];
      if (h.until < game.time || h.rec.depleted) this.highlights.splice(i, 1);
    }

    if (!this.beamLoop && game.audio.ready) this.beamLoop = game.audio.loop('beam');
    if (!active) {
      this.mining = false;
      this.beamLoop?.set(0);
      this.heat = Math.max(0, this.heat - dt * 0.5);
      return;
    }
    const input = game.input;
    const player = game.player;
    const planet = player.planet!;
    const eye = player.eye;
    const fwd = player.forward;

    // find harvest target
    const localEye = planet.toLocal(eye, new THREE.Vector3());
    const localDir = planet.universeDirToLocal(fwd, new THREE.Vector3());
    const hit = planet.scatter.raycast(localEye, localDir, 38);
    this.target = hit?.rec ?? null;
    this.targetDist = hit?.dist ?? 0;

    const ui = game.uiBlocking;
    if (!ui && input.wasPressed('toolMode')) this.toggleMode(game);
    if (!ui && input.wasPressed('scan')) this.scan(game);

    // heat
    if (this.overheated) {
      this.overheatTimer -= dt;
      this.heat = Math.max(0, this.heat - dt * 0.6);
      if (this.overheatTimer <= 0) this.overheated = false;
    }

    const firing = !ui && input.isDown('fire') && input.locked;
    this.mining = false;
    if (this.mode === 'mine' && firing && !this.overheated) {
      this.mining = true;
      const lvl = game.state.level('tool_mining');
      this.heat += dt * 0.16 * (1 - lvl * 0.15);
      if (this.heat >= 1) {
        this.heat = 1;
        this.overheated = true;
        this.overheatTimer = 2.2;
        game.audio.play('overheat', 0.7);
      }
      // beam end point
      const muzzle = this.muzzle(game);
      let end: THREE.Vector3;
      if (this.target) {
        end = eye.clone().addScaledVector(fwd, this.targetDist + 0.3);
        const rec = this.target;
        rec.health -= dt * (1 + lvl * 0.35);
        planet.scatter.setDamageVisual(rec, 1 - rec.health / rec.maxHealth);
        if (Math.random() < 0.5) game.effects.spark(end, fwd.clone().negate(), new THREE.Color(2.5, 1.2, 0.4), 2, 4, 0.08, 0.35, player.up.clone().multiplyScalar(-6));
        if (rec.health <= 0) this.harvest(rec, end, game);
      } else {
        // beam hits terrain / creature
        const creature = game.creatures.raycast(eye, fwd, 38);
        if (creature) {
          end = eye.clone().addScaledVector(fwd, creature.dist);
          creature.c.hit(dt * 12, true, game);
        } else {
          end = eye.clone().addScaledVector(fwd, 38);
          const g = this.terrainHit(eye, fwd, 38, game);
          if (g) {
            end = g;
            if (Math.random() < 0.3) game.effects.spark(end, player.up, new THREE.Color(2, 1, 0.4), 1, 3, 0.06, 0.3);
          }
        }
      }
      const w = 0.018 + Math.sin(game.time * 60) * 0.006;
      game.effects.beam(muzzle, end, new THREE.Color(3.0, 1.4, 0.45), w, 0.04);
      game.effects.beam(muzzle, end, new THREE.Color(1.2, 0.35, 0.1), w * 3.5, 0.04);
      if (Math.random() < 0.4) game.effects.glowAt(end, new THREE.Color(3, 1.5, 0.5), 0.25, 0.08);
    } else if (!this.overheated) {
      this.heat = Math.max(0, this.heat - dt * 0.35);
    }
    this.beamLoop?.set(this.mining ? 0.22 : 0, 1 + this.heat * 0.5, 1000 + this.heat * 1500);

    if (this.mode === 'combat' && firing && this.fireCooldown <= 0) {
      this.fireCooldown = 0.22;
      const lvl = game.state.level('tool_blaster');
      const muzzle = this.muzzle(game);
      // aim so that the bolt converges on the crosshair
      const aimPoint = eye.clone().addScaledVector(fwd, 60);
      const dir = aimPoint.sub(muzzle).normalize();
      game.combat.fire({ owner: 'player', origin: muzzle, dir, speed: 320, inherit: player.vel, damage: 16 * (1 + lvl * 0.3), life: 1.2, color: new THREE.Color(3, 0.9, 0.3), width: 0.05, length: 1.6 });
      game.audio.play('blaster', 0.55);
      this.recoil = 1;
      game.cameraRig.shake(0.06);
      game.effects.glowAt(muzzle, new THREE.Color(3, 1, 0.3), 0.3, 0.06);
    }

    // viewmodel animation
    const m = { x: input.mouseDX, y: input.mouseDY };
    this.swayX = THREE.MathUtils.lerp(this.swayX, THREE.MathUtils.clamp(-m.x * 0.0004, -0.03, 0.03), 1 - Math.exp(-dt * 10));
    this.swayY = THREE.MathUtils.lerp(this.swayY, THREE.MathUtils.clamp(m.y * 0.0004, -0.03, 0.03), 1 - Math.exp(-dt * 10));
    const bob = player.onGround ? Math.sin(player.bob) * 0.008 : 0;
    const bob2 = player.onGround ? Math.abs(Math.cos(player.bob)) * 0.006 : 0;
    this.viewmodel.position.set(0.16 + this.swayX + bob, -0.13 + this.swayY - bob2 - player.landingDip * 0.1, -0.3 + this.recoil * 0.04);
    this.viewmodel.rotation.set(this.recoil * 0.15 + (this.mining ? Math.sin(game.time * 50) * 0.004 : 0), 0.04, 0);
    const em = this.emitter.material as THREE.MeshBasicMaterial;
    const glow = this.mining ? 3 + Math.sin(game.time * 40) : this.mode === 'combat' ? 1.5 : 0.6;
    em.color.setRGB(glow, glow * (this.mode === 'combat' ? 0.35 : 0.55), glow * 0.15 + this.heat * 0.5);
  }

  private terrainHit(eye: THREE.Vector3, dir: THREE.Vector3, max: number, game: Game): THREE.Vector3 | null {
    const planet = game.player.planet!;
    const p = new THREE.Vector3();
    for (let t = 1; t <= max; t += 1.5) {
      p.copy(eye).addScaledVector(dir, t);
      if (planet.altitudeAt(p).altitude < 0) return p;
    }
    return null;
  }

  private harvest(rec: ScatterRecord, at: THREE.Vector3, game: Game): void {
    const planet = game.player.planet!;
    planet.scatter.deplete(rec);
    const item = rec.item!;
    const amount = rec.amount;
    const added = game.state.give(item, amount);
    // bonus silex from rocks on arid/barren worlds
    if ((rec.type === 3 || rec.type === 4) && (planet.desc.archetype === 'arid' || planet.desc.archetype === 'barren') && Math.random() < 0.6) {
      game.state.give('silex', Math.round(amount * 0.5));
    }
    const col = new THREE.Color(getItem(item).color);
    game.effects.spark(at, game.player.up, col.clone().multiplyScalar(2), 22, 7, 0.14, 0.8, game.player.up.clone().multiplyScalar(-5));
    game.effects.puff(at, col.clone().multiplyScalar(0.5), 5, 0.8, 1.2, 0.8, game.player.up);
    game.audio.play('harvest', 0.8);
    events.emit('harvest', { item, amount: added });
    if (game.time - this.lastYieldTime > 0.2) events.emit('notify', { text: `+${added} ${getItem(item).name}`, kind: 'good', icon: item });
    this.lastYieldTime = game.time;
    this.target = null;
    game.wardens.onHarvest(game, at);
    game.state.stat('harvested');
  }

  /** Called by the combat system when a player projectile strikes an asteroid. */
  damageAsteroid(a: Asteroid, damage: number, at: THREE.Vector3, game: Game): void {
    a.health -= damage / 12;
    game.effects.spark(at, at.clone().sub(a.pos).normalize(), new THREE.Color(2, 1.5, 1), 6, 15, 0.5, 0.5);
    if (a.health <= 0) {
      game.world.system!.asteroids.deplete(a);
      game.effects.explosion(a.pos, Math.min(3, a.radius / 15), new THREE.Color(0.9, 0.7, 0.5));
      game.effects.puff(a.pos, new THREE.Color(0.3, 0.28, 0.25), 12, a.radius * 0.5, 3, a.radius * 0.3);
      game.audio.play('explosion', 0.5);
      const added = game.state.give(a.item, a.amount, true);
      if (a.item !== 'astrium' && Math.random() < 0.5) game.state.give('astrium', Math.round(a.amount * 0.4), true);
      events.emit('harvest', { item: a.item, amount: added });
      events.emit('notify', { text: `+${added} ${getItem(a.item).name}`, kind: 'good', icon: a.item });
    }
  }

  scan(game: Game): void {
    if (this.scanCooldown > 0) {
      game.audio.play('ui_error', 0.5);
      return;
    }
    const lvl = game.state.level('tool_scanner');
    const range = 140 * (1 + lvl * 0.5);
    this.scanCooldown = 6;
    const player = game.player;
    const planet = player.planet!;
    game.effects.wave(player.pos, range, 1.6);
    game.audio.play('scan', 0.8);
    const local = planet.toLocal(player.pos, new THREE.Vector3());
    let n = 0;
    for (const rec of planet.scatter.nearby(local, range)) {
      if (rec.type === 6 || rec.type === 5 || rec.type === 7 || rec.type === 4) {
        this.highlights.push({ rec, until: game.time + 30 });
        n++;
      }
    }
    game.pois.revealNear(player.pos, 2500 * (1 + lvl * 0.5), game);
    events.emit('scan:pulse', { origin: player.pos.toArray() as [number, number, number] });
    if (n > 0) events.emit('notify', { text: `Scanner: ${n} resource deposits located`, kind: 'info' });
  }

  stopSounds(): void {
    this.beamLoop?.set(0);
  }
}
