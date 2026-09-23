import * as THREE from 'three';
import { patchPlanetMaterial, type PlanetLightUniforms } from './PlanetLighting';

/**
 * Shared material factories for procedurally built props (ships, stations,
 * creatures, structures). Vertex colours above 1.0 become emissive so
 * running lights, engines and bioluminescence glow via bloom.
 */
const EMISSIVE_FROM_COLOR = /* glsl */ `
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
totalEmissiveRadiance += max(vColor.rgb - vec3(1.0), vec3(0.0)) * 2.0;
#endif
`;

export function propMaterial(opts: { roughness?: number; metalness?: number; side?: THREE.Side } = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: opts.roughness ?? 0.55,
    metalness: opts.metalness ?? 0.35,
    side: opts.side ?? THREE.FrontSide,
  });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\n${EMISSIVE_FROM_COLOR}`);
  };
  m.customProgramCacheKey = () => 'prop-emissive';
  return m;
}

export function planetPropMaterial(lu: PlanetLightUniforms, opts: { roughness?: number; metalness?: number; key?: string } = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: opts.roughness ?? 0.6,
    metalness: opts.metalness ?? 0.2,
  });
  patchPlanetMaterial(m, lu, { key: opts.key ?? 'planet-prop', fragColor: EMISSIVE_FROM_COLOR });
  return m;
}
