import * as THREE from 'three';
import { FloraLibrary, VARIANTS, type TintedPart } from './FloraLibrary';
import { SC_STRIDE, ScatterType, SCATTER_TYPE_COUNT } from './terrain/ChunkBuilder';
import type { QuadNode } from './terrain/QuadTree';
import { patchPlanetMaterial, type PlanetLightUniforms } from '../render/PlanetLighting';
import type { TerrainParams } from '../universe/types';
import { getItem } from '../gameplay/Items';
import { settings } from '../core/Settings';
import { RNG, hashString } from '../core/Random';

/** A harvestable / collidable scatter instance. */
export interface ScatterRecord {
  id: string;
  type: ScatterType;
  variant: number;
  pos: THREE.Vector3; // planet local (base)
  up: THREE.Vector3;
  scale: number;
  health: number;
  maxHealth: number;
  item: string | null;
  amount: number;
  /** Every instanced mesh (detail parts + far LOD) that draws this instance. */
  meshes: THREE.InstancedMesh[];
  index: number;
  matrix: THREE.Matrix4;
  depleted: boolean;
}

interface ScatterGroup {
  node: QuadNode;
  group: THREE.Group;
  meshes: { mesh: THREE.InstancedMesh; type: ScatterType; lod: 0 | 1 | 2 }[]; // lod: 0 always, 1 near only, 2 far only
  records: ScatterRecord[];
  center: THREE.Vector3;
  visible: boolean;
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** Wind sway strength per scatter type (scaled by height² in the shader). */
const SWAY: Partial<Record<number, number>> = {
  [ScatterType.Tree]: 0.1,
  [ScatterType.Bush]: 1.2,
  [ScatterType.Grass]: 6,
  [ScatterType.OxyPlant]: 0.6,
};

const SWAY_GLSL = /* glsl */ `
  #ifdef USE_INSTANCING
  {
    vec3 ip = instanceMatrix[3].xyz;
    float ph = dot(ip, vec3(0.37, 0.21, 0.29));
    float k = max(transformed.y, 0.0);
    float sway = k * k * 0.04 * (sin(uTime * 1.6 + ph) + 0.5 * sin(uTime * 3.7 + ph * 1.7));
    transformed.x += sway * aSway;
    transformed.z += sway * 0.6 * aSway;
  }
  #endif
`;

/**
 * Turns scatter data produced by terrain workers into instanced meshes and
 * gameplay records (harvestables, colliders). Depleted instances are tracked
 * by stable ids so they stay harvested across sessions.
 */
export class ScatterManager {
  readonly library: FloraLibrary;
  readonly material: THREE.MeshStandardMaterial;
  private groups = new Map<string, ScatterGroup>();
  readonly depleted: Set<string>;
  private params: TerrainParams;
  private parent: THREE.Object3D;
  private lu: PlanetLightUniforms;
  private detailMaterials = new Map<string, THREE.MeshStandardMaterial>();

  /** Planet-lit, wind-swayed, palette-tinted clone of an imported model material. */
  private detailMaterial(p: TintedPart): THREE.MeshStandardMaterial {
    const key = `${p.material.uuid}|${p.tint.getHexString()}|${p.tintAmount.toFixed(2)}|${p.foliage}`;
    let m = this.detailMaterials.get(key);
    if (m) return m;
    m = p.material.clone();
    m.side = THREE.DoubleSide;
    // colour attributes are stripped when models are baked for instancing
    m.vertexColors = false;
    m.roughness = Math.max(0.75, m.roughness);
    m.metalness = 0;
    const tint = new THREE.Vector3(p.tint.r, p.tint.g, p.tint.b);
    patchPlanetMaterial(m, this.lu, {
      key: p.foliage ? 'scatter-detail-foliage-v1' : 'scatter-detail-v1',
      // foliage normals are authored for both faces; undo three's back-face flip
      fragNormal: p.foliage ? '#ifdef DOUBLE_SIDED\n normal *= faceDirection;\n #endif' : undefined,
      vertDecl: 'attribute float aSway;',
      vertTransform: SWAY_GLSL,
      fragDecl: 'uniform vec3 uTint; uniform float uTintAmt;',
      fragColor: /* glsl */ `
        {
          // pull the texture toward the planet palette, keeping its detail (luminance)
          float l = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          vec3 tinted = uTint * (l / max(dot(uTint, vec3(0.2126, 0.7152, 0.0722)), 0.05));
          diffuseColor.rgb = mix(diffuseColor.rgb, tinted, uTintAmt);
        }
      `,
      extraUniforms: { uTint: { value: tint }, uTintAmt: { value: p.tintAmount } },
    });
    this.detailMaterials.set(key, m);
    return m;
  }

  constructor(params: TerrainParams, archetype: string, lu: PlanetLightUniforms, parent: THREE.Object3D, depleted: Set<string>) {
    this.params = params;
    this.parent = parent;
    this.depleted = depleted;
    this.library = new FloraLibrary(params, archetype);
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.0, side: THREE.DoubleSide });
    this.lu = lu;
    patchPlanetMaterial(this.material, lu, {
      key: 'scatter-v1',
      vertDecl: 'attribute float aSway;',
      vertTransform: SWAY_GLSL,
      fragColor: /* glsl */ `
        #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
        totalEmissiveRadiance += max(vColor.rgb - vec3(1.0), vec3(0.0)) * 0.6;
        #endif
      `,
    });
    // per-type sway attribute baked into geometries
    for (let t = 0; t < SCATTER_TYPE_COUNT; t++) {
      for (const g of this.library.geometries[t]) {
        const n = g.attributes.position.count;
        g.setAttribute('aSway', new THREE.BufferAttribute(new Float32Array(n).fill(SWAY[t] ?? 0), 1));
      }
      for (const parts of this.library.models[t]) {
        if (!parts) continue;
        for (const p of parts) {
          const n = p.geometry.attributes.position.count;
          p.geometry.setAttribute('aSway', new THREE.BufferAttribute(new Float32Array(n).fill(SWAY[t] ?? 0), 1));
        }
      }
    }
  }

  add(node: QuadNode, data: Float32Array, center: THREE.Vector3): void {
    const count = data.length / SC_STRIDE;
    // bucket by type+variant
    const buckets: number[][] = [];
    for (let i = 0; i < SCATTER_TYPE_COUNT * VARIANTS; i++) buckets.push([]);
    const veg = settings.data.vegetationDensity;
    for (let i = 0; i < count; i++) {
      const o = i * SC_STRIDE;
      const type = data[o] as ScatterType;
      if ((type === ScatterType.Grass || type === ScatterType.Bush) && veg < 1 && ((i * 2654435761) >>> 0) / 4294967296 > veg) continue;
      const variant = Math.min(VARIANTS - 1, Math.floor(data[o + 6] * VARIANTS));
      buckets[type * VARIANTS + variant].push(i);
    }
    const group = new THREE.Group();
    group.position.copy(center);
    group.matrixAutoUpdate = false;
    group.updateMatrix();
    const g: ScatterGroup = { node, group, meshes: [], records: [], center: center.clone(), visible: false };
    const mat = new THREE.Matrix4();
    const col = new THREE.Color();
    for (let b = 0; b < buckets.length; b++) {
      const list = buckets[b];
      if (list.length === 0) continue;
      const type = Math.floor(b / VARIANTS) as ScatterType;
      const variant = b % VARIANTS;
      const info = this.library.info[type];
      const castShadow = type === ScatterType.Tree || type === ScatterType.Boulder || type === ScatterType.Node;
      const detail = this.library.models[type][variant];
      const bucketMeshes: { mesh: THREE.InstancedMesh; lod: 0 | 1 | 2 }[] = [];
      const make = (geo: THREE.BufferGeometry, material: THREE.Material, lod: 0 | 1 | 2) => {
        const m = new THREE.InstancedMesh(geo, material, list.length);
        m.castShadow = castShadow;
        m.receiveShadow = true;
        m.frustumCulled = true;
        bucketMeshes.push({ mesh: m, lod });
        return m;
      };
      if (detail) {
        for (const p of detail) make(p.geometry, this.detailMaterial(p), info.maxDist > info.nearDist ? 1 : 0);
        if (info.maxDist > info.nearDist) make(this.library.geometries[type][variant], this.material, 2);
      } else {
        make(this.library.geometries[type][variant], this.material, 0);
      }
      const all = bucketMeshes.map((b) => b.mesh);
      for (let k = 0; k < list.length; k++) {
        const o = list[k] * SC_STRIDE;
        const lx = data[o + 1], ly = data[o + 2], lz = data[o + 3];
        const s = data[o + 4];
        const yaw = data[o + 5];
        const up = _v.set(lx + center.x, ly + center.y, lz + center.z).normalize();
        _q.setFromUnitVectors(Y, up);
        _q2.setFromAxisAngle(Y, yaw);
        _q.multiply(_q2);
        if (type === ScatterType.Rock || type === ScatterType.Boulder) {
          _q2.setFromAxisAngle(new THREE.Vector3(1, 0, 0), (data[o + 6] - 0.5) * 0.8);
          _q.multiply(_q2);
        }
        _s.setScalar(s);
        mat.compose(new THREE.Vector3(lx, ly, lz), _q, _s);
        const id = `${node.key}#${list[k]}`;
        const recMatrix = mat.clone();
        let item: string | null = info.harvest?.item ?? null;
        if (type === ScatterType.Node) {
          const res = this.params.resourceNodes[Math.floor(data[o + 7])] ?? this.params.resourceNodes[0];
          item = res.item;
          col.set(getItem(item).color);
        } else {
          const v = 0.85 + data[o + 6] * 0.3;
          col.setRGB(v, v, v);
        }
        const dep = info.harvest ? this.depleted.has(id) : false;
        for (const m of all) {
          m.setColorAt(k, col);
          m.setMatrixAt(k, dep ? ZERO : mat);
        }
        if (info.harvest || info.collide > 0) {
          const rng = new RNG(hashString(id));
          const amount = info.harvest ? rng.int(info.harvest.min, info.harvest.max) : 0;
          g.records.push({
            id,
            type,
            variant,
            pos: new THREE.Vector3(lx + center.x, ly + center.y, lz + center.z),
            up: up.clone(),
            scale: s,
            health: info.health,
            maxHealth: info.health,
            item,
            amount,
            meshes: all,
            index: k,
            matrix: recMatrix,
            depleted: dep,
          });
        }
      }
      for (const { mesh, lod } of bucketMeshes) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.userData.scatterType = type;
        group.add(mesh);
        g.meshes.push({ mesh, type, lod });
      }
    }
    group.visible = false;
    this.parent.add(group);
    this.groups.set(node.key, g);
  }

  remove(node: QuadNode): void {
    const g = this.groups.get(node.key);
    if (!g) return;
    for (const m of g.meshes) m.mesh.dispose();
    g.group.removeFromParent();
    this.groups.delete(node.key);
  }

  setVisible(node: QuadNode, v: boolean): void {
    const g = this.groups.get(node.key);
    if (g) g.visible = v;
  }

  /** Per-frame distance culling of scatter types. */
  update(camLocal: THREE.Vector3): void {
    for (const g of this.groups.values()) {
      const d = g.center.distanceTo(camLocal);
      g.group.visible = g.visible;
      if (!g.visible) continue;
      const detail = settings.data.terrainDetail;
      for (const m of g.meshes) {
        const info = this.library.info[m.type];
        const near = info.nearDist * detail;
        m.mesh.visible = d < info.maxDist && (m.lod === 0 || (m.lod === 1 ? d < near : d >= near));
      }
    }
  }

  /** Iterate active records within radius of a planet-local point. */
  *nearby(p: THREE.Vector3, radius: number): Generator<ScatterRecord> {
    for (const g of this.groups.values()) {
      if (!g.visible) continue;
      if (g.center.distanceTo(p) > radius + 250) continue;
      for (const r of g.records) {
        if (r.depleted) continue;
        if (r.pos.distanceToSquared(p) < radius * radius) yield r;
      }
    }
  }

  /** Ray (planet-local) against harvestable records. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): { rec: ScatterRecord; dist: number } | null {
    let best: ScatterRecord | null = null;
    let bestT = maxDist;
    const c = new THREE.Vector3();
    for (const r of this.nearby(origin, maxDist + 10)) {
      if (!r.item) continue;
      const info = this.library.info[r.type];
      c.copy(r.up).multiplyScalar(info.height * r.scale).add(r.pos);
      const rad = info.hitRadius * r.scale;
      const oc = c.clone().sub(origin);
      const t = oc.dot(dir);
      if (t < 0 || t > bestT + rad) continue;
      const d2 = oc.lengthSq() - t * t;
      if (d2 > rad * rad) continue;
      const tt = t - Math.sqrt(rad * rad - d2);
      if (tt < bestT) {
        bestT = Math.max(0, tt);
        best = r;
      }
    }
    return best ? { rec: best, dist: bestT } : null;
  }

  /** Mark a record depleted and hide its instance. */
  deplete(rec: ScatterRecord): void {
    rec.depleted = true;
    this.depleted.add(rec.id);
    for (const m of rec.meshes) {
      m.setMatrixAt(rec.index, ZERO);
      m.instanceMatrix.needsUpdate = true;
    }
  }

  /** Visual feedback while being mined: shrink slightly. */
  setDamageVisual(rec: ScatterRecord, frac: number): void {
    const m = rec.matrix.clone();
    const s = 1 - frac * 0.35;
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    m.decompose(pos, q, sc);
    sc.multiplyScalar(s);
    m.compose(pos, q, sc);
    for (const mesh of rec.meshes) {
      mesh.setMatrixAt(rec.index, m);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Push a planet-local point out of solid scatter colliders (trees, boulders). */
  collide(p: THREE.Vector3, radius: number): boolean {
    let hit = false;
    for (const r of this.nearby(p, 12)) {
      const info = this.library.info[r.type];
      if (info.collide <= 0) continue;
      const cr = info.collide * r.scale + radius;
      // horizontal distance relative to local up
      _v.copy(p).sub(r.pos);
      const vert = _v.dot(r.up);
      if (vert < -1 || vert > (r.type === ScatterType.Tree ? 8 : 2.5) * r.scale) continue;
      _v.addScaledVector(r.up, -vert);
      const d = _v.length();
      if (d < cr && d > 1e-4) {
        p.addScaledVector(_v, (cr - d) / d);
        hit = true;
      }
    }
    return hit;
  }

  dispose(): void {
    for (const g of this.groups.values()) {
      for (const m of g.meshes) m.mesh.dispose();
      g.group.removeFromParent();
    }
    this.groups.clear();
    this.library.dispose();
    this.material.dispose();
    for (const m of this.detailMaterials.values()) m.dispose();
    this.detailMaterials.clear();
  }
}
