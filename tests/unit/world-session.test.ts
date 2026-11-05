import { describe, expect, it } from 'vitest';
import { nextWorldName, nextWorldSeed, CURRENT_WORLD_GENERATOR_VERSION, timeAgo } from '../../src/game/session/world-session';
import type { WorldRecord } from '../../src/game/storage/world-storage';

function world(name: string): WorldRecord {
  return { id: name, name, seed: 5, created: 100, lastPlayed: 100 };
}

describe('saved world session naming and history', () => {
  it('chooses the next numbered world without reusing deleted names', () => {
    expect(nextWorldName([world('World 2'), world('World 10'), world('Village')]))
      .toBe('World 11');
    expect(nextWorldName([world('My favorite world')])).toBe('World 1');
    expect(nextWorldName([])).toBe('World 1');
  });

  it('creates full-range deterministic testable seeds without reusing saved seeds', () => {
    expect(CURRENT_WORLD_GENERATOR_VERSION).toBe(2);
    expect(nextWorldSeed([], () => 0.75)).toBe(3221225472);
    expect(nextWorldSeed([world('a')], () => 0)).toBe(0);
    const existing = [{ ...world('a'), seed: 3221225472 }];
    expect(nextWorldSeed(existing, () => 0.75)).toBe(0);
  });

  it('renders stable user-friendly save ages', () => {
    const now = 100_000_000;
    expect(timeAgo(now, now)).toBe('just now');
    expect(timeAgo(now - 125_000, now)).toBe('2 min ago');
    expect(timeAgo(now - 2 * 3_600_000, now)).toBe('2 h ago');
    expect(timeAgo(now - 3 * 86_400_000, now)).toBe('3 d ago');
  });

  it('never shows a negative save age for device clock changes', () => {
    expect(timeAgo(2000, 1000)).toBe('just now');
  });
});
