import * as THREE from 'three';
import { patchPlanetMaterial, type PlanetLightUniforms } from '../../render/PlanetLighting';
import { getNoiseTexture } from '../../render/Textures';
import type { TerrainParams } from '../../universe/types';

const PERTURB = /* glsl */ `
uniform sampler2D uNoiseTex;
varying vec3 vLocalNormal;
vec3 perturbNormalArb2(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
  vec3 vSigmaX = normalize(dFdx(surf_pos.xyz));
  vec3 vSigmaY = normalize(dFdy(surf_pos.xyz));
  vec3 vN = surf_norm;
  vec3 R1 = cross(vSigmaY, vN);
  vec3 R2 = cross(vN, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDir;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
vec4 tri(vec3 p, vec3 w) {
  return texture2D(uNoiseTex, p.yz) * w.x + texture2D(uNoiseTex, p.xz) * w.y + texture2D(uNoiseTex, p.xy) * w.z;
}
`;

export function createTerrainMaterial(u: PlanetLightUniforms): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.93,
    metalness: 0.0,
  });
  patchPlanetMaterial(mat, u, {
    key: 'terrain-v1',
    extraUniforms: { uNoiseTex: { value: getNoiseTexture() } },
    vertDecl: 'varying vec3 vLocalNormal;',
    vertBody: 'vLocalNormal = normal;',
    fragDecl: PERTURB,
    fragColor: /* glsl */ `
      vec3 _N = normalize(vLocalNormal);
      vec3 _w = pow(abs(_N), vec3(4.0)); _w /= (_w.x + _w.y + _w.z);
      vec3 _P = vPlanetLocal;
      float _dist = length(vViewPosition);
      vec4 _n2 = tri(_P * 0.55, _w);
      vec4 _n1 = tri(_P * 0.06, _w);
      vec4 _n3 = tri(_P * 0.0045, _w);
      float _slope = 1.0 - dot(_N, vPlanetUp);
      float _fine = mix(_n2.r * 0.6 + _n2.a * 0.4, 0.5, smoothstep(15.0, 60.0, _dist));
      vec4 _n1b = tri(_P * 0.0237 + vec3(0.37, 0.71, 0.13), _w);
      float _mid = mix(_n1.g * 0.5 + _n1b.r * 0.5, 0.5, smoothstep(300.0, 2000.0, _dist));
      float _rockMask = smoothstep(0.2, 0.42, _slope);
      float _pebbles = mix(1.0, 0.8 + 0.4 * _n2.b, (1.0 - smoothstep(8.0, 30.0, _dist)) * 0.5);
      float _detail = 0.7 + 0.6 * (_fine * 0.5 + _mid * 0.5);
      diffuseColor.rgb *= _detail * (0.85 + 0.3 * _n3.b) * _pebbles;
      float _strata = 0.78 + 0.44 * sin(dot(_P, vPlanetUp) * 0.35 + _n1.r * 7.0);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * _strata, _rockMask);
      float _bump = _fine * 0.35 + _mid * 0.65 + _rockMask * _n1.b * 0.4;
    `,
    fragNormal: /* glsl */ `
      {
        vec2 dH = vec2(dFdx(_bump), dFdy(_bump)) * 2.2;
        normal = perturbNormalArb2(-vViewPosition, normal, dH, faceDirection);
      }
    `,
  });
  return mat;
}

const LIQUID: Record<string, { opaque: boolean; emissive: number; rough: number }> = {
  water: { opaque: false, emissive: 0, rough: 0.06 },
  acid: { opaque: false, emissive: 0.25, rough: 0.1 },
  lava: { opaque: true, emissive: 3.2, rough: 0.6 },
  ice: { opaque: true, emissive: 0, rough: 0.25 },
  none: { opaque: false, emissive: 0, rough: 0.1 },
};

export function createLiquidMaterial(u: PlanetLightUniforms, params: TerrainParams, skyColor: THREE.Color): THREE.MeshStandardMaterial {
  const kind = LIQUID[params.liquid] ?? LIQUID.water;
  const shallow = new THREE.Color().setRGB(...params.palette.shallow, THREE.SRGBColorSpace);
  const deep = new THREE.Color().setRGB(...params.palette.deep, THREE.SRGBColorSpace);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: kind.rough,
    metalness: 0.0,
    transparent: !kind.opaque,
    depthWrite: true,
  });
  const liquidId = params.liquid === 'lava' ? 1 : params.liquid === 'ice' ? 2 : params.liquid === 'acid' ? 3 : 0;
  patchPlanetMaterial(mat, u, {
    key: 'liquid-v1-' + liquidId,
    extraUniforms: {
      uNoiseTex: { value: getNoiseTexture() },
      uShallow: { value: shallow },
      uDeep: { value: deep },
      uSky: { value: skyColor },
      uEmissive: { value: kind.emissive },
    },
    vertDecl: 'attribute float depth; varying float vDepth; varying vec3 vLocalNormal;',
    vertBody: 'vDepth = depth; vLocalNormal = normal;',
    fragDecl: PERTURB + /* glsl */ `
      uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uSky; uniform float uEmissive;
      varying float vDepth;
      #define LIQUID ${liquidId}
    `,
    fragColor: /* glsl */ `
      vec3 _P = vPlanetLocal;
      vec3 _N = normalize(vLocalNormal);
      vec3 _w = pow(abs(_N), vec3(4.0)); _w /= (_w.x + _w.y + _w.z);
      float _t = uTime;
      #if LIQUID == 1
        vec4 _a = tri(_P * 0.012 + vec3(_t * 0.004), _w);
        vec4 _b = tri(_P * 0.05 - vec3(_t * 0.01), _w);
        float _heat = smoothstep(0.35, 0.8, _a.r * 0.6 + _b.b * 0.6);
        diffuseColor.rgb = mix(vec3(0.08, 0.03, 0.02), uDeep, 0.25 + _heat * 0.2);
        float _bumpL = _a.g * 0.5 + _b.r * 0.5;
      #elif LIQUID == 2
        vec4 _a = tri(_P * 0.02, _w);
        vec4 _b = tri(_P * 0.2, _w);
        diffuseColor.rgb = mix(uShallow, uDeep, 0.3 + _a.b * 0.4) * (0.9 + _b.r * 0.2);
        float _bumpL = _b.b * 0.3;
      #else
        vec4 _a = tri(_P * 0.03 + vec3(_t * 0.012, 0.0, _t * 0.008), _w);
        vec4 _b = tri(_P * 0.11 - vec3(_t * 0.02, _t * 0.015, 0.0), _w);
        float _depthT = smoothstep(0.0, 28.0, vDepth);
        diffuseColor.rgb = mix(uShallow, uDeep, _depthT);
        float _foam = (1.0 - smoothstep(0.0, 1.4 + _b.r * 1.5, vDepth)) * step(0.45, _a.a + _b.g * 0.3);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.95, 1.0), _foam * 0.8);
        diffuseColor.a = mix(0.6, 0.97, smoothstep(0.0, 10.0, vDepth));
        float _bumpL = _a.r * 0.6 + _b.g * 0.4;
      #endif
    `,
    fragNormal: /* glsl */ `
      {
        float _fade = 1.0 - smoothstep(60.0, 900.0, length(vViewPosition));
        vec2 dH = vec2(dFdx(_bumpL), dFdy(_bumpL)) * 3.0 * _fade;
        normal = perturbNormalArb2(-vViewPosition, normal, dH, faceDirection);
      }
    `,
    fragEmissive: /* glsl */ `
      {
        vec3 V = normalize(vViewPosition);
        float fres = pow(1.0 - max(dot(normal, V), 0.0), 4.0);
        float day = smoothstep(-0.25, 0.3, dot(vPlanetUp, uSunDirLocal));
        #if LIQUID == 1
          gl_FragColor.rgb += uDeep * uEmissive * (0.4 + _heat * 1.6);
        #elif LIQUID == 3
          gl_FragColor.rgb += uShallow * uEmissive * 0.4;
          gl_FragColor.rgb += uSky * fres * day * 0.8;
        #elif LIQUID == 0
          gl_FragColor.rgb += uSky * fres * day * 0.35;
          gl_FragColor.a = max(gl_FragColor.a, fres);
        #endif
      }
    `,
  });
  return mat;
}
