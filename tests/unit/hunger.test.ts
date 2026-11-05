import { describe, expect, it } from 'vitest';
import { exertPlayer, type HungerState } from '../../src/game/player/hunger';

function state(): HungerState {
  return { mode: 'survival', difficulty: 'normal', exhaust: 0, sat: 2, hunger: 20 };
}
describe('hunger exhaustion', () => {
  it('consumes saturation first and keeps remaining fractional exhaustion', () => {
    const s = state();
    exertPlayer(s, 9);
    expect(s).toMatchObject({ exhaust: 1, sat: 0, hunger: 20 });
    exertPlayer(s, 7);
    expect(s).toMatchObject({ exhaust: 0, sat: 0, hunger: 18 });
  });
  it('does not drain food in Creative or on Peaceful', () => {
    const s = state();
    s.mode = 'creative';
    exertPlayer(s, 40);
    expect(s.exhaust).toBe(0);
    s.mode = 'survival'; s.difficulty = 'peaceful';
    exertPlayer(s, 40);
    expect(s.hunger).toBe(20);
  });
  it('never lets hunger become negative on repeated exertion', () => {
    const s = state(); s.sat = 0; s.hunger = 1;
    exertPlayer(s, 40);
    expect(s.hunger).toBe(0);
    expect(s.exhaust).toBe(0);
  });
});
