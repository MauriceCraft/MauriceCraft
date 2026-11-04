import { describe, expect, it } from 'vitest';
import { createBlockCatalog } from '../../src/game/world/block-catalog';

describe('persisted item and block catalog', () => {
  it('preserves the historical block IDs and tool identifiers', () => {
    const catalog = createBlockCatalog();
    expect(catalog.OBSIDIAN).toBe(36);
    expect(catalog.FLINT).toBe(111);
    expect(catalog.BED).toBe(19);
    expect(catalog.toolId(0, 0)).toBe(130);
    expect(catalog.toolId(4, 3)).toBe(150);
    expect(catalog.TOOLS[130]).toEqual({ kind: 'pickaxe', tier: 0 });
    expect(catalog.TOOLS[150]).toEqual({ kind: 'sword', tier: 4 });
  });
  it('keeps rendering and collision rules stable', () => {
    const catalog = createBlockCatalog();
    expect(catalog.tileOf(catalog.OBSIDIAN)).toBe(98);
    expect(catalog.solid(catalog.WATER)).toBe(false);
    expect(catalog.solid(catalog.STONE)).toBe(true);
    expect(catalog.opq(catalog.BED)).toBe(false);
    expect(catalog.isBed(26)).toBe(true);
  });
  it('does not change survival crafting and block selection', () => {
    const catalog = createBlockCatalog();
    expect(catalog.ALL_BLOCKS.slice(0, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(catalog.NAMES[111]).toBe('Flint & Steel');
    expect(catalog.EGG_KINDS[155]).toBe('diamondgolem');
    expect(catalog.DROPS[30]).toBe(catalog.DIAMOND);
    expect(catalog.BREAK_TIME[36]).toBe(5.5);
    expect(catalog.NEEDS_PICK[30]).toBe(2);
  });
});
