import { describe, expect, it } from 'vitest';
import { raycastActors } from '../../src/game/entities/actor-targeting';

const actors = [
  { id: 'far', x: 8, y: 1, z: 0, r: 0.4, h: 2 },
  { id: 'near', x: 3, y: 1, z: 0, r: 0.4, h: 2 },
  { id: 'behind', x: -4, y: 1, z: 0, r: 0.4, h: 2 },
];
const origin = { x: 0, y: 2, z: 0 };

describe('mob targeting performance and behavior', () => {
  it('selects the closest hit without depending on array order', () => {
    expect(raycastActors(actors, origin, { x: 1, y: 0, z: 0 }, 10))
      .toMatchObject({ mob: { id: 'near' }, t: 2.6 });
    expect(raycastActors(actors.slice().reverse(), origin, { x: 1, y: 0, z: 0 }, 10)?.mob.id)
      .toBe('near');
  });

  it('rejects actors outside reach, behind the player, or above the ray', () => {
    expect(raycastActors(actors, origin, { x: 1, y: 0, z: 0 }, 2)).toBeNull();
    expect(raycastActors(actors, { x: 0, y: 5, z: 0 }, { x: 1, y: 0, z: 0 }, 10)).toBeNull();
    expect(raycastActors(actors, origin, { x: -1, y: 0, z: 0 }, 10)?.mob.id).toBe('behind');
  });

  it('selects the eye-inside-hitbox actor immediately', () => {
    const inside = { id: 'inside', x: 0, y: 1, z: 0, r: 0.5, h: 2 };
    expect(raycastActors([inside], origin, { x: 1, y: 0, z: 0 }, 6))
      .toEqual({ mob: inside, t: 0 });
  });

  it('can scan large crowds without mutating actor positions', () => {
    const crowd = Array.from({ length: 1200 }, (_, index) => ({
      id: index, x: index + 2, y: 1, z: 0, r: 0.3, h: 2,
    }));
    expect(raycastActors(crowd, origin, { x: 1, y: 0, z: 0 }, 5)?.mob.id).toBe(0);
    expect(crowd[0].x).toBe(2);
  });
});
