import { describe, expect, it } from 'vitest';
import { ckey } from '../../src/game/world/chunk-key';
import { chunkDimension, getDimensionCache, hydrateDimensionChunks, savedChunkKey } from '../../src/game/session/dimension-chunk-records';
import type { ChunkRecord } from '../../src/game/storage/world-storage';

describe('cross-dimension save identity', () => {
  it('keeps old overworld keys and gives Nether/End separate coordinates', () => {
    expect(savedChunkKey('w', 'overworld', -2, 3)).toBe('w:-2,3');
    expect(savedChunkKey('w', 'nether', -2, 3)).toBe('w:nether:-2,3');
    expect(savedChunkKey('w', 'end', -2, 3)).toBe('w:end:-2,3');
  });
  it('rehydrates edited chunks separately and accepts old saves without dimension fields', () => {
    const records: ChunkRecord[] = [
      { k: 'w:-2,3', w: 'w', cx: -2, cz: 3, data: new Uint8Array([1]) },
      { k: 'w:nether:-2,3', w: 'w', cx: -2, cz: 3, dimension: 'nether', data: new Uint8Array([2]) },
      { k: 'w:end:-2,3', w: 'w', cx: -2, cz: 3, data: new Uint8Array([3]) },
    ];
    const overworld = new Map<number, Uint8Array>();
    const other = new Map<string, Map<number, Uint8Array>>();
    hydrateDimensionChunks(records, overworld, other);
    expect(overworld.get(ckey(-2, 3))).toEqual(new Uint8Array([1]));
    expect(getDimensionCache(other, 'nether').get(ckey(-2, 3))).toEqual(new Uint8Array([2]));
    expect(getDimensionCache(other, 'end').get(ckey(-2, 3))).toEqual(new Uint8Array([3]));
    expect(records.map(chunkDimension)).toEqual(['overworld', 'nether', 'end']);
    hydrateDimensionChunks([], overworld, other);
    expect(overworld.size).toBe(0);
    expect(other.size).toBe(0);
  });
});
