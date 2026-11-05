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
  it('preserves ore smelting and multi-ingredient recipes', () => {
    expect(recipes.some(recipe => recipe.out === blocks.IRON_INGOT &&
      recipe.shapeless?.includes(blocks.RAW_IRON))).toBe(true);
    expect(recipes.filter(recipe => recipe.out === blocks.TORCH).length).toBeGreaterThan(0);
  });
});
