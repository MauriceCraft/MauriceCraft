import { hash2, mulberry32 } from './noise';
import { biomeSurface } from './biomes';
import { createTreeDecorator } from './tree-decorator';
import { createNaturalFeatures } from './natural-features';
import type { Biome } from './biomes';
import type { ChunkGeneratorDependencies } from './chunk-generator';
import type { WriteBlock } from './structure-builders';

/** The v2 overworld generator. V1 remains untouched for pre-upgrade saves. */
export function createModernChunkGenerator(
  deps: ChunkGeneratorDependencies & { getBiome: (x: number, z: number) => Biome },
): (cx: number, cz: number) => Uint8Array {
  const { maxHeight: H, seaLevel: SEA, regionSize: REG, blocks, getSeed,
    groundH, inStructZone, forceSand, structureFor, buildStructure, getBiome } = deps;
  const natural = createNaturalFeatures({
    getSeed, biomeAt: getBiome, heightAt: deps.heightAt, inStructureZone: inStructZone,
    seaLevel: SEA, maxHeight: H, waterBlock: blocks.WATER, lavaBlock: blocks.LAVA,
  });
  const trees = createTreeDecorator({
    getSeed, getGeneratorVersion: deps.getGeneratorVersion, getBiome, groundHeight: groundH, canGrowAt: (x, z) => natural.lakeAt(x, z) === null,
    inStructureZone: inStructZone, seaLevel: SEA, maxHeight: H,
    blocks: {
      wood: blocks.WOOD, leaves: blocks.LEAVES,
      darkWood: blocks.DARK_WOOD ?? blocks.WOOD,
      pineLeaves: blocks.PINE_LEAVES ?? blocks.LEAVES,
      birchWood: blocks.BIRCH_WOOD, birchLeaves: blocks.BIRCH_LEAVES,
      acaciaWood: blocks.ACACIA_WOOD, acaciaLeaves: blocks.ACACIA_LEAVES,
      willowWood: blocks.WILLOW_WOOD, willowLeaves: blocks.WILLOW_LEAVES,
      autumnLeaves: blocks.AUTUMN_LEAVES,
    },
  });
  return function generateModernChunk(cx: number, cz: number): Uint8Array {
    const seed = getSeed(), x0 = cx * 16, z0 = cz * 16;
    const data = new Uint8Array(16 * H * 16);
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const x = x0 + lx, z = z0 + lz;
      const height = groundH(x, z);
      const lake = natural.lakeAt(x, z);
      const top = lake ? Math.max(1, lake.bottom) : height;
      const beach = height <= SEA + 1 || forceSand(x, z);
      const surface = biomeSurface(getBiome(x, z), height, SEA);
      const modernColors = (deps.getGeneratorVersion?.() ?? 2) >= 3;
      const topBlock = beach ? blocks.SAND :
        surface === 'snow' ? blocks.SNOW ?? blocks.GRASS :
        surface === 'red-sand' ? blocks.RED_SAND ?? blocks.SAND :
        surface === 'stone' ? blocks.STONE :
        surface === 'moss' ? (modernColors ? blocks.MUD ?? blocks.GRASS : blocks.GRASS) :
        surface === 'sand' ? blocks.SAND :
        modernColors && getBiome(x, z) === 'meadow' ? blocks.FLOWERING_GRASS ?? blocks.GRASS : blocks.GRASS;
      for (let y = 0; y <= top; y++) {
        const block = y === top ? topBlock :
          y >= top - 3 ? (topBlock === blocks.SAND || topBlock === blocks.RED_SAND ? topBlock : blocks.DIRT) :
          blocks.STONE;
        data[(y * 16 + lz) * 16 + lx] = block;
      }
      if (lake) {
        for (let y = top + 1; y <= Math.min(H - 1, lake.surface); y++)
          data[(y * 16 + lz) * 16 + lx] =
            lake.liquid === 'lava' ? blocks.LAVA : blocks.WATER;
      } else if (height < SEA && !inStructZone(x, z)) {
        for (let y = height + 1; y <= SEA; y++)
          data[(y * 16 + lz) * 16 + lx] = blocks.WATER;
      }
      // Rare underground magma pockets, never inside the surface.
      if (top > 8 && hash2(x, z, seed + 940) > 0.993) {
        const y = 3 + Math.floor(hash2(x, z, seed + 941) * 3);
        const i = (y * 16 + lz) * 16 + lx;
        if (data[i] === blocks.STONE) data[i] = blocks.LAVA;
      }
    }
    const ores = mulberry32((Math.imul(cx, 73856093) ^
      Math.imul(cz, 19349663) ^ Math.imul(seed, 83492791)) >>> 0);
    const recipes = [
      [blocks.COAL_ORE, 16, 4, 42, 8], [blocks.COPPER_ORE, 9, 3, 32, 6],
      [blocks.IRON_ORE, 9, 2, 30, 5], [blocks.DIAMOND_ORE, 2, 1, 12, 2],
    ];
    for (const [ore, attempts, minY, maxY, maxSize] of recipes)
      for (let a = 0; a < attempts; a++) {
        let x = Math.floor(ores() * 16), z = Math.floor(ores() * 16);
        let y = minY + Math.floor(ores() * (maxY - minY + 1));
        const size = 1 + Math.floor(ores() * maxSize);
        for (let j = 0; j < size; j++) {
          if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < H) {
            const i = (y * 16 + z) * 16 + x;
            if (data[i] === blocks.STONE) data[i] = ore;
          }
          x += Math.floor(ores() * 3) - 1;
          y += Math.floor(ores() * 3) - 1;
          z += Math.floor(ores() * 3) - 1;
        }
      }
    const put: WriteBlock = (x, y, z, block, onlyAir) => {
      if (x < x0 || x >= x0 + 16 || z < z0 || z >= z0 + 16 || y < 0 || y >= H) return;
      const i = (y * 16 + z - z0) * 16 + x - x0;
      if (!onlyAir || !data[i]) data[i] = block;
    };
    trees(cx, cz, put);
    natural.decorateFalls(cx, cz, put);
    const st = structureFor(Math.floor(x0 / REG), Math.floor(z0 / REG));
    if (st && Math.abs(st.cx - (x0 + 8)) <= st.reach + 8 &&
      Math.abs(st.cz - (z0 + 8)) <= st.reach + 8) buildStructure(st, put, x0, z0);
    return data;
  };
}
