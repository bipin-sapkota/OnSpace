import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * Screen-space physically based atmospheric scattering (Rayleigh + Mie,
 * single scattering). Works from any altitude — from ground level through
 * orbit — which lets space ↔ surface transitions be fully seamless. Uses the
 * scene depth buffer (logarithmic) to apply aerial perspective to geometry.
 */
export const MAX_ATMOS = 4;

export interface AtmosphereInstance {
  center: THREE.Vector3; // render space
  radius: number;
  atmoRadius: number;
  rayleigh: THREE.Vector3; // scattering coefficients per metre
  mie: number;
  mieG: number;
  hr: number;
  hm: number;
  sunDir: THREE.Vector3; // from planet toward star
  sunIntensity: number;
  sunColor: THREE.Color;
}

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const frag = /* glsl */ `
precision highp float;
#define MAX_ATMOS ${MAX_ATMOS}
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform float uLogFar;
uniform int uCount;
uniform int uSteps;
uniform int uDebug;
uniform vec3 uCenter[MAX_ATMOS];
uniform float uRadius[MAX_ATMOS];
uniform float uAtmoRadius[MAX_ATMOS];
uniform vec3 uRayleigh[MAX_ATMOS];
uniform float uMie[MAX_ATMOS];
uniform float uMieG[MAX_ATMOS];
uniform float uHr[MAX_ATMOS];
uniform float uHm[MAX_ATMOS];
uniform vec3 uSunDir[MAX_ATMOS];
uniform vec3 uSunColor[MAX_ATMOS];
varying vec2 vUv;

vec2 raySphere(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float cc = dot(oc, oc) - r * r;
  float h = b * b - cc;
  if (h < 0.0) return vec2(1e20, -1e20);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

void scatter(int i, vec3 ro, vec3 rd, float sceneDist, inout vec3 col) {
  vec3 C = uCenter[i];
  float R = uRadius[i];
  float AR = uAtmoRadius[i];
  vec2 ta = raySphere(ro, rd, C, AR);
  if (ta.x > ta.y || ta.y < 0.0) return;
  float t0 = max(ta.x, 0.0);
  float t1 = min(ta.y, sceneDist);
  // stop at planet surface if the depth buffer missed it (far LOD cracks)
  vec2 tp = raySphere(ro, rd, C, R - 2.0);
  if (tp.x > 0.0 && tp.x < t1) t1 = tp.x;
  if (t1 <= t0) return;

  // artistic aerial-perspective scale: nearby geometry keeps its contrast
  float k = sceneDist < 1e19 ? mix(0.35, 1.0, smoothstep(0.0, (AR - R) * 8.0, sceneDist)) : 1.0;
  int steps = uSteps;
  float segLen = (t1 - t0) / float(steps);
  vec3 bR = uRayleigh[i];
  float bM = uMie[i];
  float Hr = uHr[i];
  float Hm = uHm[i];
  vec3 L = uSunDir[i];
  float mu = dot(rd, L);
  float g = uMieG[i];
  float phaseR = 3.0 / (16.0 * 3.14159265) * (1.0 + mu * mu);
  float g2 = g * g;
  float phaseM = 3.0 / (8.0 * 3.14159265) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));

  vec3 sumR = vec3(0.0);
  vec3 sumM = vec3(0.0);
  float odR = 0.0;
  float odM = 0.0;
  float t = t0;
  for (int s = 0; s < 64; s++) {
    if (s >= steps) break;
    float ds = segLen * k;
    vec3 p = ro + rd * (t + segLen * 0.5);
    float h = length(p - C) - R;
    float dr = exp(-max(h, 0.0) / Hr) * ds;
    float dm = exp(-max(h, 0.0) / Hm) * ds;
    odR += dr;
    odM += dm;
    // light ray toward sun
    vec2 tl = raySphere(p, L, C, AR);
    float lLen = tl.y;
    // soft shadow of the planet body (terminator)
    vec3 pc = p - C;
    float along = dot(pc, L);
    float perp = length(pc - along * L);
    float shadow = along > 0.0 ? 1.0 : smoothstep(R * 0.985, R * 1.02, perp);
    if (shadow > 0.0) {
      float lsl = lLen / 6.0;
      float lR = 0.0;
      float lM = 0.0;
      for (int k = 0; k < 6; k++) {
        vec3 q = p + L * (lsl * (float(k) + 0.5));
        float hq = max(length(q - C) - R, 0.0);
        lR += exp(-hq / Hr) * lsl;
        lM += exp(-hq / Hm) * lsl;
      }
      vec3 tau = bR * (odR + lR) + bM * 1.1 * (odM + lM);
      vec3 att = exp(-tau) * shadow;
      sumR += att * dr;
      sumM += att * dm;
    }
    t += segLen;
  }
  vec3 inscatter = uSunColor[i] * (sumR * bR * phaseR + sumM * bM * phaseM);
  vec3 trans = exp(-(bR * odR + bM * 1.1 * odM));
  col = col * trans + inscatter;
}

void main() {
  vec3 col = texture2D(tColor, vUv).rgb;
  float d = texture2D(tDepth, vUv).x;
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 vr = uInvProj * vec4(ndc, -1.0, 1.0);
  vec3 viewRay = vr.xyz / vr.w;
  viewRay /= -viewRay.z;
  float sceneDist = 1e20;
  if (d < 0.99999) {
    float w = exp2(d * uLogFar) - 1.0;
    sceneDist = length(viewRay) * w;
  }
  vec3 rd = normalize(mat3(uCamWorld) * viewRay);
  vec3 ro = uCamPos;
  for (int i = MAX_ATMOS - 1; i >= 0; i--) {
    if (i >= uCount) continue;
    scatter(i, ro, rd, sceneDist, col);
  }
  if (uDebug == 2) { gl_FragColor = vec4(d, (exp2(d * uLogFar) - 1.0) / 1e5, sceneDist / 1e5, uLogFar); return; }
  if (uDebug == 1) col = vec3(fract(sceneDist / 10000.0), d, sceneDist > 1e19 ? 1.0 : 0.0);
  gl_FragColor = vec4(col, 1.0);
}`;

export class AtmospherePass {
  readonly material: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  instances: AtmosphereInstance[] = [];

  constructor() {
    const arr3 = () => Array.from({ length: MAX_ATMOS }, () => new THREE.Vector3());
    const arr1 = () => new Array(MAX_ATMOS).fill(1);
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uLogFar: { value: 1 },
        uCount: { value: 0 },
        uSteps: { value: 16 },
        uDebug: { value: 0 },
        uCenter: { value: arr3() },
        uRadius: { value: arr1() },
        uAtmoRadius: { value: arr1() },
        uRayleigh: { value: arr3() },
        uMie: { value: arr1() },
        uMieG: { value: arr1() },
        uHr: { value: arr1() },
        uHm: { value: arr1() },
        uSunDir: { value: arr3() },
        uSunColor: { value: arr3() },
      },
    });
    this.quad = new FullScreenQuad(this.material);
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget | null, steps: number): void {
    const u = this.material.uniforms;
    u.tColor.value = input.texture;
    u.tDepth.value = input.depthTexture;
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    u.uLogFar.value = Math.log2(camera.far + 1);
    u.uSteps.value = steps;
    const camPos = u.uCamPos.value as THREE.Vector3;
    // nearest atmospheres first get priority
    const list = this.instances
      .slice()
      .sort((a, b) => a.center.distanceTo(camPos) - a.atmoRadius - (b.center.distanceTo(camPos) - b.atmoRadius))
      .slice(0, MAX_ATMOS);
    // order back-to-front for correct compositing: index 0 = nearest (applied last)
    u.uCount.value = list.length;
    list.forEach((a, i) => {
      u.uCenter.value[i].copy(a.center);
      u.uRadius.value[i] = a.radius;
      u.uAtmoRadius.value[i] = a.atmoRadius;
      u.uRayleigh.value[i].copy(a.rayleigh);
      u.uMie.value[i] = a.mie;
      u.uMieG.value[i] = a.mieG;
      u.uHr.value[i] = a.hr;
      u.uHm.value[i] = a.hm;
      u.uSunDir.value[i].copy(a.sunDir);
      u.uSunColor.value[i].set(a.sunColor.r * a.sunIntensity, a.sunColor.g * a.sunIntensity, a.sunColor.b * a.sunIntensity);
    });
    renderer.setRenderTarget(output);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}
