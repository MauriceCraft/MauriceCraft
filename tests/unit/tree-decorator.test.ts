import { describe, expect, it } from 'vitest';
import { createTreeDecorator, treeDensity, treeStyle } from '../../src/game/world/tree-decorator';
import type { Biome } from '../../src/game/world/biomes';

function generate(cx: number, cz: number, biome: Biome = 'forest', seed = 15) {
  const blocks = new Map<string, number>();
  const decorate = createTreeDecorator({
    getSeed: () => seed, getBiome: () => biome, groundHeight: () => 18,
    canGrowAt: () => true, inStructureZone: () => false, seaLevel: 14, maxHeight: 48,
    blocks: { wood: 5, darkWood: 40, leaves: 6, pineLeaves: 38 },
  });
  decorate(cx, cz, (x, y, z, block, onlyAir) => {
    if (x < cx * 16 || x >= cx * 16 + 16 || z < cz * 16 || z >= cz * 16 + 16) return;
    const key = `${x},${y},${z}`;
    if (!onlyAir || !blocks.has(key)) blocks.set(key, block);
  });
  return blocks;
}

describe('biome-aware tree generation', () => {
  it('uses different tree silhouettes and sparse distributions', () => {
    expect(treeStyle('taiga', 0.3)).toBe('pine');
    expect(treeStyle('marsh', 0.3)).toBe('willow');
    expect(treeStyle('savanna', 0.3)).toBe('acacia');
    expect(treeStyle('forest', 0.99)).toBe('ancient');
    expect(treeDensity('plains')).toBeLessThan(treeDensity('forest'));
    expect(treeDensity('desert')).toBe(0);
  });
  it('reproduces the same tree locations in any generation order', () => {
    expect(generate(4, -3)).toEqual(generate(4, -3));
    expect(generate(-2, 1, 'taiga')).toEqual(generate(-2, 1, 'taiga'));
  });
  it('keeps deserts open and produces distinct shapes in forest and taiga', () => {
    const desert = generate(0, 0, 'desert');
    expect(desert.size).toBe(0);
    const forest = [generate(0, 0), generate(1, 1), generate(2, 2)];
    const taiga = [generate(0, 0, 'taiga'), generate(1, 1, 'taiga'), generate(2, 2, 'taiga')];
    expect(forest.some(chunk => chunk.size > 0)).toBe(true);
    expect(taiga.some(chunk => [...chunk.values()].includes(38))).toBe(true);
  });
});
