import { ckey } from './chunk-key';
import type { MeshChunk } from '../rendering/chunk-mesher';

/** Mutable chunk fields shared by the terrain, renderer, and save pipeline. */
export interface WritableChunk extends MeshChunk {
  edited?: boolean;
  dirty?: boolean;
}

/**
 * Owns the last-chunk cache and the original persistent block layout.
 * No chunk is created here: an unloaded chunk remains solid to collisions.
 */
export function createBlockAccess<T extends WritableChunk>(
  chunks: Map<number, T>,
  height: number,
) {
  let cachedKey: number | null = null;
  let cachedChunk: T | null = null;

  function chunkAt(cx: number, cz: number): T | null {
    const key = ckey(cx, cz);
    if (key !== cachedKey) {
      cachedKey = key;
      cachedChunk = chunks.get(key) ?? null;
    }
    return cachedChunk;
  }

  function resetChunkCache(): void {
    cachedKey = null;
    cachedChunk = null;
  }

  function getBlock(x: number, y: number, z: number): number {
    if (y < 0) return 3;
    if (y >= height) return 0;
    const chunk = chunkAt(x >> 4, z >> 4);
    if (!chunk) return 3;
    return chunk.data[(y * 16 + (z & 15)) * 16 + (x & 15)];
  }

  function setBlock(x: number, y: number, z: number, id: number): void {
    if (y < 0 || y >= height) return;
    const chunk = chunkAt(x >> 4, z >> 4);
    if (!chunk) return;
    chunk.data[(y * 16 + (z & 15)) * 16 + (x & 15)] = id;
    chunk.edited = true;
    chunk.dirty = true;
    chunk.torches = null;
  }

  function inBounds(...coordinates: [number, number, number]): boolean {
    const y = coordinates[1];
    return y >= 0 && y < height;
  }

  return { chunkAt, resetChunkCache, getBlock, setBlock, inBounds };
}
