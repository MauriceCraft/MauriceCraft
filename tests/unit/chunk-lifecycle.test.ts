import { describe, expect, it, vi } from 'vitest';
import { createBlockAccess, type WritableChunk } from '../../src/game/world/block-access';
import { createChunkLifecycle } from '../../src/game/world/chunk-lifecycle';
import { ckey } from '../../src/game/world/chunk-key';

function fixture() {
  const chunks = new Map<number, WritableChunk>();
  const savedChunks = new Map<number, Uint8Array>();
  const dimensionChunks = new Map<string, Map<number, Uint8Array>>();
  const access = createBlockAccess(chunks, 48);
  let dimension = 'overworld';
  let seed = 1;
  const setSeed = vi.fn((value: number) => { seed = value; });
  const clearStructures = vi.fn();
  const disposeMesh = vi.fn();
  const buildChunk = vi.fn();
  const generateChunkData = vi.fn(() => new Uint8Array(16 * 16 * 48));
  const lifecycle = createChunkLifecycle({
    chunks, savedChunks, dimensionChunks, height: 48,
    getDimension: () => dimension, setSeed, clearStructures,
    chunkAt: access.chunkAt, resetChunkCache: access.resetChunkCache,
    generateChunkData, buildChunk, disposeMesh,
    solid: id => id !== 0, getBlock: access.getBlock,
  });
  return { chunks, savedChunks, dimensionChunks, access, lifecycle, setSeed, clearStructures,
    disposeMesh, buildChunk, generateChunkData,
    getSeed: () => seed, setDimension: (value: string) => { dimension = value; } };
}

describe('world chunk lifecycle', () => {
  it('reuses an already loaded chunk without regenerating it', () => {
    const f = fixture();
    const chunk = f.lifecycle.getOrGen(-2, 3);
    expect(chunk.cx).toBe(-2);
    expect(chunk.cz).toBe(3);
    expect(f.lifecycle.getOrGen(-2, 3)).toBe(chunk);
    expect(f.generateChunkData).toHaveBeenCalledTimes(1);
  });

  it('restores edited overworld chunk bytes without changing the save', () => {
    const f = fixture();
    const saved = new Uint8Array(16 * 16 * 48);
    saved[17] = 44;
    f.savedChunks.set(ckey(-1, 0), saved);
    const chunk = f.lifecycle.genChunk(-1, 0);
    expect(chunk.edited).toBe(true);
    expect(chunk.data[17]).toBe(44);
    chunk.data[17] = 9;
    expect(saved[17]).toBe(44);
    expect(f.generateChunkData).not.toHaveBeenCalled();
  });

  it('does not load overworld snapshots into another dimension', () => {
    const f = fixture();
    f.savedChunks.set(ckey(1, 1), new Uint8Array(16 * 16 * 48).fill(12));
    f.setDimension('nether');
    const chunk = f.lifecycle.genChunk(1, 1);
    expect(chunk.edited).toBe(false);
    expect(chunk.data[0]).toBe(0);
    expect(f.generateChunkData).toHaveBeenCalledWith(1, 1);
  });

  it('loads separately saved Nether chunks without leaking overworld changes', () => {
    const f = fixture();
    const overworld = new Uint8Array(16 * 16 * 48).fill(3);
    const nether = new Uint8Array(16 * 16 * 48).fill(17);
    f.savedChunks.set(ckey(3, -2), overworld);
    f.dimensionChunks.set('nether', new Map([[ckey(3, -2), nether]]));
    f.setDimension('nether');
    const loaded = f.lifecycle.genChunk(3, -2);
    expect(loaded.data[0]).toBe(17);
    loaded.data[0] = 90;
    expect(nether[0]).toBe(17);
    expect(overworld[0]).toBe(3);
    expect(f.generateChunkData).not.toHaveBeenCalled();
  });

  it('releases old meshes, resets structures and primes only initial chunks', () => {
    const f = fixture();
    f.lifecycle.genChunk(50, 50);
    f.lifecycle.resetWorld(125, 0, 0);
    expect(f.getSeed()).toBe(125);
    expect(f.clearStructures).toHaveBeenCalledOnce();
    expect(f.disposeMesh).toHaveBeenCalledTimes(1);
    expect(f.chunks.size).toBe(9);
    expect(f.buildChunk).toHaveBeenCalledOnce();
    expect(f.buildChunk).toHaveBeenCalledWith(0, 0);
  });

  it('finds the highest solid block without creating new chunks', () => {
    const f = fixture();
    const data = new Uint8Array(16 * 16 * 48);
    data[(8 * 16) * 16] = 3;
    f.savedChunks.set(ckey(0, 0), data);
    f.lifecycle.genChunk(0, 0);
    expect(f.lifecycle.topY(0, 0)).toBe(8);
    expect(f.generateChunkData).not.toHaveBeenCalled();
  });
});
