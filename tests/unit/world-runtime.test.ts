import { describe, expect, it, vi } from 'vitest';
import { createWorldRuntime } from '../../src/game/world/world-runtime';

vi.mock('../../src/game/rendering/game-renderer', () => ({
  createGameRenderer: vi.fn(() => ({
    canvas: {}, renderer: {}, scene: {}, camera: {},
    atlasCanvas: {}, tex: {}, mat: {}, torchMat: {},
    dayUniform: { value: 1 }, glowMat: {}, sun: {}, moon: {}, sel: {},
  })),
}));
const buildChunk = vi.fn(), disposeMesh = vi.fn();
vi.mock('../../src/game/rendering/chunk-mesher', () => ({
  createChunkMesher: vi.fn(() => ({
    buildChunk: (cx: number, cz: number) => buildChunk(cx, cz),
    disposeMesh: (chunk: unknown) => disposeMesh(chunk),
    refreshAround: vi.fn(), blockGeo: vi.fn(),
  })),
}));

describe('world runtime wiring', () => {
  it('builds a coherent, cached world with stable block IDs and shared chunk access', () => {
    let seed = 17, version = 1;
    const world = createWorldRuntime({
      height: 48, chunkSize: 16, seaLevel: 14, viewDistance: 5,
      getSeed: () => seed, setSeed: value => { seed = value; },
      getGeneratorVersion: () => version, setGeneratorVersion: value => { version = value; },
      getDimension: () => 'overworld',
      getPlayer: () => ({ x: 0, z: 0 }),
    });
    expect(world.STONE).toBe(3);
    expect(world.hotbar).toHaveLength(9);
    expect(world.chunks.size).toBe(0);
    const first = world.getOrGen(0, 0);
    expect(first.data).toBeInstanceOf(Uint8Array);
    expect(first.data).toHaveLength(16 * 48 * 16);
    expect(world.getOrGen(0, 0)).toBe(first);
    world.setBlock(3, 6, 4, world.DIAMOND_BLOCK);
    expect(world.get(3, 6, 4)).toBe(world.DIAMOND_BLOCK);
    expect(first.dirty).toBe(true);
    expect(world.chunks.size).toBe(1);
    world.resetWorld(20, 0, 0, 2);
    expect(version).toBe(2);
    expect(seed).toBe(20);
    expect(disposeMesh).toHaveBeenCalled();
    expect(buildChunk).toHaveBeenCalled();
  });

  it('keeps chunk data separate across dimensions and delegates player streaming', () => {
    let dimension: 'overworld' | 'nether' = 'overworld';
    const world = createWorldRuntime({
      height: 48, chunkSize: 16, seaLevel: 14, viewDistance: 5,
      getSeed: () => 120, setSeed: () => undefined,
      getGeneratorVersion: () => 1, setGeneratorVersion: () => undefined,
      getDimension: () => dimension,
      getPlayer: () => ({ x: 24, z: -16 }),
    });
    const overworld = world.getOrGen(1, -1);
    dimension = 'nether';
    world.chunks.clear();
    world.resetChunkCache();
    const nether = world.getOrGen(1, -1);
    expect(nether.data).not.toEqual(overworld.data);
    world.streamChunks();
    expect(world.chunks.size).toBeGreaterThan(1);
  });
});
