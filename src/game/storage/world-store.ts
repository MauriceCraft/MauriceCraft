import Dexie, { type EntityTable } from 'dexie';

/**
 * IMPORTANT: this is the original browser database schema, unchanged.
 * Native IndexedDB saves created before Dexie must still open as-is.
 */
export interface WorldRecord {
  id: string;
  name: string;
  seed: number;
  lastPlayed?: number;
  created?: number;
  mode?: string;
  [property: string]: unknown;
}

export interface ChunkRecord {
  /** Existing composite key: `<world id>:<chunk x>,<chunk z>`. */
  k: string;
  w: string;
  cx: number;
  cz: number;
  data: Uint8Array | number[];
}

type GameDatabase = Dexie & {
  worlds: EntityTable<WorldRecord, 'id'>;
  chunks: EntityTable<ChunkRecord, 'k'>;
};

/** Bounded metadata cache. Terrain remains owned by the game's chunk maps. */
export class WorldStore {
  private readonly db: GameDatabase;
  private worldListCache: WorldRecord[] | null = null;

  constructor(name = 'blockcraft-worlds') {
    this.db = new Dexie(name) as GameDatabase;
    // Same version and primary keys as original native IndexedDB.
    this.db.version(1).stores({ worlds: 'id', chunks: 'k' });
  }

  async open(): Promise<void> {
    await this.db.open();
  }

  async listWorlds(): Promise<WorldRecord[]> {
    if (!this.worldListCache) {
      this.worldListCache = await this.db.worlds.toArray();
    }
    return this.worldListCache.slice();
  }

  async getWorld(id: string): Promise<WorldRecord | undefined> {
    return this.db.worlds.get(id);
  }

  async getChunks(worldId: string): Promise<ChunkRecord[]> {
    // Only a world prefix is scanned. No additional duplicate chunk cache:
    // gameplay already keeps loaded chunks and savedChunks in memory.
    return this.db.chunks.where('k')
      .between(`${worldId}:`, `${worldId}:\uffff`, true, true)
      .toArray();
  }

  async saveWorld(meta: WorldRecord, chunks: ChunkRecord[]): Promise<void> {
    // Metadata and modified chunks commit together or not at all.
    await this.db.transaction('rw', this.db.worlds, this.db.chunks, async () => {
      await this.db.worlds.put(meta);
      if (chunks.length) await this.db.chunks.bulkPut(chunks);
    });
    this.worldListCache = null;
  }

  async deleteWorld(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.worlds, this.db.chunks, async () => {
      await this.db.chunks.where('k')
        .between(`${id}:`, `${id}:\uffff`, true, true)
        .delete();
      await this.db.worlds.delete(id);
    });
    this.worldListCache = null;
  }

  close(): void {
    this.db.close();
    this.worldListCache = null;
  }
}
