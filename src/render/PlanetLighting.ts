import * as THREE from 'three';

/**
 * Shared uniforms that make standard three.js materials planet-aware:
 *  - the directional sun light is re-aimed per planet (a single scene light
 *    cannot be correct for every planet in a star system),
 *  - ambient light is attenuated on the night side,
 *  - fragments get a stable planet-local position for triplanar detail.
 */
export interface PlanetLightUniforms {
  uSunDirView: { value: THREE.Vector3 };
  uSunDirLocal: { value: THREE.Vector3 };
  uPlanetInvModel: { value: THREE.Matrix4 };
  uNightAmbient: { value: number };
  uTime: { value: number };
}

export function createPlanetLightUniforms(): PlanetLightUniforms {
  return {
    uSunDirView: { value: new THREE.Vector3(0, 1, 0) },
    uSunDirLocal: { value: new THREE.Vector3(0, 1, 0) },
    uPlanetInvModel: { value: new THREE.Matrix4() },
    uNightAmbient: { value: 0.12 },
    uTime: { value: 0 },
  };
}

export interface PatchOptions {
  /** Extra GLSL declarations for the fragment shader. */
  fragDecl?: string;
  /** GLSL run after color_fragment (can modify diffuseColor). */
  fragColor?: string;
  /** GLSL run after normal_fragment_maps (can modify normal). */
  fragNormal?: string;
  /** GLSL run at the end of the fragment shader before output (modify gl_FragColor / outgoingLight). */
  fragEmissive?: string;
  vertDecl?: string;
  vertBody?: string;
  /** GLSL run right after begin_vertex (can modify \`transformed\`). */
  vertTransform?: string;
  extraUniforms?: Record<string, THREE.IUniform>;
  /** Unique key for program caching. */
  key: string;
}

export function patchPlanetMaterial(mat: THREE.Material, u: PlanetLightUniforms, opts: PatchOptions): void {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, opts.extraUniforms ?? {});
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform mat4 uPlanetInvModel;
uniform float uTime;
varying vec3 vPlanetLocal;
varying vec3 vPlanetUp;
${opts.vertDecl ?? ''}`,
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${opts.vertTransform ?? ''}`)
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
{
  vec4 _wp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  _wp = instanceMatrix * _wp;
  #endif
  vPlanetLocal = (uPlanetInvModel * modelMatrix * _wp).xyz;
  vPlanetUp = normalize(vPlanetLocal);
}
${opts.vertBody ?? ''}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uSunDirView;
uniform vec3 uSunDirLocal;
uniform float uNightAmbient;
uniform float uTime;
varying vec3 vPlanetLocal;
varying vec3 vPlanetUp;
${opts.fragDecl ?? ''}`,
      )
      .replace('#include <color_fragment>', `#include <color_fragment>\n${opts.fragColor ?? ''}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${opts.fragNormal ?? ''}`)
      .replace(
        'directionalLight = directionalLights[ i ];',
        'directionalLight = directionalLights[ i ]; directionalLight.direction = uSunDirView;',
      )
      .replace(
        '#include <lights_fragment_begin>',
        `#include <lights_fragment_begin>
{
  float _sunH = dot(vPlanetUp, uSunDirLocal);
  float _day = smoothstep(-0.28, 0.25, _sunH);
  irradiance *= mix(uNightAmbient, 1.0, _day);
}`,
      )
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${opts.fragEmissive ?? ''}`);
  };
  mat.customProgramCacheKey = () => opts.key;
}

/** Common GLSL helpers: value noise on a 3D lattice + triplanar noise texture sampling. */
export const GLSL_NOISE = /* glsl */ `
float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1,0,0)), f.x), mix(h13(i + vec3(0,1,0)), h13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h13(i + vec3(0,0,1)), h13(i + vec3(1,0,1)), f.x), mix(h13(i + vec3(0,1,1)), h13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
`;
