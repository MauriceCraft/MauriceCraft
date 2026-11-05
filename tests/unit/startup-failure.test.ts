import { describe, expect, it } from 'vitest';
import { describeStartupFailure } from '../../src/game/startup-failure';

describe('startup failure messages', () => {
  it('provides a specific WebGL explanation', () => {
    expect(describeStartupFailure(new Error('Error creating WebGL context')))
      .toContain('3D renderer');
  });
  it('preserves saves and suggests a retry for unknown errors', () => {
    expect(describeStartupFailure(new Error('IndexedDB version blocked')))
      .toContain('saved worlds have not been deleted');
    expect(describeStartupFailure(null)).toContain('Reload');
  });
});
