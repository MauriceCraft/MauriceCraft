import { describe, expect, it } from 'vitest';
import { ckey } from '../../src/game/world/chunk-key';
import { createBlockAccess, type WritableChunk } from '../../src/game/world/block-access';

function chunk(cx: number, cz: number): WritableChunk {
  return { cx, cz, data: new Uint8Array(16 * 16 * 48), meshed: false, edited: false, dirty: false, torches: [[1, 2, 3]] };
}

describe('chunk block access', () => {
  it('keeps missing chunks solid, the bottom solid and the sky empty', () => {
    const access = createBlockAccess(new Map<number, WritableChunk>(), 48);
    expect(access.getBlock(0, -1, 0)).toBe(3);
    expect(access.getBlock(0, 48, 0)).toBe(0);
    expect(access.getBlock(0, 1, 0)).toBe(3);
    expect(access.inBounds(0, 47, 0)).toBe(true);
    expect(access.inBounds(0, 48, 0)).toBe(false);
  });

  it('uses the original y/z/x block index and marks edits for saving and remeshing', () => {
    const c = chunk(-1, 2);
    const access = createBlockAccess(new Map([[ckey(-1, 2), c]]), 48);
    access.setBlock(-1, 4, 32, 24);
    expect(c.data[(4 * 16 + 0) * 16 + 15]).toBe(24);
    expect(access.getBlock(-1, 4, 32)).toBe(24);
    expect(c.edited).toBe(true);
    expect(c.dirty).toBe(true);
    expect(c.torches).toBeNull();
    access.setBlock(-1, 48, 32, 5);
    expect(access.getBlock(-1, 4, 32)).toBe(24);
  });

  it('invalidates the last-chunk cache when a chunk is replaced or unloaded', () => {
    const original = chunk(1, -1);
    original.data[0] = 7;
    const map = new Map([[ckey(1, -1), original]]);
    const access = createBlockAccess(map, 48);
    expect(access.getBlock(16, 0, -16)).toBe(7);
    const replacement = chunk(1, -1);
    replacement.data[0] = 8;
    map.set(ckey(1, -1), replacement);
    // A cached chunk intentionally persists until the owning world invalidates it.
    expect(access.getBlock(16, 0, -16)).toBe(7);
    access.resetChunkCache();
    expect(access.getBlock(16, 0, -16)).toBe(8);
    map.delete(ckey(1, -1));
    access.resetChunkCache();
    expect(access.getBlock(16, 0, -16)).toBe(3);
  });

  it('does not edit chunks that have not been generated', () => {
    const access = createBlockAccess(new Map<number, WritableChunk>(), 48);
    expect(() => access.setBlock(100, 4, -100, 4)).not.toThrow();
    expect(access.getBlock(100, 4, -100)).toBe(3);
  });
});
