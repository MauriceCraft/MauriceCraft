import { cropGrid, samePattern } from './grid';

export interface ShapedRecipe {
  out: number;
  n: number;
  shape: string[];
  key: Record<string, number>;
  shapeless?: never;
}
export interface ShapelessRecipe {
  out: number;
  n: number;
  shapeless: number[];
  shape?: never;
  key?: never;
}
export type Recipe = ShapedRecipe | ShapelessRecipe;

/** Pure crafting lookup so UI and inventory state remain separate. */
export function createRecipeMatcher(recipes: readonly Recipe[]) {
  function recipePattern(r: Recipe): number[][] {
    if (!r.shape || !r.key) return [];
    return r.shape.map(row => row.split('').map(ch => ch === '.' ? 0 : r.key[ch]));
  }
  function recipeCounts(r: Recipe): Record<number, number> {
    const counts: Record<number, number> = {};
    if (r.shapeless) r.shapeless.forEach(id => { counts[id] = (counts[id] || 0) + 1; });
    else recipePattern(r).forEach(row => row.forEach(id => {
      if (id) counts[id] = (counts[id] || 0) + 1;
    }));
    return counts;
  }
  function matchRecipe(grid: readonly number[], size: number): Recipe | null {
    const crop = cropGrid(grid, size);
    if (!crop) return null;
    const flat: number[] = [];
    crop.forEach(row => row.forEach(v => { if (v) flat.push(v); }));
    const key = flat.slice().sort((a, b) => a - b).join(',');
    for (const r of recipes) {
      if (r.shapeless) {
        if (r.shapeless.slice().sort((a, b) => a - b).join(',') === key) return r;
      } else {
        const pattern = recipePattern(r);
        if (samePattern(crop, pattern) ||
            samePattern(crop, pattern.map(row => row.slice().reverse()))) return r;
      }
    }
    return null;
  }
  return { recipePattern, recipeCounts, matchRecipe };
}
