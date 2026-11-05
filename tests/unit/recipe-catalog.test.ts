import { describe, expect, it } from 'vitest';
import { createBlockCatalog } from '../../src/game/world/block-catalog';
import { createRecipeCatalog } from '../../src/game/crafting/recipe-catalog';

describe('crafting catalog compatibility', () => {
  const blocks = createBlockCatalog();
  const recipes = createRecipeCatalog({
    items: blocks,
    toolTiers: blocks.TOOL_TIERS,
    toolId: blocks.toolId,
  });
  it('preserves classic utility recipes and starter tools', () => {
    expect(recipes.find(recipe => recipe.out === blocks.PLANKS))
      .toMatchObject({ n: 4, shapeless: [blocks.WOOD] });
    expect(recipes.find(recipe => recipe.out === blocks.CTABLE))
      .toMatchObject({ shape: ['pp', 'pp'] });
    expect(recipes.some(recipe => recipe.out === blocks.toolId(0, 0))).toBe(true);
  });
  it('crafts planks and sticks directly from every tree log type', () => {
    const variants = [blocks.WOOD, blocks.DARK_WOOD, blocks.BIRCH_WOOD,
      blocks.ACACIA_WOOD, blocks.WILLOW_WOOD];
    for (const log of variants) {
      expect(recipes).toContainEqual({ out: blocks.PLANKS, n: 4, shapeless: [log] });
      expect(recipes).toContainEqual({ out: blocks.STICK, n: 4, shapeless: [log] });
    }
    // Traditional two-plank recipe still works in the 2x2 crafting grid.
    expect(recipes).toContainEqual({ out: blocks.STICK, n: 4,
      shape: ['p', 'p'], key: { p: blocks.PLANKS } });
  });

  it('preserves ore smelting and multi-ingredient recipes', () => {
    expect(recipes.some(recipe => recipe.out === blocks.IRON_INGOT &&
      recipe.shapeless?.includes(blocks.RAW_IRON))).toBe(true);
    expect(recipes.filter(recipe => recipe.out === blocks.TORCH).length).toBeGreaterThan(0);
  });
});
