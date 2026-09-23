import * as THREE from 'three';
import type { PlanetLightUniforms } from '../render/PlanetLighting';
import { getNoiseTexture } from '../render/Textures';

/**
 * Animated cloud shell. A single double-sided sphere with a procedural
 * coverage field, sun-facing lighting and a cheap self-shadow term. Coverage
 * can be driven at runtime by the weather system (storms thicken clouds).
 */
const vert = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vLocal;
varying vec3 vView;
void main() {
  vLocal = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;

const frag = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D uNoiseTex;
uniform vec3 uSunDirLocal;
uniform vec3 uColor;
uniform vec3 uSunColor;
uniform float uCoverage;
uniform float uTime;
uniform float uRadius;
uniform float uCamAlt;
varying vec3 vLocal;
varying vec3 vView;

float tex3(vec3 p) {
  vec3 n = normalize(vLocal);
  vec3 w = pow(abs(n), vec3(6.0)); w /= (w.x + w.y + w.z);
  return texture2D(uNoiseTex, p.yz).r * w.x + texture2D(uNoiseTex, p.xz).r * w.y + texture2D(uNoiseTex, p.xy).r * w.z;
}
float clouds(vec3 dir) {
  vec3 p = dir * 2.2;
  float t = uTime * 0.0015;
  vec3 drift = vec3(t, 0.0, t * 0.6);
  float base = tex3(p * 0.5 + drift) * 0.62 + tex3(p * 1.7 - drift * 1.7) * 0.28 + tex3(p * 6.0 + drift * 3.0) * 0.1;
  // latitude banding for more believable weather systems
  float band = 0.85 + 0.15 * sin(dir.y * 9.0 + tex3(p * 0.3) * 4.0);
  float c = smoothstep(1.0 - uCoverage, 1.0 - uCoverage + 0.28, base * band);
  return c;
}
void main() {
  #include <logdepthbuf_fragment>
  vec3 dir = normalize(vLocal);
  float c = clouds(dir);
  if (c < 0.01) discard;
  float sunH = dot(dir, uSunDirLocal);
  // self-shadow: sample coverage slightly toward the sun
  vec3 toward = normalize(dir + (uSunDirLocal - dir * sunH) * 0.012);
  float sh = clouds(toward);
  float lit = smoothstep(-0.25, 0.35, sunH);
  vec3 col = uColor * (0.22 + 0.95 * lit * (1.0 - sh * 0.45)) * uSunColor;
  // warm terminator
  col *= mix(vec3(1.0), vec3(1.25, 0.8, 0.6), smoothstep(0.3, 0.0, abs(sunH)) * lit);
  float dist = length(vView);
  float fadeNear = smoothstep(20.0, 260.0, dist);
  float alpha = c * 0.92 * fadeNear;
  gl_FragColor = vec4(col, alpha);
}`;

export class CloudLayer {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  baseCoverage: number;

  constructor(radius: number, coverage: number, color: [number, number, number], lu: PlanetLightUniforms) {
    this.baseCoverage = coverage;
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uNoiseTex: { value: getNoiseTexture() },
        uSunDirLocal: lu.uSunDirLocal,
        uTime: lu.uTime,
        uColor: { value: new THREE.Color().setRGB(color[0], color[1], color[2], THREE.SRGBColorSpace) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uCoverage: { value: coverage },
        uRadius: { value: radius },
        uCamAlt: { value: 0 },
      },
    });
    const geo = new THREE.IcosahedronGeometry(radius, 48);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = false;
  }

  setCoverage(c: number): void {
    this.material.uniforms.uCoverage.value = c;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
