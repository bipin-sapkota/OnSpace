import * as THREE from 'three';
import type { Renderer } from '../render/Renderer';
import { StarSystem } from './StarSystem';
import { TerrainWorkerPool } from './terrain/WorkerPool';
import type { Galaxy } from '../universe/Galaxy';
import type { Planet } from './Planet';
import { settings } from '../core/Settings';

const REBASE_DISTANCE = 3000;

/**
 * World container. Everything spatial lives under `root`, positioned in
 * double-precision universe coordinates. A floating origin keeps the camera
 * near (0,0,0) in render space so float32 GPU precision is never an issue,
 * even hundreds of kilometres from the star.
 */
export class World {
  readonly root = new THREE.Group();
  readonly origin = new THREE.Vector3();
  readonly pool = new TerrainWorkerPool();
  system: StarSystem | null = null;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  private renderer: Renderer;
  /** Environment derived each frame for the camera location. */
  env = {
    planet: null as Planet | null,
    altitude: Infinity,
    inAtmosphere: 0, // 0 = space, 1 = at ground level inside atmosphere
    day: 1, // sun elevation factor at camera
    sunElevation: 1,
  };

  constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.root.name = 'world-root';
    renderer.scene.add(this.root);
    this.sun = new THREE.DirectionalLight(0xffffff, 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(settings.data.shadowMapSize, settings.data.shadowMapSize);
    const sc = this.sun.shadow.camera;
    sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.near = 1; sc.far = 1200;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    renderer.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0x8899bb, 0x443322, 0.2);
    this.ambient = new THREE.AmbientLight(0x404858, 0.15);
    renderer.scene.add(this.hemi, this.ambient);
    settings.onChange((s) => {
      if (this.sun.shadow.mapSize.x !== s.shadowMapSize) {
        this.sun.shadow.mapSize.set(s.shadowMapSize, s.shadowMapSize);
        this.sun.shadow.map?.dispose();
        this.sun.shadow.map = null;
      }
    });
  }

  loadSystem(galaxy: Galaxy, id: number, depletedFor: (k: string) => Set<string>, asteroidDepleted: Set<string>, time: number): StarSystem {
    this.unloadSystem();
    const desc = galaxy.getSystem(id);
    this.system = new StarSystem(desc, galaxy.systems, this.renderer.renderer, this.renderer.scene, this.root, this.pool, depletedFor, asteroidDepleted, time);
    return this.system;
  }

  unloadSystem(): void {
    if (this.system) {
      this.system.dispose(this.pool);
      this.system = null;
    }
  }

  /** Convert a universe position into render space. */
  toRender(u: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(u).sub(this.origin);
  }

  /** Recentre the floating origin if the camera wandered too far. */
  maybeRebase(camU: THREE.Vector3): boolean {
    if (camU.distanceTo(this.origin) < REBASE_DISTANCE) return false;
    this.origin.copy(camU).round();
    this.root.position.copy(this.origin).multiplyScalar(-1);
    this.root.updateMatrixWorld(true);
    return true;
  }

  update(time: number, dt: number, camU: THREE.Vector3, focusU: THREE.Vector3): void {
    const sys = this.system;
    if (!sys) return;
    const cam = this.renderer.camera;
    this.maybeRebase(camU);
    this.root.position.copy(this.origin).multiplyScalar(-1);
    sys.update(time, dt, camU, cam, this.origin);

    // environment at camera
    const near = sys.nearestPlanet(camU);
    const planet = near.planet;
    const alt = planet.altitudeAt(camU).altitude;
    this.env.planet = planet;
    this.env.altitude = alt;
    const atmoH = planet.desc.atmosphere.enabled ? planet.desc.atmosphere.height : 0;
    this.env.inAtmosphere = atmoH > 0 ? 1 - THREE.MathUtils.smoothstep(alt, atmoH * 0.1, atmoH * 1.0) : 0;
    const elev = planet.sunElevation(camU);
    this.env.sunElevation = elev;
    this.env.day = THREE.MathUtils.smoothstep(elev, -0.15, 0.2);

    // sun light: direction from the star toward the focus (player)
    const sunDir = focusU.clone().multiplyScalar(-1).normalize();
    const focusR = this.toRender(focusU);
    // light attenuates at night on the near planet (planet shadows the player)
    const nearSurface = alt < (atmoH || 3000) * 1.5;
    const shadowed = nearSurface ? THREE.MathUtils.smoothstep(elev, -0.12, 0.06) : 1;
    const starCol = sys.star.color;
    this.sun.color.copy(starCol);
    // warm the light near the horizon inside atmospheres
    if (this.env.inAtmosphere > 0) {
      const warm = 1 - THREE.MathUtils.smoothstep(elev, 0.0, 0.35);
      this.sun.color.lerp(new THREE.Color(1.0, 0.55, 0.3), warm * 0.7 * this.env.inAtmosphere);
    }
    this.sun.intensity = 3.2 * shadowed;
    this.sun.position.copy(focusR).addScaledVector(sunDir, 600);
    this.sun.target.position.copy(focusR);
    this.sun.target.updateMatrixWorld();
    this.sun.castShadow = settings.data.shadows && nearSurface && shadowed > 0.05;

    // ambient: sky light inside atmospheres, faint starlight in space
    const sky = planet.skyColor;
    const inA = this.env.inAtmosphere;
    // day: sky-tinted skylight; night: cool, dim "moonlight" so terrain stays readable
    const night = 1 - this.env.day;
    this.hemi.color.copy(sky).multiplyScalar(0.25 + 0.75 * this.env.day).lerp(new THREE.Color(0.35, 0.45, 0.75), night * 0.6);
    this.hemi.groundColor.copy(planet.fogColor).multiplyScalar(0.35);
    this.hemi.intensity = inA * (1.2 - 0.4 * this.env.day);
    // faint starlight keeps night sides and airless moons readable
    this.ambient.intensity = 0.22 + inA * 0.1 * this.env.day;

    // backdrop brightness fades in daylight skies
    const skyBright = 1 - inA * this.env.day * 0.97;
    sys.skybox.update(cam.position, skyBright, Math.max(0.5, this.renderer.pixelHeight / 900));
    this.renderer.atmosphere.instances = sys.atmospheres;
  }

  dispose(): void {
    this.unloadSystem();
    this.pool.dispose();
  }
}
