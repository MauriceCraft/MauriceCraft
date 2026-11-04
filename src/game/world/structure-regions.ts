import { ckey } from './chunk-key';
import { hash2, smooth } from './noise';

export type StructureType = 'village' | 'temple' | 'tower' | 'dungeon' | 'cabin' | 'circle';
export interface GeneratedStructure {
  type: StructureType;
  cx: number; cz: number; gy: number;
  pad: number; blend: number; reach: number; zone: number;
  rx: number; rz: number;
}
export interface StructureRegionDependencies {
  heightAt: (x: number, z: number) => number;
  getSeed: () => number;
  getPlayer: () => { x: number; z: number };
  seaLevel: number;
  maxHeight: number;
}

/** The deterministic 80x80-region structure planner. Never change placement seeds lightly. */
export function createStructureRegions(deps: StructureRegionDependencies) {
  const { heightAt, getSeed, getPlayer } = deps;
  const SEA = deps.seaLevel, H = deps.maxHeight;
  // The world is split into 80x80 regions; each region can hold one structure that fits entirely inside it,
  // so every chunk only has to ask its own region what to build.
  const REG = 80;
  const structCache = new Map<number, GeneratedStructure | null>();
  const STRUCT_NAMES: Record<StructureType, string> = { village: 'Village', temple: 'Desert temple', tower: 'Ruined tower', dungeon: 'Old dungeon', cabin: 'Cabin', circle: 'Stone circle' };
  function structureFor(rx: number, rz: number): GeneratedStructure | null {
    const k = ckey(rx, rz);
    if (structCache.has(k)) return structCache.get(k) ?? null;
    const st = makeStructure(rx, rz);
    structCache.set(k, st);
    return st;
  }
  function sampleGround(cx: number, cz: number, rad: number): { spread: number; avg: number; min: number } {
    let mn = 999, mx = -999, sum = 0, n = 0;
    for (let a = 0; a <= 8; a++) {
      const x = a === 8 ? cx : Math.round(cx + Math.cos(a * Math.PI / 4) * rad);
      const z = a === 8 ? cz : Math.round(cz + Math.sin(a * Math.PI / 4) * rad);
      const h = heightAt(x, z);
      mn = Math.min(mn, h); mx = Math.max(mx, h); sum += h; n++;
    }
    return { spread: mx - mn, avg: Math.round(sum / n), min: mn };
  }
  function makeStructure(rx: number, rz: number): GeneratedStructure | null {
    const r = hash2(rx, rz, getSeed() + 500), jx = hash2(rx, rz, getSeed() + 501), jz = hash2(rx, rz, getSeed() + 502);
    const ox = rx * REG, oz = rz * REG;
    let st: (Omit<GeneratedStructure, 'rx' | 'rz' | 'zone'> & { zone?: number }) | null = null;
    if (r < 0.22) {
      const cx = ox + 28 + Math.floor(jx * 25), cz = oz + 28 + Math.floor(jz * 25), f = sampleGround(cx, cz, 16);
      if (f.min > SEA + 2 && f.spread <= 9) st = { type: 'village', cx: cx, cz: cz, gy: f.avg, pad: 20, blend: 8, reach: 22 };
    } else if (r < 0.30) {
      const cx = ox + 22 + Math.floor(jx * 37), cz = oz + 22 + Math.floor(jz * 37), f = sampleGround(cx, cz, 10);
      if (f.avg <= 30 && f.spread <= 9) st = { type: 'temple', cx: cx, cz: cz, gy: Math.max(f.avg, 5), pad: 15, blend: 6, reach: 16 };
    } else if (r < 0.40) {
      const cx = ox + 14 + Math.floor(jx * 53), cz = oz + 14 + Math.floor(jz * 53), f = sampleGround(cx, cz, 6);
      if (f.min > SEA + 1 && f.spread <= 8) st = { type: 'tower', cx: cx, cz: cz, gy: f.avg, pad: 7, blend: 5, reach: 8 };
    } else if (r < 0.50) {
      const cx = ox + 8 + Math.floor(jx * 52), cz = oz + 8 + Math.floor(jz * 64), gy = heightAt(cx, cz);
      if (gy >= 14 && gy <= H - 14) st = { type: 'dungeon', cx: cx, cz: cz, gy: gy, pad: 0, blend: 0, reach: 20, zone: 4 };
    } else if (r < 0.60) {
      const cx = ox + 14 + Math.floor(jx * 53), cz = oz + 14 + Math.floor(jz * 53), f = sampleGround(cx, cz, 6);
      if (f.min > SEA + 1 && f.spread <= 6) st = { type: 'cabin', cx: cx, cz: cz, gy: f.avg, pad: 8, blend: 5, reach: 10 };
    } else if (r < 0.68) {
      const cx = ox + 14 + Math.floor(jx * 53), cz = oz + 14 + Math.floor(jz * 53), f = sampleGround(cx, cz, 6);
      if (f.min > SEA + 1 && f.spread <= 7) st = { type: 'circle', cx: cx, cz: cz, gy: f.avg, pad: 8, blend: 5, reach: 9 };
    }
    if (!st) return null;
    const result: GeneratedStructure = {
      ...st, rx, rz, zone: st.zone ?? st.pad + st.blend + 2,
    };
    // Keep structures away from the original spawn area.
    return Math.hypot(result.cx, result.cz) < result.reach + 8 ? null : result;
  }
  function structAt(x: number, z: number): GeneratedStructure | null { return structureFor(Math.floor(x / REG), Math.floor(z / REG)); }
  function inStructZone(x: number, z: number): boolean { const st = structAt(x, z); return !!st && Math.hypot(x - st.cx, z - st.cz) <= st.zone; }
  // Terrain height, levelled and blended around structures so they sit on flat ground
  function groundH(x: number, z: number): number {
    const h0 = heightAt(x, z), st = structAt(x, z);
    if (!st || !st.pad) return h0;
    const d = Math.hypot(x - st.cx, z - st.cz);
    if (d <= st.pad) return st.gy;
    if (d < st.pad + st.blend) { const t = smooth((d - st.pad) / st.blend); return Math.round(st.gy + (h0 - st.gy) * t); }
    return h0;
  }
  function forceSand(x: number, z: number): boolean {
    const st = structAt(x, z);
    return !!st && st.type === 'temple' && Math.hypot(x - st.cx, z - st.cz) <= st.pad + st.blend * 0.5;
  }
  function nearestStructure(): string {
    const player = getPlayer();
    const prx = Math.floor(player.x / REG), prz = Math.floor(player.z / REG);
    let best: GeneratedStructure | null = null, bd = 1e9;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const st = structureFor(prx + dx, prz + dz);
      if (!st) continue;
      const d = Math.hypot(st.cx - player.x, st.cz - player.z);
      if (d < bd) { bd = d; best = st; }
    }
    return best ? STRUCT_NAMES[best.type] + ' ' + Math.round(bd) + ' m' : 'nothing close';
  }
  return { REG, STRUCT_NAMES, structCache, structureFor, structAt, inStructZone,
    groundH, forceSand, nearestStructure };
}
