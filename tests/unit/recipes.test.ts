import { describe, expect, it } from 'vitest';
import { createRecipeMatcher, type Recipe } from '../../src/game/crafting/recipes';

const recipes: Recipe[] = [
  { out: 7, n: 4, shape: ['aa', 'aa'], key: { a: 5 } },
  { out: 18, n: 1, shape: ['ab', 'b.'], key: { a: 3, b: 7 } },
  { out: 111, n: 1, shapeless: [12, 9] },
];
const { matchRecipe, recipeCounts, recipePattern } = createRecipeMatcher(recipes);
describe('crafting rules', () => {
  it('matches shaped recipes independent of empty grid borders', () => {
    expect(matchRecipe([0, 0, 0, 0, 5, 5, 0, 5, 5], 3)?.out).toBe(7);
    expect(matchRecipe([5, 5, 5, 5], 2)?.n).toBe(4);
    expect(recipeCounts(recipes[0])).toEqual({ 5: 4 });
  });
  it('mirrors shaped recipes but rejects incorrect rotations', () => {
    expect(matchRecipe([7, 3, 0, 7], 2)?.out).toBe(18);
    expect(matchRecipe([3, 7, 0, 7], 2)).toBeNull();
    expect(recipePattern(recipes[1])).toEqual([[3, 7], [7, 0]]);
  });
  it('matches shapeless recipes in either order', () => {
    expect(matchRecipe([9, 12, 0, 0], 2)?.out).toBe(111);
    expect(matchRecipe([12, 9, 0, 0], 2)?.out).toBe(111);
    expect(recipeCounts(recipes[2])).toEqual({ 9: 1, 12: 1 });
  });
  it('rejects missing ingredients and empty grids', () => {
    expect(matchRecipe([5, 5, 5, 0], 2)).toBeNull();
    expect(matchRecipe([0, 0, 0, 0], 2)).toBeNull();
  });
});
