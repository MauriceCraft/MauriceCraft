import { describe, expect, it } from 'vitest';
import { ckey } from '../../src/game/world/chunk-key';
import type { WritableChunk } from '../../src/game/world/block-access';
import type { WorldRecord } from '../../src/game/storage/world-storage';
import { collectWorldSaveBatch, snapshotWorldState, type WorldSnapshotState } from '../../src/game/session/world-persistence';

const world = (): WorldRecord => ({ id: 'w-old', name: 'Old World', seed: 7, created: 10, lastPlayed: 10, extraLegacy: 5 });
const chunk = (x: number, z: number, edited = true): WritableChunk => ({
  cx: x, cz: z, data: new Uint8Array([3, 4, 5]), meshed: false, edited, dirty: edited,
});

describe('save format compatibility', () => {
  it('preserves previous metadata while copying player state and persistent golems', () => {
    const state: WorldSnapshotState = {
      dimension: 'overworld', enderDragonDefeated: false, portals: [],
      mode: 'survival', difficulty: 'normal', spawn: null, omen: true,
      hunger: 13, satiety: 4, weather: { w: 'rain', t: 100, r: 0.7 },
      timeOfDay: 0.65, health: 9, selected: 2, hotbar: [1, 2, 3],
      inventory: { 3: 99 }, player: { x: 2, y: 3, z: 4, yaw: 0, pitch: 0, fly: false },
      relics: [{ x: 6, y: 7, z: 8, got: true }], toolWear: { 110: 4 },
      golems: [
        { kind: 'irongolem', x: 1, y: 2, z: 3, hp: 19, hx: 1, hz: 3, golem: true, persist: true },
        { kind: 'cow', x: 1, y: 2, z: 3, hp: 10, hx: 1, hz: 3, golem: false, persist: true },
      ],
    };
    const old = world();
    const saved = snapshotWorldState(old, state, 1234);
    expect(saved).toBe(old);
    expect(saved.extraLegacy).toBe(5);
    expect(saved.lastPlayed).toBe(1234);
    expect(saved.sat).toBe(4);
    expect(saved.tod).toBe(0.65);
    expect(saved.inv).toEqual({ 3: 99 });
    expect(saved.golems).toEqual([{ kind: 'irongolem', x: 1, y: 2, z: 3, hp: 19, hx: 1, hz: 3 }]);
    state.hotbar[0] = 99;
    expect(saved.hotbar).toEqual([1, 2, 3]);
  });

  it('saves only dirty overworld chunks and supports retry after save failure', () => {
    const dirty = chunk(-3, 5);
    const clean = chunk(1, 1, false);
    const chunks = new Map([[ckey(-3, 5), dirty], [ckey(1, 1), clean]]);
    const batch = collectWorldSaveBatch(world(), 'overworld', chunks, new Map());
    expect(batch.records.map(c => c.k)).toEqual(['w-old:-3,5']);
    expect(batch.records[0].data).toEqual(dirty.data);
    expect(dirty.dirty).toBe(false);
    dirty.data[0] = 9;
    expect(batch.records[0].data[0]).toBe(3);
    batch.restoreDirty();
    expect(dirty.dirty).toBe(true);
    expect(clean.dirty).toBe(false);
  });

  it('keeps overworld snapshots while changing dimension, including negative coordinates', () => {
    const inNether = chunk(0, 0);
    const cache = new Map([[ckey(-1, -2), new Uint8Array([11, 12])]]);
    const batch = collectWorldSaveBatch(world(), 'nether', new Map([[ckey(0, 0), inNether]]), cache);
    expect(batch.records.map(c => [c.k, c.cx, c.cz])).toEqual([['w-old:-1,-2', -1, -2]]);
    expect(batch.records[0].data).toEqual(new Uint8Array([11, 12]));
    expect(inNether.dirty).toBe(true);
  });
});
