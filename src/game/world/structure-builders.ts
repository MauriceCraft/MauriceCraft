import { hash2 } from './noise';
import type { GeneratedStructure } from './structure-regions';

export type PlaceBlock = (x: number, y: number, z: number, block: number) => void;
export type WriteBlock = (x: number, y: number, z: number, block: number, onlyAir: boolean) => void;
type MapXZ = (u: number, v: number) => [number, number];
export type StructureBlockIds = Record<'BRICK' | 'COBBLE' | 'CTABLE' | 'DIRT' | 'GOLD' | 'GRAVEL' | 'HAY' | 'LEAVES' | 'MOSSY' | 'PLANKS' | 'SANDSTONE' | 'STONEBRICK' | 'TORCH' | 'WOOD', number>;

/** Stable seeded geometry for villages, temples, towers, dungeons and cabins. */
export function createStructureBuilders(getSeed: () => number, blocks: StructureBlockIds,
  getGeneratorVersion: () => number = () => 1) {
  const { BRICK, COBBLE, CTABLE, DIRT, GOLD, GRAVEL, HAY, LEAVES, MOSSY, PLANKS, SANDSTONE, STONEBRICK, TORCH, WOOD } = blocks;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function eachXZ(x0: number, z0: number, a1: number, b1: number, a2: number, b2: number, fn: (x: number, z: number) => void): void {
    for (let x = Math.max(a1, x0); x <= Math.min(a2, x0 + 15); x++) for (let z = Math.max(b1, z0); z <= Math.min(b2, z0 + 15); z++) fn(x, z);
  }
  function clearAbove(P: PlaceBlock, st: GeneratedStructure, x0: number, z0: number, rad: number, h: number): void {
    eachXZ(x0, z0, st.cx - rad, st.cz - rad, st.cx + rad, st.cz + rad, function (x, z) {
      if (Math.hypot(x - st.cx, z - st.cz) > rad) return;
      for (let y = st.gy + 1; y <= st.gy + h; y++) P(x, y, z, 0);
    });
  }
  // A small house: map(u, v) gives world x,z. u runs along the roof ridge, v from the front door to the back wall.
  function buildHouse(P: PlaceBlock, map: MapXZ, gy: number, w: number, d: number, style: number): void {
    const wall = style === 1 ? COBBLE : PLANKS, roof = [PLANKS, COBBLE, BRICK][style % 3];
    const mu = Math.floor(w / 2), mv = Math.floor(d / 2);
    for (let u = 0; u < w; u++) {
      for (let v = 0; v < d; v++) {
        const m = map(u, v), x = m[0], z = m[1];
        P(x, gy, z, PLANKS);
        const edge = u === 0 || u === w - 1 || v === 0 || v === d - 1;
        const corner = (u === 0 || u === w - 1) && (v === 0 || v === d - 1);
        for (let y = 1; y <= 3; y++) {
          let b = 0;
          if (edge) {
            b = corner ? WOOD : wall;
            if (v === 0 && u === mu && y <= 2) b = 0;
            if (y === 2 && (u === 0 || u === w - 1) && v === mv) b = 0;
            if (y === 2 && v === d - 1 && u === mu) b = 0;
          }
          P(x, gy + y, z, b);
        }
        for (let L = 0; L <= Math.floor((d - 1) / 2); L++) if (v >= L && v <= d - 1 - L) P(x, gy + 4 + L, z, roof);
      }
    }
    const tm = map(1, 1); P(tm[0], gy + 1, tm[1], TORCH);
    if (w >= 5) { const tb = map(w - 2, 1); P(tb[0], gy + 1, tb[1], CTABLE); }
    {
      const bf = map(1, d - 2), bh = map(2, d - 2), ddx = bh[0] - bf[0], ddz = bh[1] - bf[1];
      const bdir = ddx > 0 ? 0 : (ddx < 0 ? 2 : (ddz > 0 ? 1 : 3));
      P(bf[0], gy + 1, bf[1], 19 + bdir * 2); P(bh[0], gy + 1, bh[1], 19 + bdir * 2 + 1);
    }
  }
  function buildFarm(P: PlaceBlock, map: MapXZ, gy: number, w: number, d: number): void {
    for (let u = 0; u < w; u++) {
      for (let v = 0; v < d; v++) {
        const m = map(u, v), x = m[0], z = m[1];
        P(x, gy, z, DIRT);
        if (v % 2 === 1) P(x, gy + 1, z, LEAVES);
        if ((u === 0 || u === w - 1) && (v === 0 || v === d - 1)) { P(x, gy + 1, z, WOOD); P(x, gy + 2, z, WOOD); }
      }
    }
    const a = map(1, d), b = map(2, d);
    P(a[0], gy + 1, a[1], HAY); P(a[0], gy + 2, a[1], HAY); P(b[0], gy + 1, b[1], HAY);
  }
  function buildBellTower(P: PlaceBlock, map: MapXZ, gy: number): void {
    for (let u = 0; u < 5; u++) {
      for (let v = 0; v < 5; v++) {
        const m = map(u, v), x = m[0], z = m[1];
        const edge = u === 0 || u === 4 || v === 0 || v === 4, corner = (u === 0 || u === 4) && (v === 0 || v === 4);
        P(x, gy, z, COBBLE);
        for (let y = 1; y <= 7; y++) {
          let b = 0;
          if (edge) {
            b = corner ? WOOD : STONEBRICK;
            if (v === 0 && u === 2 && y <= 2) b = 0;
            if (y === 5 && ((u === 0 || u === 4) && v === 2 || v === 4 && u === 2)) b = 0;
          }
          P(x, gy + y, z, b);
        }
        for (let L = 0; L <= 2; L++) if (u >= L && u <= 4 - L && v >= L && v <= 4 - L) P(x, gy + 8 + L, z, BRICK);
      }
    }
    const c = map(2, 2); P(c[0], gy + 11, c[1], GOLD);
  }
  /** V2 settlements have variable street lengths, orientations, and plot counts. */
  function buildVariedVillage(P: PlaceBlock, st: GeneratedStructure, x0: number, z0: number): void {
    const { cx, cz, gy } = st;
    clearAbove(P, st, x0, z0, st.pad, 14);
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
      P(cx + dx, gy, cz + dz, Math.abs(dx) <= 1 && Math.abs(dz) <= 1 ? COBBLE : GRAVEL);
    }
    // Central market well and beacon are stable, but streets and plots are not.
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const border = Math.abs(dx) === 1 || Math.abs(dz) === 1;
      if (border) P(cx + dx, gy + 1, cz + dz, COBBLE);
      else for (let y = gy - 3; y <= gy + 1; y++) P(cx, y, cz, 0);
    }
    for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      for (let y = gy + 2; y <= gy + 3; y++) P(cx + dx, y, cz + dz, WOOD);
      P(cx + dx, gy + 4, cz + dz, PLANKS);
    }
    P(cx, gy + 5, cz, TORCH);
    const seed = getSeed();
    for (let a = 0; a < 4; a++) {
      const roll = hash2(st.rx * 5 + a, st.rz, seed + 1610);
      if (roll < 0.20) continue; // Some villages have only two or three streets.
      const [dx, dz] = DIRS[a], px = -dz, pz = dx;
      const reach = 10 + Math.floor(hash2(st.rx * 5 + a, st.rz, seed + 1611) * 9);
      const shift = Math.floor(hash2(st.rx * 5 + a, st.rz, seed + 1612) * 3) - 1;
      for (let step = 3; step <= reach; step++) {
        for (let side = -1; side <= 1; side++)
          P(cx + dx * step + px * (side + shift), gy, cz + dz * step + pz * (side + shift), GRAVEL);
      }
      for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
        const side = sideIndex ? 1 : -1;
        const k = st.rx * 91 + st.rz * 37 + a * 2 + sideIndex;
        if (hash2(k, a, seed + 1613) < 0.30) continue;
        const along = 6 + Math.floor(hash2(k, a, seed + 1614) * 4);
        const width = hash2(k, a, seed + 1615) > 0.63 ? 7 : 5;
        const style = Math.floor(hash2(k, a, seed + 1616) * 3);
        const building = hash2(k, a, seed + 1617);
        const map: MapXZ = (u, v) => [
          cx + dx * (along + u) + px * (shift + side * (3 + v)),
          cz + dz * (along + u) + pz * (shift + side * (3 + v)),
        ];
        if (building < 0.58) buildHouse(P, map, gy, width, 5, style);
        else if (building < 0.89) buildFarm(P, map, gy, 7, 6);
        else buildBellTower(P, map, gy);
      }
      const endX = cx + dx * reach + px * shift, endZ = cz + dz * reach + pz * shift;
      P(endX, gy + 1, endZ, WOOD);
      P(endX, gy + 2, endZ, TORCH);
    }
  }

  function buildVillage(P: PlaceBlock, st: GeneratedStructure, x0: number, z0: number): void {
    const cx = st.cx, cz = st.cz, gy = st.gy;
    clearAbove(P, st, x0, z0, st.pad, 14);
    eachXZ(x0, z0, cx - 18, cz, cx + 18, cz, function (x, z) { if (Math.abs(x - cx) > 1) P(x, gy, z, GRAVEL); });
    eachXZ(x0, z0, cx, cz - 18, cx, cz + 18, function (x, z) { if (Math.abs(z - cz) > 1) P(x, gy, z, GRAVEL); });
    // well in the middle
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const x = cx + dx, z = cz + dz, ring = dx !== 0 || dz !== 0, corner = dx !== 0 && dz !== 0;
      P(x, gy, z, COBBLE);
      if (ring) P(x, gy + 1, z, corner ? WOOD : COBBLE);
      if (corner) { P(x, gy + 2, z, WOOD); P(x, gy + 3, z, WOOD); }
      P(x, gy + 4, z, PLANKS);
    }
    for (let k = 0; k <= 3; k++) P(cx, gy - k, cz, 0);
    P(cx, gy - 4, cz, COBBLE);
    P(cx, gy + 5, cz, TORCH);
    [[14, 1], [-14, -1], [1, 14], [-1, -14]].forEach(function (o) {
      P(cx + o[0], gy + 1, cz + o[1], WOOD); P(cx + o[0], gy + 2, cz + o[1], WOOD); P(cx + o[0], gy + 3, cz + o[1], TORCH);
    });
    // buildings along the four roads
    for (let a = 0; a < 4; a++) {
      for (let si = 0; si < 2; si++) {
        const sg = si === 0 ? -1 : 1, key = st.rx * 8 + a * 2 + si;
        if (hash2(key, st.rz, getSeed() + 601) > 0.74) continue;
        const kind = hash2(key, st.rz, getSeed() + 602), style = Math.floor(hash2(key, st.rz, getSeed() + 603) * 3);
        const dd = DIRS[a], px = -dd[1], pz = dd[0], tA = 9;
        const map: MapXZ = function (u: number, v: number) { return [cx + dd[0] * (tA + u) + px * sg * (2 + v), cz + dd[1] * (tA + u) + pz * sg * (2 + v)]; };
        if (kind < 0.48) buildHouse(P, map, gy, 5, 5, style);
        else if (kind < 0.66) buildHouse(P, map, gy, 7, 5, style);
        else if (kind < 0.88) buildFarm(P, map, gy, 7, 6);
        else buildBellTower(P, map, gy);
      }
    }
  }
  function buildTemple(P: PlaceBlock, st: GeneratedStructure, x0: number, z0: number): void {
    const cx = st.cx, cz = st.cz, gy = st.gy;
    clearAbove(P, st, x0, z0, st.pad, 16);
    eachXZ(x0, z0, cx - 10, cz - 10, cx + 10, cz + 10, function (x, z) { for (let y = gy - 4; y <= gy; y++) P(x, y, z, SANDSTONE); });
    for (let L = 0; L < 10; L++) {
      const half = 10 - L, y = gy + 1 + L;
      eachXZ(x0, z0, cx - half, cz - half, cx + half, cz + half, function (x, z) {
        const rim = Math.abs(x - cx) === half || Math.abs(z - cz) === half;
        P(x, y, z, (L === 3 && rim && ((x + z) & 1) === 0) ? BRICK : SANDSTONE);
      });
    }
    eachXZ(x0, z0, cx - 3, cz - 3, cx + 3, cz + 3, function (x, z) { for (let y = gy + 1; y <= gy + 4; y++) P(x, y, z, 0); });
    eachXZ(x0, z0, cx - 1, cz - 10, cx + 1, cz - 3, function (x, z) { for (let y = gy + 1; y <= gy + 2; y++) P(x, y, z, 0); });
    P(cx, gy + 1, cz, BRICK); P(cx, gy + 2, cz, GOLD);
    [[-2, -2], [2, -2], [-2, 2], [2, 2]].forEach(function (o) { for (let y = gy + 1; y <= gy + 4; y++) P(cx + o[0], y, cz + o[1], SANDSTONE); });
  }
  function buildRuinTower(P: PlaceBlock, st: GeneratedStructure, x0: number, z0: number): void {
    const gy = st.gy, bx = st.cx - 3, bz = st.cz - 3;
    clearAbove(P, st, x0, z0, 6, 16);
    for (let u = 0; u < 7; u++) {
      for (let v = 0; v < 7; v++) {
        const x = bx + u, z = bz + v;
        const edge = u === 0 || u === 6 || v === 0 || v === 6, corner = (u === 0 || u === 6) && (v === 0 || v === 6);
        P(x, gy, z, COBBLE);
        if (edge) {
          const top = (corner ? 13 : 13 - Math.floor(hash2(x, z, getSeed() + 710) * 7));
          for (let y = 1; y <= top; y++) {
            let b = hash2(x, z + y * 31, getSeed() + 711) < 0.35 ? MOSSY : STONEBRICK;
            if (v === 0 && u === 3 && y <= 2) b = 0;
            if ((y === 6 || y === 10) && !corner && ((u === 3 && (v === 0 || v === 6)) || (v === 3 && (u === 0 || u === 6)))) b = 0;
            if (b) P(x, gy + y, z, b);
          }
        } else {
          for (const fy of [5, 9]) if (hash2(x, z + fy, getSeed() + 712) < 0.7) P(x, gy + fy, z, PLANKS);
        }
      }
    }
  }
  function buildCabin(P: PlaceBlock, st: GeneratedStructure, x0: number, z0: number): void {
    const gy = st.gy;
    clearAbove(P, st, x0, z0, 8, 10);
    buildHouse(P, function (u, v) { return [st.cx - 3 + u, st.cz - 2 + v]; }, gy, 7, 5, Math.floor(hash2(st.rx, st.rz, getSeed() + 720) * 3));
    P(st.cx + 5, gy + 1, st.cz - 2, HAY); P(st.cx + 5, gy + 2, st.cz - 2, HAY); P(st.cx + 5, gy + 1, st.cz - 1, HAY);
    P(st.cx - 5, gy + 1, st.cz - 3, WOOD); P(st.cx - 5, gy + 2, st.cz - 3, WOOD);
  }
  function buildCircle(P: PlaceBlock, st: GeneratedStructure, x0: number, z0: number): void {
    const gy = st.gy, cx = st.cx, cz = st.cz;
    clearAbove(P, st, x0, z0, 8, 8);
    eachXZ(x0, z0, cx - 7, cz - 7, cx + 7, cz + 7, function (x, z) {
      if (Math.hypot(x - cx, z - cz) <= 6.5 && hash2(x, z, getSeed() + 730) < 0.55) P(x, gy, z, GRAVEL);
    });
    for (let k = 0; k < 8; k++) {
      const px = Math.round(cx + Math.cos(k * Math.PI / 4) * 5), pz = Math.round(cz + Math.sin(k * Math.PI / 4) * 5);
      let ph = 3 + Math.floor(hash2(px, pz, getSeed() + 731) * 3);
      if (hash2(px, pz, getSeed() + 732) < 0.25) ph = 1;
      for (let y = 1; y <= ph; y++) P(px, gy + y, pz, hash2(px, pz + y, getSeed() + 733) < 0.4 ? MOSSY : STONEBRICK);
    }
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) P(cx + dx, gy + 1, cz + dz, STONEBRICK);
    P(cx, gy + 2, cz, GOLD);
  }
  // Underground room with a stairway down from the surface
  function buildDungeon(P: PlaceBlock, st: GeneratedStructure): void {
    const gy = st.gy, x0 = st.cx, z0 = st.cz;
    const mix = function (x: number, y: number, z: number): number { return hash2(x, y * 7 + z, getSeed() + 740) < 0.45 ? MOSSY : COBBLE; };
    for (let x = x0 + 9; x <= x0 + 17; x++) for (let z = z0 - 4; z <= z0 + 4; z++) for (let y = gy - 10; y <= gy - 5; y++) P(x, y, z, mix(x, y, z));
    for (let i = 0; i <= 9; i++) {
      const x = x0 + i, fy = gy - i - 1;
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dz) === 2) { for (let y = fy + 1; y <= fy + 3; y++) P(x, y, z0 + dz, mix(x, y, z0 + dz)); }
        else {
          P(x, fy, z0 + dz, mix(x, fy, z0 + dz));
          for (let y = fy + 1; y <= fy + 3; y++) P(x, y, z0 + dz, 0);
          if (i >= 2) P(x, fy + 4, z0 + dz, mix(x, fy + 4, z0 + dz));
        }
      }
    }
    for (let dz = -2; dz <= 2; dz++) P(x0, gy + 4, z0 + dz, MOSSY);
    for (const dz of [-2, 2]) for (let y = gy + 1; y <= gy + 3; y++) P(x0, y, z0 + dz, MOSSY);
    for (let x = x0 + 10; x <= x0 + 16; x++) for (let z = z0 - 3; z <= z0 + 3; z++) for (let y = gy - 9; y <= gy - 6; y++) P(x, y, z, 0);
    for (let dz = -1; dz <= 1; dz++) for (let y = gy - 9; y <= gy - 7; y++) P(x0 + 9, y, z0 + dz, 0);
    P(x0 + 13, gy - 9, z0, STONEBRICK); P(x0 + 13, gy - 8, z0, GOLD);
    P(x0 + 11, gy - 6, z0 - 2, TORCH); P(x0 + 11, gy - 6, z0 + 2, TORCH);
    [[11, -2], [11, 2], [15, -2], [15, 2]].forEach(function (o) { for (let y = gy - 9; y <= gy - 7; y++) P(x0 + o[0], y, z0 + o[1], STONEBRICK); });
  }
  function buildStructure(st: GeneratedStructure, put: WriteBlock, x0: number, z0: number): void {
    const P: PlaceBlock = function (x: number, y: number, z: number, b: number) { put(x, y, z, b, false); };
    switch (st.type) {
      case 'village':
        if (getGeneratorVersion() >= 2) buildVariedVillage(P, st, x0, z0);
        else buildVillage(P, st, x0, z0);
        break;
      case 'temple': buildTemple(P, st, x0, z0); break;
      case 'tower': buildRuinTower(P, st, x0, z0); break;
      case 'dungeon': buildDungeon(P, st); break;
      case 'cabin': buildCabin(P, st, x0, z0); break;
      case 'circle': buildCircle(P, st, x0, z0); break;
    }
  }
  return { buildStructure };
}
