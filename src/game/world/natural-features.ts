import { hash2, fbm } from './noise';
import type { Biome } from './biomes';
import type { WriteBlock } from './structure-builders';

export type NaturalLiquid = 'water' | 'lava';
export interface LakeColumn { bottom: number; surface: number; liquid: NaturalLiquid }
interface Lake { x: number; z: number; rx: number; rz: number; level: number; liquid: NaturalLiquid }
interface Cascade { x: number; z: number; dx: number; dz: number; high: number; low: number; liquid: NaturalLiquid }

export interface NaturalFeatureDependencies {
  getSeed: () => number;
  biomeAt: (x: number, z: number) => Biome;
  heightAt: (x: number, z: number) => number;
  inStructureZone: (x: number, z: number) => boolean;
  seaLevel: number;
  maxHeight: number;
  waterBlock: number;
  lavaBlock: number;
}

/** Region-anchored liquid features require no communication between chunks. */
export function createNaturalFeatures(deps: NaturalFeatureDependencies) {
  const LAKE_CELL = 96, FALL_CELL = 112;
  const { getSeed, biomeAt, heightAt, inStructureZone } = deps;
  const lakeCache = new Map<string, Lake | null>();
  let cachedSeed: number | null = null;

  function lakeFor(rx: number, rz: number): Lake | null {
    const seed = getSeed();
    if (cachedSeed !== seed) { lakeCache.clear(); cachedSeed = seed; }
    const key = rx + ',' + rz;
    if (lakeCache.has(key)) return lakeCache.get(key) ?? null;
    const result = makeLake(rx, rz, seed);
    // Bounds memory use while exploring very long distances.
    if (lakeCache.size > 512) lakeCache.clear();
    lakeCache.set(key, result);
    return result;
  }

  function makeLake(rx: number, rz: number, seed: number): Lake | null {
    const roll = hash2(rx, rz, seed + 2110);
    if (roll > 0.34) return null;
    const x = rx * LAKE_CELL + 20 + Math.floor(hash2(rx, rz, seed + 2111) * 56);
    const z = rz * LAKE_CELL + 20 + Math.floor(hash2(rx, rz, seed + 2112) * 56);
    if (inStructureZone(x, z)) return null;
    const h = heightAt(x, z);
    if (h < deps.seaLevel + 3 || h >= deps.maxHeight - 7) return null;
    const biome = biomeAt(x, z);
    const liquid: NaturalLiquid = (biome === 'volcanic' || (biome === 'badlands' && roll < 0.10)) &&
      Math.hypot(x, z) > 80 ? 'lava' : 'water';
    if (biome === 'desert' && roll > 0.09) return null;
    return {
      x, z, rx: 7 + Math.floor(hash2(rx, rz, seed + 2113) * 10),
      rz: 7 + Math.floor(hash2(rx, rz, seed + 2114) * 10),
      level: h - 1, liquid,
    };
  }

  /** Height of a carved lakebed plus the height/type of its liquid surface. */
  function lakeAt(x: number, z: number): LakeColumn | null {
    const lake = lakeFor(Math.floor(x / LAKE_CELL), Math.floor(z / LAKE_CELL));
    if (!lake || inStructureZone(x, z)) return null;
    const d = Math.hypot((x - lake.x) / lake.rx, (z - lake.z) / lake.rz);
    const shore = (fbm(x / 6, z / 6, getSeed() + 2115) - 0.5) * 0.16;
    if (d + shore >= 1) return null;
    const depth = 1 + Math.floor(Math.max(0, 1 - d) * 5);
    return { bottom: Math.min(heightAt(x, z), lake.level - depth),
      surface: lake.level, liquid: lake.liquid };
  }

  function cascadeFor(rx: number, rz: number): Cascade | null {
    const seed = getSeed();
    if (hash2(rx, rz, seed + 2150) > 0.42) return null;
    const x = rx * FALL_CELL + 24 + Math.floor(hash2(rx, rz, seed + 2151) * 64);
    const z = rz * FALL_CELL + 24 + Math.floor(hash2(rx, rz, seed + 2152) * 64);
    const high = heightAt(x, z);
    if (high < deps.seaLevel + 9 || high > deps.maxHeight - 4 || inStructureZone(x, z)) return null;
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
    let best: Cascade | null = null, largestDrop = 0;
    for (const [dx, dz] of directions) {
      const low = heightAt(x + dx * 7, z + dz * 7);
      const drop = high - low;
      if (drop < 5 || drop <= largestDrop) continue;
      if (inStructureZone(x + dx * 7, z + dz * 7)) continue;
      largestDrop = drop;
      const biome = biomeAt(x, z);
      best = { x, z, dx, dz, high, low,
        liquid: biome === 'volcanic' || (biome === 'badlands' &&
          hash2(rx, rz, seed + 2153) < 0.4) ? 'lava' : 'water' };
    }
    return best;
  }

  function decorateFalls(cx: number, cz: number, put: WriteBlock): void {
    const x0 = cx * 16, z0 = cz * 16;
    const rx0 = Math.floor((x0 - 8) / FALL_CELL), rx1 = Math.floor((x0 + 23) / FALL_CELL);
    const rz0 = Math.floor((z0 - 8) / FALL_CELL), rz1 = Math.floor((z0 + 23) / FALL_CELL);
    for (let rz = rz0; rz <= rz1; rz++) for (let rx = rx0; rx <= rx1; rx++) {
      const fall = cascadeFor(rx, rz);
      if (!fall) continue;
      const id = fall.liquid === 'water' ? deps.waterBlock : deps.lavaBlock;
      // The upper stream follows the hillside, ending in a vertical cascade.
      for (let step = 0; step <= 7; step++) {
        const wx = fall.x + fall.dx * step, wz = fall.z + fall.dz * step;
        const ground = heightAt(wx, wz);
        if (inStructureZone(wx, wz)) continue;
        put(wx, ground + 1, wz, id, false);
      }
      const endX = fall.x + fall.dx * 7, endZ = fall.z + fall.dz * 7;
      for (let y = fall.low + 1; y <= fall.high; y++) put(endX, y, endZ, id, false);
      // Small receiving pool rather than a free-floating single column.
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        if (dx * dx + dz * dz > 4) continue;
        const wx = endX + dx, wz = endZ + dz;
        if (!inStructureZone(wx, wz) && heightAt(wx, wz) <= fall.low + 1)
          put(wx, heightAt(wx, wz) + 1, wz, id, false);
      }
    }
  }

  return { lakeAt, decorateFalls, lakeFor, cascadeFor };
}
