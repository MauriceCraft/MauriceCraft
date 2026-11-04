import { describe, expect, it } from 'vitest';
import { coord } from '../../src/game/commands/coordinates';

describe('command coordinate parser', () => {
  it('parses absolute coordinates', () => {
    expect(coord('14', 500)).toBe(14);
    expect(coord('-3.25', 500)).toBe(-3.25);
  });
  it('supports relative coordinates', () => {
    expect(coord('~', 10)).toBe(10);
    expect(coord('~2.5', 10)).toBe(12.5);
    expect(coord('~-4', 10)).toBe(6);
  });
  it('rejects missing and invalid input', () => {
    expect(() => coord(undefined, 0)).toThrow('Missing a coordinate');
    expect(() => coord('nope', 0)).toThrow('not a number');
    expect(() => coord('~whoops', 0)).toThrow('not a number');
  });
});
