import { describe, expect, it } from 'vitest';
import { describeMode, DIFFICULTY_DESCRIPTIONS, MODE_LABELS } from '../../src/game/ui/game-menu';

describe('game-mode help text', () => {
  it('documents each game mode in a readable form', () => {
    expect(Object.keys(MODE_LABELS)).toEqual(['creative', 'survival', 'adventure', 'spectator']);
    expect(describeMode('creative', 5)).toContain('flying');
    expect(describeMode('survival', 5)).toContain('hunger');
    expect(describeMode('adventure', 7)).toContain('7 glowing relics');
    expect(describeMode('spectator', 5)).toContain('Fly through');
  });
  it('describes each difficulty without hidden feature flags', () => {
    expect(Object.keys(DIFFICULTY_DESCRIPTIONS)).toHaveLength(4);
    expect(DIFFICULTY_DESCRIPTIONS.peaceful).toContain('No monsters');
    expect(DIFFICULTY_DESCRIPTIONS.hard).toContain('fast monsters');
  });
});
