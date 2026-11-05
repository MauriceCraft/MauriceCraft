import { describe, expect, it, vi } from 'vitest';
import type { WorldRecord } from '../../src/game/storage/world-storage';
import { createWorldRestore, type RestorableGameState, type WorldRestoreDependencies } from '../../src/game/session/world-restore';
import type { SpawnMob } from '../../src/game/entities/mob-spawning';

function fixture() {
  const state: RestorableGameState = {
    dimension: 'overworld', enderDragonDefeated: false, selected: 2, tod: 0.4,
    mode: 'survival', difficulty: 'hard', spawnPoint: { x: 1, y: 2, z: 3 }, omen: true,
    weather: 'storm', weatherT: 1, rainLevel: 1, rainTarget: 1,
    ready: false, dead: true, hp: 5, hunger: 3, sat: 2,
  };
  const player = { x: 3, y: 11, z: 5, vx: 5, vy: 3, vz: 2, yaw: 0, pitch: 0,
    fly: false, fallStart: 30 as number | null };
  const portals: WorldRestoreDependencies['portals'] = [];
  const inventory: Record<string, number> = { 5: 10 };
  const toolWear: Record<string, number> = { 100: 7 };
  const hotbar = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const relics: unknown[] = [];
  const resetWorld = vi.fn(), clearMobs = vi.fn(), clearRelics = vi.fn();
  const updateHearts = vi.fn(), renderFood = vi.fn(), updateWeatherUI = vi.fn();
  const addMob = vi.fn((kind: string, x: number, y: number, z: number): SpawnMob =>
    ({ kind, x, y, z, hp: 20, persist: false } as SpawnMob));
  const deps: WorldRestoreDependencies = {
    state, player, portals, inventory, toolWear, hotbar,
    allBlocks: [2, 3, 4, 5, 6, 7, 8, 9, 10],
    savedChunks: new Map(), validDifficulties: { normal: {}, hard: {} },
    weatherLabels: { clear: 'Clear', rain: 'Rain', storm: 'Storm' },
    kinds: { irongolem: {} }, mobs: [], relics, maximumHealth: 20,
    resetWorld, clearPortalVisuals: vi.fn(), showPortalVisual: vi.fn(),
    clearMobs, clearRelics, addRelic: vi.fn(), createRelics: vi.fn(),
    setMode: mode => { state.mode = mode; state.hp = 20; state.hunger = 20; },
    updateHearts, renderFood, updateWeatherUI,
    addMob, hasChunk: () => true, respawn: vi.fn(), random: () => 0.5,
  };
  return { restore: createWorldRestore(deps), deps, state, player, portals,
    inventory, toolWear, hotbar, resetWorld, clearMobs, clearRelics,
    updateHearts, renderFood, updateWeatherUI, addMob };
}

describe('saved-world restoration', () => {
  it('restores compatible legacy metadata without resetting the selected game mode', () => {
    const f = fixture();
    const world: WorldRecord = {
      id: 'old', name: 'Saved World', seed: 501, created: 1, lastPlayed: 2,
      mode: 'survival', difficulty: 'normal', dimension: 'overworld',
      player: { x: 35, y: 20, z: -18, yaw: 1, pitch: 0.3, fly: false },
      inv: { 3: 10 }, toolWear: { 101: 12 },
      hunger: 13, sat: 4, hp: 8, selected: 5, tod: 0.6,
      weather: { w: 'rain', t: 15, r: 0.7 },
      portals: [{ dimension: 'overworld', x: 10, y: 2, z: 6 }],
    };
    f.restore.applyWorld(world);
    expect(f.resetWorld).toHaveBeenCalledWith(501, 2, -2, 1);
    expect(f.player.x).toBe(35);
    expect(f.player.vx).toBe(0);
    expect(f.state.mode).toBe('survival');
    expect(f.state.hp).toBe(8);
    expect(f.state.hunger).toBe(13);
    expect(f.state.rainTarget).toBe(0.75);
    expect(f.inventory).toEqual({ 3: 10 });
    expect(f.toolWear).toEqual({ 101: 12 });
    expect(f.portals).toHaveLength(1);
    expect(f.portals[0].axis).toBe('x');
    expect(f.state.ready).toBe(true);
    expect(f.state.dead).toBe(false);
  });

  it('restores saved golems without duplicating ordinary creatures', () => {
    const f = fixture();
    const world: WorldRecord = {
      id: 'saved', name: 'Saved World', seed: 4, created: 1, lastPlayed: 1,
      player: { x: 1, y: 20, z: 1, yaw: 0, pitch: 0, fly: false },
      golems: [
        { kind: 'irongolem', x: 2, y: 21, z: 3, hp: 45, hx: 1, hz: 1 },
        { kind: 'cow', x: 2, y: 21, z: 3, hp: 10, hx: 1, hz: 1 },
        { kind: 'irongolem', x: 300, y: 21, z: 300, hp: 30, hx: 300, hz: 300 },
      ],
    };
    f.restore.applyWorld(world);
    expect(f.addMob).toHaveBeenCalledOnce();
    const golem = f.addMob.mock.results[0].value;
    expect(golem).toMatchObject({ kind: 'irongolem', hp: 45, persist: true, hx: 1, hz: 1 });
  });

  it('prepares a new world without carrying old inventory or chunk backups forward', () => {
    const f = fixture();
    f.deps.savedChunks.set(99, new Uint8Array([1]));
    f.restore.prepareNewWorld({ id: 'new', name: 'World 2', seed: 700, created: 1, lastPlayed: 1 });
    expect(f.deps.savedChunks.size).toBe(0);
    expect(f.resetWorld).toHaveBeenCalledWith(700, 0, 0, 1);
    expect(f.state.spawnPoint).toBeNull();
    expect(f.state.omen).toBe(false);
    expect(f.state.weatherT).toBe(570);
    expect(f.state.tod).toBe(0.22);
    expect(f.state.ready).toBe(true);
    expect(f.inventory).toEqual({});
    expect(f.toolWear).toEqual({});
    expect(f.hotbar).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('loads defaults for missing fields in old saves and rejects unsupported dimensions', () => {
    const f = fixture();
    f.restore.applyWorld({
      id: 'older', name: 'Old', seed: 1, created: 1, lastPlayed: 1,
      dimension: 'moon', mode: 'creative', difficulty: 'nightmare',
    });
    expect(f.state.dimension).toBe('overworld');
    expect(f.state.difficulty).toBe('normal');
    expect(f.state.hp).toBe(20);
    expect(f.state.hunger).toBe(20);
    expect(f.state.sat).toBe(5);
    expect(f.player.x).toBe(0.5);
    expect(f.player.fly).toBe(false);
  });
});
