import { hash2 } from './noise';
import { biomeAt, biomeHeightAt } from './biomes';

export interface Volcano { x: number; z: number; base: number; radius: number; lavaLevel: number }
const CELL = 176;
const cache = new Map<string, Volcano | null>();
/** Seeded cone catalog: only entries here may be labeled a volcano in the HUD. */
export function volcanoFor(rx: number, rz: number, seed: number, worldHeight = 48): Volcano | null {
  const key = seed + ':' + worldHeight + ':' + rx + ':' + rz;
  if (cache.has(key)) return cache.get(key) ?? null;
  const x = rx * CELL + 63 + Math.floor(hash2(rx, rz, seed + 4011) * 50);
  const z = rz * CELL + 63 + Math.floor(hash2(rx, rz, seed + 4012) * 50);
  const biome = biomeAt(x, z, seed), roll = hash2(rx, rz, seed + 4010);
  if (!((biome === 'volcanic' && roll < 0.85) ||
    (biome === 'highlands' && roll < 0.30) ||
    (biome === 'badlands' && roll < 0.07))) {
    cache.set(key, null);
    return null;
  }
  const base = biomeHeightAt(x, z, seed, worldHeight);
  const result = base >= 12 && base <= worldHeight - 20
    ? { x, z, base, radius: 22 + Math.floor(hash2(rx, rz, seed + 4013) * 7), lavaLevel: base + 8 }
    : null;
  if (cache.size > 512) cache.clear();
  cache.set(key, result);
  return result;
}
export function volcanoNear(x: number, z: number, seed: number, h = 48): Volcano | null {
  return volcanoFor(Math.floor(x / CELL), Math.floor(z / CELL), seed, h);
}
export function volcanoHeightAt(x: number, z: number, seed: number, baseHeight: number, h = 48): number {
  const volcano = volcanoNear(x, z, seed, h);
  if (!volcano) return baseHeight;
  const d = Math.hypot(x - volcano.x, z - volcano.z);
  if (d > volcano.radius) return baseHeight;
  return Math.min(h - 5, Math.max(3, Math.round(baseHeight +
    (1 - d / volcano.radius) * 15 - Math.max(0, 1 - d / 4) * 11)));
}
export function volcanoCraterAt(x: number, z: number, seed: number, h = 48):
  { floor: number; level: number } | null {
  const v = volcanoNear(x, z, seed, h);
  if (!v || Math.hypot(x - v.x, z - v.z) > 3.35) return null;
  const floor = volcanoHeightAt(x, z, seed, biomeHeightAt(x, z, seed, h), h);
  return floor < v.lavaLevel ? { floor, level: v.lavaLevel } : null;
}
export function nearestVolcano(x: number, z: number, seed: number, h = 48, radius = 300):
  { feature: Volcano; distance: number } | null {
  const rx = Math.floor(x / CELL), rz = Math.floor(z / CELL);
  let result: { feature: Volcano; distance: number } | null = null;
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const v = volcanoFor(rx + dx, rz + dz, seed, h);
    if (!v) continue;
    const distance = Math.round(Math.hypot(x - v.x, z - v.z));
    if (distance <= radius && (!result || result.distance > distance)) result = { feature: v, distance };
  }
  return result;
}
