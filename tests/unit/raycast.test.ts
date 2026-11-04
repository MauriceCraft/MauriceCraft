import { describe, expect, it } from 'vitest';
import { raycastBlocks } from '../../src/game/world/raycast';

const solid = (block: number): boolean => block !== 0;
const origin = { x: 0.5, y: 5.5, z: 0.5 };
function world(blocks: Record<string, number>) {
  return (x: number, y: number, z: number): number => blocks[`${x},${y},${z}`] ?? 0;
}
describe('voxel targeting regression', () => {
  it('hits the entered face in positive and negative directions', () => {
    expect(raycastBlocks(origin, { x: 1, y: 0, z: 0 }, 5, world({ '3,5,0': 3 }), solid, 48))
      .toEqual({ x: 3, y: 5, z: 0, nx: -1, ny: 0, nz: 0, t: 2.5 });
    expect(raycastBlocks(origin, { x: 0, y: 0, z: -1 }, 5, world({ '0,5,-2': 3 }), solid, 48))
      .toMatchObject({ x: 0, y: 5, z: -2, nx: 0, ny: 0, nz: 1 });
  });
  it('respects reach distance and skips empty blocks', () => {
    const blocks = world({ '3,5,0': 3 });
    expect(raycastBlocks(origin, { x: 1, y: 0, z: 0 }, 2, blocks, solid, 48)).toBeNull();
    expect(raycastBlocks(origin, { x: 1, y: 0, z: 0 }, 3, blocks, solid, 48)?.x).toBe(3);
  });
  it('does not select a block if the player's eye begins inside a solid', () => {
    expect(raycastBlocks(origin, { x: 1, y: 0, z: 0 }, 5, world({ '0,5,0': 3 }), solid, 48))
      .toBeNull();
  });
  it('stops at the world height boundary', () => {
    expect(raycastBlocks({ x: 0.5, y: 47.5, z: 0.5 }, { x: 0, y: 1, z: 0 }, 5,
      world({ '0,48,0': 3 }), solid, 48)).toBeNull();
    expect(raycastBlocks({ x: 0.5, y: 0.5, z: 0.5 }, { x: 0, y: -1, z: 0 }, 5,
      world({ '0,-1,0': 3 }), solid, 48)).toBeNull();
  });
});
