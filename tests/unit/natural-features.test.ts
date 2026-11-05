import { describe, expect, it } from 'vitest';
import { createNaturalFeatures } from '../../src/game/world/natural-features';

function make(seed: number) {
  return createNaturalFeatures({
    getSeed: () => seed, biomeAt: () => 'highlands',
    heightAt: (x, z) => 23 + Math.round(Math.sin(x / 13) * 4 + Math.cos(z / 10) * 4),
    inStructureZone: () => false, seaLevel: 14, maxHeight: 48,
    waterBlock: 34, lavaBlock: 35,
  });
}

describe('lakes and flowing terrain features', () => {
  it('places deterministic region features even with negative coordinates', () => {
    const a = make(121), b = make(121);
    for (let rx = -3; rx <= 3; rx++) for (let rz = -3; rz <= 3; rz++) {
      expect(a.lakeFor(rx, rz)).toEqual(b.lakeFor(rx, rz));
      expect(a.cascadeFor(rx, rz)).toEqual(b.cascadeFor(rx, rz));
    }
  });
  it('carves filled basins below their stable waterline', () => {
    const features = make(121);
    const lake = Array.from({ length: 400 }, (_, i) =>
      features.lakeFor(i % 20 - 10, Math.floor(i / 20) - 10)).find(Boolean);
    expect(lake).toBeDefined();
    if (!lake) return;
    const center = features.lakeAt(lake.x, lake.z);
    expect(center).not.toBeNull();
    expect(center!.bottom).toBeLessThan(center!.surface);
    expect(center!.liquid).toBe('water');
  });
  it('clips feature decorations to adjacent chunks without random generation order', () => {
    const features = make(121);
    const collect = (cx: number, cz: number) => {
      const blocks = new Map<string, number>();
      features.decorateFalls(cx, cz, (x, y, z, b) => {
        if (x >= cx * 16 && x < cx * 16 + 16 && z >= cz * 16 &&
            z < cz * 16 + 16) blocks.set(`${x},${y},${z}`, b);
      });
      return blocks;
    };
    expect(collect(5, -6)).toEqual(collect(5, -6));
  });
});
