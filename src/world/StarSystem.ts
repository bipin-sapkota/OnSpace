import * as THREE from 'three';
import type { GalaxySystemEntry, StarSystemDesc } from '../universe/types';
import { Planet } from './Planet';
import { Star } from './Star';
import { Station } from './Station';
import { AsteroidField } from './AsteroidField';
import { Skybox } from './Skybox';
import type { TerrainWorkerPool } from './terrain/WorkerPool';
import type { AtmosphereInstance } from '../render/AtmospherePass';

/**
 * Runtime container for everything in the current star system. Created when
 * the player arrives (game start / hyperspace exit) and disposed on departure.
 */
export class StarSystem {
  readonly desc: StarSystemDesc;
  readonly star: Star;
  readonly planets: Planet[] = [];
  readonly stations: Station[] = [];
  readonly asteroids: AsteroidField;
  readonly skybox: Skybox;
  private worldRoot: THREE.Object3D;

  constructor(
    desc: StarSystemDesc,
    galaxy: GalaxySystemEntry[],
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    worldRoot: THREE.Object3D,
    pool: TerrainWorkerPool,
    depletedFor: (planetKey: string) => Set<string>,
    asteroidDepleted: Set<string>,
    time: number,
  ) {
    this.desc = desc;
    this.worldRoot = worldRoot;
    this.skybox = new Skybox(renderer, desc, galaxy);
    scene.add(this.skybox.group);
    this.star = new Star(desc.star);
    worldRoot.add(this.star.group);
    for (const pd of desc.planets) {
      const p = new Planet(pd, desc.seed, pool, depletedFor(`${desc.seed}:${pd.id}`), time);
      worldRoot.add(p.root);
      this.planets.push(p);
    }
    for (const sd of desc.stations) {
      const s = new Station(sd);
      worldRoot.add(s.root);
      this.stations.push(s);
    }
    this.asteroids = new AsteroidField(desc.belts, desc.seed, asteroidDepleted);
    worldRoot.add(this.asteroids.group);
  }

  planet(id: string): Planet | undefined {
    return this.planets.find((p) => p.desc.id === id);
  }

  /** Planet whose sphere of influence contains `u`, preferring the nearest surface. */
  nearestPlanet(u: THREE.Vector3): { planet: Planet; altitude: number; dist: number } {
    let best = this.planets[0];
    let bestAlt = Infinity;
    for (const p of this.planets) {
      const d = p.position.distanceTo(u) - p.radius;
      if (d < bestAlt) {
        bestAlt = d;
        best = p;
      }
    }
    return { planet: best, altitude: bestAlt, dist: bestAlt + best.radius };
  }

  get atmospheres(): AtmosphereInstance[] {
    const list: AtmosphereInstance[] = [];
    for (const p of this.planets) if (p.atmo) list.push(p.atmo);
    return list;
  }

  update(time: number, dt: number, camU: THREE.Vector3, camera: THREE.Camera, origin: THREE.Vector3): void {
    this.star.update(time);
    for (const p of this.planets) p.update(time, dt, camU, camera, origin, this.star.color);
    for (const s of this.stations) s.update(time);
    this.asteroids.update(camU);
  }

  dispose(pool: TerrainWorkerPool): void {
    for (const p of this.planets) p.dispose(pool);
    for (const s of this.stations) s.dispose();
    this.asteroids.dispose();
    this.star.dispose();
    this.skybox.dispose();
    void this.worldRoot;
  }
}
