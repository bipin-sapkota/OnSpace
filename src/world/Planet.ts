import * as THREE from 'three';
import type { PlanetDesc } from '../universe/types';
import { TerrainGen } from './terrain/TerrainGen';
import { TerrainQuadTree } from './terrain/QuadTree';
import type { TerrainWorkerPool } from './terrain/WorkerPool';
import { createLiquidMaterial, createTerrainMaterial } from './terrain/TerrainMaterials';
import { createPlanetLightUniforms, type PlanetLightUniforms } from '../render/PlanetLighting';
import { CloudLayer } from './Clouds';
import { ScatterManager } from './ScatterManager';
import type { AtmosphereInstance } from '../render/AtmospherePass';
import { settings } from '../core/Settings';

const Y = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

/**
 * Runtime planet: quadtree terrain, liquid, clouds, scatter and atmosphere.
 * The planet spins about its axis; objects standing on it (player, landed
 * ship) are carried with the spin via `spinDelta` so day/night is real.
 */
export class Planet {
  readonly desc: PlanetDesc;
  readonly gen: TerrainGen;
  readonly root = new THREE.Group();
  readonly lu: PlanetLightUniforms;
  readonly terrain: TerrainQuadTree;
  readonly scatter: ScatterManager;
  readonly clouds: CloudLayer | null;
  readonly atmo: AtmosphereInstance | null;
  readonly position: THREE.Vector3;
  readonly radius: number;
  readonly atmosphereRadius: number;
  readonly skyColor = new THREE.Color();
  readonly fogColor = new THREE.Color();
  private baseQuat = new THREE.Quaternion();
  private spinAngle = 0;
  /** World-space rotation applied this frame (for carrying attached objects). */
  readonly spinDelta = new THREE.Quaternion();
  private terrainMat: THREE.MeshStandardMaterial;
  private liquidMat: THREE.MeshStandardMaterial | null = null;
  /** Weather-driven multiplier on cloud coverage & fog. */
  weatherCloud = 0;
  readonly camLocal = new THREE.Vector3();
  readonly key: string;

  constructor(desc: PlanetDesc, systemSeed: number, pool: TerrainWorkerPool, depleted: Set<string>, time: number) {
    this.desc = desc;
    this.key = `${systemSeed}:${desc.id}`;
    this.gen = new TerrainGen(desc.terrain);
    this.position = new THREE.Vector3(...desc.position);
    this.radius = desc.radius;
    this.atmosphereRadius = desc.atmosphere.enabled ? desc.radius + desc.atmosphere.height : desc.radius + desc.terrain.heightScale * 1.5;
    this.lu = createPlanetLightUniforms();
    this.root.name = `planet-${desc.name}`;
    this.root.position.copy(this.position);
    this.baseQuat.setFromUnitVectors(Y, new THREE.Vector3(...desc.axis).normalize());
    this.spinAngle = ((desc.seed % 1000) / 1000) * Math.PI * 2;
    this.applySpin(time);

    const fc = desc.atmosphere.fogColor;
    this.fogColor.setRGB(fc[0], fc[1], fc[2], THREE.SRGBColorSpace);
    const r = desc.atmosphere.rayleigh;
    this.skyColor.setRGB(r[0], r[1], r[2]).multiplyScalar(1 / Math.max(r[0], r[1], r[2])).lerp(this.fogColor, 0.3);

    pool.register(this.key, desc.terrain);
    this.terrainMat = createTerrainMaterial(this.lu);
    if (this.gen.hasSea) this.liquidMat = createLiquidMaterial(this.lu, desc.terrain, this.skyColor);

    this.scatter = new ScatterManager(desc.terrain, desc.archetype, this.lu, this.root, depleted);
    const faceEdge = (Math.PI / 2) * desc.radius;
    const scatterLevel = Math.max(2, Math.round(Math.log2(faceEdge / 180)));
    this.terrain = new TerrainQuadTree({
      planetKey: this.key,
      radius: desc.radius,
      heightScale: desc.terrain.heightScale,
      seaHeight: this.gen.seaHeight,
      scatterLevel,
      scatterSeed: desc.seed ^ 0x5ca7,
      pool,
      terrainMaterial: this.terrainMat,
      liquidMaterial: this.liquidMat,
      parent: this.root,
      onScatter: (node, data, center) => this.scatter.add(node, data, center),
      onScatterRemoved: (node) => this.scatter.remove(node),
      onScatterVisible: (node, v) => this.scatter.setVisible(node, v),
    });

    if (desc.atmosphere.enabled && desc.atmosphere.cloudCoverage > 0.02) {
      this.clouds = new CloudLayer(desc.radius + Math.max(desc.terrain.heightScale * 1.5, desc.atmosphere.height * 0.42), desc.atmosphere.cloudCoverage, desc.atmosphere.cloudColor, this.lu);
      this.root.add(this.clouds.mesh);
    } else this.clouds = null;

    if (desc.atmosphere.enabled) {
      const a = desc.atmosphere;
      const H = a.height;
      const hr = H * 0.16;
      const hm = H * 0.05;
      const dens = a.density;
      this.atmo = {
        center: new THREE.Vector3(),
        radius: desc.radius + (this.gen.hasSea ? Math.max(0, this.gen.seaHeight) : 0),
        atmoRadius: this.atmosphereRadius,
        rayleigh: new THREE.Vector3(a.rayleigh[0] / hr, a.rayleigh[1] / hr, a.rayleigh[2] / hr).multiplyScalar(dens * 0.75),
        mie: (a.mie / hm) * dens,
        mieG: a.mieG,
        hr,
        hm,
        sunDir: new THREE.Vector3(),
        sunIntensity: 16,
        sunColor: new THREE.Color(1, 1, 1),
      };
    } else this.atmo = null;
  }

  private applySpin(time: number): void {
    const angle = this.spinAngle + (time / this.desc.dayLength) * Math.PI * 2;
    _q.setFromAxisAngle(Y, angle);
    this.root.quaternion.copy(this.baseQuat).multiply(_q);
  }

  /** Surface radius (distance from centre) along a planet-local direction. */
  surfaceRadius(dirLocal: THREE.Vector3): number {
    return this.radius + this.gen.height(dirLocal.x, dirLocal.y, dirLocal.z, 0.4);
  }

  get seaRadius(): number {
    return this.gen.hasSea ? this.radius + this.gen.seaHeight : -Infinity;
  }

  toLocal(u: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    out.copy(u).sub(this.position);
    _q.copy(this.root.quaternion).invert();
    return out.applyQuaternion(_q);
  }

  toUniverse(l: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(l).applyQuaternion(this.root.quaternion).add(this.position);
  }

  localDirToUniverse(d: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(d).applyQuaternion(this.root.quaternion);
  }

  universeDirToLocal(d: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    _q.copy(this.root.quaternion).invert();
    return out.copy(d).applyQuaternion(_q);
  }

  /** Altitude above terrain at a universe position (positive = above ground). */
  altitudeAt(u: THREE.Vector3): { altitude: number; ground: number; up: THREE.Vector3; dist: number } {
    _v.copy(u).sub(this.position);
    const dist = _v.length();
    const up = _v.clone().divideScalar(dist);
    const local = this.universeDirToLocal(up, new THREE.Vector3());
    let ground = this.surfaceRadius(local);
    if (this.gen.hasSea && this.desc.terrain.liquid === 'ice') ground = Math.max(ground, this.seaRadius);
    return { altitude: dist - ground, ground, up, dist };
  }

  /** Sun direction (toward star, which sits at the universe origin) in world space. */
  sunDir(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.position).multiplyScalar(-1).normalize();
  }

  /** Sun elevation (sin) at a universe position; > 0 is day. */
  sunElevation(u: THREE.Vector3): number {
    _v.copy(u).sub(this.position).normalize();
    return _v.dot(this.sunDir(new THREE.Vector3()));
  }

  update(time: number, dt: number, camU: THREE.Vector3, camera: THREE.Camera, origin: THREE.Vector3, starColor: THREE.Color): void {
    // spin
    const prev = this.root.quaternion.clone();
    this.applySpin(time);
    this.spinDelta.copy(this.root.quaternion).multiply(prev.invert());

    this.root.updateMatrixWorld();
    this.toLocal(camU, this.camLocal);
    const near = this.camLocal.length() < this.radius * 3;
    this.terrain.update(this.camLocal, near ? 5 : 1.5);
    this.scatter.update(this.camLocal);

    // lighting uniforms
    const sunW = this.sunDir(new THREE.Vector3());
    this.lu.uSunDirView.value.copy(sunW).transformDirection(camera.matrixWorldInverse);
    this.lu.uSunDirLocal.value.copy(this.universeDirToLocal(sunW));
    _m.copy(this.root.matrixWorld).invert();
    this.lu.uPlanetInvModel.value.copy(_m);
    this.lu.uTime.value = time;
    this.lu.uNightAmbient.value = this.desc.atmosphere.enabled ? 0.5 : 0.45;

    if (this.clouds) {
      this.clouds.mesh.visible = settings.data.clouds;
      this.clouds.setCoverage(Math.min(0.95, this.clouds.baseCoverage + this.weatherCloud * 0.35));
    }
    if (this.atmo) {
      this.atmo.center.copy(this.position).sub(origin);
      this.atmo.sunDir.copy(sunW);
      this.atmo.sunColor.copy(starColor);
    }
    void dt;
  }

  dispose(pool: TerrainWorkerPool): void {
    this.terrain.dispose();
    this.scatter.dispose();
    this.clouds?.dispose();
    this.terrainMat.dispose();
    this.liquidMat?.dispose();
    pool.unregister(this.key);
    this.root.removeFromParent();
  }
}
