import { describe, expect, it, vi } from 'vitest';
import { createChunkGenerator, type ChunkGeneratorDependencies } from '../../src/game/world/chunk-generator';
import { createTreeDecorator } from '../../src/game/world/tree-decorator';
import type { Biome } from '../../src/game/world/biomes';

const BLOCKS: ChunkGeneratorDependencies['blocks'] = {
  BRICK: 8, COAL_ORE: 27, COPPER_ORE: 28, DIAMOND_ORE: 30,
  DIRT: 2, GOLD: 14, GRASS: 1, IRON_ORE: 29, LAVA: 35,
  LEAVES: 6, SAND: 4, SANDSTONE: 11, STONE: 3,
  STONEBRICK: 10, TORCH: 17, WATER: 34, WOOD: 5,
  SNOW: 37, PINE_LEAVES: 38, RED_SAND: 39, DARK_WOOD: 40,
  FLOWERING_GRASS: 55,
};

function generate(version: number, seed = 17) {
  const carveCaves = vi.fn();
  const deps: ChunkGeneratorDependencies = {
    getSeed: () => seed, getDimension: () => 'overworld',
    getGeneratorVersion: () => version,
    getBiome: () => 'meadow', carveCaves,
    maxHeight: 48, seaLevel: 14, regionSize: 80,
    groundH: () => 20, heightAt: () => 20,
    forceSand: () => false, inStructZone: () => false,
    structureFor: () => null, buildStructure: () => undefined,
    blocks: BLOCKS,
  };
  return { data: createChunkGenerator(deps)(0, 0), carveCaves };
}

function treeBlocks(version: number, biome: Biome): Set<number> {
  const seen = new Set<number>();
  const decorate = createTreeDecorator({
    getSeed: () => 23, getGeneratorVersion: () => version,
    getBiome: () => biome, groundHeight: () => 20,
    canGrowAt: () => true, inStructureZone: () => false,
    seaLevel: 14, maxHeight: 48,
    blocks: {
      wood: 5, leaves: 6, darkWood: 40, pineLeaves: 38,
      acaciaWood: 51, acaciaLeaves: 52,
      willowWood: 53, willowLeaves: 54,
    },
  });
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    decorate(cx, cz, (x, _y, z, block) => {
      if (x >= cx * 16 && x < cx * 16 + 16 &&
          z >= cz * 16 && z < cz * 16 + 16) seen.add(block);
    });
  }
  return seen;
}

describe('versioned world-generation contract', () => {
  it('never runs v3 cave carving on existing v1 or v2 worlds', () => {
    for (const version of [1, 2]) {
      const result = generate(version);
      expect(result.carveCaves).not.toHaveBeenCalled();
      expect(result.data).toHaveLength(16 * 16 * 48);
    }
    expect(generate(3).carveCaves).toHaveBeenCalledOnce();
  });

  it('reserves flowering meadow surfaces for v3 while preserving v2 grass', () => {
    const index = 20 * 16 * 16;
    expect(generate(2).data[index]).toBe(BLOCKS.GRASS);
    expect(generate(3).data[index]).toBe(BLOCKS.FLOWERING_GRASS);
  });

  it.each([
    ['savanna', 51, 52],
    ['marsh', 53, 54],
  ] as const)('keeps v2 %s trees compatible while enabling distinct v3 species blocks',
    (biome, wood, leaves) => {
      const oldBlocks = treeBlocks(2, biome);
      const newBlocks = treeBlocks(3, biome);
      expect(oldBlocks.has(wood)).toBe(false);
      expect(oldBlocks.has(leaves)).toBe(false);
      expect(newBlocks.has(wood)).toBe(true);
      expect(newBlocks.has(leaves)).toBe(true);
    });

  it('reproduces old and new chunks from the same seed and coordinates', () => {
    for (const version of [1, 2, 3]) {
      expect(generate(version, 123).data).toEqual(generate(version, 123).data);
    }
  });
});
