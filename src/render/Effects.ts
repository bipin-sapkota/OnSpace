import * as THREE from 'three';
import { getParticleTexture } from './Textures';

/**
 * Pooled visual effects: CPU-simulated GPU-rendered particles (additive and
 * alpha-blended), beams/tracers and expanding scan waves. Everything is
 * pre-allocated so spawning effects never allocates GPU resources.
 *
 * Positions are stored relative to an anchor near the camera so float32
 * precision is preserved anywhere in the star system.
 */
const MAX_PARTICLES = 6000;

const pVert = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
uniform float uScale;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  #include <logdepthbuf_vertex>
}`;
const pFrag = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D uTex;
varying vec4 vColor;
void main() {
  #include <logdepthbuf_fragment>
  float a = texture2D(uTex, gl_PointCoord).a;
  if (a * vColor.a < 0.003) discard;
  gl_FragColor = vec4(vColor.rgb * a * vColor.a, a * vColor.a);
}`;

interface Particle {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size0: number;
  size1: number;
  color: THREE.Color;
  alpha0: number;
  drag: number;
  gravity: THREE.Vector3;
}

class ParticleLayer {
  readonly points: THREE.Points;
  private particles: Particle[] = [];
  private pos: Float32Array;
  private size: Float32Array;
  private col: Float32Array;
  private cursor = 0;
  readonly mat: THREE.ShaderMaterial;

  constructor(additive: boolean) {
    this.pos = new Float32Array(MAX_PARTICLES * 3);
    this.size = new Float32Array(MAX_PARTICLES);
    this.col = new Float32Array(MAX_PARTICLES * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: pVert,
      fragmentShader: pFrag,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: { uTex: { value: getParticleTexture() }, uScale: { value: 600 } },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 19;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, maxLife: 1, size0: 1, size1: 1, color: new THREE.Color(), alpha0: 1, drag: 0, gravity: new THREE.Vector3() });
    }
  }

  spawn(pos: THREE.Vector3, vel: THREE.Vector3, life: number, size0: number, size1: number, color: THREE.Color, alpha = 1, drag = 0, gravity?: THREE.Vector3): void {
    const p = this.particles[this.cursor];
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;
    p.alive = true;
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.life = 0;
    p.maxLife = life;
    p.size0 = size0;
    p.size1 = size1;
    p.color.copy(color);
    p.alpha0 = alpha;
    p.drag = drag;
    if (gravity) p.gravity.copy(gravity);
    else p.gravity.set(0, 0, 0);
  }

  shift(d: THREE.Vector3): void {
    for (const p of this.particles) if (p.alive) p.pos.add(d);
  }

  update(dt: number): number {
    let n = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.alive) {
        this.col[i * 4 + 3] = 0;
        this.size[i] = 0;
        continue;
      }
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.alive = false;
        this.col[i * 4 + 3] = 0;
        this.size[i] = 0;
        continue;
      }
      n++;
      const t = p.life / p.maxLife;
      p.vel.addScaledVector(p.gravity, dt);
      if (p.drag > 0) p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      this.pos[i * 3] = p.pos.x;
      this.pos[i * 3 + 1] = p.pos.y;
      this.pos[i * 3 + 2] = p.pos.z;
      this.size[i] = p.size0 + (p.size1 - p.size0) * t;
      const fade = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      this.col[i * 4] = p.color.r;
      this.col[i * 4 + 1] = p.color.g;
      this.col[i * 4 + 2] = p.color.b;
      this.col[i * 4 + 3] = p.alpha0 * fade;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    return n;
  }
}

interface Beam {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  a: THREE.Vector3;
  b: THREE.Vector3;
  width: number;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

export class Effects {
  readonly group = new THREE.Group();
  readonly anchor = new THREE.Vector3();
  private glow = new ParticleLayer(true);
  private smoke = new ParticleLayer(false);
  private beams: Beam[] = [];
  private beamCursor = 0;
  private waves: { mesh: THREE.Mesh; life: number; max: number; radius: number }[] = [];
  readonly flash: THREE.PointLight;
  private flashLife = 0;
  private flashMax = 1;
  private flashIntensity = 0;
  activeParticles = 0;

  constructor(parent: THREE.Object3D) {
    parent.add(this.group);
    this.group.add(this.glow.points, this.smoke.points);
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    beamGeo.translate(0, 0.5, 0);
    for (let i = 0; i < 64; i++) {
      const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = 21;
      this.group.add(m);
      this.beams.push({ mesh: m, life: 0, maxLife: 0, a: new THREE.Vector3(), b: new THREE.Vector3(), width: 0.05 });
    }
    const waveGeo = new THREE.SphereGeometry(1, 48, 24);
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uColor: { value: new THREE.Color(0.3, 0.9, 1.0) }, uAlpha: { value: 0 } },
        vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vN; varying vec3 vV;
void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv;
#include <logdepthbuf_vertex>
}`,
        fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor; uniform float uAlpha; varying vec3 vN; varying vec3 vV;
void main(){
#include <logdepthbuf_fragment>
float f = pow(1.0 - abs(dot(vN, vV)), 3.0); gl_FragColor = vec4(uColor * f * uAlpha * 2.0, 1.0); }`,
      });
      const m = new THREE.Mesh(waveGeo, mat);
      m.visible = false;
      m.frustumCulled = false;
      this.group.add(m);
      this.waves.push({ mesh: m, life: 0, max: 1, radius: 1 });
    }
    this.flash = new THREE.PointLight(0xffaa66, 0, 250, 1.6);
    this.group.add(this.flash);
  }

  /** Convert a universe position to anchor-relative. */
  private rel(u: THREE.Vector3, out = _v): THREE.Vector3 {
    return out.copy(u).sub(this.anchor);
  }

  /** Called every frame; keeps anchor near camera. */
  update(dt: number, camU: THREE.Vector3, origin: THREE.Vector3): void {
    if (camU.distanceTo(this.anchor) > 4000) {
      const newAnchor = camU.clone().round();
      const d = this.anchor.clone().sub(newAnchor);
      this.glow.shift(d);
      this.smoke.shift(d);
      for (const b of this.beams) {
        b.a.add(d);
        b.b.add(d);
      }
      for (const w of this.waves) w.mesh.position.add(d);
      this.flash.position.add(d);
      this.anchor.copy(newAnchor);
    }
    // the group lives under the world root, i.e. in universe coordinates
    this.group.position.copy(this.anchor);
    void origin;
    this.activeParticles = this.glow.update(dt) + this.smoke.update(dt);

    for (const b of this.beams) {
      if (b.life <= 0) continue;
      b.life -= dt;
      if (b.life <= 0) {
        b.mesh.visible = false;
        continue;
      }
      const mat = b.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.min(1, b.life / Math.max(0.001, b.maxLife) * 1.5);
    }
    for (const w of this.waves) {
      if (!w.mesh.visible) continue;
      w.life += dt;
      const t = w.life / w.max;
      if (t >= 1) {
        w.mesh.visible = false;
        continue;
      }
      w.mesh.scale.setScalar(w.radius * (0.02 + t));
      (w.mesh.material as THREE.ShaderMaterial).uniforms.uAlpha.value = (1 - t) * (1 - t);
    }
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      this.flash.intensity = Math.max(0, this.flashLife / this.flashMax) * this.flashIntensity;
    } else this.flash.intensity = 0;
  }

  spark(u: THREE.Vector3, dir: THREE.Vector3, color: THREE.Color, count = 8, speed = 6, size = 0.15, life = 0.5, gravity?: THREE.Vector3): void {
    const p = this.rel(u, new THREE.Vector3());
    for (let i = 0; i < count; i++) {
      _v2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.4).add(dir).normalize().multiplyScalar(speed * (0.4 + Math.random()));
      this.glow.spawn(p, _v2, life * (0.5 + Math.random() * 0.8), size, size * 0.3, color, 1, 1.5, gravity);
    }
  }

  puff(u: THREE.Vector3, color: THREE.Color, count = 6, size = 1.2, life = 1.5, spread = 1, up?: THREE.Vector3, alpha = 0.5): void {
    const p = this.rel(u, new THREE.Vector3());
    for (let i = 0; i < count; i++) {
      _v2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(spread * 2);
      if (up) _v2.addScaledVector(up, spread * 0.8);
      this.smoke.spawn(p, _v2, life * (0.6 + Math.random() * 0.8), size * 0.5, size * 2, color, alpha, 1.2);
    }
  }

  glowAt(u: THREE.Vector3, color: THREE.Color, size: number, life: number, vel?: THREE.Vector3): void {
    this.glow.spawn(this.rel(u, new THREE.Vector3()), vel ?? new THREE.Vector3(), life, size, size * 0.4, color, 1, 0);
  }

  explosion(u: THREE.Vector3, scale = 1, color = new THREE.Color(1.0, 0.55, 0.2)): void {
    const p = this.rel(u, new THREE.Vector3());
    for (let i = 0; i < 40 * Math.min(2, scale); i++) {
      _v2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar((10 + Math.random() * 30) * scale);
      this.glow.spawn(p, _v2, 0.4 + Math.random() * 0.8, 1.2 * scale, 0.2 * scale, color.clone().multiplyScalar(3), 1, 2.5);
    }
    for (let i = 0; i < 18; i++) {
      _v2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar((2 + Math.random() * 8) * scale);
      this.glow.spawn(p, _v2, 0.5 + Math.random() * 0.4, 6 * scale, 10 * scale, new THREE.Color(2.5, 1.2, 0.4), 0.8, 2);
      this.smoke.spawn(p, _v2.multiplyScalar(0.6), 2 + Math.random() * 2, 5 * scale, 16 * scale, new THREE.Color(0.12, 0.11, 0.1), 0.7, 0.8);
    }
    this.flash.position.copy(p);
    this.flash.color.copy(color);
    this.flashIntensity = 3000 * scale;
    this.flash.distance = 200 * scale;
    this.flashLife = this.flashMax = 0.35;
  }

  beam(aU: THREE.Vector3, bU: THREE.Vector3, color: THREE.Color, width: number, life: number): void {
    const b = this.beams[this.beamCursor];
    this.beamCursor = (this.beamCursor + 1) % this.beams.length;
    this.rel(aU, b.a);
    this.rel(bU, b.b);
    b.life = b.maxLife = life;
    b.width = width;
    const dir = _v2.copy(b.b).sub(b.a);
    const len = dir.length();
    if (len < 1e-4) return;
    _q.setFromUnitVectors(UP, dir.divideScalar(len));
    b.mesh.position.copy(b.a);
    b.mesh.quaternion.copy(_q);
    b.mesh.scale.set(width, len, width);
    (b.mesh.material as THREE.MeshBasicMaterial).color.copy(color);
    b.mesh.visible = true;
  }

  wave(u: THREE.Vector3, radius: number, duration: number, color = new THREE.Color(0.3, 0.9, 1.0)): void {
    const w = this.waves.find((x) => !x.mesh.visible) ?? this.waves[0];
    this.rel(u, w.mesh.position);
    w.life = 0;
    w.max = duration;
    w.radius = radius;
    (w.mesh.material as THREE.ShaderMaterial).uniforms.uColor.value.copy(color);
    w.mesh.visible = true;
  }

  setPixelScale(heightPx: number, fovDeg: number): void {
    const s = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.glow.mat.uniforms.uScale.value = s;
    this.smoke.mat.uniforms.uScale.value = s;
  }
}
