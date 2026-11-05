import { liquidKind, WATER_FLOW_START, LAVA_FLOW_START, WATER_REACH, LAVA_REACH } from './fluid-blocks';

/** Persistent IDs and item metadata. Never renumber items in an existing save. */
export function createBlockCatalog() {
  const GRASS = 1, DIRT = 2, STONE = 3, SAND = 4, WOOD = 5, LEAVES = 6, PLANKS = 7, BRICK = 8, COBBLE = 9;
  const STONEBRICK = 10, SANDSTONE = 11, GRAVEL = 12, HAY = 13, GOLD = 14, MOSSY = 15, TNT = 16, TORCH = 17, CTABLE = 18, BED = 19;
  const WATER = 34, LAVA = 35, OBSIDIAN = 36;
  const SNOW = 37, PINE_LEAVES = 38, RED_SAND = 39, DARK_WOOD = 40;
  const BIRCH_WOOD = 41, BIRCH_LEAVES = 42, ACACIA_WOOD = 43, ACACIA_LEAVES = 44;
  const WILLOW_WOOD = 45, WILLOW_LEAVES = 46, AUTUMN_LEAVES = 47, MUD = 48, FLOWERING_GRASS = 49;
  const COAL_ORE = 27, COPPER_ORE = 28, IRON_ORE = 29, DIAMOND_ORE = 30, IRON_BLOCK = 31, COPPER_BLOCK = 32, DIAMOND_BLOCK = 33;
  // Items (not placeable) start at 100
  const BEEF = 101, PORK = 102, MUTTON = 103, CHICKEN = 104, COOKED = 105, WOOL = 106, FEATHER = 107, LEATHER = 108, GUNPOWDER = 109, DYNAMITE = 110, FLINT = 111, EMERALD = 112, BONE = 113, STRING = 114, STICK = 115;
  const COAL = 116, RAW_COPPER = 117, RAW_IRON = 118, COPPER_INGOT = 119, IRON_INGOT = 151, DIAMOND = 152;
  const ITEM_TILE: Record<number, number> = { 101: 21, 102: 22, 103: 23, 104: 24, 105: 25, 106: 26, 107: 27, 108: 28, 109: 29, 110: 30, 111: 31, 112: 34, 113: 35, 114: 36, 115: 40, 19: 67, 116: 75, 117: 76, 118: 77, 119: 78, 151: 79, 152: 80, 120: 41, 121: 42, 122: 43, 123: 44, 124: 45, 125: 46, 126: 47, 127: 48, 128: 49 };
  // Spawn eggs: item id -> creature
  const EGG_KINDS: Record<number, string> = { 120: 'cow', 121: 'pig', 122: 'sheep', 123: 'chicken', 124: 'villager', 125: 'zombie', 126: 'creeper', 127: 'skeleton', 128: 'spider' };
  const FOOD: Record<number, number> = { 101: 3, 102: 3, 103: 3, 104: 2, 105: 8 };   // health restored
  const TILES: Record<number, number[]> = {
    1: [0, 1, 2], 2: [2, 2, 2], 3: [3, 3, 3], 4: [4, 4, 4], 5: [6, 5, 6],
    6: [7, 7, 7], 7: [8, 8, 8], 8: [9, 9, 9], 9: [10, 10, 10],
    10: [11, 11, 11], 11: [13, 12, 13], 12: [14, 14, 14], 13: [16, 15, 16], 14: [17, 17, 17], 15: [18, 18, 18], 16: [19, 20, 19], 17: [37, 37, 37], 18: [38, 39, 8], 34: [96, 96, 96], 35: [97, 97, 97], 36: [98, 98, 98], 37: [99, 99, 99], 38: [100, 100, 100],
    39: [101, 101, 101], 40: [103, 102, 103],
    41: [104, 105, 104], 42: [106, 106, 106], 43: [107, 108, 107],
    44: [109, 109, 109], 45: [110, 111, 110], 46: [112, 112, 112],
    47: [113, 113, 113], 48: [114, 114, 114], 49: [115, 116, 2],
    27: [68, 68, 68], 28: [69, 69, 69], 29: [70, 70, 70], 30: [71, 71, 71], 31: [72, 72, 72], 32: [73, 73, 73], 33: [74, 74, 74]
  };
  for (let n = 0; n < WATER_REACH; n++) TILES[WATER_FLOW_START + n] = [96, 96, 96];
  for (let n = 0; n < LAVA_REACH; n++) TILES[LAVA_FLOW_START + n] = [97, 97, 97];
  const tileOf = (b: number): number | undefined => TILES[b] ? TILES[b][1] : ITEM_TILE[b];
  const ATLAS_N = 128;   // tiles across the texture atlas
  // Torches are see-through and walk-through; everything else non-empty is solid
  const isBed = (b: number): boolean => b >= 19 && b <= 26;                        // 19 + facing * 2 + (head ? 1 : 0)
  const BED_H = 0.5625;                                         // beds are only a little over half a block tall
  const BED_DIR = [[1, 0], [0, 1], [-1, 0], [0, -1]];           // direction from the foot towards the head
  const solid = (b: number): boolean => b !== 0 && b !== TORCH && !liquidKind(b);
  const opq = (b: number): boolean => b !== 0 && b !== TORCH && !liquidKind(b) && !(b >= 19 && b <= 26);
  const NAMES: Record<number, string> = { 1: 'Grass', 2: 'Dirt', 3: 'Stone', 4: 'Sand', 5: 'Log', 6: 'Leaves', 7: 'Planks', 8: 'Brick', 9: 'Cobblestone', 10: 'Stone Brick', 11: 'Sandstone', 12: 'Gravel', 13: 'Hay Bale', 14: 'Gold Block', 15: 'Mossy Cobble', 16: 'TNT', 17: 'Torch', 18: 'Crafting Table', 19: 'Bed', 34: 'Water', 35: 'Lava', 36: 'Obsidian', 37: 'Snow', 38: 'Pine Leaves', 39: 'Red Sand', 40: 'Dark Wood', 41: 'Birch Log', 42: 'Birch Leaves', 43: 'Acacia Log',
    44: 'Acacia Leaves', 45: 'Willow Log', 46: 'Willow Leaves', 47: 'Autumn Leaves',
    48: 'Mud', 49: 'Flowering Grass', 27: 'Coal Ore', 28: 'Copper Ore', 29: 'Iron Ore', 30: 'Diamond Ore', 31: 'Iron Block', 32: 'Copper Block', 33: 'Diamond Block',
    101: 'Raw Beef', 102: 'Raw Pork', 103: 'Raw Mutton', 104: 'Raw Chicken', 105: 'Cooked Meat', 106: 'Wool', 107: 'Feather', 108: 'Leather', 109: 'Gunpowder', 110: 'Dynamite', 111: 'Flint & Steel', 112: 'Emerald', 113: 'Bone', 114: 'String', 115: 'Stick', 116: 'Coal', 117: 'Raw Copper', 118: 'Raw Iron', 119: 'Copper Ingot', 151: 'Iron Ingot', 152: 'Diamond',
    120: 'Cow Spawn Egg', 121: 'Pig Spawn Egg', 122: 'Sheep Spawn Egg', 123: 'Chicken Spawn Egg', 124: 'Villager Spawn Egg', 125: 'Zombie Spawn Egg', 126: 'Creeper Spawn Egg', 127: 'Skeleton Spawn Egg', 128: 'Spider Spawn Egg' };
  const ALL_BLOCKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 120, 121, 122, 123, 124, 125, 126, 127, 128];   // blocks first, then items (tools are appended below)
  // Survival: seconds to break, and what a block drops
  const BREAK_TIME: Record<number, number> = { 37: 0.25, 38: 0.25, 39: 0.5, 40: 1.3, 41: 1.3, 42: 0.25, 43: 1.3,
    44: 0.25, 45: 1.3, 46: 0.25, 47: 0.25, 48: 0.55, 49: 0.6, 36: 5.5, 1: 0.6, 2: 0.5, 3: 2.2, 4: 0.5, 5: 1.3, 6: 0.25, 7: 1.0, 8: 2.4, 9: 2.2, 10: 2.4, 11: 1.2, 12: 0.6, 13: 0.5, 14: 2.0, 15: 2.2, 16: 0.3, 17: 0.1, 18: 1.2 };
  for (let bi = 19; bi <= 26; bi++) BREAK_TIME[bi] = 0.4;
  Object.assign(BREAK_TIME, { 27: 2.6, 28: 3, 29: 3.2, 30: 4.2, 31: 4, 32: 3.5, 33: 5 });
  const DROPS: Record<number, number> = { 1: 2, 49: 2, 3: 9, 27: COAL, 28: RAW_COPPER, 29: RAW_IRON, 30: DIAMOND };
  // Tools. Tool ids run 130..141: tier * 4 + kind.
  const TOOL_KINDS = ['pickaxe', 'axe', 'shovel', 'sword'], TOOL_TIERS = ['Wooden', 'Stone', 'Emerald', 'Iron', 'Diamond'];
  const toolId = (ti: number, ki: number): number => ti < 3 ? 130 + ti * 4 + ki : 143 + (ti - 3) * 4 + ki;
  const toolTile = (ti: number, ki: number): number => ti < 3 ? 50 + ti * 4 + ki : 81 + (ti - 3) * 4 + ki;
  const TOOLS: Record<number, { kind: string; tier: number }> = {}, TOOL_IDS: number[] = [];
  TOOL_TIERS.forEach(function (tn, ti) {
    TOOL_KINDS.forEach(function (k, ki) {
      const id = toolId(ti, ki);
      TOOLS[id] = { kind: k, tier: ti }; TOOL_IDS.push(id);
      NAMES[id] = tn + ' ' + k[0].toUpperCase() + k.slice(1); ITEM_TILE[id] = toolTile(ti, ki);
    });
  });
  ALL_BLOCKS.push(...TOOL_IDS);
  EGG_KINDS[129] = 'pillager'; EGG_KINDS[142] = 'vindicator'; EGG_KINDS[153] = 'irongolem'; EGG_KINDS[154] = 'coppergolem'; EGG_KINDS[155] = 'diamondgolem';
  NAMES[129] = 'Pillager Spawn Egg'; NAMES[142] = 'Vindicator Spawn Egg'; NAMES[153] = 'Iron Golem Spawn Egg'; NAMES[154] = 'Copper Golem Spawn Egg'; NAMES[155] = 'Diamond Golem Spawn Egg';
  ITEM_TILE[129] = 64; ITEM_TILE[142] = 65; ITEM_TILE[153] = 89; ITEM_TILE[154] = 90; ITEM_TILE[155] = 91;
  ALL_BLOCKS.push(129, 142, 153, 154, 155);
  ALL_BLOCKS.push(27, 28, 29, 30, 31, 32, 33, 116, 117, 118, 119, 151, 152);   // ores, metal blocks, ore items
  const TOOL_MAX = [40, 90, 400, 250, 800];             // uses before a tool breaks
  const TOOL_LVL = [0, 1, 2, 2, 3];                     // mining level per tier
  const TOOL_SPD = [2.4, 4, 6.5, 5.5, 8];               // mining speed per tier
  const TOOL_DMG = { sword: [6, 8, 12, 9, 14], axe: [5, 7, 10, 8, 12], pickaxe: [4, 6, 8, 6, 9], shovel: [4, 5, 7, 5, 8] };
  // blocks that only drop with a pickaxe of at least this level
  const NEEDS_PICK: Record<number, number> = { 3: 0, 8: 0, 9: 0, 10: 0, 11: 0, 15: 0, 14: 1, 27: 0, 28: 1, 29: 1, 30: 2, 31: 1, 32: 1, 33: 2 };
  return {
    GRASS, DIRT, STONE, SAND, WOOD, LEAVES, PLANKS, BRICK,
    COBBLE, STONEBRICK, SANDSTONE, GRAVEL, HAY, GOLD, MOSSY, TNT,
    TORCH, CTABLE, BED, WATER, LAVA, OBSIDIAN, SNOW, PINE_LEAVES, RED_SAND, DARK_WOOD,
    BIRCH_WOOD, BIRCH_LEAVES, ACACIA_WOOD, ACACIA_LEAVES, WILLOW_WOOD,
    WILLOW_LEAVES, AUTUMN_LEAVES, MUD, FLOWERING_GRASS, COAL_ORE, COPPER_ORE,
    IRON_ORE, DIAMOND_ORE, IRON_BLOCK, COPPER_BLOCK, DIAMOND_BLOCK, BEEF, PORK, MUTTON,
    CHICKEN, COOKED, WOOL, FEATHER, LEATHER, GUNPOWDER, DYNAMITE, FLINT,
    EMERALD, BONE, STRING, STICK, COAL, RAW_COPPER, RAW_IRON, COPPER_INGOT,
    IRON_INGOT, DIAMOND, ITEM_TILE, EGG_KINDS, FOOD, TILES, tileOf, ATLAS_N,
    isBed, BED_H, BED_DIR, solid, opq, NAMES, ALL_BLOCKS, BREAK_TIME,
    DROPS, TOOL_KINDS, TOOL_TIERS, toolId, toolTile, TOOLS, TOOL_IDS, TOOL_MAX,
    TOOL_LVL, TOOL_SPD, TOOL_DMG, NEEDS_PICK,
  };
}
