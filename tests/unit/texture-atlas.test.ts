import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeAtlas } from '../../src/game/rendering/texture-atlas';

afterEach(() => vi.unstubAllGlobals());

describe('game texture atlas regression', () => {
  it('draws predictable block, portal-frame and lava tiles in the 2048x16 atlas', () => {
    const pixels = new Map<string, string>();
    const context = {
      fillStyle: '',
      fillRect(x: number, y: number, width: number, height: number) {
        if (width === 1 && height === 1) pixels.set(`${x},${y}`, this.fillStyle);
      },
    };
    const canvas = { width: 0, height: 0, getContext: () => context };
    const createElement = vi.fn(() => canvas);
    vi.stubGlobal('document', { createElement });

    const texture = makeAtlas((tier, kind) => tier * 4 + kind + 50);
    expect(texture).toBe(canvas);
    expect(canvas.width).toBe(2048);
    expect(canvas.height).toBe(16);
    expect(pixels.get(`${98 * 16 + 5},5`)).toMatch(/^rgb\(/);
    expect(pixels.get(`${97 * 16 + 3},3`)).toMatch(/^rgb\(/);
    for (const tile of [99, 100, 101, 102, 103])
      expect(pixels.get(`${tile * 16 + 3},3`)).toMatch(/^rgb\(/);
    expect(pixels.get(`${80 * 16 + 8},8`)).toBeDefined();
    expect(createElement).toHaveBeenCalledWith('canvas');
  });

  it('fails clearly if browser canvas drawing is not supported', () => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
    expect(() => makeAtlas(() => 0)).toThrow('2D canvas');
  });
});
