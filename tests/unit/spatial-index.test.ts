import { describe, expect, it } from 'vitest';
import { SpatialIndex } from '../../src/game/entities/spatial-index';

interface Actor { id: number; x: number; z: number }

describe('spatial index', () => {
  it('finds nearby actors on both sides of negative coordinate boundaries', () => {
    const actors: Actor[] = [
      { id: 1, x: -16.1, z: -0.5 },
      { id: 2, x: -15.9, z: 0.5 },
      { id: 3, x: 160, z: 160 },
    ];
    const index = new SpatialIndex<Actor>(16);
    actors.forEach(actor => index.upsert(actor));
    expect(new Set([...index.near(-16, 0, 2)].map(actor => actor.id))).toEqual(new Set([1, 2]));
    expect([...index.near(0, 0, 1)]).toEqual([]);
    expect([...index.near(-15.9, 0.5, 0.2)].map(actor => actor.id)).toEqual([2]);
    expect(index.size).toBe(3);
  });

  it('updates positions and removes defeated actors without duplicates', () => {
    const actor: Actor = { id: 1, x: 1, z: 1 };
    const index = new SpatialIndex<Actor>(8);
    index.upsert(actor);
    index.upsert(actor);
    expect([...index.near(0, 0, 4)]).toEqual([actor]);
    actor.x = 90;
    index.upsert(actor);
    expect([...index.near(0, 0, 4)]).toEqual([]);
    expect([...index.near(90, 0, 4)]).toEqual([actor]);
    index.delete(actor);
    expect(index.size).toBe(0);
    index.clear();
    expect([...index.near(90, 0, 4)]).toEqual([]);
  });

  it('visits only local candidates in a spread-out large mob population', () => {
    const index = new SpatialIndex<Actor>();
    for (let mobId = 0; mobId < 4000; mobId++) {
      index.upsert({ id: mobId, x: mobId * 32, z: 0 });
    }
    const candidates = [...index.near(64, 0, 16)];
    expect(candidates.length).toBeLessThanOrEqual(2);
    expect(candidates.map(actor => actor.id)).toContain(2);
    expect(index.size).toBe(4000);
  });

  it('rejects invalid cell sizes', () => {
    expect(() => new SpatialIndex(0)).toThrow(RangeError);
    expect(() => new SpatialIndex(-1)).toThrow(RangeError);
  });
});
