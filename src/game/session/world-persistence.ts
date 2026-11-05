import { savedChunkKey } from './dimension-chunk-records';
import type { WritableChunk } from '../world/block-access';
import type { WorldRecord, ChunkRecord } from '../storage/world-storage';
import type { SaveBatch } from './world-session';
import type { PortalFrame } from '../portals/frame';

export interface WorldSnapshotState {
  dimension: string;
  enderDragonDefeated: boolean;
  portals: readonly PortalFrame[];
  mode: string;
  difficulty: string;
  spawn: { x: number; y: number; z: number } | null;
  omen: boolean;
  hunger: number;
  satiety: number;
  weather: { w: string; t: number; r: number };
  timeOfDay: number;
  health: number;
  selected: number;
  hotbar: readonly number[];
  inventory: Readonly<Record<number, number>>;
  player: { x: number; y: number; z: number; yaw: number; pitch: number; fly: boolean };
  relics: readonly { x: number; y: number; z: number; got: boolean }[];
  toolWear: Readonly<Record<number, number>>;
  golems: readonly { kind: string; x: number; y: number; z: number;
    hp: number; hx: number; hz: number; golem: boolean; persist: boolean }[];
}

/** Writes exactly the existing world metadata keys, retaining unknown legacy fields. */
export function snapshotWorldState(world: WorldRecord, state: WorldSnapshotState, now = Date.now()): WorldRecord {
  world.dimension = state.dimension;
  world.enderDragonDefeated = state.enderDragonDefeated;
  world.portals = state.portals.map(p => ({ ...p }));
  world.mode = state.mode;
  world.difficulty = state.difficulty;
  world.spawn = state.spawn;
  world.omen = state.omen;
  world.hunger = state.hunger;
  world.sat = state.satiety;
  world.weather = { ...state.weather };
  world.lastPlayed = now;
  world.tod = state.timeOfDay;
  world.hp = state.health;
  world.selected = state.selected;
  world.hotbar = [...state.hotbar];
  world.inv = { ...state.inventory };
  world.player = { ...state.player };
  world.relics = state.relics.map(({ x, y, z, got }) => ({ x, y, z, got }));
  world.toolWear = { ...state.toolWear };
  world.golems = state.golems.filter(g => g.golem && g.persist).map(g => ({
    kind: g.kind, x: g.x, y: g.y, z: g.z, hp: g.hp, hx: g.hx, hz: g.hz,
  }));
  return world;
}

/**
 * Preserve historical chunk keys, and re-mark unsaved edits on write failure.
 * Persist edits from all dimensions under unique keys. The original Overworld
 * key format stays intact so pre-upgrade saves can be read unchanged.
 */
export function collectWorldSaveBatch(
  world: WorldRecord,
  dimension: string,
  chunks: ReadonlyMap<number, WritableChunk>,
  savedChunks: ReadonlyMap<number, Uint8Array>,
  dimensionChunks: ReadonlyMap<string, ReadonlyMap<number, Uint8Array>> = new Map(),
): SaveBatch {
  const dirtyChunks: WritableChunk[] = [];
  for (const chunk of chunks.values()) if (chunk.dirty) dirtyChunks.push(chunk);
  const records = new Map<string, ChunkRecord>();
  function remember(dim: string, cx: number, cz: number, data: Uint8Array): void {
    const k = savedChunkKey(world.id, dim, cx, cz);
    records.set(k, { k, w: world.id, cx, cz, data: data.slice(),
      ...(dim === 'overworld' ? {} : { dimension: dim as 'nether' | 'end' }) });
  }
  function unpack(key: number): [number, number] {
    return [((key >> 16) << 16) >> 16, (key << 16) >> 16];
  }
  // The older save pipeline buffered edited Overworld chunks during portal travel.
  if (dimension !== 'overworld') for (const [key, data] of savedChunks) {
    const [cx, cz] = unpack(key);
    remember('overworld', cx, cz, data);
  }
  for (const [dim, cache] of dimensionChunks) {
    if (dim === 'overworld' || (dim !== 'nether' && dim !== 'end')) continue;
    for (const [key, data] of cache) {
      const [cx, cz] = unpack(key);
      remember(dim, cx, cz, data);
    }
  }
  // Current-dimension writes override any older cached copy of that same chunk.
  for (const chunk of dirtyChunks) {
    chunk.dirty = false;
    remember(dimension, chunk.cx, chunk.cz, chunk.data);
  }
  return {
    records: [...records.values()],
    restoreDirty: () => { for (const chunk of dirtyChunks) chunk.dirty = true; },
  };
}
