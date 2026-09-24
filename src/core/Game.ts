import * as THREE from 'three';
import { Renderer } from '../render/Renderer';
import { Input } from './Input';
import { settings } from './Settings';
import { events } from './EventBus';
import { audio, type AudioEngine } from '../audio/AudioEngine';
import { World } from '../world/World';
import { Galaxy } from '../universe/Galaxy';
import { GameState, newGameData, type SaveData } from '../gameplay/GameState';
import { Effects } from '../render/Effects';
import { Combat, type Damageable } from '../gameplay/Combat';
import { Player } from '../entities/player/Player';
import { PlayerShip } from '../entities/ship/PlayerShip';
import { CameraRig } from '../entities/player/CameraRig';
import { Multitool } from '../entities/player/Multitool';
import { PlayerAvatar } from '../entities/player/PlayerAvatar';
import { CreatureManager } from '../entities/creatures/CreatureManager';
import { WardenManager } from '../entities/npc/Wardens';
import { NpcShips } from '../entities/npc/NpcShips';
import { POIManager } from '../entities/poi/POIs';
import { WeatherSystem } from '../world/Weather';
import { Discovery } from '../gameplay/Discovery';
import { Economy } from '../gameplay/Economy';
import { Missions } from '../gameplay/Missions';
import { Quest } from '../gameplay/Quest';
import { WorldEvents } from '../gameplay/WorldEvents';
import { SaveSystem } from '../save/SaveSystem';
import { UI } from '../ui/UI';
import { WarpTunnel } from '../render/WarpTunnel';
import { RECHARGE_TABLE, getItem } from '../gameplay/Items';
import { getTech } from '../gameplay/Upgrades';
import type { Recipe } from '../gameplay/Crafting';
import type { Planet } from '../world/Planet';
import type { Station } from '../world/Station';
import { RNG } from './Random';
import { Inventory } from '../gameplay/Inventory';
import { getShipClass } from '../entities/ship/ShipDefs';

export type GameMode = 'menu' | 'loading' | 'foot' | 'ship' | 'docked' | 'warp' | 'dead';

export interface Prompt {
  text: string;
  key: string;
  action: () => void;
}

const Y = new THREE.Vector3(0, 1, 0);

/**
 * Top-level orchestrator. Owns every subsystem, the main loop and the game
 * mode state machine (menu → loading → on foot / piloting / docked / warp).
 * Subsystems receive the Game instance and communicate through it or through
 * the event bus, keeping them decoupled from each other.
 */
export class Game {
  readonly renderer: Renderer;
  readonly input: Input;
  readonly audio: AudioEngine = audio;
  readonly world: World;
  galaxy!: Galaxy;
  state!: GameState;
  readonly effects: Effects;
  readonly combat: Combat;
  readonly player = new Player();
  readonly ship: PlayerShip;
  readonly cameraRig = new CameraRig();
  readonly mining: Multitool;
  readonly avatar: PlayerAvatar;
  readonly creatures = new CreatureManager();
  readonly wardens = new WardenManager();
  readonly npcs: NpcShips;
  readonly pois = new POIManager();
  readonly weather: WeatherSystem;
  readonly discovery = new Discovery();
  readonly economy = new Economy();
  missions!: Missions;
  readonly quest = new Quest();
  readonly worldEvents = new WorldEvents();
  readonly saves = new SaveSystem();
  readonly ui: UI;
  private warpTunnel: WarpTunnel;
  mode: GameMode = 'menu';
  time = 0;
  private lastFrame = performance.now();
  prompt: Prompt | null = null;
  lightning = 0;
  pendingPirates = 0;
  private autosaveTimer = 0;
  private warpState: { t: number; target: number; loaded: boolean } | null = null;
  private deathTimer = 0;
  private playerTarget: Damageable;
  fps = 60;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private menuTime = 0;
  lockedTarget: Damageable | null = null;
  private musicTimer = 0;

  constructor(container: HTMLElement) {
    this.renderer = new Renderer(container);
    this.input = new Input(this.renderer.renderer.domElement);
    this.input.sensitivity = settings.data.mouseSensitivity;
    this.input.invertY = settings.data.invertY;
    settings.onChange((s) => {
      this.input.sensitivity = s.mouseSensitivity;
      this.input.invertY = s.invertY;
    });
    this.world = new World(this.renderer);
    this.effects = new Effects(this.world.root);
    this.combat = new Combat(this.world.root);
    this.ship = new PlayerShip(this.world.root);
    this.mining = new Multitool(this.renderer.camera);
    this.avatar = new PlayerAvatar(this.world.root);
    this.npcs = new NpcShips(this.world.root);
    this.weather = new WeatherSystem(this.renderer.scene);
    this.warpTunnel = new WarpTunnel(this.renderer.camera);
    this.playerTarget = Combat.playerTarget(this);
    this.ui = new UI(this);
    this.input.onPointerLockChange = (locked) => {
      if (!locked && this.isPlaying && !this.ui.anyScreenOpen && !this.ui.suppressPauseOnUnlock) this.ui.openPause();
      this.ui.suppressPauseOnUnlock = false;
    };
    this.bindEvents();
    window.addEventListener('beforeunload', () => {
      if (this.isPlaying) this.save('auto');
    });
  }

  get isPlaying(): boolean {
    return this.mode === 'foot' || this.mode === 'ship' || this.mode === 'docked';
  }

  /** True when a menu is open and gameplay input should be ignored. */
  get uiBlocking(): boolean {
    return this.ui.anyScreenOpen;
  }

  private bindEvents(): void {
    events.on('player:died', ({ cause }) => this.onDeath(cause));
    events.on('ship:destroyed', () => this.onShipDestroyed());
    events.on('ship:docked', () => {
      this.setMode('docked');
      this.ui.openStation();
      this.save('auto');
    });
    events.on('ship:landed', () => this.save('auto'));
    events.on('discovery', (d) => this.ui.discoveryBanner(d.kind, d.name, d.reward));
  }

  start(): void {
    this.ui.showMainMenu();
    this.audio.setMood('menu');
    this.loop();
  }

  // ---------------------------------------------------------------- lifecycle

  /** Begin a brand-new game from a seed. */
  async newGame(seed: number): Promise<void> {
    this.galaxy = new Galaxy(seed);
    const data = newGameData(seed, this.galaxy.startSystemId);
    await this.boot(data, true);
  }

  async loadGame(data: SaveData): Promise<void> {
    this.galaxy = new Galaxy(data.seed);
    await this.boot(data, false);
  }

  private async boot(data: SaveData, fresh: boolean): Promise<void> {
    this.mode = 'loading';
    this.ui.showLoading('Generating star system…', 0);
    this.state = new GameState(data);
    this.missions ??= new Missions(this);
    this.time = data.playTime;
    this.clearTransient();
    await this.nextFrame();
    const sys = this.world.loadSystem(this.galaxy, data.systemId, (k) => this.state.depletedSet(k), this.asteroidSet(), this.time);
    this.ship.rebuild(this.state.ship.classId, this.state.ship.seed);
    this.discovery.discover(this, 'system', `sys${sys.desc.id}`, sys.desc.name, `${sys.desc.star.classLabel}-class star`, 1000);

    if (fresh) {
      // crash site: ship landed on the starting planet, player a short walk away
      const planet = sys.planets[0];
      const rng = new RNG(data.seed ^ 0x57a27);
      let dir = new THREE.Vector3();
      const sunDir = planet.sunDir();
      // find a gentle, dry, sunlit landing site
      let bestScore = Infinity;
      const probe = new THREE.Vector3();
      for (let i = 0; i < 400; i++) {
        const cand = planet.universeDirToLocal(sunDir.clone().add(new THREE.Vector3(...rng.unitVector()).multiplyScalar(0.9)).normalize());
        const r = planet.surfaceRadius(cand);
        if (planet.gen.hasSea && r < planet.seaRadius + 6) continue;
        let rough = 0;
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          probe.set(Math.cos(a), 0, Math.sin(a)).multiplyScalar(40 / planet.radius);
          rough += Math.abs(planet.surfaceRadius(probe.add(cand).normalize()) - r);
        }
        const score = rough + (r - planet.radius) * 0.02;
        if (score < bestScore) {
          bestScore = score;
          dir = cand.clone();
        }
        if (rough < 6) break;
      }
      const shipU = planet.toUniverse(dir.clone().multiplyScalar(planet.radius));
      const facing = new THREE.Vector3().crossVectors(planet.localDirToUniverse(dir), Y).normalize();
      const pose = PlayerShip.groundPose(planet, shipU, facing, this.ship.model.gearHeight);
      this.ship.placeLanded(planet, pose.local, pose.quat);
      const side = facing.clone().applyAxisAngle(planet.localDirToUniverse(dir), 1.2);
      const pU = this.ship.pos.clone().addScaledVector(side, 70);
      this.player.placeAt(pU, planet, this.ship.pos.clone().sub(pU));
      this.player.lifeSupport = data.player.lifeSupport;
      this.setMode('foot', false);
    } else {
      this.restoreFromSave(data);
    }
    this.player.health = data.player.health;
    this.player.shield = data.player.shield;
    this.player.hazard = data.player.hazard;
    this.player.jetpack = data.player.jetpack;

    // wait for terrain to settle so the player never sees a hole
    const focus = (this.mode as GameMode) === 'foot' ? this.player.pos : this.ship.pos;
    const start = performance.now();
    let calm = 0;
    while (performance.now() - start < 90000) {
      this.cameraRig.update(0.016, this);
      this.world.update(this.time, 0.016, this.cameraRig.posU, focus);
      const planet = this.world.env.planet;
      const settled = !planet || planet.terrain.isSettled();
      calm = settled && this.world.pool.pending === 0 ? calm + 1 : 0;
      this.ui.showLoading('Generating terrain…', Math.min(0.98, (performance.now() - start) / 8000 + calm * 0.1));
      await this.nextFrame();
      if (calm >= 4) break;
    }
    this.ui.hideLoading();
    this.cameraRig.beginBlend();
    this.cameraRig.update(0.016, this);
    this.cameraRig.update(1, this);
    if (fresh) this.ui.showIntro();
    this.renderer.finalMat.uniforms.uFade.value = 1;
    events.emit('system:entered', { systemId: data.systemId });
  }

  private nextFrame(): Promise<void> {
    return new Promise((r) => requestAnimationFrame(() => r()));
  }

  private asteroidSet(): Set<string> {
    const arr = this.state.data.asteroidsDepleted;
    const set = new Set(arr);
    const add = set.add.bind(set);
    set.add = (v: string) => {
      if (!set.has(v)) arr.push(v);
      return add(v);
    };
    return set;
  }

  private clearTransient(): void {
    this.creatures.clear(this);
    this.wardens.clear(this);
    this.npcs.clear(this);
    this.worldEvents.clear();
    this.combat.clear();
    this.combat.targets.clear();
    this.combat.register(this.playerTarget);
  }

  private restoreFromSave(d: SaveData): void {
    const sys = this.world.system!;
    const pose = d.shipPose;
    if (pose.landed) {
      const planet = sys.planet(pose.landed.planetId) ?? sys.planets[0];
      this.ship.placeLanded(planet, new THREE.Vector3(...pose.landed.localPos), new THREE.Quaternion(...pose.landed.localQuat));
    } else {
      this.ship.pos.set(...pose.pos);
      this.ship.quat.set(...pose.quat);
      this.ship.setMode('flying');
    }
    if (d.mode === 'docked' || pose.dockedAt) {
      const st = sys.stations[0];
      this.ship.dockedAt = st;
      this.ship.setMode('docked');
      this.ship.update(0, this, true);
      this.setMode('docked', false);
      this.ui.openStation();
      return;
    }
    if (d.mode === 'foot' && d.player.planetId && d.player.localPos) {
      const planet = sys.planet(d.player.planetId) ?? sys.planets[0];
      const u = planet.toUniverse(new THREE.Vector3(...d.player.localPos));
      this.player.placeAt(u, planet);
      this.player.body.multiply(new THREE.Quaternion().setFromAxisAngle(Y, d.player.look[0]));
      this.player.pitch = d.player.look[1];
      this.setMode('foot', false);
    } else {
      this.setMode('ship', false);
      if (this.ship.mode === 'flying') this.ship.throttle = 0;
    }
  }

  setMode(m: GameMode, blend = true): void {
    const prev = this.mode;
    this.mode = m;
    if (blend && prev !== m) this.cameraRig.beginBlend();
    if (m !== 'foot') this.player.stopSounds();
    if (m !== 'ship' && m !== 'docked') this.ship.stopSounds();
    this.mining.stopSounds();
    events.emit('mode:changed', { mode: m });
  }

  // ---------------------------------------------------------------- save/load

  snapshot(): SaveData {
    const d = this.state.data;
    this.state.sync();
    d.playTime = this.time;
    d.mode = this.mode === 'docked' ? 'docked' : this.mode === 'foot' ? 'foot' : 'ship';
    const p = this.player;
    const planet = p.planet;
    d.player.health = Math.max(1, p.health);
    d.player.shield = p.shield;
    d.player.lifeSupport = p.lifeSupport;
    d.player.hazard = p.hazard;
    d.player.jetpack = p.jetpack;
    d.player.pos = p.pos.toArray() as [number, number, number];
    d.player.planetId = planet?.desc.id ?? null;
    d.player.localPos = planet ? (planet.toLocal(p.pos).addScaledVector(planet.toLocal(p.pos).normalize(), 0.3).toArray() as [number, number, number]) : null;
    d.player.look = [0, p.pitch];
    d.shipPose = {
      pos: this.ship.pos.toArray() as [number, number, number],
      quat: this.ship.quat.toArray() as [number, number, number, number],
      landed: this.ship.landedPose(),
      dockedAt: this.ship.mode === 'docked' || this.ship.mode === 'docking' ? this.ship.dockedAt?.desc.id ?? 's0' : null,
    };
    if (this.ship.mode === 'docking') d.mode = 'docked';
    return d;
  }

  save(slot: string): boolean {
    if (!this.state || !this.isPlaying) return false;
    const d = this.snapshot();
    const sys = this.world.system!;
    const loc = this.mode === 'docked' ? sys.stations[0]?.desc.name ?? 'Station' : this.world.env.planet && this.world.env.inAtmosphere > 0 ? this.world.env.planet.desc.name : 'Deep space';
    const ok = this.saves.save(slot, d, { playTime: d.playTime, systemName: sys.desc.name, location: loc, credits: d.credits });
    if (ok) events.emit('save:done', { slot });
    return ok;
  }

  // ---------------------------------------------------------------- actions

  /** Recharge a gauge (life support, hazard, fuel...) with an item from inventory. */
  recharge(gauge: keyof typeof RECHARGE_TABLE, itemId: string, maxUnits = Infinity): boolean {
    const per = RECHARGE_TABLE[gauge]?.[itemId];
    if (!per) return false;
    const cur = this.gaugeValue(gauge);
    const missing = 1 - cur;
    if (missing <= 0.001) {
      events.emit('notify', { text: 'Already full', kind: 'info' });
      return false;
    }
    const need = Math.min(maxUnits, Math.ceil(missing / per));
    const have = this.state.count(itemId);
    const use = Math.min(need, have);
    if (use <= 0) {
      events.emit('notify', { text: `No ${getItem(itemId).name} available`, kind: 'bad' });
      this.audio.play('ui_error');
      return false;
    }
    this.state.take(itemId, use);
    this.setGauge(gauge, Math.min(1, cur + use * per));
    this.audio.play('pickup');
    return true;
  }

  gaugeValue(g: string): number {
    const s = this.state.ship;
    switch (g) {
      case 'lifeSupport': return this.player.lifeSupport;
      case 'hazard': return this.player.hazard;
      case 'suitShield': return this.state.maxSuitShield ? this.player.shield / this.state.maxSuitShield : 1;
      case 'launch': return s.launchFuel;
      case 'pulse': return s.pulseFuel;
      case 'shipShield': return s.shield / this.state.maxShipShield;
      case 'hull': return s.hull / this.state.maxHull;
    }
    return 1;
  }

  private setGauge(g: string, v: number): void {
    const s = this.state.ship;
    switch (g) {
      case 'lifeSupport': this.player.lifeSupport = v; break;
      case 'hazard': this.player.hazard = v; break;
      case 'suitShield': this.player.shield = v * this.state.maxSuitShield; break;
      case 'launch': s.launchFuel = v; break;
      case 'pulse': s.pulseFuel = v; break;
      case 'shipShield': s.shield = v * this.state.maxShipShield; break;
      case 'hull': s.hull = v * this.state.maxHull; break;
    }
  }

  craft(r: Recipe, times = 1): boolean {
    if (r.blueprint && !this.state.hasBlueprint(r.blueprint)) {
      events.emit('notify', { text: 'Blueprint unknown', kind: 'bad' });
      return false;
    }
    let made = 0;
    for (let i = 0; i < times; i++) {
      if (!this.state.canAfford(r.inputs)) break;
      if (this.state.suit.spaceFor(r.output) + this.state.cargo.spaceFor(r.output) < r.amount) {
        events.emit('notify', { text: 'No space for crafted item', kind: 'bad' });
        break;
      }
      this.state.pay(r.inputs);
      this.state.give(r.output, r.amount);
      made++;
    }
    if (made > 0) {
      this.audio.play('craft');
      events.emit('notify', { text: `Crafted ${made * r.amount} × ${getItem(r.output).name}`, kind: 'good', icon: r.output });
      this.state.stat('crafted', made);
      return true;
    }
    this.audio.play('ui_error');
    events.emit('notify', { text: 'Missing materials', kind: 'bad' });
    return false;
  }

  installTech(id: string): boolean {
    const t = getTech(id);
    const lvl = this.state.level(id);
    if (lvl >= t.maxLevel) return false;
    if (t.requires && !this.state.hasBlueprint(t.requires)) {
      events.emit('notify', { text: `Requires the ${t.name} blueprint — follow the Signal`, kind: 'bad' });
      this.audio.play('ui_error');
      return false;
    }
    const cost = t.cost(lvl + 1);
    if (!this.state.pay(cost.items, cost.credits)) {
      events.emit('notify', { text: 'Insufficient materials or credits', kind: 'bad' });
      this.audio.play('ui_error');
      return false;
    }
    this.state.data.upgrades[id] = lvl + 1;
    this.state.refreshCapacities();
    events.emit('upgrade:installed', { id, level: lvl + 1 });
    events.emit('notify', { text: `Installed ${t.name} Mk.${lvl + 1}`, kind: 'good' });
    this.audio.play('craft');
    this.state.stat('upgrades');
    return true;
  }

  buyShip(classId: string, seed: number): boolean {
    const cls = getShipClass(classId);
    const tradeIn = Math.round(getShipClass(this.state.ship.classId).price * 0.5);
    const cost = Math.max(0, cls.price - tradeIn);
    if (this.state.data.credits < cost) {
      events.emit('notify', { text: 'Insufficient credits', kind: 'bad' });
      return false;
    }
    this.state.addCredits(-cost);
    const old = this.state.ship;
    this.state.sync();
    const cargoItems = old.cargo.filter((s) => s);
    old.classId = classId;
    old.seed = seed;
    old.hull = cls.hull * (1 + this.state.level('ship_hull') * 0.3);
    old.shield = cls.shield;
    old.cargo = new Array(cls.cargo).fill(null);
    this.state.cargo = new Inventory(this.state.cargoCapacity);
    for (const s of cargoItems) if (s) this.state.give(s.id, s.count, true);
    this.ship.rebuild(classId, seed);
    events.emit('notify', { text: `Acquired ${cls.name}`, kind: 'discovery' });
    this.audio.play('ui_confirm');
    return true;
  }

  undock(): void {
    if (this.mode !== 'docked') return;
    this.ui.closeAll();
    this.setMode('ship');
    this.ship.beginUndock();
    this.input.requestLock();
  }

  /** Start a hyperspace jump to another system. */
  jump(targetId: number): boolean {
    if (this.mode !== 'ship' || this.ship.mode !== 'flying') {
      events.emit('notify', { text: 'Hyperdrive can only engage in open space', kind: 'bad' });
      return false;
    }
    if (this.world.env.inAtmosphere > 0.01) {
      events.emit('notify', { text: 'Leave the atmosphere to engage the hyperdrive', kind: 'bad' });
      return false;
    }
    const range = this.state.jumpRange;
    const dist = this.galaxy.distance(this.state.data.systemId, targetId);
    if (range <= 0) {
      events.emit('notify', { text: 'No hyperdrive installed', kind: 'bad' });
      return false;
    }
    if (dist > range) {
      events.emit('notify', { text: 'Target out of range', kind: 'bad' });
      return false;
    }
    if (!this.state.take('warp_cell', 1)) {
      events.emit('notify', { text: 'A Warp Cell is required', kind: 'bad' });
      this.audio.play('ui_error');
      return false;
    }
    this.save('auto');
    this.ui.closeAll();
    this.setMode('warp', false);
    this.ship.setMode('warp');
    this.warpState = { t: 0, target: targetId, loaded: false };
    this.audio.play('warp_charge', 1);
    this.audio.setMood('silent');
    return true;
  }

  private updateWarp(dt: number): void {
    const w = this.warpState!;
    w.t += dt;
    const fm = this.renderer.finalMat.uniforms;
    const charge = Math.min(1, w.t / 2.2);
    this.cameraRig.fovBoost = charge * 30;
    this.cameraRig.shake(0.08 * charge);
    // accelerate into the jump; after the new system is streamed in the ship coasts in the tunnel
    this.ship.vel.copy(this.ship.forward).multiplyScalar(w.loaded ? 0 : 300 + charge * 4000);
    this.ship.pos.addScaledVector(this.ship.vel, dt);
    this.ship.root.position.copy(this.ship.pos);
    this.ship.throttle = 1;
    const tunnel = THREE.MathUtils.smoothstep(w.t, 1.8, 2.6) * (1 - THREE.MathUtils.smoothstep(w.t, 7.5, 8.5));
    this.warpTunnel.update(this.time, tunnel);
    fm.uAberration.value = tunnel * 3;
    fm.uFlash.value = Math.max(0, 1 - Math.abs(w.t - 2.5) * 3) * 0.9;
    if (w.t > 2.6 && !w.loaded) {
      w.loaded = true;
      this.arriveInSystem(w.target);
    }
    if (w.t > 8.5) {
      this.warpState = null;
      this.cameraRig.fovBoost = 0;
      fm.uAberration.value = 0;
      this.warpTunnel.update(this.time, 0);
      this.ship.setMode('flying');
      this.ship.throttle = 0.3;
      this.ship.vel.copy(this.ship.forward).multiplyScalar(200);
      this.setMode('ship', false);
      this.audio.play('warp_exit', 1);
      fm.uFlash.value = 0.8;
      this.save('auto');
    }
  }

  private arriveInSystem(id: number): void {
    this.clearTransient();
    const d = this.state.data;
    d.systemId = id;
    if (!d.visited.includes(id)) d.visited.push(id);
    const sys = this.world.loadSystem(this.galaxy, id, (k) => this.state.depletedSet(k), this.asteroidSet(), this.time);
    // arrive facing the station
    const st = sys.stations[0];
    const target = st ? st.position : sys.planets[0].position;
    const from = target.clone().add(new THREE.Vector3(0.6, 0.15, 0.8).normalize().multiplyScalar(26000));
    this.ship.pos.copy(from);
    this.ship.quat.setFromRotationMatrix(new THREE.Matrix4().lookAt(from, target, Y));
    this.ship.root.position.copy(this.ship.pos);
    this.world.maybeRebase(this.ship.pos);
    this.discovery.discover(this, 'system', `sys${id}`, sys.desc.name, `${sys.desc.star.classLabel}-class star`, 1000);
    this.quest.onSystemEntered(this);
    events.emit('system:entered', { systemId: id });
    this.state.stat('jumps');
  }

  private onDeath(cause: string): void {
    if (this.mode === 'dead') return;
    this.setMode('dead', false);
    this.deathTimer = 0;
    this.audio.play('death');
    this.ui.showDeath(cause);
    this.state.stat('deaths');
  }

  respawn(): void {
    const p = this.player;
    // lose a portion of carried resources
    for (const s of this.state.suit.slots) {
      if (s && getItem(s.id).category === 'resource') s.count = Math.floor(s.count * 0.6);
    }
    this.state.suit.slots = this.state.suit.slots.map((s) => (s && s.count > 0 ? s : null));
    p.dead = false;
    p.health = 100;
    p.lifeSupport = Math.max(0.5, p.lifeSupport);
    p.hazard = 1;
    this.wardens.clear(this);
    this.wardens.alert = 0;
    const planet = this.ship.landedPlanet;
    if (this.ship.mode === 'landed' && planet) {
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(this.ship.quat);
      p.placeAt(this.ship.pos.clone().addScaledVector(side, 12), planet, this.ship.pos.clone().sub(p.pos));
      this.setMode('foot', false);
    } else {
      this.dockAtStation();
    }
    this.renderer.finalMat.uniforms.uDamage.value = 0;
    this.renderer.finalMat.uniforms.uFade.value = 1;
    this.ui.hideDeath();
  }

  private onShipDestroyed(): void {
    this.effects.explosion(this.ship.pos, 3);
    this.audio.play('explosion', 1);
    // lose half of cargo, respawn at station with repaired hull
    for (const s of this.state.cargo.slots) if (s) s.count = Math.floor(s.count * 0.5);
    this.state.cargo.slots = this.state.cargo.slots.map((s) => (s && s.count > 0 ? s : null));
    this.state.ship.hull = this.state.maxHull * 0.4;
    this.state.ship.shield = 0;
    this.onDeath('Ship destroyed');
  }

  private dockAtStation(): void {
    const st = this.world.system!.stations[0];
    this.ship.dockedAt = st;
    this.ship.setMode('docked');
    this.ship.update(0, this, true);
    this.setMode('docked', false);
    this.ui.openStation();
  }

  // ---------------------------------------------------------------- interaction

  collideStructures(u: THREE.Vector3, radius: number, up: THREE.Vector3): void {
    const planet = this.player.planet;
    if (planet) {
      const local = planet.toLocal(u, new THREE.Vector3());
      if (this.pois.collide(local, radius)) planet.toUniverse(local, u);
    }
    // landed ship hull
    if (this.ship.mode === 'landed') {
      const d = u.clone().sub(this.ship.pos);
      const h = d.dot(up);
      if (h > -3 && h < 3) {
        d.addScaledVector(up, -h);
        const r = this.ship.model.length * 0.32 + radius;
        const len = d.length();
        if (len < r && len > 1e-3) u.addScaledVector(d, (r - len) / len);
      }
    }
  }

  private findPrompt(): Prompt | null {
    if (this.mode === 'foot') {
      const p = this.player;
      const it = this.pois.nearestInteractable(p.pos.clone().addScaledVector(p.up, 1), 2.8);
      if (it) return { text: it.prompt, key: 'E', action: () => it.action(this) };
      for (const s of this.worldEvents.sites) {
        if (!s.onlyInShip && s.prompt && s.pos().distanceTo(p.pos) < s.radius) return { text: s.prompt, key: 'E', action: () => s.action(this) };
      }
      if (this.ship.mode === 'landed' && p.pos.distanceTo(this.ship.pos) < this.ship.model.length * 0.6 + 4) {
        return { text: 'Board ship', key: 'E', action: () => this.boardShip() };
      }
    } else if (this.mode === 'ship') {
      const s = this.ship;
      if (s.mode === 'landed') return { text: 'Disembark', key: 'E', action: () => this.disembark() };
      if (s.mode === 'flying') {
        const st = this.world.system!.stations.find((x) => x.toUniverse(x.bayEntrance).distanceTo(s.pos) < 700);
        if (st) return { text: `Request docking · ${st.desc.name}`, key: 'E', action: () => this.requestDock(st) };
        for (const site of this.worldEvents.sites) {
          if (site.onlyInShip && site.prompt && site.pos().distanceTo(s.pos) < site.radius) return { text: site.prompt, key: 'E', action: () => site.action(this) };
        }
        if (s.altitude < 700 && this.world.env.planet) return { text: 'Land', key: 'E', action: () => s.beginLanding(this) };
      }
    }
    return null;
  }

  private requestDock(st: Station): void {
    this.ship.beginDocking(st);
    this.audio.play('ui_confirm');
    events.emit('notify', { text: `Docking clearance granted — ${st.desc.name}`, kind: 'info' });
  }

  boardShip(): void {
    this.setMode('ship');
    this.player.vel.set(0, 0, 0);
    this.audio.play('dock', 0.4);
    this.cameraRig.orbit.yaw = Math.PI;
  }

  disembark(): void {
    const s = this.ship;
    const planet = s.landedPlanet as Planet;
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(s.quat);
    const u = s.pos.clone().addScaledVector(side, s.model.length * 0.45 + 2);
    this.player.placeAt(u, planet, s.forward);
    this.setMode('foot');
    this.audio.play('thud', 0.5);
  }

  // ---------------------------------------------------------------- loop

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const rawDt = Math.max(0, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const dt = Math.min(rawDt, 1 / 20);
    this.fpsAcc += rawDt;
    this.fpsFrames++;
    if (this.fpsAcc > 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    try {
      this.frame(dt);
    } catch (e) {
      console.error(e);
    }
    this.input.endFrame();
  };

  private frame(dt: number): void {
    const fm = this.renderer.finalMat.uniforms;
    if (this.mode === 'menu') {
      this.menuTime += dt;
      this.ui.update(dt);
      if (this.world.system) this.menuBackdrop(dt);
      this.renderer.render(this.menuTime);
      return;
    }
    if (this.mode === 'loading') return; // the loading screen covers the view; spend the frame on streaming
    if (this.input.wasPressed('pause') && !this.ui.consumeEscape()) this.ui.togglePause();
    const paused = this.ui.paused;
    if (!paused) {
      this.time += dt;
      this.simulate(dt);
    }
    // post fx decay
    fm.uFade.value = Math.max(0, fm.uFade.value - dt * 0.8);
    fm.uDamage.value = Math.max(0, fm.uDamage.value - dt * 0.6);
    if (this.lightning > 0) {
      fm.uFlash.value = Math.max(fm.uFlash.value, this.lightning * (0.5 + Math.random() * 0.5) * 0.6);
      fm.uFlashColor.value.setRGB(0.8, 0.85, 1);
      this.lightning = Math.max(0, this.lightning - dt * 3);
    } else if (!this.warpState) {
      fm.uFlash.value = Math.max(0, fm.uFlash.value - dt * 2);
      fm.uFlashColor.value.setRGB(1, 1, 1);
    }
    fm.uVignette.value = this.mode === 'foot' ? 0.4 : 0.3;
    this.ui.update(dt);
    this.renderer.render(this.time);
  }

  private simulate(dt: number): void {
    const input = this.input;
    const blocking = this.uiBlocking;

    if (this.mode === 'warp') {
      this.updateWarp(dt);
    } else if (this.mode === 'dead') {
      this.deathTimer += dt;
      this.renderer.finalMat.uniforms.uFade.value = Math.min(0.85, this.deathTimer * 0.5);
    }

    // global hotkeys
    if (!blocking && this.isPlaying) {
      if (input.wasPressed('inventory')) this.ui.openExosuit();
      else if (input.wasPressed('map')) this.ui.openMap();
      else if (input.wasPressed('missions')) this.ui.openLog('missions');
      else if (input.wasPressed('discoveries')) this.ui.openLog('discoveries');
      else if (input.wasPressed('craft')) this.ui.openExosuit('crafting');
      else if (input.wasPressed('galaxy')) this.ui.openGalaxy();
      else if (input.wasPressed('quickSave')) {
        if (this.save('slot1')) events.emit('notify', { text: 'Game saved', kind: 'good' });
      } else if (input.wasPressed('camera') && this.mode === 'foot') {
        this.cameraRig.thirdPersonFoot = !this.cameraRig.thirdPersonFoot;
      } else if (input.wasPressed('hud')) this.ui.toggleHud();
    } else if (blocking && (input.wasPressed('inventory') || input.wasPressed('map') || input.wasPressed('missions') || input.wasPressed('galaxy'))) {
      if (this.mode !== 'docked') this.ui.closeAll();
    }

    // mode updates
    if (this.mode === 'foot') {
      this.player.update(dt, this);
    }
    const piloting = this.mode === 'ship';
    this.ship.update(dt, this, piloting);
    if (piloting || this.mode === 'docked') this.player.rechargeInShip(dt);
    if (piloting && this.pendingPirates > 0 && this.ship.mode === 'flying' && this.world.env.inAtmosphere < 0.01) {
      const st = this.world.system!.stations[0];
      if (!st || st.position.distanceTo(this.ship.pos) > 5000) {
        this.npcs.spawnPirates(this, Math.min(4, this.pendingPirates));
        this.pendingPirates = 0;
      }
    }
    // ship target lock for aim assist & HUD
    if (piloting && (this.ship.mode === 'flying')) {
      const t = this.combat.nearestHostile(this.ship.pos, this.ship.forward, 3000, 0.9);
      this.lockedTarget = t;
      this.ship.lockedTarget = t ? { pos: t.pos, vel: t.vel ?? new THREE.Vector3() } : null;
    } else if (this.mode === 'foot') {
      const t = this.combat.nearestHostile(this.player.eye, this.player.forward, 120, 0.96);
      this.lockedTarget = t && (t.faction === 'hostile' || this.mining.mode === 'combat') ? t : null;
      this.ship.lockedTarget = null;
    } else {
      this.lockedTarget = null;
    }

    // interaction prompt
    this.prompt = this.isPlaying && !blocking ? this.findPrompt() : null;
    if (this.prompt && input.wasPressed('interact')) {
      const p = this.prompt;
      this.prompt = null;
      p.action();
    }

    // systems
    this.mining.update(dt, this);
    this.avatar.update(dt, this);
    this.discovery.update(dt, this);
    this.creatures.update(dt, this);
    this.wardens.update(dt, this);
    this.npcs.update(dt, this);
    this.pois.update(dt, this);
    this.worldEvents.update(dt, this);
    this.combat.update(dt, this);
    this.economy.update(dt, this);
    if (this.isPlaying) this.quest.update(this);

    // camera + world
    this.cameraRig.orbit.active = false;
    this.cameraRig.update(dt, this);
    const focus = this.mode === 'foot' || this.mode === 'dead' ? this.player.pos : this.ship.pos;
    this.world.update(this.time, dt, this.cameraRig.posU, focus);
    this.weather.update(dt, this);
    this.effects.update(dt, this.cameraRig.posU, this.world.origin);
    this.effects.setPixelScale(this.renderer.renderer.domElement.height, this.renderer.camera.fov);

    // music mood (and slow environment checks)
    this.musicTimer -= dt;
    if (this.musicTimer <= 0) {
      this.musicTimer = 2;
      const env = this.world.env;
      if (env.planet && this.isPlaying && (env.inAtmosphere > 0.2 || env.altitude < env.planet.desc.terrain.heightScale * 4)) {
        const pd = env.planet.desc;
        if (this.discovery.discover(this, 'planet', env.planet.key, pd.name, `${pd.archetypeLabel} · ${this.world.system!.desc.name}`, pd.isMoon ? 400 : 600)) {
          events.emit('planet:entered', { planetId: pd.id });
        }
      }
      const danger = this.combat.hostilesNear(focus, 400) || this.npcs.hostileCount > 0;
      const mood = danger ? 'danger' : this.mode === 'docked' ? 'station' : this.world.env.inAtmosphere > 0.3 ? (this.world.env.day < 0.3 ? 'night' : 'planet') : 'space';
      this.audio.setMood(mood);
    }

    // autosave
    this.autosaveTimer += dt;
    if (this.autosaveTimer > 180 && this.isPlaying && !blocking) {
      this.autosaveTimer = 0;
      if (this.save('auto')) events.emit('notify', { text: 'Autosaved', kind: 'info' });
    }
  }

  /** Slowly orbiting camera behind the main menu. */
  private menuBackdrop(dt: number): void {
    const sys = this.world.system!;
    const planet = sys.planets[0];
    const t = this.menuTime * 0.02;
    const dist = planet.radius * 2.6;
    const pos = planet.position.clone().add(new THREE.Vector3(Math.cos(t) * dist, planet.radius * 0.5, Math.sin(t) * dist));
    this.cameraRig.posU.copy(pos);
    const m = new THREE.Matrix4().lookAt(pos, planet.position.clone().add(new THREE.Vector3(0, planet.radius * 0.6, 0)), Y);
    this.renderer.camera.quaternion.setFromRotationMatrix(m);
    this.world.update(this.time + this.menuTime * 10, dt, pos, pos);
    this.renderer.camera.position.copy(this.world.toRender(pos));
    this.renderer.camera.updateMatrixWorld();
  }

  /** Load a system purely for the menu backdrop. */
  prepareMenuBackdrop(seed: number): void {
    this.galaxy = new Galaxy(seed);
    this.world.loadSystem(this.galaxy, this.galaxy.startSystemId, () => new Set(), new Set(), 0);
  }

  quitToMenu(): void {
    this.save('auto');
    this.clearTransient();
    this.player.stopSounds();
    this.ship.stopSounds();
    this.mining.stopSounds();
    this.weather.silence();
    this.mode = 'menu';
    this.ui.closeAll();
    this.ui.showMainMenu();
    this.audio.setMood('menu');
    this.input.releaseLock();
  }
}
