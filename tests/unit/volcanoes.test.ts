import { describe, expect, it } from 'vitest';
import { nearestVolcano, volcanoCraterAt, volcanoFor, volcanoHeightAt } from '../../src/game/world/volcanoes';
import { biomeHeightAt } from '../../src/game/world/biomes';

describe('generated volcano landmarks', () => {
  it('creates a reproducible crater and raised rim', () => {
    let v = null;
    for (let rx = -16; rx <= 16 && !v; rx++) for (let rz = -16; rz <= 16 && !v; rz++) v = volcanoFor(rx, rz, 112);
    expect(v).not.toBeNull();
    if (!v) return;
    expect(nearestVolcano(v.x, v.z, 112, 48, 40)?.feature).toEqual(v);
    const crater = volcanoCraterAt(v.x, v.z, 112);
    expect(crater?.floor).toBeLessThan(crater!.level);
    expect(volcanoHeightAt(v.x + 5, v.z, 112, biomeHeightAt(v.x + 5, v.z, 112, 48))).toBeGreaterThan(crater!.floor);
  });
});
