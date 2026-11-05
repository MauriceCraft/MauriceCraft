import { describe, expect, it } from 'vitest';
import { createFluidSimulator } from '../../src/game/world/fluid-simulator';

function fixture() {
  const blocks = new Map<string, number>();
  let version = 2, dimension = 'overworld';
  const get = (x: number, y: number, z: number) => blocks.get(`${x},${y},${z}`) ?? (y === 0 ? 3 : 0);
  const set = (x: number, y: number, z: number, b: number) => {
    if (b === 0) blocks.delete(`${x},${y},${z}`);
    else blocks.set(`${x},${y},${z}`, b);
  };
  const changed: string[] = [];
  const fluid = createFluidSimulator({
    height: 16, getBlock: get, setBlock: set, isLoaded: () => true,
    refreshChunk: (x, z) => { changed.push(x + ',' + z); },
    getDimension: () => dimension, getGeneratorVersion: () => version,
  });
  const advance = (frames = 12) => { for (let i = 0; i < frames; i++) fluid.tick(0.15); };
  return { get, set, fluid, advance, changed,
    setVersion: (v: number) => { version = v; }, setDimension: (d: string) => { dimension = d; } };
}
describe('bounded liquid updates', () => {
  it('flows down first and makes a spreading waterfall from a source', () => {
    const f = fixture();
    f.set(0, 9, 0, 34);
    f.fluid.notify(0, 9, 0);
    f.advance(15);
    expect(f.get(0, 9, 0)).toBe(34);
    expect(f.get(0, 8, 0)).toBe(160);
    expect(f.get(0, 7, 0)).toBe(160);
    expect(f.changed.length).toBeGreaterThan(0);
  });
  it('spreads over floors with levels that decrease away from sources', () => {
    const f = fixture();
    for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) f.set(x, 4, z, 3);
    f.set(0, 5, 0, 34); f.fluid.notify(0, 5, 0);
    f.advance(75);
    expect(f.get(1, 5, 0)).toBe(160);
    expect(f.get(2, 5, 0)).toBe(161);
    expect(f.get(7, 5, 0)).toBe(166);
    expect(f.get(8, 5, 0)).toBe(0);
  });
  it('restores air when a supporting source is removed', () => {
    const f = fixture();
    for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) f.set(x, 4, z, 3);
    f.set(0, 5, 0, 34); f.fluid.notify(0, 5, 0); f.advance(45);
    f.set(0, 5, 0, 0); f.fluid.notify(0, 5, 0);
    f.advance(70);
    expect(f.get(1, 5, 0)).toBe(0);
  });
  it('preserves legacy terrain and never mutates non-overworld dimensions', () => {
    const f = fixture();
    f.setVersion(1); f.set(0, 5, 0, 34); f.fluid.notify(0, 5, 0); f.advance();
    expect(f.get(0, 4, 0)).toBe(0);
    f.setVersion(2); f.setDimension('nether'); f.fluid.notify(0, 5, 0); f.advance();
    expect(f.get(0, 4, 0)).toBe(0);
  });
  it('reaches fewer blocks and cools when lava meets water', () => {
    const f = fixture();
    for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) f.set(x, 4, z, 3);
    f.set(0, 5, 0, 35); f.fluid.notify(0, 5, 0); f.advance(50);
    expect(f.get(4, 5, 0)).toBe(173);
    expect(f.get(5, 5, 0)).toBe(0);
    f.set(0, 5, 1, 34); f.fluid.notify(0, 5, 1); f.advance(20);
    expect(f.get(0, 5, 0)).toBe(36);
  });
});
