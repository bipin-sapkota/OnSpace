/// <reference lib="webworker" />
import { TerrainGen } from './TerrainGen';
import { buildChunk, type ChunkRequest } from './ChunkBuilder';
import type { TerrainParams } from '../../universe/types';

/**
 * Terrain worker: owns a TerrainGen per registered planet and builds chunk
 * meshes + scatter off the main thread. Results are transferred zero-copy.
 */
const gens = new Map<string, TerrainGen>();

type Msg =
  | { type: 'register'; key: string; params: TerrainParams }
  | { type: 'unregister'; key: string }
  | { type: 'build'; id: number; req: ChunkRequest };

self.onmessage = (e: MessageEvent<Msg>) => {
  const msg = e.data;
  if (msg.type === 'register') {
    gens.set(msg.key, new TerrainGen(msg.params));
  } else if (msg.type === 'unregister') {
    gens.delete(msg.key);
  } else if (msg.type === 'build') {
    const gen = gens.get(msg.req.planet);
    if (!gen) {
      (self as unknown as Worker).postMessage({ type: 'error', id: msg.id });
      return;
    }
    const res = buildChunk(gen, msg.req);
    const transfer: ArrayBuffer[] = [res.positions.buffer as ArrayBuffer, res.normals.buffer as ArrayBuffer, res.colors.buffer as ArrayBuffer];
    if (res.water) transfer.push(res.water.positions.buffer as ArrayBuffer, res.water.normals.buffer as ArrayBuffer, res.water.depth.buffer as ArrayBuffer);
    if (res.scatter) transfer.push(res.scatter.buffer as ArrayBuffer);
    (self as unknown as Worker).postMessage({ type: 'built', id: msg.id, res }, transfer);
  }
};
