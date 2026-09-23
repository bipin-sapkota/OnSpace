import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Planet } from './Planet';
import type { WeatherKind } from '../universe/types';
import { events } from '../core/EventBus';
import type { LoopHandle } from '../audio/AudioEngine';
import { getParticleTexture } from '../render/Textures';

/**
 * Planetary weather. Each planet cycles between clear skies and its native
 * weather types; storms raise hazards, thicken clouds and haze, and bring
 * lightning. Precipitation is rendered as camera-local wrapped particles.
 */
const DROPS = 2400;
const BOX = 36;

interface PlanetWeather {
  kind: WeatherKind;
  intensity: number;
  target: number;
  storm: boolean;
  timer: number;
}

export class WeatherSystem {
  private states = new Map<string, PlanetWeather>();
  private planet: Planet | null = null;
  private rain: THREE.LineSegments;
  private flakes: THREE.Points;
  private rainPos: Float32Array;
  private flakePos: Float32Array;
  private offsets: Float32Array;
  private flakeMat: THREE.PointsMaterial;
  private rainMat: THREE.LineBasicMaterial;
  private wind: LoopHandle | null = null;
  private rainLoop: LoopHandle | null = null;
  private lightningTimer = 5;
  private baseMie = new Map<Planet, number>();
  hazardMultiplier = 1;
  current: PlanetWeather | null = null;

  constructor(scene: THREE.Scene) {
    this.offsets = new Float32Array(DROPS * 3);
    for (let i = 0; i < this.offsets.length; i++) this.offsets[i] = Math.random() * BOX;
    this.rainPos = new Float32Array(DROPS * 6);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rainMat = new THREE.LineBasicMaterial({ color: 0x9fb4c8, transparent: true, opacity: 0.35, depthWrite: false });
    this.rain = new THREE.LineSegments(rg, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.flakePos = new Float32Array(DROPS * 3);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(this.flakePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.flakeMat = new THREE.PointsMaterial({ size: 0.12, map: getParticleTexture(), transparent: true, depthWrite: false, color: 0xffffff, opacity: 0.8 });
    this.flakes = new THREE.Points(fg, this.flakeMat);
    this.flakes.frustumCulled = false;
    this.flakes.visible = false;
    scene.add(this.rain, this.flakes);
  }

  stateFor(p: Planet): PlanetWeather {
    let s = this.states.get(p.key);
    if (!s) {
      s = { kind: 'clear', intensity: 0, target: 0, storm: false, timer: 30 + Math.random() * 60 };
      this.states.set(p.key, s);
    }
    return s;
  }

  describe(p: Planet): string {
    const s = this.stateFor(p);
    if (s.kind === 'clear' || s.intensity < 0.1) return 'Clear';
    const names: Record<WeatherKind, string> = { clear: 'Clear', rain: 'Rain', snow: 'Snowfall', dust: 'Dust', ash: 'Ashfall', toxic: 'Caustic rain', spores: 'Drifting spores' };
    return (s.storm ? 'Storm · ' : '') + names[s.kind];
  }

  update(dt: number, game: Game): void {
    const env = game.world.env;
    const planet = env.planet && env.inAtmosphere > 0 ? env.planet : null;
    if (planet !== this.planet) {
      if (this.planet) {
        this.planet.weatherCloud = 0;
        const bm = this.baseMie.get(this.planet);
        if (bm !== undefined && this.planet.atmo) this.planet.atmo.mie = bm;
      }
      this.planet = planet;
      if (planet?.atmo && !this.baseMie.has(planet)) this.baseMie.set(planet, planet.atmo.mie);
    }
    if (!this.audioReady(game)) return;
    if (!planet) {
      this.rain.visible = this.flakes.visible = false;
      this.hazardMultiplier = 1;
      this.wind!.set(0);
      this.rainLoop!.set(0);
      this.current = null;
      return;
    }
    const s = this.stateFor(planet);
    this.current = s;
    s.timer -= dt;
    if (s.timer <= 0) {
      const d = planet.desc;
      const next = d.weather[Math.floor(Math.random() * d.weather.length)];
      s.kind = next === 'clear' ? s.kind : next;
      s.target = next === 'clear' ? 0 : 0.4 + Math.random() * 0.6;
      const wasStorm = s.storm;
      s.storm = next !== 'clear' && Math.random() < d.stormChance;
      if (s.storm) s.target = 1;
      s.timer = s.storm ? 60 + Math.random() * 60 : 90 + Math.random() * 120;
      if (s.storm && !wasStorm && game.mode === 'foot') {
        events.emit('notify', { text: `Storm approaching — ${this.describe(planet)}`, kind: 'warn' });
        game.audio.play('alarm', 0.4);
      }
      events.emit('weather:changed', { planetId: planet.desc.id, kind: s.kind, storm: s.storm });
    }
    s.intensity += (s.target - s.intensity) * Math.min(1, dt * 0.08);
    const I = s.intensity * env.inAtmosphere;
    this.hazardMultiplier = 1 + (s.storm ? I * 2.5 : I * 0.4);
    planet.weatherCloud = I;
    const bm = this.baseMie.get(planet);
    if (bm !== undefined && planet.atmo) planet.atmo.mie = bm * (1 + I * (s.storm ? 5 : 1.5) * (s.kind === 'dust' || s.kind === 'ash' ? 2 : 1));

    // precipitation particles around camera
    const cam = game.renderer.camera;
    const up = game.cameraRig.posU.clone().sub(planet.position).normalize();
    const low = env.altitude < 900;
    const isRain = s.kind === 'rain' || s.kind === 'toxic';
    this.rain.visible = isRain && I > 0.05 && low;
    this.flakes.visible = !isRain && I > 0.05 && low && s.kind !== 'clear';
    const count = Math.floor(DROPS * Math.min(1, I));
    const t = game.time;
    const wind = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0.3, 0.9, 0.1)).normalize().multiplyScalar(s.storm ? 6 : 2);
    const tangent = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 0, 1)).normalize();
    const bitangent = new THREE.Vector3().crossVectors(up, tangent);
    const cp = cam.position;
    if (this.rain.visible) {
      this.rainMat.color.set(s.kind === 'toxic' ? 0xc8f06a : 0x9fb4c8);
      const fall = 22;
      for (let i = 0; i < DROPS; i++) {
        if (i >= count) {
          this.rainPos.fill(0, i * 6, i * 6 + 6);
          continue;
        }
        const ox = this.offsets[i * 3], oy = this.offsets[i * 3 + 1], oz = this.offsets[i * 3 + 2];
        const h = BOX - ((oy + t * fall) % BOX);
        const a = ((ox + t * wind.length()) % BOX) - BOX / 2;
        const b = oz - BOX / 2;
        const px = cp.x + tangent.x * a + bitangent.x * b + up.x * (h - BOX / 3);
        const py = cp.y + tangent.y * a + bitangent.y * b + up.y * (h - BOX / 3);
        const pz = cp.z + tangent.z * a + bitangent.z * b + up.z * (h - BOX / 3);
        const L = 0.7;
        this.rainPos.set([px, py, pz, px - up.x * L + wind.x * 0.03, py - up.y * L + wind.y * 0.03, pz - up.z * L + wind.z * 0.03], i * 6);
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.rainMat.opacity = 0.25 + I * 0.25;
    }
    if (this.flakes.visible) {
      const conf: Record<string, [number, number, number]> = { snow: [0xffffff, 0.14, 2.5], dust: [0xc9a57a, 0.25, 1], ash: [0x3a3330, 0.18, 1.5], spores: [0xb8ff9a, 0.12, 0.6] };
      const [col, size, fall] = conf[s.kind] ?? conf.snow;
      this.flakeMat.color.set(col);
      this.flakeMat.size = size;
      if (s.kind === 'spores') this.flakeMat.color.multiplyScalar(2.5);
      for (let i = 0; i < DROPS; i++) {
        if (i >= count) {
          this.flakePos[i * 3] = cp.x; this.flakePos[i * 3 + 1] = cp.y - 1000; this.flakePos[i * 3 + 2] = cp.z;
          continue;
        }
        const ox = this.offsets[i * 3], oy = this.offsets[i * 3 + 1], oz = this.offsets[i * 3 + 2];
        const h = BOX - ((oy + t * fall) % BOX);
        const sway = Math.sin(t * 0.8 + i) * 0.6;
        const a = ((ox + t * wind.length() * (s.kind === 'dust' ? 4 : 1)) % BOX) - BOX / 2 + sway;
        const b = oz - BOX / 2;
        this.flakePos[i * 3] = cp.x + tangent.x * a + bitangent.x * b + up.x * (h - BOX / 3);
        this.flakePos[i * 3 + 1] = cp.y + tangent.y * a + bitangent.y * b + up.y * (h - BOX / 3);
        this.flakePos[i * 3 + 2] = cp.z + tangent.z * a + bitangent.z * b + up.z * (h - BOX / 3);
      }
      this.flakes.geometry.attributes.position.needsUpdate = true;
    }

    // lightning
    if (s.storm && I > 0.5 && (s.kind === 'rain' || s.kind === 'ash' || s.kind === 'toxic')) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 4 + Math.random() * 10;
        game.lightning = 0.6 + Math.random() * 0.4;
        setTimeout(() => game.audio.play('explosion', 0.35, (Math.random() - 0.5) * 1.5, 0.5), 400 + Math.random() * 1500);
      }
    }

    // ambience
    const inA = env.inAtmosphere;
    const windVol = (0.12 + I * (s.storm ? 0.6 : 0.25)) * inA * (game.mode === 'docked' ? 0 : 1);
    this.wind!.set(windVol, 1, 400 + I * 600 + Math.min(1, env.altitude / 1000) * 400);
    this.rainLoop!.set(isRain && low ? I * 0.4 : 0);
  }

  private audioReady(game: Game): boolean {
    if (!game.audio.ready) return false;
    if (!this.wind) this.wind = game.audio.loop('wind');
    if (!this.rainLoop) this.rainLoop = game.audio.loop('rain');
    return true;
  }

  silence(): void {
    this.wind?.set(0);
    this.rainLoop?.set(0);
  }
}
