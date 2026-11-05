import { describe, expect, it } from 'vitest';
import { createNaturalFeatures } from '../../src/game/world/natural-features';

describe('world-version-scoped lake planning', () => {
  it('does not reuse a v2 lake when a v3 world has the same seed', () => {
    const seed = 121;
    const shared = {
      getSeed: () => seed,
      biomeAt: () => 'plains' as const,
      inStructureZone: () => false,
      seaLevel: 14, maxHeight: 48,
      waterBlock: 34, lavaBlock: 35,
    };
    const flat = createNaturalFeatures({
      ...shared, getGeneratorVersion: () => 2, heightAt: () => 24,
    });
    let sample: { rx: number; rz: number; x: number; z: number } | undefined;
    for (let rx = -5; rx <= 5 && !sample; rx++) {
      for (let rz = -5; rz <= 5 && !sample; rz++) {
        const lake = flat.lakeFor(rx, rz);
        if (lake) sample = { rx, rz, x: lake.x, z: lake.z };
      }
    }
    expect(sample).toBeDefined();
    if (!sample) return;

    let version = 2;
    const planner = createNaturalFeatures({
      ...shared,
      getGeneratorVersion: () => version,
      // Lake center is viable but the shoreline drops off sharply.
      heightAt: (x, z) => x === sample.x && z === sample.z ? 24 : 3,
    });
    expect(planner.lakeFor(sample.rx, sample.rz)).not.toBeNull();

    // The same coordinates and seed now use v3's cliff-edge rejection.
    version = 3;
    expect(planner.lakeFor(sample.rx, sample.rz)).toBeNull();

    // Switching back should also restore the older version's lake.
    version = 2;
    expect(planner.lakeFor(sample.rx, sample.rz)).not.toBeNull();
  });
});
