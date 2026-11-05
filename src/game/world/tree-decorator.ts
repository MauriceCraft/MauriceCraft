import { hash2 } from './noise';
import type { Biome } from './biomes';
import type { WriteBlock } from './structure-builders';

export type TreeStyle = 'oak' | 'birch' | 'pine' | 'acacia' | 'willow' | 'ancient';

export function treeDensity(biome: Biome): number {
  const densities: Record<Biome, number> = {
    plains: 0.08, forest: 0.51, meadow: 0.035, savanna: 0.13,
    desert: 0, badlands: 0.005, marsh: 0.26, taiga: 0.40,
    tundra: 0.02, highlands: 0.06, volcanic: 0,
  };
  return densities[biome];
}

export function treeStyle(biome: Biome, roll: number): TreeStyle {
  if (biome === 'taiga' || biome === 'tundra') return 'pine';
  if (biome === 'savanna') return 'acacia';
  if (biome === 'marsh') return 'willow';
  if (biome === 'forest' && roll > 0.955) return 'ancient';
  if (biome === 'forest' && roll > 0.67) return 'pine';
  return roll > 0.38 ? 'oak' : 'birch';
}

export interface TreeDecoratorDependencies {
  getSeed: () => number;
  getBiome: (x: number, z: number) => Biome;
  groundHeight: (x: number, z: number) => number;
  canGrowAt: (x: number, z: number) => boolean;
  inStructureZone: (x: number, z: number) => boolean;
  seaLevel: number;
  maxHeight: number;
  blocks: { wood: number; leaves: number; darkWood: number; pineLeaves: number };
}

/** Tree origins use global jittered cells, never the current chunk's RNG. */
export function createTreeDecorator(deps: TreeDecoratorDependencies) {
  const CELL = 15;
  const { getSeed, getBiome, groundHeight, canGrowAt, inStructureZone } = deps;
  const { wood, leaves, darkWood, pineLeaves } = deps.blocks;

  function decorate(cx: number, cz: number, put: WriteBlock): void {
    const seed = getSeed(), x0 = cx * 16, z0 = cz * 16;
    const gx0 = Math.floor((x0 - 8) / CELL), gx1 = Math.floor((x0 + 23) / CELL);
    const gz0 = Math.floor((z0 - 8) / CELL), gz1 = Math.floor((z0 + 23) / CELL);
    for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
      const x = gx * CELL + 3 + Math.floor(hash2(gx, gz, seed + 1011) * 9);
      const z = gz * CELL + 3 + Math.floor(hash2(gx, gz, seed + 1012) * 9);
      const biome = getBiome(x, z);
      if (hash2(gx, gz, seed + 1010) >= treeDensity(biome)) continue;
      if (inStructureZone(x, z) || !canGrowAt(x, z)) continue;
      const ground = groundHeight(x, z);
      if (ground <= deps.seaLevel + 1 || ground > deps.maxHeight - 15) continue;
      const style = treeStyle(biome, hash2(gx, gz, seed + 1013));
      const growth = hash2(gx, gz, seed + 1014);
      const h = style === 'ancient' ? 8 + Math.floor(growth * 4) :
        style === 'pine' ? 6 + Math.floor(growth * 5) :
        style === 'birch' ? 5 + Math.floor(growth * 5) :
        style === 'oak' ? 4 + Math.floor(growth * 5) : 4 + Math.floor(growth * 3);
      const timber = style === 'pine' || style === 'ancient' ? darkWood : wood;
      const foliage = style === 'pine' ? pineLeaves : leaves;
      const trunkX = style === 'acacia' ? (hash2(gx, gz, seed + 1015) < 0.5 ? -2 : 2) : 0;
      for (let dy = 1; dy <= h; dy++) {
        const tx = style === 'acacia' && dy >= h - 1 ? x + trunkX : x;
        put(tx, ground + dy, z, timber, false);
        if (style === 'ancient') {
          put(tx + 1, ground + dy, z, timber, false);
          put(tx, ground + dy, z + 1, timber, false);
          put(tx + 1, ground + dy, z + 1, timber, false);
        }
      }
      if (style === 'pine') {
        for (let dy = 2; dy <= h + 1; dy++) {
          const r = dy >= h ? 1 : (dy % 3 === 0 ? 2 : 3);
          for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) > r ||
              (Math.abs(dx) === r && Math.abs(dz) === r)) continue;
            put(x + dx, ground + dy, z + dz, foliage, true);
          }
        }
      } else {
        const top = ground + h, originX = x + trunkX;
        const radius = style === 'ancient' ? 4 : (style === 'willow' ? 3 : 2);
        const vertical = style === 'acacia' ? 1 : 2;
        for (let dy = -vertical; dy <= (style === 'acacia' ? 0 : 2); dy++) {
          const r = style === 'acacia' ? 3 : radius - (Math.abs(dy) >= 2 ? 1 : 0);
          for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dz * dz > r * r + 1) continue;
            if (r > 2 && Math.abs(dx) === r && Math.abs(dz) === r) continue;
            put(originX + dx, top + dy, z + dz, foliage, true);
            if (style === 'willow' && Math.abs(dx) + Math.abs(dz) >= 3 &&
              hash2(originX + dx, z + dz, seed + 1016) > 0.43) {
              put(originX + dx, top + dy - 1, z + dz, leaves, true);
              put(originX + dx, top + dy - 2, z + dz, leaves, true);
            }
          }
        }
      }
    }
  }
  return decorate;
}
