import * as THREE from 'three';
import { buildSharedIndices, faceToDir, type ChunkResult } from './ChunkBuilder';
import type { TerrainWorkerPool } from './WorkerPool';
import { settings } from '../../core/Settings';

let sharedIndex: THREE.BufferAttribute | null = null;
function getSharedIndex(): THREE.BufferAttribute {
  if (!sharedIndex) sharedIndex = new THREE.BufferAttribute(buildSharedIndices(), 1);
  return sharedIndex;
}

export interface QuadTreeOptions {
  planetKey: string;
  radius: number;
  heightScale: number;
  seaHeight: number;
  scatterLevel: number;
  scatterSeed: number;
  pool: TerrainWorkerPool;
  terrainMaterial: THREE.Material;
  liquidMaterial: THREE.Material | null;
  parent: THREE.Object3D;
  onScatter?: (node: QuadNode, data: Float32Array, center: THREE.Vector3) => void;
  onScatterRemoved?: (node: QuadNode) => void;
  onScatterVisible?: (node: QuadNode, visible: boolean) => void;
}

export class QuadNode {
  readonly key: string;
  children: QuadNode[] | null = null;
  mesh: THREE.Mesh | null = null;
  water: THREE.Mesh | null = null;
  ready = false;
  job: { cancel: () => void; setPriority: (p: number) => void } | null = null;
  /** Planet-local bounding sphere. */
  readonly center = new THREE.Vector3();
  boundRadius: number;
  readonly size: number;
  hasScatter = false;
  minH = 0;
  maxH = 0;
  disposed = false;

  constructor(
    readonly face: number,
    readonly level: number,
    readonly ix: number,
    readonly iy: number,
    radius: number,
    heightScale: number,
  ) {
    this.key = `${face}:${level}:${ix}:${iy}`;
    const s = 2 / (1 << level);
    const d = [0, 0, 0];
    faceToDir(face, -1 + (ix + 0.5) * s, -1 + (iy + 0.5) * s, d);
    this.center.set(d[0], d[1], d[2]).multiplyScalar(radius);
    this.size = (Math.PI / 2) * radius / (1 << level);
    this.boundRadius = this.size * 0.75 + heightScale;
    this.minH = -heightScale;
    this.maxH = heightScale;
  }
}

/**
 * Chunked LOD terrain over a cube-sphere. Nodes split based on camera distance;
 * a parent remains visible until all of its children are ready, so there are
 * never holes. Chunk meshes are generated asynchronously in workers.
 */
export class TerrainQuadTree {
  readonly roots: QuadNode[] = [];
  readonly opts: QuadTreeOptions;
  readonly maxLevel: number;
  private resultQueue: { node: QuadNode; res: ChunkResult }[] = [];
  private camLocal = new THREE.Vector3();
  visibleChunks = 0;
  totalChunks = 0;
  private horizonMin: number;

  constructor(opts: QuadTreeOptions) {
    this.opts = opts;
    const faceEdge = (Math.PI / 2) * opts.radius;
    this.maxLevel = Math.max(4, Math.ceil(Math.log2(faceEdge / 20)));
    for (let f = 0; f < 6; f++) {
      const n = new QuadNode(f, 0, 0, 0, opts.radius, opts.heightScale);
      this.roots.push(n);
      this.request(n, 0);
    }
    this.horizonMin = opts.radius + Math.max(-opts.heightScale * 0.6, isFinite(opts.seaHeight) ? opts.seaHeight : -opts.heightScale * 0.6);
  }

  private request(node: QuadNode, priority: number): void {
    const h = this.opts.pool.request(
      {
        planet: this.opts.planetKey,
        face: node.face,
        level: node.level,
        ix: node.ix,
        iy: node.iy,
        scatter: node.level === this.opts.scatterLevel,
        scatterSeed: this.opts.scatterSeed,
      },
      priority,
    );
    node.job = h;
    h.promise.then((res) => {
      node.job = null;
      if (!res || node.disposed) return;
      this.resultQueue.push({ node, res });
    });
  }

  private buildMesh(node: QuadNode, res: ChunkResult): void {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(res.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(res.normals, 3));
    g.setAttribute('color', new THREE.BufferAttribute(res.colors, 3));
    g.setIndex(getSharedIndex());
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), res.radius);
    const mesh = new THREE.Mesh(g, this.opts.terrainMaterial);
    mesh.position.set(res.center[0], res.center[1], res.center[2]);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.receiveShadow = true;
    mesh.castShadow = node.level >= this.maxLevel - 3;
    mesh.visible = false;
    mesh.userData.terrain = true;
    this.opts.parent.add(mesh);
    node.mesh = mesh;
    node.center.set(res.center[0], res.center[1], res.center[2]);
    node.boundRadius = res.radius;
    node.minH = res.minH;
    node.maxH = res.maxH;

    if (res.water && this.opts.liquidMaterial) {
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.BufferAttribute(res.water.positions, 3));
      wg.setAttribute('normal', new THREE.BufferAttribute(res.water.normals, 3));
      wg.setAttribute('depth', new THREE.BufferAttribute(res.water.depth, 1));
      wg.setIndex(getSharedIndex());
      wg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), res.radius + 50);
      const wm = new THREE.Mesh(wg, this.opts.liquidMaterial);
      wm.position.copy(mesh.position);
      wm.matrixAutoUpdate = false;
      wm.updateMatrix();
      wm.visible = false;
      wm.receiveShadow = true;
      wm.renderOrder = 1;
      this.opts.parent.add(wm);
      node.water = wm;
    }
    if (res.scatter && this.opts.onScatter) {
      node.hasScatter = true;
      this.opts.onScatter(node, res.scatter, node.center);
    }
    node.ready = true;
  }

  private setVisible(node: QuadNode, v: boolean): void {
    if (node.mesh) node.mesh.visible = v;
    if (node.water) node.water.visible = v;
    if (v) this.visibleChunks++;
  }

  private hideSubtree(node: QuadNode): void {
    this.setVisible(node, false);
    if (node.hasScatter) this.opts.onScatterVisible?.(node, false);
    if (node.children) for (const c of node.children) this.hideSubtree(c);
  }

  private disposeNode(node: QuadNode): void {
    node.disposed = true;
    node.job?.cancel();
    node.job = null;
    if (node.mesh) {
      node.mesh.geometry.dispose();
      node.mesh.removeFromParent();
      node.mesh = null;
    }
    if (node.water) {
      node.water.geometry.dispose();
      node.water.removeFromParent();
      node.water = null;
    }
    if (node.hasScatter) this.opts.onScatterRemoved?.(node);
    if (node.children) for (const c of node.children) this.disposeNode(c);
    node.children = null;
  }

  private split(node: QuadNode): void {
    const l = node.level + 1;
    node.children = [];
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const c = new QuadNode(node.face, l, node.ix * 2 + i, node.iy * 2 + j, this.opts.radius, this.opts.heightScale);
        // inherit a better height estimate from parent
        c.minH = node.minH;
        c.maxH = node.maxH;
        node.children.push(c);
        this.request(c, this.priority(c));
      }
    }
  }

  private priority(node: QuadNode): number {
    const d = Math.max(0, node.center.distanceTo(this.camLocal) - node.boundRadius);
    return d + node.level * 1500;
  }

  private beyondHorizon(node: QuadNode): boolean {
    const camR = this.camLocal.length();
    if (camR <= this.horizonMin) return false;
    const hCam = Math.sqrt(camR * camR - this.horizonMin * this.horizonMin);
    const topR = this.opts.radius + node.maxH;
    const hNode = topR > this.horizonMin ? Math.sqrt(topR * topR - this.horizonMin * this.horizonMin) : 0;
    const d = node.center.distanceTo(this.camLocal) - node.boundRadius;
    return d > hCam + hNode;
  }

  private updateNode(node: QuadNode, split: number): boolean {
    const dist = Math.max(0, node.center.distanceTo(this.camLocal) - node.boundRadius);
    const wantSplit = node.level < this.maxLevel && dist < node.size * split;
    if (node.job) node.job.setPriority(this.priority(node));
    this.totalChunks++;

    if (wantSplit) {
      if (!node.children) this.split(node);
      let ok = true;
      for (const c of node.children!) ok = this.updateNode(c, split) && ok;
      if (ok) {
        this.setVisible(node, false);
        if (node.hasScatter) this.opts.onScatterVisible?.(node, true);
        return true;
      }
      for (const c of node.children!) this.hideSubtree(c);
      this.setVisible(node, node.ready && !this.beyondHorizon(node));
      if (node.hasScatter) this.opts.onScatterVisible?.(node, node.ready);
      return node.ready;
    }
    if (node.children) {
      if (node.ready) {
        for (const c of node.children) this.disposeNode(c);
        node.children = null;
      } else {
        // keep children until this node is ready to replace them
        let ok = true;
        for (const c of node.children) ok = this.updateNode(c, split) && ok;
        return ok;
      }
    }
    this.setVisible(node, node.ready && !this.beyondHorizon(node));
    if (node.hasScatter) this.opts.onScatterVisible?.(node, node.ready);
    return node.ready;
  }

  /** camLocal: camera position in planet-local space. */
  update(camLocal: THREE.Vector3, budgetMs = 4): void {
    this.camLocal.copy(camLocal);
    const start = performance.now();
    // nearest results first
    if (this.resultQueue.length > 1) this.resultQueue.sort((a, b) => a.node.level - b.node.level || this.priority(a.node) - this.priority(b.node));
    let processed = 0;
    const budget = budgetMs + Math.min(14, this.resultQueue.length * 0.08);
    while (this.resultQueue.length && (processed < 2 || performance.now() - start < budget)) {
      const { node, res } = this.resultQueue.shift()!;
      if (!node.disposed) this.buildMesh(node, res);
      processed++;
    }
    this.visibleChunks = 0;
    this.totalChunks = 0;
    const split = 2.1 * settings.data.terrainDetail;
    for (const r of this.roots) this.updateNode(r, split);
    this.opts.pool.pump();
  }

  /** True when the finest chunks around the camera are built (used to hide pop-in during transitions). */
  isSettled(): boolean {
    return this.resultQueue.length === 0 && this.opts.pool.pending === 0;
  }

  dispose(): void {
    for (const r of this.roots) this.disposeNode(r);
  }
}
