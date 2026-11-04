import { fbm, hash2, mulberry32 } from './noise';
import type { GeneratedStructure } from './structure-regions';
import type { WriteBlock } from './structure-builders';

export type WorldDimension = 'overworld' | 'nether' | 'end';
export type TerrainBlockIds = Record<'BRICK' | 'COAL_ORE' | 'COPPER_ORE' | 'DIAMOND_ORE' | 'DIRT' | 'GOLD' | 'GRASS' | 'IRON_ORE' | 'LAVA' | 'LEAVES' | 'SAND' | 'SANDSTONE' | 'STONE' | 'STONEBRICK' | 'TORCH' | 'WATER' | 'WOOD', number>;
export interface ChunkGeneratorDependencies {
  getSeed: () => number;
  getDimension: () => WorldDimension;
  maxHeight: number;
  seaLevel: number;
  regionSize: number;
  groundH: (x: number, z: number) => number;
  heightAt: (x: number, z: number) => number;
  forceSand: (x: number, z: number) => boolean;
  inStructZone: (x: number, z: number) => boolean;
  structureFor: (rx: number, rz: number) => GeneratedStructure | null;
  buildStructure: (st: GeneratedStructure, put: WriteBlock, x0: number, z0: number) => void;
  blocks: TerrainBlockIds;
}

/**
 * Build deterministic terrain without mutating the chunk cache.
 * Existing seeds and stored block IDs must remain backward compatible.
 */
export function createChunkGenerator(deps: ChunkGeneratorDependencies) {
  const { getSeed, getDimension, groundH, heightAt, forceSand, inStructZone,
    structureFor, buildStructure } = deps;
  const { BRICK, COAL_ORE, COPPER_ORE, DIAMOND_ORE, DIRT, GOLD, GRASS, IRON_ORE, LAVA, LEAVES, SAND, SANDSTONE, STONE, STONEBRICK, TORCH, WATER, WOOD } = deps.blocks;
  const H = deps.maxHeight, SEA = deps.seaLevel, REG = deps.regionSize;
  function generateChunkData(cx: number, cz: number): Uint8Array {
    const seed = getSeed(), dimension = getDimension();
    const data = new Uint8Array(16 * H * 16);
    const x0 = cx * 16, z0 = cz * 16;
    // Separate Nether and End terrain generators. They reuse the game's block atlas,
    // but create distinct landscapes and keep the normal Overworld generator unchanged.
    if (dimension === 'nether' || dimension === 'end') {
      for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
        const wx = x0 + lx, wz = z0 + lz;
        const dist = Math.hypot(wx, wz);
        if (dimension === 'nether') {
          const floor = 8 + Math.floor(fbm(wx / 19, wz / 19, seed + 810) * 7);
          for (let y = 0; y <= floor; y++) {
            let b = y < 3 ? STONEBRICK : (y < floor - 1 ? BRICK : (y === floor ? BRICK : DIRT));
            if (y === floor && hash2(wx, wz, seed + 811) > 0.94) b = GOLD;
            data[(y * 16 + lz) * 16 + lx] = b;
          }
          // Hanging netherrack-like ceiling makes the dimension feel enclosed.
          const ceil = 39 + Math.floor(fbm(wx / 23, wz / 23, seed + 812) * 5);
          for (let y = ceil; y < H; y++) data[(y * 16 + lz) * 16 + lx] = (y === ceil ? BRICK : STONEBRICK);
          if (hash2(wx, wz, seed + 813) > 0.985) {
            for (let y = floor + 1; y < Math.min(ceil, floor + 5); y++) data[(y * 16 + lz) * 16 + lx] = 0;
          }
        } else {
          // The End is a floating central island surrounded by the void.
          const edge = 29 + fbm(wx / 12, wz / 12, seed + 820) * 7;
          if (dist < edge) {
            const top = 19 + Math.floor(fbm(wx / 10, wz / 10, seed + 821) * 3);
            for (let y = top - 5; y <= top; y++) {
              if (y >= 0) data[(y * 16 + lz) * 16 + lx] = y === top ? SANDSTONE : STONEBRICK;
            }
          }
          // Small distant floating islands
          const island = Math.hypot(wx - 48, wz + 24);
          if (island < 7 + fbm(wx / 5, wz / 5, seed + 822) * 2) {
            for (let y = 15; y <= 18; y++) data[(y * 16 + lz) * 16 + lx] = y === 18 ? SANDSTONE : STONEBRICK;
          }
        }
      }
      // Procedurally generate Nether structures inside this chunk so they stay
      // deterministic and do not pop in differently when neighbouring chunks load.
      if (dimension === 'nether') {
        const putNether = function (x: number, y: number, z: number, b: number): void {
          if (x < x0 || x >= x0 + 16 || z < z0 || z >= z0 + 16 || y < 0 || y >= H) return;
          data[(y * 16 + (z - z0)) * 16 + (x - x0)] = b;
        };
        const structureRoll = hash2(cx, cz, seed + 860);
        const sx = x0 + 3 + Math.floor(hash2(cx, cz, seed + 861) * 6);
        const sz = z0 + 3 + Math.floor(hash2(cx, cz, seed + 862) * 6);
        const baseY = 13 + Math.floor(fbm(sx / 19, sz / 19, seed + 810) * 7);
        if (structureRoll > 0.90) {
          // Nether fortress: a raised brick keep with towers, battlements and a bridge.
          for (let dx = 0; dx < 10; dx++) for (let dz = 0; dz < 10; dz++) {
            const edge = dx === 0 || dx === 9 || dz === 0 || dz === 9;
            putNether(sx + dx, baseY, sz + dz, BRICK);
            if (edge) for (let dy = 1; dy <= 4; dy++) {
              if (dy === 2 && (dx === 0 || dx === 9 || dz === 0 || dz === 9) && ((dx + dz) % 3 === 0)) continue;
              putNether(sx + dx, baseY + dy, sz + dz, BRICK);
            }
            if (dx % 3 === 0 && dz % 3 === 0) putNether(sx + dx, baseY + 5, sz + dz, STONEBRICK);
          }
          // Raised walkway and chunky support pillars.
          for (let dx = -3; dx <= 2; dx++) {
            for (let dz = 4; dz <= 5; dz++) putNether(sx + dx, baseY + 2, sz + dz, BRICK);
            for (let dy = -3; dy <= 1; dy++) putNether(sx + dx, baseY + dy, sz + 4, STONEBRICK);
          }
          putNether(sx + 4, baseY + 1, sz + 4, TORCH);
        } else if (structureRoll > 0.84) {
          // Bastion-like ruin: dark stonebrick courtyard, gold treasure pile and broken walls.
          for (let dx = 0; dx < 10; dx++) for (let dz = 0; dz < 9; dz++) {
            putNether(sx + dx, baseY, sz + dz, STONEBRICK);
            if ((dx === 0 || dx === 9 || dz === 0 || dz === 8) && hash2(sx + dx, sz + dz, seed + 863) > 0.16) {
              const wallH = 2 + Math.floor(hash2(dx, dz, seed + 864) * 3);
              for (let dy = 1; dy <= wallH; dy++) putNether(sx + dx, baseY + dy, sz + dz, STONEBRICK);
            }
          }
          for (let dx = 3; dx <= 6; dx++) for (let dz = 3; dz <= 5; dz++) putNether(sx + dx, baseY + 1, sz + dz, GOLD);
          for (let dy = 1; dy <= 4; dy++) {
            putNether(sx + 2, baseY + dy, sz + 2, BRICK);
            putNether(sx + 7, baseY + dy, sz + 6, BRICK);
          }
        }
      }
      return data;
    }
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const h = groundH(x0 + lx, z0 + lz), beach = h <= SEA + 1 || forceSand(x0 + lx, z0 + lz);
        for (let y = 0; y <= h; y++) {
          let b;
          if (y === h) b = beach ? SAND : GRASS;
          else if (y >= h - 3) b = beach ? SAND : DIRT;
          else b = STONE;
          data[(y * 16 + lz) * 16 + lx] = b;
        }
      }
    }
    // Fill low coastal areas with walk-through water up to sea level.
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const wx = x0 + lx, wz = z0 + lz, h = groundH(wx, wz);
      if (h < SEA && !inStructZone(wx, wz)) {
        for (let wy = h + 1; wy <= SEA; wy++) data[(wy * 16 + lz) * 16 + lx] = WATER;
      }
      // Small underground lava pockets, deterministic for each world seed.
      if (h > 7 && hash2(wx, wz, seed + 940) > 0.992) {
        const ly = 3 + Math.floor(hash2(wx, wz, seed + 941) * 3);
        const li = (ly * 16 + lz) * 16 + lx;
        if (data[li] === STONE) data[li] = LAVA;
      }
    }
    // Ore veins hide inside the stone: [ore, attempts per chunk, min y, max y, max vein size]
    const oreRng = mulberry32((Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ Math.imul(seed, 83492791)) >>> 0);
    [[COAL_ORE, 16, 4, 42, 8], [COPPER_ORE, 9, 3, 32, 6], [IRON_ORE, 9, 2, 30, 5], [DIAMOND_ORE, 2, 1, 12, 2]].forEach(function (o) {
      for (let a = 0; a < o[1]; a++) {
        let vx = Math.floor(oreRng() * 16), vz = Math.floor(oreRng() * 16), vy = o[2] + Math.floor(oreRng() * (o[3] - o[2] + 1));
        const size = 1 + Math.floor(oreRng() * o[4]);
        for (let k = 0; k < size; k++) {
          if (vx >= 0 && vx < 16 && vz >= 0 && vz < 16 && vy >= 1 && vy < H) { const i = (vy * 16 + vz) * 16 + vx; if (data[i] === STONE) data[i] = o[0]; }
          vx += Math.floor(oreRng() * 3) - 1; vy += Math.floor(oreRng() * 3) - 1; vz += Math.floor(oreRng() * 3) - 1;
        }
      }
    });
    const put: WriteBlock = function (x: number, y: number, z: number, b: number, onlyAir: boolean): void {
      if (x < x0 || x >= x0 + 16 || z < z0 || z >= z0 + 16 || y < 0 || y >= H) return;
      const i = (y * 16 + (z - z0)) * 16 + (x - x0);
      if (!onlyAir || data[i] === 0) data[i] = b;
    };
    // Trees come from a fixed grid, so every chunk agrees on them without talking to its neighbours
    const c0 = Math.floor((x0 - 3) / 7), c1 = Math.floor((x0 + 18) / 7);
    const d0 = Math.floor((z0 - 3) / 7), d1 = Math.floor((z0 + 18) / 7);
    for (let gz = d0; gz <= d1; gz++) {
      for (let gx = c0; gx <= c1; gx++) {
        if (hash2(gx, gz, seed + 7) > 0.55) continue;
        const tx = gx * 7 + 3 + Math.floor(hash2(gx, gz, seed + 8) * 3);
        const tz = gz * 7 + 3 + Math.floor(hash2(gx, gz, seed + 9) * 3);
        if (inStructZone(tx, tz)) continue;
        const gy = heightAt(tx, tz);
        if (gy <= SEA + 1) continue;
        const th = 4 + Math.floor(hash2(gx, gz, seed + 10) * 3);
        for (let k = 1; k <= th; k++) put(tx, gy + k, tz, WOOD, false);
        for (let dy = th - 2; dy <= th + 1; dy++) {
          const r = dy >= th ? 1 : 2;
          for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) === r && Math.abs(dz) === r && (r === 2 || dy === th + 1) && hash2(tx + dx, tz + dz + dy, seed) < 0.5) continue;
            put(tx + dx, gy + dy, tz + dz, LEAVES, true);
          }
        }
      }
    }
    const rs = structureFor(Math.floor(x0 / REG), Math.floor(z0 / REG));
    if (rs && Math.abs(rs.cx - (x0 + 8)) <= rs.reach + 8 && Math.abs(rs.cz - (z0 + 8)) <= rs.reach + 8) buildStructure(rs, put, x0, z0);
    return data;
  }
  return generateChunkData;
}
