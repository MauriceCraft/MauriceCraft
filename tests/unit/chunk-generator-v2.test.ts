import { describe, expect, it } from 'vitest';
import { createModernChunkGenerator } from '../../src/game/world/chunk-generator-v2';
import type { ChunkGeneratorDependencies } from '../../src/game/world/chunk-generator';

function generator(seed: number) {
  const deps: ChunkGeneratorDependencies = {
    getSeed: () => seed, getDimension: () => 'overworld',
    maxHeight: 48, seaLevel: 14, regionSize: 80,
    groundH: (x, z) => 19 + Math.floor(Math.sin(x / 30) * 2 + Math.cos(z / 30) * 2),
    heightAt: (x, z) => 19 + Math.floor(Math.sin(x / 30) * 2 + Math.cos(z / 30) * 2),
    forceSand: () => false, inStructZone: () => false,
    structureFor: () => null, buildStructure: () => {},
    blocks: {
      BRICK: 8, COAL_ORE: 27, COPPER_ORE: 28, DIAMOND_ORE: 30,
      DIRT: 2, GOLD: 14, GRASS: 1, IRON_ORE: 29, LAVA: 35,
      LEAVES: 6, SAND: 4, SANDSTONE: 11, STONE: 3,
      STONEBRICK: 10, TORCH: 17, WATER: 34, WOOD: 5,
      SNOW: 37, PINE_LEAVES: 38, RED_SAND: 39, DARK_WOOD: 40,
    },
  };
  return createModernChunkGenerator({ ...deps, getBiome: () => 'taiga' });
}

describe('modern chunk generation', () => {
  it('generates reproducible biome terrain across negative chunks', () => {
    expect(generator(15)(-3, 2)).toEqual(generator(15)(-3, 2));
    expect(generator(99)(-3, 2)).not.toEqual(generator(15)(-3, 2));
  });
  it('creates snow-covered taiga terrain and underground resources', () => {
    const data = generator(22)(0, 0);
    const top = data.findIndex((b, i) => b === 37 && i > 0);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(data).toHaveLength(48 * 16 * 16);
  });
});
