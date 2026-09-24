import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Runtime library for the third-party models baked by `tools/assets/build.mjs`
 * (CC0 Quaternius / KayKit packs, NASA public-domain models, ambientCG
 * materials). Loads everything once behind the loading screen and hands out:
 *  - merged, instancing-ready geometry parts (one per material) for scatter,
 *  - normalised clones for props,
 *  - skinned clones with animation clips for creatures.
 * Every consumer has a procedural fallback, so the game still runs if an
 * asset fails to load.
 */
export interface ModelPart {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
}

export interface InstanceModel {
  parts: ModelPart[];
  /** Height of the source model in its own units. */
  height: number;
  size: THREE.Vector3;
}

export interface SkinnedAsset {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  height: number;
}

const BUNDLES = ['nature', 'spacebase', 'scifi'];
const CREATURES = [
  'alpaca', 'bull', 'stag', 'fox', 'chicken_cow', 'crabenemy', 'spider', 'velociraptor', 'frog', 'yeti', 'greyjaw', 'wolf_basic',
  'glubevolved', 'dragonevolved', 'ghost', 'golelingevolved', 'demon', 'orcenemy',
];
const NASA = ['lunar_module', 'astronaut', 'eva_suit', 'habitat', 'sev_rover', 'perseverance', 'ingenuity', 'dawn', 'bennu'];
export const TERRAIN_MATERIALS = ['Grass004', 'Ground003', 'Ground022', 'Ground010', 'Rock023', 'Rock005', 'Snow004', 'Ice002', 'Gravel015'] as const;
export type TerrainMaterialId = (typeof TERRAIN_MATERIALS)[number];

function toFloat(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const out = new Float32Array(a.count * a.itemSize);
  for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
  return new THREE.BufferAttribute(out, a.itemSize);
}

const base = (): string => `${import.meta.env.BASE_URL ?? './'}assets/`;

class AssetLibrary {
  private models = new Map<string, THREE.Object3D>();
  private gltfs = new Map<string, GLTF>();
  private instanceCache = new Map<string, InstanceModel>();
  loaded = false;
  failed: string[] = [];
  /** Terrain detail texture array (sRGB albedo + linear height in alpha), one layer per material. */
  terrainTex: THREE.DataArrayTexture | null = null;
  /** Mean sRGB albedo per layer, for normalising detail to the planet palette. */
  terrainMeans: number[][] = [];

  has(key: string): boolean {
    return this.models.has(key) || this.gltfs.has(key);
  }

  /** Load everything; `onProgress` receives 0..1. Never throws. */
  async loadAll(onProgress?: (p: number) => void): Promise<void> {
    if (this.loaded) return;
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const jobs: { url: string; key: string; kind: 'bundle' | 'single' }[] = [
      ...BUNDLES.map((b) => ({ url: `${base()}${b}.glb`, key: b, kind: 'bundle' as const })),
      ...CREATURES.map((c) => ({ url: `${base()}creatures/${c}.glb`, key: `creatures/${c}`, kind: 'single' as const })),
      ...NASA.map((n) => ({ url: `${base()}nasa/${n}.glb`, key: `nasa/${n}`, kind: 'single' as const })),
    ];
    let done = 0;
    const total = jobs.length + 1;
    const tick = () => onProgress?.(++done / total);
    await Promise.all(
      jobs.map(async (j) => {
        try {
          const gltf = await loader.loadAsync(j.url);
          if (j.kind === 'bundle') {
            for (const child of gltf.scene.children) this.models.set(`${j.key}/${child.name}`, child);
          } else {
            this.gltfs.set(j.key, gltf);
            this.models.set(j.key, gltf.scene);
          }
        } catch (e) {
          console.warn(`Asset failed: ${j.url}`, e);
          this.failed.push(j.key);
        }
        tick();
      }),
    );
    try {
      await this.loadTerrainMaterials();
    } catch (e) {
      console.warn('Terrain materials failed', e);
      this.failed.push('materials');
    }
    tick();
    this.loaded = true;
  }

  private async loadTerrainMaterials(): Promise<void> {
    const size = 512;
    const n = TERRAIN_MATERIALS.length;
    // RGB = albedo, A = height
    const data = new Uint8Array(size * size * 4 * n);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const readImage = async (url: string): Promise<Uint8ClampedArray> => {
      const img = new Image();
      img.src = url;
      await img.decode();
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      return ctx.getImageData(0, 0, size, size).data;
    };
    this.terrainMeans = [];
    // sequential: the shared canvas is reused between reads
    for (let i = 0; i < n; i++) {
      const id = TERRAIN_MATERIALS[i];
      const c = await readImage(`${base()}materials/${id}_color.webp`);
      const h = await readImage(`${base()}materials/${id}_height.webp`);
      const o = i * size * size * 4;
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < c.length; k += 4) {
        data[o + k] = c[k];
        data[o + k + 1] = c[k + 1];
        data[o + k + 2] = c[k + 2];
        data[o + k + 3] = h[k];
        r += c[k];
        g += c[k + 1];
        b += c[k + 2];
      }
      const cnt = (c.length / 4) * 255;
      this.terrainMeans[i] = [r / cnt, g / cnt, b / cnt];
    }
    const t = new THREE.DataArrayTexture(data, size, size, n);
    t.format = THREE.RGBAFormat;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    // sampled as linear data; the shader converts albedo from sRGB itself so height stays linear
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    this.terrainTex = t;
  }

  terrainLayer(id: TerrainMaterialId): number {
    return TERRAIN_MATERIALS.indexOf(id);
  }

  /**
   * Instancing-ready geometry for a model: all meshes baked into model space
   * and merged per material, re-based so the model's lowest point sits at y=0.
   */
  instanceModel(key: string): InstanceModel | null {
    const cached = this.instanceCache.get(key);
    if (cached) return cached;
    const src = this.models.get(key);
    if (!src) return null;
    src.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(src.matrixWorld).invert();
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    src.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const g = new THREE.BufferGeometry();
      // meshopt-quantised attributes are dequantised to float so transforms & merging are exact
      for (const name of ['position', 'normal', 'uv']) {
        const a = m.geometry.getAttribute(name);
        if (a) g.setAttribute(name, toFloat(a));
      }
      if (m.geometry.index) g.setIndex(Array.from(m.geometry.index.array));
      for (const grp of m.geometry.groups) g.addGroup(grp.start, grp.count, grp.materialIndex);
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (mats.length > 1 && g.groups.length) {
        for (const grp of g.groups) {
          const sub = g.clone();
          const idx = g.index!;
          sub.setIndex(Array.from((idx.array as Uint32Array).slice(grp.start, grp.start + grp.count)));
          sub.clearGroups();
          const mat = mats[grp.materialIndex ?? 0];
          (byMat.get(mat) ?? byMat.set(mat, []).get(mat)!).push(sub);
        }
      } else {
        g.clearGroups();
        (byMat.get(mats[0]) ?? byMat.set(mats[0], []).get(mats[0])!).push(g);
      }
    });
    const parts: ModelPart[] = [];
    const box = new THREE.Box3();
    for (const [mat, geos] of byMat) {
      const nonIndexed = geos.some((g) => !g.index);
      const merged = mergeGeometries(nonIndexed ? geos.map((g) => (g.index ? g.toNonIndexed() : g)) : geos, false);
      if (!merged) continue;
      merged.computeBoundingBox();
      box.union(merged.boundingBox!);
      parts.push({ geometry: merged, material: mat as THREE.MeshStandardMaterial });
    }
    if (!parts.length) return null;
    for (const p of parts) {
      p.geometry.translate(0, -box.min.y, 0);
      p.geometry.computeBoundingSphere();
    }
    const size = box.getSize(new THREE.Vector3());
    const model = { parts, height: size.y, size };
    this.instanceCache.set(key, model);
    return model;
  }

  /** A deep clone scaled so its largest (or given-axis) dimension is `target` metres, base at y=0. */
  prop(key: string, target: number, axis: 'y' | 'max' = 'max'): THREE.Object3D | null {
    const src = this.models.get(key);
    if (!src) return null;
    const clone = src.clone(true);
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    clone.scale.set(1, 1, 1);
    clone.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const dim = axis === 'y' ? size.y : Math.max(size.x, size.y, size.z);
    const s = target / Math.max(dim, 1e-6);
    const holder = new THREE.Group();
    clone.scale.setScalar(s);
    clone.position.set(-(box.min.x + size.x / 2) * s, -box.min.y * s, -(box.min.z + size.z / 2) * s);
    holder.add(clone);
    holder.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    return holder;
  }

  /** Skinned, independently animatable clone of a creature. */
  skinned(key: string): SkinnedAsset | null {
    const gltf = this.gltfs.get(key);
    if (!gltf) return null;
    const scene = SkeletonUtils.clone(gltf.scene);
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    return { scene, clips: gltf.animations, height: Math.max(0.01, box.max.y - box.min.y) };
  }
}

export const assets = new AssetLibrary();
