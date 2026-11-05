import { describe, expect, it } from 'vitest';
import { flowingBlock, liquidCornerHeight, liquidHeight, liquidKind, liquidLevel } from '../../src/game/world/fluid-blocks';

describe('persisted flowing liquid levels', () => {
  it('preserves original water and lava source IDs and separates flowing variants', () => {
    expect(liquidKind(34)).toBe('water');
    expect(liquidKind(35)).toBe('lava');
    expect(liquidLevel(34)).toBe(0);
    expect(liquidLevel(35)).toBe(0);
    expect(flowingBlock('water', 1)).toBe(160);
    expect(flowingBlock('water', 7)).toBe(166);
    expect(flowingBlock('lava', 1)).toBe(170);
    expect(flowingBlock('lava', 4)).toBe(173);
    expect(liquidKind(174)).toBeNull();
  });
  it('makes farther flows visibly shallower and waterfalls full-height', () => {
    expect(liquidHeight(34)).toBeGreaterThan(liquidHeight(160));
    expect(liquidHeight(160)).toBeGreaterThan(liquidHeight(166));
    expect(liquidHeight(170)).toBeGreaterThan(liquidHeight(173));
    expect(liquidHeight(163, 34)).toBe(1);
  });
  it('generates shared sloped/trapezoidal corners without cracks between blocks', () => {
    const map = new Map<string, number>([['0,0,0', 34], ['1,0,0', 162]]);
    const get = (x: number, y: number, z: number) => map.get(`${x},${y},${z}`) ?? 0;
    expect(liquidCornerHeight(get, 0, 0, 0, 1, 0))
      .toBeCloseTo(liquidCornerHeight(get, 1, 0, 0, 0, 0));
    expect(liquidCornerHeight(get, 0, 0, 0, 0, 0))
      .toBeGreaterThan(liquidCornerHeight(get, 1, 0, 0, 1, 0));
  });
});
