import { describe, expect, it } from 'vitest';
import { heartLevel } from '../../src/game/ui/hud';

describe('HUD health and hunger icons', () => {
  it('shows the correct full, half and empty units at the boundaries', () => {
    expect(Array.from({ length: 10 }, (_, index) => heartLevel(20, index))).toEqual(Array(10).fill('full'));
    expect(Array.from({ length: 10 }, (_, index) => heartLevel(5, index)))
      .toEqual(['full', 'full', 'half', 'empty', 'empty', 'empty', 'empty', 'empty', 'empty', 'empty']);
    expect(Array.from({ length: 10 }, (_, index) => heartLevel(0, index))).toEqual(Array(10).fill('empty'));
  });
});
