import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createExplosionSystem } from '../../src/game/effects/explosions';

function fixture() {
  const chunksBuilt: string[] = [];
  const blocks = new Map<string, number>();
  const scene = new THREE.Scene();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const system = createExplosionSystem({
    scene, texture: new THREE.Texture(), tntId: 16, torchId: 17,
    worldHeight: 48, breakTimes: { 3: 4 },
    blockGeometry: () => new THREE.BoxGeometry(1, 1, 1),
    getBlock: (x, y, z) => blocks.get(key(x, y, z)) ?? 0,
    setBlock: (x, y, z, block) => { blocks.set(key(x, y, z), block); },
    hasChunk: () => true,
    buildChunk: (x, z) => { chunksBuilt.push(`${x},${z}`); },
    getMobs: () => [],
    getPlayer: () => ({ x: 100, y: 100, z: 100, h: 1.8, r: 0.3, vx: 0, vy: 0, vz: 0 }),
    damageMob: () => undefined, damagePlayer: () => undefined,
    moveEntity: () => undefined, collides: () => false,
    playSound: () => undefined, increaseShake: () => undefined,
  });
  return { system, scene, chunksBuilt, blocks, key };
}
describe('explosion module', () => {
  it('queues boundary chunk rebuilds without quadratic duplicate work', () => {
    const { system, chunksBuilt } = fixture();
    system.queueRebuild(16, 0);
    system.queueRebuild(16, 0);
    system.flushRebuilds();
    expect(new Set(chunksBuilt).size).toBe(chunksBuilt.length);
    expect(chunksBuilt).toContain('1,0');
    expect(chunksBuilt).toContain('0,0');
    expect(system.rebuildSet.size).toBe(0);
  });
  it('cleans up primed TNT meshes after removal', () => {
    const { system, scene } = fixture();
    system.spawnTnt(1, 2, 3, 1);
    expect(system.blasts).toHaveLength(1);
    expect(scene.children).toHaveLength(1);
    system.removeBlastAt(0);
    expect(system.blasts).toHaveLength(0);
    expect(scene.children).toHaveLength(0);
  });
  it('only damages blocks inside explosion radius', () => {
    const { system, blocks, key } = fixture();
    blocks.set(key(2, 2, 2), 3);
    blocks.set(key(20, 20, 20), 3);
    system.explode(2.5, 2.5, 2.5, 1, 100);
    expect(blocks.get(key(2, 2, 2))).toBe(0);
    expect(blocks.get(key(20, 20, 20))).toBe(3);
  });
});
