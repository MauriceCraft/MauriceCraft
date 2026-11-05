import { describe, expect, it } from 'vitest';
import { rotateLook, scrollHotbar, spectatorScrollSpeed } from '../../src/game/input/game-controls';

describe('input control helpers', () => {
  it('wraps the hotbar in both directions without out-of-range slots', () => {
    expect(scrollHotbar(8, true)).toBe(0);
    expect(scrollHotbar(0, false)).toBe(8);
    expect(scrollHotbar(3, true)).toBe(4);
  });
  it('clamps spectator speed to supported gameplay limits', () => {
    expect(spectatorScrollSpeed(0.25, true)).toBe(0.25);
    expect(spectatorScrollSpeed(6, false)).toBe(6);
    expect(spectatorScrollSpeed(1, true)).toBe(0.8);
  });
  it('clamps vertical look angle while preserving yaw wrapping', () => {
    expect(rotateLook(0, 1.5, 10, -100, 0.1)).toEqual({ yaw: -1, pitch: 1.55 });
    expect(rotateLook(0, -1.5, -10, 100, 0.1)).toEqual({ yaw: 1, pitch: -1.55 });
  });
});
