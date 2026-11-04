import { describe, expect, it } from 'vitest';
import { ckey } from '../../src/game/world/chunk-key';
import { blockKind } from '../../src/game/world/block-kind';
import { mulberry32, hash2, vnoise, fbm } from '../../src/game/world/noise';

describe('persisted chunk keys', () => {
  it('preserves the original bit-packed format', () => {
    expect(ckey(0, 0)).toBe(0);
    expect(ckey(1, 2)).toBe(65538);
    expect(ckey(-1, -1)).toBe(-1);
  });
  it('handles coordinates outside the origin', () => {
    expect(ckey(-1, 0)).toBe(-65536);
    expect(ckey(0, -1)).toBe(65535);
    expect(ckey(0, 1)).not.toBe(ckey(1, 0));
  });
});

describe('world generation determinism', () => {
  it('preserves the seeded random sequence', () => {
    const random = mulberry32(123);
    expect([random(), random(), random()]).toEqual([
      0.7872516233474016,
      0.1785435655619949,
      0.49531551403924823,
    ]);
    expect(mulberry32(123)()).toBe(0.7872516233474016);
  });
  it('preserves integer-coordinate hash output', () => {
    expect(hash2(2, -5, 123)).toBe(0.4495100495405495);
    expect(hash2(2, -5, 123)).not.toBe(hash2(2, -5, 124));
  });
  it('interpolates smoothly and returns finite values', () => {
    const sample = vnoise(1.3, -2.4, 77);
    expect(Number.isFinite(sample)).toBe(true);
    expect(vnoise(1.3, -2.4, 77)).toBe(sample);
    expect(fbm(1.3, -2.4, 77)).toBe(fbm(1.3, -2.4, 77));
    expect(fbm(1.3, -2.4, 77)).toBeGreaterThanOrEqual(0);
    expect(fbm(1.3, -2.4, 77)).toBeLessThanOrEqual(1);
  });
});

describe('mining tools', () => {
  it.each([[3, 'pickaxe'], [30, 'pickaxe'], [5, 'axe'], [18, 'axe'], [1, 'shovel'], [12, 'shovel']] as const)(
    'classifies block %i as %s', (id, expected) => expect(blockKind(id)).toBe(expected),
  );
  it('allows hand-mining of unspecified blocks', () => {
    expect(blockKind(0)).toBeNull();
    expect(blockKind(17)).toBeNull();
  });
});
