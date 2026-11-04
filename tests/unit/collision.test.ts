import { describe, expect, it } from 'vitest';
import { createCollisionEngine } from '../../src/game/world/collision';

const blocks = new Map<string, number>();
const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
const engine = createCollisionEngine({
  getBlock: (x, y, z) => blocks.get(key(x, y, z)) ?? 0,
  solid: b => b !== 0,
  defaultRadius: 0.3,
  defaultHeight: 1.8,
  bedHeight: 0.5625,
});
describe('player and mob collision rules', () => {
  it('treats solid blocks as obstacles but lets players stand above a low bed', () => {
    blocks.clear();
    blocks.set(key(2, 2, 0), 3);
    expect(engine.collides(2.5, 2.01, 0.5)).toBe(true);
    blocks.clear();
    blocks.set(key(2, 2, 0), 19);
    expect(engine.collides(2.5, 2.57, 0.5)).toBe(false);
    expect(engine.collides(2.5, 2.1, 0.5)).toBe(true);
  });
  it('prevents fast horizontal movement from tunnelling through a wall', () => {
    blocks.clear();
    blocks.set(key(2, 2, 0), 3);
    const entity = { x: 0.5, y: 2.01, z: 0.5, vx: 10, vy: 0, vz: 0, hit: false };
    engine.moveEnt(entity, 0, 5);
    expect(entity.x).toBeLessThan(2 - 0.3 + 0.01);
    expect(entity.vx).toBe(0);
    expect(entity.hit).toBe(true);
  });
  it('lands a falling entity and clears vertical velocity', () => {
    blocks.clear();
    blocks.set(key(0, 0, 0), 3);
    const entity = { x: 0.5, y: 2, z: 0.5, vx: 0, vy: -8, vz: 0, onGround: false };
    engine.moveEnt(entity, 1, -4);
    expect(entity.y).toBeGreaterThanOrEqual(1);
    expect(entity.onGround).toBe(true);
    expect(entity.vy).toBe(0);
  });
});
