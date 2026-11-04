import { describe, expect, it } from 'vitest';
import { createStructureRegions } from '../../src/game/world/structure-regions';

const make = (seed: number) => createStructureRegions({
  heightAt: () => 19, getSeed: () => seed, getPlayer: () => ({ x: 0, z: 0 }),
  seaLevel: 14, maxHeight: 48,
});

describe('deterministic structure regions', () => {
  it('generates the same structures for identical seeds, independent of query order', () => {
    const a = make(128), b = make(128);
    const cells = Array.from({ length: 25 }, (_, i) => [i % 5 - 2, Math.floor(i / 5) - 2]);
    const first = cells.map(([x,z]) => a.structureFor(x,z));
    const second = cells.slice().reverse().map(([x,z]) => b.structureFor(x,z)).reverse();
    expect(first).toEqual(second);
    expect(a.structCache.size).toBe(25);
  });
  it('keeps spawn area free of structures and caches null results', () => {
    const a = make(919);
    expect(a.structureFor(0,0)).toBeNull();
    expect(a.structureFor(0,0)).toBeNull();
    expect(a.structCache.has(0)).toBe(true);
  });
  it('changes structure maps when seed changes', () => {
    const a = make(101), b = make(202);
    const cells = Array.from({ length: 80 }, (_, i) => [i % 10 + 1, Math.floor(i / 10) + 1]);
    expect(cells.map(([x,z]) => a.structureFor(x,z)))
      .not.toEqual(cells.map(([x,z]) => b.structureFor(x,z)));
  });
  it('flattens terrain near structures while preserving areas far away', () => {
    const a = make(4321);
    const cells = Array.from({ length: 100 }, (_, i) => [i % 10 + 1, Math.floor(i / 10) + 1]);
    const structure = cells.map(([x,z]) => a.structureFor(x,z)).find(v => v && v.pad > 0);
    expect(structure).toBeDefined();
    if (!structure) return;
    expect(a.groundH(structure.cx, structure.cz)).toBe(structure.gy);
    expect(a.groundH(structure.cx + 100, structure.cz + 100)).toBe(19);
    expect(a.STRUCT_NAMES[structure.type]).toBeTruthy();
  });
});
