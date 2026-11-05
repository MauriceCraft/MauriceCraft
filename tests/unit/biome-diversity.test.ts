import { describe, expect, it } from 'vitest';
import { biomeAt, type Biome } from '../../src/game/world/biomes';

/**
 * Broad, deterministic samples guard the experience near new-world spawn.
 * These are deliberately tolerant distribution checks, not golden terrain
 * snapshots: generator updates may change individual coordinates.
 */
const SEEDS = [0, 1, 23, 42, 456, 987654321] as const;
const RADIUS = 512;
const STEP = 32;

function survey(seed: number): { counts: Map<Biome, number>; total: number } {
  const counts = new Map<Biome, number>();
  let total = 0;
  for (let x = -RADIUS; x <= RADIUS; x += STEP) {
    for (let z = -RADIUS; z <= RADIUS; z += STEP) {
      const biome = biomeAt(x, z, seed);
      counts.set(biome, (counts.get(biome) ?? 0) + 1);
      total++;
    }
  }
  return { counts, total };
}

describe('near-spawn biome diversity regression', () => {
  it.each(SEEDS)('keeps a variety of accessible biomes for seed %i', seed => {
    const { counts, total } = survey(seed);
    const largestRegion = Math.max(...counts.values());
    // A single good seed must not hide another seed producing repetitive worlds.
    expect(counts.size, `seed ${seed} biome count`).toBeGreaterThanOrEqual(8);
    expect(largestRegion / total, `seed ${seed} dominant biome share`).toBeLessThan(0.6);
  });

  it.each(SEEDS)('creates coherent regions rather than pixel-noise patches for seed %i', seed => {
    let matchingNeighbors = 0;
    let comparisons = 0;
    for (let x = -RADIUS; x < RADIUS; x += STEP) {
      for (let z = -RADIUS; z < RADIUS; z += STEP) {
        const biome = biomeAt(x, z, seed);
        if (biome === biomeAt(x + 16, z, seed)) matchingNeighbors++;
        if (biome === biomeAt(x, z + 16, seed)) matchingNeighbors++;
        comparisons += 2;
      }
    }
    expect(matchingNeighbors / comparisons, `seed ${seed} spatial continuity`)
      .toBeGreaterThan(0.65);
  });

  it('changes the regional biome pattern when the world seed changes', () => {
    const positions = [
      [-480, -480], [-320, 224], [-96, -256], [0, 0], [192, 288], [416, -352],
    ] as const;
    const a = positions.map(([x, z]) => biomeAt(x, z, 1));
    const b = positions.map(([x, z]) => biomeAt(x, z, 65537));
    expect(a).not.toEqual(b);
  });
});
