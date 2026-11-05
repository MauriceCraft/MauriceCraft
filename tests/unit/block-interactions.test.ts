import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createBlockInteractions, type BlockInteractionDependencies, type BlockTarget } from '../../src/game/interactions/block-interactions';
import type { SpawnMob } from '../../src/game/entities/mob-spawning';

function fixture() {
  const camera = new THREE.PerspectiveCamera();
  const player = { x: 20, y: 10, z: 20, yaw: 0, vx: 0, vz: 0 };
  const cells = new Map<string, number>();
  const key = (x: number, y: number, z: number) => [x, y, z].join(',');
  const getBlock = (x: number, y: number, z: number) => cells.get(key(x, y, z)) ?? 0;
  const setBlock = vi.fn((x: number, y: number, z: number, id: number) => { cells.set(key(x, y, z), id); });
  const hotbar = [17];
  const inventory: Record<number, number> = { 17: 2, 19: 1, 31: 4, 13: 1 };
  let mode = 'survival';
  let target: BlockTarget | null = null;
  let hunger = 9, satiety = 2;
  const flashName = vi.fn();
  const showHint = vi.fn();
  const playSound = vi.fn();
  const updateHotbar = vi.fn();
  const refreshAround = vi.fn();
  const spawnTnt = vi.fn();
  const addMob = vi.fn((kind: string, x: number, y: number, z: number): SpawnMob =>
    ({ kind, x, y, z, hp: 20, persist: false, hx: 0, hz: 0 } as SpawnMob));
  const deps: BlockInteractionDependencies = {
    camera, player, mobs: [], portals: [], hotbar, inventory,
    names: { 3: 'Stone', 13: 'Hay Bale', 17: 'Torch', 19: 'Bed', 31: 'Iron Block', 60: 'Beef' },
    tools: {}, kinds: { villager: { r: 0.3, h: 1.95, hp: 20 }, irongolem: { r: 0.45, h: 2.7, hp: 100 },
      zombie: { r: 0.3, h: 1.8, hp: 20, hostile: true } },
    jobs: ['farmer'], food: { 60: 5 }, drops: {}, requiresPick: {},
    eggKinds: { 150: 'zombie' }, bedDirections: [[1, 0], [0, 1], [-1, 0], [0, -1]],
    worldHeight: 48, playerRadius: 0.3, playerHeight: 1.8, bedHeight: 0.57,
    blockIds: { BED: 19, GRAVEL: 12, GUNPOWDER: 80, TORCH: 17, TNT: 16,
      FLINT: 79, DYNAMITE: 78, OBSIDIAN: 36, HAY: 13,
      IRON_INGOT: 81, COPPER_INGOT: 82, DIAMOND: 83 },
    getSelected: () => 0, getTarget: () => target, getMode: () => mode,
    getDimension: () => 'overworld', getDifficultyCap: () => 8,
    getHunger: () => hunger, setHunger: value => { hunger = value; },
    getSatiety: () => satiety, setSatiety: value => { satiety = value; },
    isNight: () => false, getWeather: () => 'clear', hasHealth: () => true,
    setSpawnPoint: vi.fn(), startSleeping: vi.fn(),
    getBlock, setBlock, inBounds: (x, y, z) => Number.isFinite(x) && y >= 0 && y < 48 && Number.isFinite(z),
    hasChunk: () => true, solid: id => id !== 0, isBed: id => id >= 19 && id <= 26,
    collides: () => false, heldTool: () => null, canCollect: () => true,
    wearTool: vi.fn(), spendItem: id => { if (!(inventory[id] > 0)) return false; inventory[id]--; return true; },
    exert: vi.fn(), giveItem: vi.fn(), updateHotbar, renderFood: vi.fn(),
    showHint, flashName, playSound, playSoundAt: vi.fn(), refreshAround,
    queueRebuild: vi.fn(), flushRebuilds: vi.fn(), rebuildRegion: vi.fn(),
    ensureAround: vi.fn(), showPortalVisual: vi.fn(), saveWorld: vi.fn(),
    spawnTnt, addDynamite: vi.fn(), addMob,
  };
  const interactions = createBlockInteractions(deps);
  return { interactions, cells, getBlock, setBlock, hotbar, inventory, flashName, showHint, refreshAround,
    playSound, spawnTnt, addMob,
    setCell: (x: number, y: number, z: number, id: number) => { cells.set(key(x, y, z), id); },
    setTarget: (value: BlockTarget | null) => { target = value; },
    setMode: (value: string) => { mode = value; },
    getHunger: () => hunger };
}

describe('block and item interactions', () => {
  it('refuses unsupported torches and consumes one only on valid placement', () => {
    const f = fixture();
    f.setTarget({ x: 0, y: 1, z: 0, nx: 0, ny: 1, nz: 0 });
    f.interactions.doPlace();
    expect(f.inventory[17]).toBe(2);
    expect(f.getBlock(0, 2, 0)).toBe(0);
    f.setCell(0, 1, 0, 3);
    f.interactions.doPlace();
    expect(f.getBlock(0, 2, 0)).toBe(17);
    expect(f.inventory[17]).toBe(1);
    expect(f.refreshAround).toHaveBeenCalledWith(0, 0, true);
  });

  it('does not place blocks or change inventory when the selected hotbar slot is empty', () => {
    const f = fixture();
    f.hotbar[0] = 0;
    f.setTarget({ x: 1, y: 0, z: 0, nx: 0, ny: 1, nz: 0 });
    f.interactions.useSelected();
    expect(f.setBlock).not.toHaveBeenCalled();
    expect(f.inventory[0]).toBeUndefined();
  });

  it('places ordinary blocks in creative without consuming inventory', () => {
    const f = fixture();
    f.setMode('creative');
    f.hotbar[0] = 3;
    f.setTarget({ x: 1, y: 0, z: 0, nx: 0, ny: 1, nz: 0 });
    f.interactions.doPlace();
    expect(f.getBlock(1, 1, 0)).toBe(3);
    expect(f.inventory[3]).toBeUndefined();
  });

  it('places both halves of a bed and keeps the same orientation and inventory cost', () => {
    const f = fixture();
    f.hotbar[0] = 19;
    f.setCell(0, 0, 0, 3);
    f.setCell(0, 0, -1, 3);
    f.setTarget({ x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 });
    f.interactions.doPlace();
    expect(f.getBlock(0, 1, 0)).toBe(25);
    expect(f.getBlock(0, 1, -1)).toBe(26);
    expect(f.inventory[19]).toBe(0);
  });

  it('clears the matching bed half when broken', () => {
    const f = fixture();
    f.setCell(0, 1, 0, 25);
    f.setCell(0, 1, -1, 26);
    f.interactions.doBreak({ x: 0, y: 1, z: 0 });
    expect(f.getBlock(0, 1, 0)).toBe(0);
    expect(f.getBlock(0, 1, -1)).toBe(0);
    expect(f.inventory[19]).toBe(2);
  });

  it('forms an iron golem from the same five-block T pattern', () => {
    const f = fixture();
    f.setCell(0, 3, 0, 13);
    f.setCell(0, 2, 0, 31);
    f.setCell(0, 1, 0, 31);
    f.setCell(-1, 2, 0, 31);
    f.setCell(1, 2, 0, 31);
    expect(f.interactions.tryBuildGolem(0, 2, 0)).toBe(true);
    expect(f.addMob).toHaveBeenCalledWith('irongolem', 0.5, 1.01, 0.5, null);
    expect(f.getBlock(0, 3, 0)).toBe(0);
    expect(f.getBlock(1, 2, 0)).toBe(0);
  });
});
