import type { Recipe } from './recipes';

export type RecipeItemId = 'ACACIA_WOOD' | 'BIRCH_WOOD' | 'DARK_WOOD' | 'WILLOW_WOOD' | 'BED' | 'BEEF' | 'BONE' | 'BRICK' | 'CHICKEN' | 'COAL' | 'COBBLE' | 'COOKED' | 'COPPER_BLOCK' | 'COPPER_INGOT' | 'CTABLE' | 'DIAMOND' | 'DIAMOND_BLOCK' | 'DIRT' | 'DYNAMITE' | 'EMERALD' | 'FEATHER' | 'FLINT' | 'GOLD' | 'GRAVEL' | 'GUNPOWDER' | 'IRON_BLOCK' | 'IRON_INGOT' | 'LEATHER' | 'MUTTON' | 'PLANKS' | 'PORK' | 'RAW_COPPER' | 'RAW_IRON' | 'SAND' | 'SANDSTONE' | 'STICK' | 'STONE' | 'STONEBRICK' | 'STRING' | 'TNT' | 'TORCH' | 'WOOD' | 'WOOL';
export type RecipeItemIds = Record<RecipeItemId, number>;
export interface RecipeCatalogDependencies {
  items: RecipeItemIds;
  toolTiers: readonly string[];
  toolId: (tier: number, kind: number) => number;
}

/** Canonical crafting recipes, including shaped and shapeless recipes. */
export function createRecipeCatalog(deps: RecipeCatalogDependencies): Recipe[] {
  const { ACACIA_WOOD, BIRCH_WOOD, DARK_WOOD, WILLOW_WOOD, BED, BEEF, BONE, BRICK, CHICKEN, COAL, COBBLE, COOKED, COPPER_BLOCK, COPPER_INGOT, CTABLE, DIAMOND, DIAMOND_BLOCK, DIRT, DYNAMITE, EMERALD, FEATHER, FLINT, GOLD, GRAVEL, GUNPOWDER, IRON_BLOCK, IRON_INGOT, LEATHER, MUTTON, PLANKS, PORK, RAW_COPPER, RAW_IRON, SAND, SANDSTONE, STICK, STONE, STONEBRICK, STRING, TNT, TORCH, WOOD, WOOL } = deps.items;
  const TOOL_TIERS = deps.toolTiers;
  const toolId = deps.toolId;
  // Crafting recipes. Shaped ones use a pattern (they work mirrored); shapeless ones just need the right items.
  const RECIPES: Recipe[] = [
    // Every tree species should feed the same early-game crafting progression.
    ...[WOOD, DARK_WOOD, BIRCH_WOOD, ACACIA_WOOD, WILLOW_WOOD].map(log =>
      ({ out: PLANKS, n: 4, shapeless: [log] } as Recipe)),
    // Quick starter recipe; the usual two-planks-to-four-sticks recipe remains.
    ...[WOOD, DARK_WOOD, BIRCH_WOOD, ACACIA_WOOD, WILLOW_WOOD].map(log =>
      ({ out: STICK, n: 4, shapeless: [log] } as Recipe)),
    { out: CTABLE, n: 1, shape: ['pp', 'pp'], key: { p: PLANKS } },
    { out: STICK, n: 4, shape: ['p', 'p'], key: { p: PLANKS } },
    { out: TORCH, n: 4, shape: ['w', 's'], key: { w: WOOD, s: STICK } },
    { out: STONE, n: 1, shapeless: [COBBLE] },
    { out: STONEBRICK, n: 4, shape: ['ss', 'ss'], key: { s: STONE } },
    { out: SANDSTONE, n: 2, shape: ['xx', 'xx'], key: { x: SAND } },
    { out: BRICK, n: 2, shapeless: [DIRT, DIRT, DIRT, SAND] },
    { out: COOKED, n: 1, shapeless: [BEEF] },
    { out: COOKED, n: 1, shapeless: [PORK] },
    { out: COOKED, n: 1, shapeless: [MUTTON] },
    { out: COOKED, n: 1, shapeless: [CHICKEN] },
    { out: FLINT, n: 1, shapeless: [GRAVEL, COBBLE] },
    { out: DYNAMITE, n: 3, shape: ['g', 'g', 's'], key: { g: GUNPOWDER, s: STRING } },
    { out: DYNAMITE, n: 2, shape: ['g', 'g', 'w'], key: { g: GUNPOWDER, w: WOOL } },
    { out: TNT, n: 1, shape: ['gsg', 'sgs', 'gsg'], key: { g: GUNPOWDER, s: SAND } },
    { out: 120, n: 1, shapeless: [GOLD, LEATHER] },
    { out: 121, n: 1, shapeless: [GOLD, PORK] },
    { out: 122, n: 1, shapeless: [GOLD, WOOL] },
    { out: 123, n: 1, shapeless: [GOLD, FEATHER] },
    { out: 124, n: 1, shapeless: [GOLD, EMERALD] },
    { out: 125, n: 1, shapeless: [GOLD, BEEF] },
    { out: 126, n: 1, shapeless: [GOLD, GUNPOWDER, GUNPOWDER] },
    { out: 127, n: 1, shapeless: [GOLD, BONE] },
    { out: 128, n: 1, shapeless: [GOLD, STRING] },
    { out: 129, n: 1, shapeless: [GOLD, EMERALD, BONE] },
    { out: 142, n: 1, shapeless: [GOLD, EMERALD, LEATHER] },
    { out: BED, n: 1, shape: ['www', 'ppp'], key: { w: WOOL, p: PLANKS } }
  ];
  TOOL_TIERS.forEach((_tier, ti) => {
    const mat = [PLANKS, COBBLE, EMERALD, IRON_INGOT, DIAMOND][ti];
    [['mmm', '.s.', '.s.'], ['mm', 'ms', '.s'], ['m', 's', 's'], ['m', 'm', 's']].forEach(function (shape, ki) {
      RECIPES.push({ out: toolId(ti, ki), n: 1, shape: shape, key: { m: mat, s: STICK } });
    });
  });
  [[IRON_BLOCK, IRON_INGOT], [COPPER_BLOCK, COPPER_INGOT], [DIAMOND_BLOCK, DIAMOND]].forEach(pr => {
    RECIPES.push({ out: pr[0], n: 1, shape: ['iii', 'iii', 'iii'], key: { i: pr[1] } });
    RECIPES.push({ out: pr[1], n: 9, shapeless: [pr[0]] });
  });
  RECIPES.push(
    { out: IRON_INGOT, n: 1, shapeless: [RAW_IRON, COAL] },       // "smelting": raw ore plus coal for fuel
    { out: COPPER_INGOT, n: 1, shapeless: [RAW_COPPER, COAL] },
    { out: TORCH, n: 4, shape: ['c', 's'], key: { c: COAL, s: STICK } },
    { out: 153, n: 1, shapeless: [GOLD, IRON_INGOT] },
    { out: 154, n: 1, shapeless: [GOLD, COPPER_INGOT] },
    { out: 155, n: 1, shapeless: [GOLD, DIAMOND] }
  );
  return RECIPES;
}
