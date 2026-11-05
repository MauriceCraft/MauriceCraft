import { fbm } from './noise';

export type Biome = 'plains' | 'forest' | 'meadow' | 'savanna' | 'desert' |
  'badlands' | 'marsh' | 'taiga' | 'tundra' | 'highlands' | 'volcanic';
export type BiomeSurface = 'grass' | 'snow' | 'sand' | 'red-sand' | 'stone' | 'moss';

export function biomeAt(x: number, z: number, seed: number): Biome {
  // Broad, independently sampled temperature/moisture/relief maps make coherent
  // biomes without fixed tiles or a repeating per-chunk pattern.
  const heat = fbm(x / 235, z / 235, seed + 1701);
  const moisture = fbm(x / 250, z / 250, seed + 1702);
  const relief = fbm(x / 185, z / 185, seed + 1703);
  if (relief > 0.69 && heat > 0.55 && moisture < 0.51) return 'volcanic';
  if (relief > 0.66) return 'highlands';
  if (heat < 0.36) return moisture > 0.49 ? 'taiga' : 'tundra';
  if (heat > 0.66) {
    if (moisture < 0.42) return 'desert';
    if (moisture < 0.51) return 'badlands';
    return 'savanna';
  }
  if (moisture > 0.67 && heat > 0.43) return 'marsh';
  if (moisture > 0.58 && heat < 0.57) return 'forest';
  if (moisture > 0.53 && heat >= 0.57) return 'meadow';
  return 'plains';
}

export function biomeHeightAt(x: number, z: number, seed: number, maxHeight: number): number {
  const detail = fbm(x / 40, z / 40, seed);
  const continental = fbm(x / 170, z / 170, seed + 300);
  const roughness = fbm(x / 12, z / 12, seed + 50);
  const relief = fbm(x / 185, z / 185, seed + 1703);
  const moisture = fbm(x / 250, z / 250, seed + 1702);
  // All height adjustments are continuous across biome transitions.
  const mountains = Math.max(0, relief - 0.54) * 48;
  const lowlands = Math.max(0, moisture - 0.60) * 12;
  const h = Math.floor(5 + (detail * 0.72 + continental * 0.28) * 30 +
    roughness * 4 + mountains - lowlands);
  return Math.max(3, Math.min(maxHeight - 8, h));
}

export function biomeSurface(biome: Biome, height: number, seaLevel: number): BiomeSurface {
  if (biome === 'desert') return 'sand';
  if (biome === 'badlands') return 'red-sand';
  if (biome === 'tundra' || (biome === 'taiga' && height > seaLevel + 5)) return 'snow';
  if (biome === 'volcanic' || (biome === 'highlands' && height > seaLevel + 16)) return 'stone';
  if (biome === 'marsh' && height <= seaLevel + 5) return 'moss';
  return 'grass';
}

export const BIOME_LABELS: Record<Biome, string> = {
  plains: 'Plains', forest: 'Forest', meadow: 'Flower Meadow', savanna: 'Savanna',
  desert: 'Desert', badlands: 'Badlands', marsh: 'Marsh', taiga: 'Snowy Taiga',
  tundra: 'Tundra', highlands: 'Highlands', volcanic: 'Volcanic Highlands',
};
