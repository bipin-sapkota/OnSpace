import * as THREE from 'three';
import { assets } from './AssetLibrary';
import { patchPlanetMaterial, type PlanetLightUniforms } from '../render/PlanetLighting';

/**
 * Hands out imported props lit by a planet's light uniforms. Materials are
 * cloned + patched once per factory (i.e. per planet); geometry stays shared
 * with the asset library and is flagged so owners never dispose it.
 */
export class PropFactory {
  private mats = new Map<THREE.Material, THREE.Material>();

  constructor(private lu: PlanetLightUniforms | null, private key = 'asset-prop') {}

  make(key: string, target: number, axis: 'y' | 'max' = 'max'): THREE.Object3D | null {
    const o = assets.prop(key, target, axis);
    if (!o) return null;
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      m.userData.sharedGeometry = true;
      const convert = (src: THREE.Material) => {
        let out = this.mats.get(src);
        if (!out) {
          out = src.clone();
          const std = out as THREE.MeshStandardMaterial;
          if (std.isMeshStandardMaterial) std.envMapIntensity = 0.6;
          if (this.lu) patchPlanetMaterial(out, this.lu, { key: this.key });
          this.mats.set(src, out);
        }
        return out;
      };
      m.material = Array.isArray(m.material) ? m.material.map(convert) : convert(m.material);
    });
    return o;
  }

  dispose(): void {
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
  }
}

/** Dispose geometry under `root` that is owned by it (skips shared asset geometry). */
export function disposeOwnedGeometry(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !m.userData.sharedGeometry) m.geometry.dispose();
  });
}
