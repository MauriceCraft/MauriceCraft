import { describe, expect, it } from 'vitest';
import { createCaveCarver } from '../../src/game/world/cave-carver';

function generated(seed: number, cx: number, cz: number) {
  const H = 48, data = new Uint8Array(16 * 16 * H);
  for (let y = 0; y <= 27; y++)
    for (let i = 0; i < 256; i++) data[y * 256 + i] = 3;
  createCaveCarver({ getSeed: () => seed, heightAt: () => 27,
    inStructureZone: () => false, worldHeight: H }).carve(cx, cz, data);
  return data;
}
describe('seeded cave networks', () => {
  it('reproduces tunnels independent of chunk generation order', () => {
    expect(generated(60, -3, 5)).toEqual(generated(60, -3, 5));
  });
  it('creates reachable underground empty spaces without breaking the bottom', () => {
    let cavities = 0;
    for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
      const data = generated(60, cx, cz);
      cavities += data.slice(5 * 256, 24 * 256).filter(b => b === 0).length;
      expect(data.slice(0, 2 * 256).every(b => b === 3)).toBe(true);
    }
    expect(cavities).toBeGreaterThan(500);
  });
  it('generates different networks for different world seeds', () => {
    const signature = (seed: number) => {
      const chunks: number[] = [];
      for (let cx = -4; cx <= 4; cx++) for (let cz = -4; cz <= 4; cz++) {
        const data = generated(seed, cx, cz);
        chunks.push(data.slice(5 * 256, 24 * 256).filter(block => block === 0).length);
      }
      return chunks;
    };
    expect(signature(3)).not.toEqual(signature(4));
  });
});
