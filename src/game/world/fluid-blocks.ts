/** Persisted liquid levels. Sources keep their original block IDs in saved worlds. */
export type LiquidKind = 'water' | 'lava';
export const WATER_SOURCE = 34;
export const LAVA_SOURCE = 35;
export const WATER_FLOW_START = 160;
export const LAVA_FLOW_START = 170;
export const WATER_REACH = 7;
export const LAVA_REACH = 4;

export function liquidKind(block: number): LiquidKind | null {
  if (block === WATER_SOURCE || (block >= WATER_FLOW_START && block < WATER_FLOW_START + WATER_REACH)) return 'water';
  if (block === LAVA_SOURCE || (block >= LAVA_FLOW_START && block < LAVA_FLOW_START + LAVA_REACH)) return 'lava';
  return null;
}

export function liquidLevel(block: number): number {
  if (block === WATER_SOURCE || block === LAVA_SOURCE) return 0;
  if (block >= WATER_FLOW_START && block < WATER_FLOW_START + WATER_REACH) return block - WATER_FLOW_START + 1;
  if (block >= LAVA_FLOW_START && block < LAVA_FLOW_START + LAVA_REACH) return block - LAVA_FLOW_START + 1;
  return -1;
}

export function flowingBlock(kind: LiquidKind, distance: number): number {
  const max = kind === 'water' ? WATER_REACH : LAVA_REACH;
  return (kind === 'water' ? WATER_FLOW_START : LAVA_FLOW_START) + Math.max(1, Math.min(max, distance)) - 1;
}

export function liquidHeight(block: number, above = 0): number {
  const kind = liquidKind(block);
  if (!kind) return 0;
  if (liquidKind(above) === kind) return 1;
  const level = liquidLevel(block);
  return level === 0 ? 0.94 : Math.max(0.14, 0.94 - level * (kind === 'water' ? 0.105 : 0.17));
}

/** Shared four-column samples make adjacent fluid surfaces meet at the same vertices. */
export function liquidCornerHeight(
  getBlock: (x: number, y: number, z: number) => number,
  x: number, y: number, z: number, cornerX: number, cornerZ: number,
): number {
  const kind = liquidKind(getBlock(x, y, z));
  if (!kind) return 0;
  let total = 0;
  for (let dz = cornerZ - 1; dz <= cornerZ; dz++) {
    for (let dx = cornerX - 1; dx <= cornerX; dx++) {
      const bx = x + dx, bz = z + dz, block = getBlock(bx, y, bz);
      total += liquidKind(block) === kind ?
        liquidHeight(block, getBlock(bx, y + 1, bz)) : 0.08;
    }
  }
  return Math.max(0.12, total / 4);
}
