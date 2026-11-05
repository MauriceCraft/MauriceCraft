import { ckey } from './chunk-key';
import { primeWorldChunks } from './prime-chunks';
import type { WritableChunk } from './block-access';

export interface ChunkLifecycleDependencies {
  chunks: Map<number, WritableChunk>;
  savedChunks: Map<number, Uint8Array>;
  height: number;
  getDimension: () => string;
  setSeed: (seed: number) => void;
  setGeneratorVersion?: (version: number) => void;
  clearStructures: () => void;
  onChunkLoaded?: (cx: number, cz: number, data: Uint8Array) => void;
  onWorldReset?: () => void;
  chunkAt: (cx: number, cz: number) => WritableChunk | null;
  resetChunkCache: () => void;
  generateChunkData: (cx: number, cz: number) => Uint8Array;
  buildChunk: (cx: number, cz: number) => unknown;
  disposeMesh: (chunk: WritableChunk) => void;
  solid: (block: number) => boolean;
  getBlock: (x: number, y: number, z: number) => number;
}

/** Keeps generated chunks and edited-world backups compatible across dimensions. */
export function createChunkLifecycle(deps: ChunkLifecycleDependencies) {
  const { chunks, savedChunks, height: WORLD_HEIGHT } = deps;
  const chunkAt = deps.chunkAt, resetChunkCache = deps.resetChunkCache;
  const generateChunkData = deps.generateChunkData, buildChunk = deps.buildChunk;
  const disposeMesh = deps.disposeMesh, solid = deps.solid, get = deps.getBlock;

function genChunk(cx: number, cz: number): WritableChunk {
  const sv = deps.getDimension() === 'overworld' ? savedChunks.get(ckey(cx, cz)) : null;
  if (sv) {
    const sc = { cx: cx, cz: cz, data: new Uint8Array(sv), mesh: null, meshed: false, edited: true, dirty: false };
    chunks.set(ckey(cx, cz), sc); resetChunkCache();
    deps.onChunkLoaded?.(cx, cz, sc.data);
    return sc;
  }
  const data = generateChunkData(cx, cz);
  const generated = { cx, cz, data, mesh: null, meshed: false, edited: false, dirty: false };
  chunks.set(ckey(cx, cz), generated);
  resetChunkCache();
  deps.onChunkLoaded?.(cx, cz, data);
  return generated;
}
function getOrGen(cx: number, cz: number): WritableChunk { return chunkAt(cx, cz) || genChunk(cx, cz); }
function topY(x: number, z: number): number { for (let y = WORLD_HEIGHT - 1; y >= 0; y--) if (solid(get(x, y, z))) return y; return 0; }

function resetWorld(newSeed: number, ox: number, oz: number, generatorVersion?: number): void {
  deps.onWorldReset?.();
  chunks.forEach(function (c) { disposeMesh(c); });
  chunks.clear(); resetChunkCache();
  deps.setSeed(newSeed);
  if (generatorVersion !== undefined) deps.setGeneratorVersion?.(generatorVersion);
  deps.clearStructures();
  primeWorldChunks(ox, oz, genChunk, buildChunk);
}


  return { genChunk, getOrGen, topY, resetWorld };
}
