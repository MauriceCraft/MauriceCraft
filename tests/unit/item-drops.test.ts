import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createItemDropSystem } from '../../src/game/entities/item-drops';

function fixture() {
  const scene = new THREE.Scene();
  const player = { x: 20, y: 8, z: 20 };
  const giveItem = vi.fn();
  let dimension = 'overworld';
  const drops = createItemDropSystem({
    scene, atlas: new THREE.Texture(), atlasTiles: 128,
    tileOf: () => 8,
    getBlock: (_x, y) => y <= 5 ? 3 : 0,
    solid: b => b !== 0, player, giveItem,
    getDimension: () => dimension,
  });
  const tick = (seconds = 2) => {
    for (let t = 0; t < seconds; t += 0.05) drops.update(0.05);
  };
  return { drops, scene, giveItem, player, tick, setDimension: (next: string) => { dimension = next; } };
}

describe('physical block drops', () => {
  it('spawns a smaller textured block and lets it fall onto the terrain', () => {
    const f = fixture();
    f.drops.spawn(5, 1, 0.5, 13.5, 0.5);
    expect(f.drops.count()).toBe(1);
    expect(f.scene.children).toHaveLength(1);
    expect(f.giveItem).not.toHaveBeenCalled();
    f.tick(3);
    expect(f.drops.snapshot()[0].y).toBeCloseTo(6.15, 1);
    expect(f.giveItem).not.toHaveBeenCalled();
  });
  it('collects an item only after it has appeared and the player moves nearby', () => {
    const f = fixture();
    f.drops.spawn(5, 2, 0.5, 6.15, 0.5);
    f.tick(2);
    expect(f.giveItem).not.toHaveBeenCalled();
    f.player.x = 0.5; f.player.z = 0.5; f.player.y = 5.2;
    f.tick(2);
    expect(f.giveItem).toHaveBeenCalledWith(5, 2);
    expect(f.drops.count()).toBe(0);
  });
  it('keeps drops separate across dimensions and persists uncollected items', () => {
    const f = fixture();
    f.drops.spawn(41, 1, 0.5, 7, 0.5);
    const saved = f.drops.snapshot();
    f.setDimension('nether');
    f.drops.update(0.05);
    expect(f.giveItem).not.toHaveBeenCalled();
    f.drops.restore(saved);
    expect(f.drops.snapshot()[0]).toMatchObject({ id: 41, dimension: 'overworld' });
    expect(f.scene.children).toHaveLength(1);
    f.drops.clear();
    expect(f.scene.children).toHaveLength(0);
  });
  it('expires distant uncollected items and caps the number of active meshes', () => {
    const f = fixture();
    for (let i = 0; i < 270; i++) f.drops.spawn(5, 1, i + 100, 8, 0);
    expect(f.drops.count()).toBe(256);
    const saved = f.drops.snapshot();
    saved[0].age = 299.99;
    f.drops.restore(saved);
    f.drops.update(0.05);
    expect(f.drops.count()).toBe(255);
  });
});
