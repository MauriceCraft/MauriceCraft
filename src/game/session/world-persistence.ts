import { ckey } from '../world/chunk-key';
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
 * When in the Nether or End, snapshot cached Overworld chunks instead of
 * writing temporary dimension data into the persistent Overworld slots.
 */
export function collectWorldSaveBatch(
  world: WorldRecord,
  dimension: string,
  chunks: ReadonlyMap<number, WritableChunk>,
  savedChunks: ReadonlyMap<number, Uint8Array>,
): SaveBatch {
  const dirtyChunks: WritableChunk[] = [];
  if (dimension === 'overworld') {
    for (const chunk of chunks.values()) if (chunk.dirty) dirtyChunks.push(chunk);
  }
  const records = new Map<number, ChunkRecord>();
  for (const chunk of dirtyChunks) {
    chunk.dirty = false;
    records.set(ckey(chunk.cx, chunk.cz), {
      k: world.id + ':' + chunk.cx + ',' + chunk.cz,
      w: world.id, cx: chunk.cx, cz: chunk.cz, data: chunk.data.slice(),
    });
  }
  if (dimension !== 'overworld') {
    for (const [chunkKey, data] of savedChunks) {
      const chunkX = ((chunkKey >> 16) << 16) >> 16;
      const chunkZ = (chunkKey << 16) >> 16;
      records.set(chunkKey, {
        k: world.id + ':' + chunkX + ',' + chunkZ,
        w: world.id, cx: chunkX, cz: chunkZ, data: data.slice(),
      });
    }
  }
  return {
    records: [...records.values()],
    restoreDirty: () => { for (const chunk of dirtyChunks) chunk.dirty = true; },
  };
}
