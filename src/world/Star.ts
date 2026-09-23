import * as THREE from 'three';
import type { StarDesc } from '../universe/types';
import { makeGlowTexture } from '../render/Textures';

/**
 * The system's star: an animated HDR photosphere with limb darkening and
 * granulation, a corona billboard and a camera-facing flare streak.
 */
const vert = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vNormalV;
varying vec3 vLocal;
void main() {
  vLocal = position;
  vNormalV = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
const frag = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uTime;
varying vec3 vNormalV;
varying vec3 vLocal;
float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1,0,0)), f.x), mix(h13(i + vec3(0,1,0)), h13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h13(i + vec3(0,0,1)), h13(i + vec3(1,0,1)), f.x), mix(h13(i + vec3(0,1,1)), h13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
void main() {
  #include <logdepthbuf_fragment>
  vec3 d = normalize(vLocal);
  float mu = max(dot(normalize(vNormalV), vec3(0.0, 0.0, 1.0)), 0.0);
  float limb = 0.35 + 0.65 * pow(mu, 0.45);
  float g = vnoise(d * 40.0 + uTime * 0.05) * 0.5 + vnoise(d * 110.0 - uTime * 0.08) * 0.35 + vnoise(d * 9.0 + uTime * 0.02) * 0.15;
  vec3 col = uColor * (0.75 + 0.5 * g) * limb * 7.0;
  col = mix(col, uColor * vec3(1.0, 0.6, 0.35) * 5.0, (1.0 - mu) * 0.5);
  gl_FragColor = vec4(col, 1.0);
}`;

export class Star {
  readonly group = new THREE.Group();
  readonly color: THREE.Color;
  private mat: THREE.ShaderMaterial;
  private corona: THREE.Sprite;
  private halo: THREE.Sprite;
  readonly radius: number;

  constructor(desc: StarDesc) {
    this.radius = desc.radius;
    this.color = new THREE.Color(...desc.color);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uColor: { value: this.color.clone() }, uTime: { value: 0 } },
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(desc.radius, 96, 48), this.mat);
    this.group.add(sphere);
    const glow = makeGlowTexture(256, 3.0);
    this.corona = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: this.color.clone().multiplyScalar(1.1), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.corona.scale.setScalar(desc.radius * 3.2);
    this.group.add(this.corona);
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(256, 6.0), color: this.color.clone().multiplyScalar(0.12), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.halo.scale.setScalar(desc.radius * 16);
    this.group.add(this.halo);
  }

  update(time: number): void {
    this.mat.uniforms.uTime.value = time;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | undefined;
      mat?.dispose();
    });
    this.group.removeFromParent();
  }
}
