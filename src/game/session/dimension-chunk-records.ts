import { ckey } from '../world/chunk-key';
import type { ChunkRecord } from '../storage/world-storage';

/** Retain the original Overworld key and Dexie schema for existing saves. */
export function savedChunkKey(worldId: string, dimension: string, cx: number, cz: number): string {
  return dimension === 'overworld'
    ? worldId + ':' + cx + ',' + cz
    : worldId + ':' + dimension + ':' + cx + ',' + cz;
}

/** Old records have neither a dimension field nor a dimension segment in their key. */
export function chunkDimension(record: ChunkRecord): string {
  if (record.dimension === 'nether' || record.dimension === 'end') return record.dimension;
  const rest = record.k.slice(record.w.length + 1);
  if (rest.startsWith('nether:')) return 'nether';
  if (rest.startsWith('end:')) return 'end';
  return 'overworld';
}

export function hydrateDimensionChunks(
  records: readonly ChunkRecord[],
  overworld: Map<number, Uint8Array>,
  other: Map<string, Map<number, Uint8Array>>,
): void {
  overworld.clear();
  other.clear();
  for (const record of records) {
    const dimension = chunkDimension(record);
    const target = dimension === 'overworld' ? overworld :
      getDimensionCache(other, dimension);
    target.set(ckey(record.cx, record.cz), record.data.slice());
  }
}

export function getDimensionCache(
  other: Map<string, Map<number, Uint8Array>>, dimension: string,
): Map<number, Uint8Array> {
  let cache = other.get(dimension);
  if (!cache) { cache = new Map(); other.set(dimension, cache); }
  return cache;
}
