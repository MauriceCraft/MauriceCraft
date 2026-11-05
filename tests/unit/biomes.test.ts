import { describe, expect, it } from 'vitest';
import { biomeAt, biomeHeightAt, biomeSurface } from '../../src/game/world/biomes';

describe('seeded biome generation', () => {
  it('is deterministic across coordinates, including negative coordinates', () => {
    for (const [x, z] of [[0, 0], [200, -300], [-1234, 987]] as const) {
      expect(biomeAt(x, z, 456)).toBe(biomeAt(x, z, 456));
      expect(biomeHeightAt(x, z, 456, 48)).toBe(biomeHeightAt(x, z, 456, 48));
    }
  });
  it('produces varied biome regions across different seeds and distant coordinates', () => {
    const found = new Set<string>();
    for (const seed of [1, 23, 456]) {
      for (let x = -1500; x <= 1500; x += 125) {
        for (let z = -1500; z <= 1500; z += 125) found.add(biomeAt(x, z, seed));
      }
    }
    expect(found.size).toBeGreaterThanOrEqual(8);
  });
  it('keeps terrain within bounds and surfaces appropriate to the biome', () => {
    for (let x = -900; x < 900; x += 61) {
      const height = biomeHeightAt(x, x * 2, 123, 48);
      expect(height).toBeGreaterThanOrEqual(3);
      expect(height).toBeLessThanOrEqual(40);
    }
    expect(biomeSurface('desert', 20, 14)).toBe('sand');
    expect(biomeSurface('badlands', 20, 14)).toBe('red-sand');
    expect(biomeSurface('tundra', 20, 14)).toBe('snow');
    expect(biomeSurface('volcanic', 20, 14)).toBe('stone');
  });
});
