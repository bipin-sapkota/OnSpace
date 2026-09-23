import * as THREE from 'three';
import { RNG } from '../core/Random';
import type { StarSystemDesc, GalaxySystemEntry } from '../universe/types';

/**
 * Space backdrop: a nebula baked once per star system into a cube map (so the
 * expensive noise runs only at load time), a galactic band, and a real point
 * starfield built from the actual galaxy so neighbouring stars appear where
 * the galaxy map says they are.
 */
const bakeVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const bakeFrag = /* glsl */ `
precision highp float;
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uDensity;
uniform float uSeed;
uniform vec3 uBandNormal;
varying vec3 vDir;
float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1,0,0)), f.x), mix(h13(i + vec3(0,1,0)), h13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h13(i + vec3(0,0,1)), h13(i + vec3(1,0,1)), f.x), mix(h13(i + vec3(0,1,1)), h13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 7; i++) { s += a * vnoise(p); p = p * 2.07 + 0.13; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  vec3 p = d * 2.2 + uSeed;
  vec3 q = vec3(fbm(p), fbm(p + 5.2), fbm(p + 9.7));
  float n = fbm(p + q * 2.4);
  float n2 = fbm(p * 2.5 - q);
  float neb = smoothstep(0.5, 0.9, n) * uDensity * smoothstep(0.35, 0.65, fbm(d * 0.8 + uSeed * 2.0));
  float dust = smoothstep(0.5, 0.75, n2);
  vec3 col = mix(uColA, uColB, smoothstep(0.3, 0.8, q.x)) * neb * 0.28;
  col += uColB * pow(neb, 3.0) * 0.3;
  // galactic band
  float band = 1.0 - abs(dot(d, uBandNormal));
  band = pow(band, 10.0);
  float bandN = fbm(d * 7.0 + uSeed);
  col += vec3(0.55, 0.5, 0.62) * band * (0.03 + 0.09 * bandN);
  col *= 1.0 - dust * 0.65 * (0.4 + band);
  // faint star dust
  gl_FragColor = vec4(col, 1.0);
}`;

const skyVert = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const skyFrag = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform samplerCube uCube;
uniform float uBrightness;
varying vec3 vDir;
void main() {
  #include <logdepthbuf_fragment>
  gl_FragColor = vec4(textureCube(uCube, normalize(vDir)).rgb * uBrightness, 1.0);
}`;

const starVert = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aSize;
attribute vec3 aColor;
uniform float uScale;
varying vec3 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale;
  #include <logdepthbuf_vertex>
}`;
const starFrag = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uBrightness;
varying vec3 vColor;
void main() {
  #include <logdepthbuf_fragment>
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float core = exp(-d * d * 7.0);
  float spike = max(0.0, 1.0 - abs(c.x) * 18.0) * max(0.0, 1.0 - abs(c.y) * 2.2) + max(0.0, 1.0 - abs(c.y) * 18.0) * max(0.0, 1.0 - abs(c.x) * 2.2);
  float a = core + spike * 0.12;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * a * uBrightness, 1.0);
}`;

export class Skybox {
  readonly group = new THREE.Group();
  private cubeRT: THREE.WebGLCubeRenderTarget;
  private skyMat: THREE.ShaderMaterial;
  private starMat: THREE.ShaderMaterial;
  private stars: THREE.Points;
  private sky: THREE.Mesh;

  constructor(renderer: THREE.WebGLRenderer, sys: StarSystemDesc, galaxy: GalaxySystemEntry[], resolution = 1024) {
    // bake nebula
    this.cubeRT = new THREE.WebGLCubeRenderTarget(resolution, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    const bakeScene = new THREE.Scene();
    const rng = new RNG(sys.nebula.seed);
    const gp = sys.galaxyPos;
    // galactic plane normal is world Y in galaxy space; tilt per system for variety
    const bandNormal = new THREE.Vector3(rng.range(-0.3, 0.3), 1, rng.range(-0.3, 0.3)).normalize();
    const bakeMat = new THREE.ShaderMaterial({
      vertexShader: bakeVert,
      fragmentShader: bakeFrag,
      side: THREE.BackSide,
      uniforms: {
        uColA: { value: new THREE.Color(...sys.nebula.colorA) },
        uColB: { value: new THREE.Color(...sys.nebula.colorB) },
        uDensity: { value: sys.nebula.density },
        uSeed: { value: (sys.nebula.seed % 1000) * 0.137 },
        uBandNormal: { value: bandNormal },
      },
    });
    const bakeMesh = new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), bakeMat);
    bakeScene.add(bakeMesh);
    const cubeCam = new THREE.CubeCamera(1, 100, this.cubeRT);
    cubeCam.update(renderer, bakeScene);
    bakeMesh.geometry.dispose();
    bakeMat.dispose();

    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uCube: { value: this.cubeRT.texture }, uBrightness: { value: 1 } },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(4e8, 32, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.group.add(this.sky);

    // starfield: real galaxy neighbours + filler stars
    const positions: number[] = [];
    const sizes: number[] = [];
    const colors: number[] = [];
    const R = 3e8;
    for (const s of galaxy) {
      if (s.id === sys.id) continue;
      const d = new THREE.Vector3(s.pos[0] - gp[0], s.pos[1] - gp[1], s.pos[2] - gp[2]);
      const dist = d.length();
      d.normalize().multiplyScalar(R);
      positions.push(d.x, d.y, d.z);
      sizes.push(Math.max(1.5, 9 - dist / 40));
      const b = Math.max(0.4, 2.6 - dist / 200);
      colors.push(s.starColor[0] * b, s.starColor[1] * b, s.starColor[2] * b);
    }
    for (let i = 0; i < 7000; i++) {
      let v = new THREE.Vector3(...rng.unitVector());
      // concentrate towards the band
      if (rng.chance(0.55)) {
        v.addScaledVector(bandNormal, -v.dot(bandNormal) * rng.range(0.7, 1)).normalize();
      }
      v = v.multiplyScalar(R);
      positions.push(v.x, v.y, v.z);
      sizes.push(rng.range(1, 3.2));
      const t = rng.next();
      const c = t < 0.2 ? [1, 0.75, 0.6] : t < 0.35 ? [0.7, 0.8, 1] : [1, 0.97, 0.92];
      const b = rng.range(0.25, 1.2);
      colors.push(c[0] * b, c[1] * b, c[2] * b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
    this.starMat = new THREE.ShaderMaterial({
      vertexShader: starVert,
      fragmentShader: starFrag,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      transparent: true,
      uniforms: { uScale: { value: 1 }, uBrightness: { value: 1 } },
    });
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -999;
    this.group.add(this.stars);
  }

  /** Keep the backdrop centred on the camera; dim it inside bright skies. */
  update(cameraPos: THREE.Vector3, brightness: number, pixelScale: number): void {
    this.group.position.copy(cameraPos);
    this.skyMat.uniforms.uBrightness.value = brightness;
    this.starMat.uniforms.uBrightness.value = brightness * 1.6;
    this.starMat.uniforms.uScale.value = pixelScale;
  }

  dispose(): void {
    this.cubeRT.dispose();
    this.skyMat.dispose();
    this.starMat.dispose();
    this.stars.geometry.dispose();
    this.sky.geometry.dispose();
    this.group.removeFromParent();
  }
}
