import { describe, expect, it, vi } from 'vitest';
import { createRespawn } from '../../src/game/player/player-respawn';

function fixture() {
  const player = { x: 5, y: 3, z: 4, vx: 9, vy: -2, vz: 3, yaw: 1, pitch: 0.4, fallStart: 12 as number | null };
  let spawn: { x: number; y: number; z: number } | null = { x: -17, y: 10, z: 32 };
  let bed = true, blocked = false;
  const getOrGenerateChunk = vi.fn();
  const clearSpawnPoint = vi.fn(() => { spawn = null; });
  const topBlockY = vi.fn(() => 15);
  const respawn = createRespawn({
    player, getSpawnPoint: () => spawn, clearSpawnPoint, getOrGenerateChunk,
    getBlock: () => bed ? 19 : 3,
    isBed: id => id === 19, collides: () => blocked,
    topBlockY,
  });
  return { player, respawn, getOrGenerateChunk, clearSpawnPoint, topBlockY,
    setBed: (yes: boolean) => { bed = yes; }, setBlocked: (yes: boolean) => { blocked = yes; },
    getSpawn: () => spawn };
}

describe('player respawning', () => {
  it('restores a bed spawn with its required neighborhood and resets momentum', () => {
    const f = fixture();
    f.respawn();
    expect(f.getOrGenerateChunk).toHaveBeenCalledTimes(9);
    expect(f.player).toMatchObject({ x: -16.5, y: 10.57, z: 32.5,
      vx: 0, vy: 0, vz: 0, yaw: 0, pitch: -0.1, fallStart: null });
    expect(f.clearSpawnPoint).not.toHaveBeenCalled();
  });

  it('finds additional vertical room before placing the player at a bed', () => {
    const f = fixture();
    f.setBlocked(true);
    f.respawn();
    expect(f.player.y).toBeCloseTo(14.57);
  });

  it('returns to origin if the previous bed has been broken', () => {
    const f = fixture();
    f.setBed(false);
    f.respawn();
    expect(f.clearSpawnPoint).toHaveBeenCalledOnce();
    expect(f.getSpawn()).toBeNull();
    expect(f.player).toMatchObject({ x: 0.5, y: 16.01, z: 0.5, vx: 0, vy: 0, vz: 0 });
    expect(f.topBlockY).toHaveBeenCalledWith(0, 0);
  });
});
