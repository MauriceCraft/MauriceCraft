import { describe, expect, it } from 'vitest';
import { cropGrid, samePattern } from '../../src/game/crafting/grid';

describe('crafting patterns', () => {
  it('ignores empty borders of a 3x3 grid', () => {
    expect(cropGrid([
      0, 0, 0,
      0, 7, 7,
      0, 7, 7,
    ], 3)).toEqual([[7, 7], [7, 7]]);
  });
  it('keeps interior empty spaces in recipes', () => {
    expect(cropGrid([
      5, 0, 5,
      0, 0, 0,
      5, 0, 5,
    ], 3)).toEqual([[5, 0, 5], [0, 0, 0], [5, 0, 5]]);
  });
  it('returns null for an empty grid', () => {
    expect(cropGrid(Array(9).fill(0), 3)).toBeNull();
  });
  it('distinguishes shape and orientation', () => {
    expect(samePattern([[7, 7], [7, 7]], [[7, 7], [7, 7]])).toBe(true);
    expect(samePattern([[7, 0]], [[0, 7]])).toBe(false);
    expect(samePattern([[7], [7]], [[7, 7]])).toBe(false);
    expect(samePattern([[7]], [[7, 7]])).toBe(false);
  });
});
