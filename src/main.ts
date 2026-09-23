import * as THREE from 'three';
import { Renderer } from './render/Renderer';
import { Galaxy } from './universe/Galaxy';
import { StarSystem } from './world/StarSystem';
import { TerrainWorkerPool } from './world/terrain/WorkerPool';

const params = new URLSearchParams(location.search);
const app = document.getElementById('app')!;
const r = new Renderer(app);
const galaxy = new Galaxy(12345);
const sys = galaxy.getSystem(galaxy.startSystemId);
const pool = new TerrainWorkerPool();
const worldRoot = new THREE.Group();
r.scene.add(worldRoot);
const pd = sys.planets[0];
void pd;
const system = new StarSystem(sys, galaxy.systems, r.renderer, r.scene, worldRoot, pool, () => new Set(), new Set(), 0);
const planet = system.planets[Number(params.get('p') ?? 0)];
const sun = new THREE.DirectionalLight(0xffffff, 3);
r.scene.add(sun, sun.target);
r.scene.add(new THREE.AmbientLight(0x404050, 0.4));
(window as any).debug = { planet, r, sys };
const alt = Number(params.get('alt') ?? 20000);
const camU = new THREE.Vector3();
const origin = new THREE.Vector3();
let t = 0;
let landDir: THREE.Vector3 | null = null;
function frame() {
  t += 1 / 60;
  // put camera on sunny side
  const sunDir = planet.sunDir();
  if (!landDir) {
    const rot = Number(params.get('rot') ?? 0.9);
    for (let k = 0; k < 400; k++) {
      const d = sunDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rot + k * 0.01).applyAxisAngle(new THREE.Vector3(1, 0, 0), k * 0.003).normalize();
      const a = planet.altitudeAt(planet.position.clone().addScaledVector(d, planet.radius * 2));
      if (!params.has('land') || a.ground > planet.seaRadius + 15) { landDir = d; break; }
    }
  }
  const dir = landDir!;
  const g = planet.altitudeAt(planet.position.clone().addScaledVector(dir, planet.radius + 10));
  camU.copy(planet.position).addScaledVector(dir, g.ground + alt);
  origin.copy(camU);
  worldRoot.position.copy(origin).multiplyScalar(-1);
  r.camera.position.set(0, 0, 0);
  const tangent = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
  const look = params.has('star') ? camU.clone().multiplyScalar(-1).normalize() : alt > 5000 ? planet.position.clone().sub(camU) : tangent.clone().addScaledVector(dir, -0.15);
  r.camera.up.copy(dir);
  r.camera.lookAt(look);
  sun.position.copy(sunDir).multiplyScalar(100);
  system.update(t, 1 / 60, camU, r.camera, origin);
  system.skybox.update(r.camera.position, 1, 1);
  r.atmosphere.instances = !params.has("noatmo") ? system.atmospheres : [];
  r.atmosphere.material.uniforms.uDebug.value = Number(params.get("dbg") ?? 0);
  r.render(t);
  requestAnimationFrame(frame);
}
frame();
