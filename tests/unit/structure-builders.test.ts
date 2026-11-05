import { describe, expect, it } from 'vitest';
import { createStructureBuilders, type StructureBlockIds } from '../../src/game/world/structure-builders';
import type { GeneratedStructure } from '../../src/game/world/structure-regions';

const blocks: StructureBlockIds = {
  BRICK: 8, COBBLE: 9, CTABLE: 18, DIRT: 2, GOLD: 14, GRAVEL: 12,
  HAY: 13, LEAVES: 6, MOSSY: 15, PLANKS: 7, SANDSTONE: 11,
  STONEBRICK: 10, TORCH: 17, WOOD: 5,
};
const structure = (type: GeneratedStructure['type']): GeneratedStructure => ({
  type, cx: 48, cz: 48, gy: 20, pad: 20, blend: 8, reach: 22, zone: 30, rx: 1, rz: 1,
});
function geometry(type: GeneratedStructure['type'], seed = 123, version = 1): string[] {
  const placed: string[] = [];
  createStructureBuilders(() => seed, blocks, () => version)
    .buildStructure(structure(type), (x, y, z, block, onlyAir) => {
      expect(onlyAir).toBe(false);
      if (x >= 48 && x < 64 && z >= 48 && z < 64 && y >= 0 && y < 48) {
        placed.push(`${x},${y},${z}:${block}`);
      }
    }, 48, 48);
  return placed;
}
describe('saved-world structure geometry', () => {
  it.each(['village', 'temple', 'tower', 'dungeon', 'cabin', 'circle'] as const)(
    'builds deterministic %s structures', type => {
      expect(geometry(type, 99)).toEqual(geometry(type, 99));
      expect(geometry(type, 99).length).toBeGreaterThan(0);
    },
  );
  it('builds varied new village street and building layouts without changing legacy villages', () => {
    const original = geometry('village', 500, 1);
    const modern = geometry('village', 500, 2);
    expect(modern).not.toEqual(original);
    expect(geometry('village', 500, 2)).toEqual(modern);
    expect(geometry('village', 501, 2)).not.toEqual(modern);
  });
  it('varies ruined tower details with the seeded world', () => {
    expect(geometry('tower', 500)).not.toEqual(geometry('tower', 501));
  });
  it('only places block IDs known to the original game', () => {
    const known = new Set<number>([0, 19, 20, 21, 22, 23, 24, 25, 26, ...Object.values(blocks)]);
    for (const write of geometry('village', 12)) {
      expect(known.has(Number(write.split(':')[1]))).toBe(true);
    }
  });
});
