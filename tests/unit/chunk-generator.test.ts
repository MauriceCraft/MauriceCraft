import { describe, expect, it } from 'vitest';
import { createChunkGenerator, type WorldDimension, type TerrainBlockIds } from '../../src/game/world/chunk-generator';

const blocks: TerrainBlockIds = {
  BRICK: 8, COAL_ORE: 27, COPPER_ORE: 28, DIAMOND_ORE: 30,
  DIRT: 2, GOLD: 14, GRASS: 1, IRON_ORE: 29, LAVA: 35,
  LEAVES: 6, SAND: 4, SANDSTONE: 11, STONE: 3,
  STONEBRICK: 10, TORCH: 17, WATER: 34, WOOD: 5,
};
function terrain(dimension: WorldDimension, seed = 123) {
  return createChunkGenerator({
    getSeed: () => seed, getDimension: () => dimension,
    maxHeight: 48, seaLevel: 14, regionSize: 80,
    groundH: () => 18, heightAt: () => 18,
    forceSand: () => false, inStructZone: () => false,
    structureFor: () => null, buildStructure: () => undefined,
    blocks,
  });
}
const index = (x: number, y: number, z: number) => (y * 16 + z) * 16 + x;

describe('deterministic terrain generator', () => {
  it.each(['overworld', 'nether', 'end'] as const)(
    'reproduces %s chunks from a stable seed', dim => {
      const build = terrain(dim, 456);
      const first = build(3, -2), second = build(3, -2);
      expect(first).toEqual(second);
      expect(first).toHaveLength(48 * 16 * 16);
    },
  );
  it('keeps legacy generation byte-identical even if the new generator is available', () => {
    const old = terrain('overworld', 42)(2, -1);
    expect(old).toEqual(terrain('overworld', 42)(2, -1));
  });
  it('keeps the original overworld surface and underground stone IDs', () => {
    const data = terrain('overworld')(0, 0);
    expect(data[index(0, 18, 0)]).toBe(1);
    expect(data[index(0, 2, 0)]).toBe(3);
    expect(data[index(0, 20, 0)]).toBe(0);
  });
  it('builds Nether ceiling and the End central island separately', () => {
    const nether = terrain('nether')(0, 0);
    const end = terrain('end')(0, 0);
    expect(nether[index(0, 47, 0)]).toBe(10);
    expect(end[index(0, 0, 0)]).toBe(0);
    expect(end[index(0, 20, 0)]).not.toBe(0);
  });
  it('changes procedural terrain when the seed changes', () => {
    expect(terrain('nether', 1)(0, 0)).not.toEqual(terrain('nether', 2)(0, 0));
  });
});
