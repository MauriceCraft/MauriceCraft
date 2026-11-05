import Dexie, { type Table } from 'dexie';

export const WORLD_DB_NAME = 'blockcraft-worlds';
const MAX_CACHED_WORLDS = 16;

/** Additional fields are kept verbatim so older saved-world data survives. */
export interface WorldRecord {
  id: string;
  name: string;
  seed: number;
  /** Missing on pre-biome worlds, which retain generator v1 forever. */
  generatorVersion?: number;
  created: number;
  lastPlayed: number;
  [key: string]: unknown;
}

export interface ChunkRecord {
  /** Historical storage key: world-id + ':' + chunk-x + ',' + chunk-z. */
  k: string;
  w: string;
  cx: number;
  cz: number;
  /** Absent for legacy Overworld chunks. The IndexedDB key path stays unchanged. */
  dimension?: 'overworld' | 'nether' | 'end';
  data: Uint8Array;
}

/**
 * Typed access to the existing IndexedDB database. Version 1 deliberately
 * matches the original raw IndexedDB key paths and adds no new indexes.
 */
export class WorldStorage extends Dexie {
  declare worlds: Table<WorldRecord, string>;
  declare chunks: Table<ChunkRecord, string>;
  private readonly worldCache = new Map<string, WorldRecord>();

  constructor(name = WORLD_DB_NAME) {
    super(name);
    this.version(1).stores({ worlds: 'id', chunks: 'k' });
  }

  async listWorlds(): Promise<WorldRecord[]> {
    return this.worlds.toArray();
  }

  async getWorld(id: string): Promise<WorldRecord | undefined> {
    const cached = this.worldCache.get(id);
    if (cached) {
      this.worldCache.delete(id);
      this.worldCache.set(id, cached);
      return structuredClone(cached);
    }
    const world = await this.worlds.get(id);
    if (world) this.rememberWorld(world);
    return world ? structuredClone(world) : undefined;
  }

  async getChunks(worldId: string): Promise<ChunkRecord[]> {
    // Chunks are loaded once per selected world into the gameplay chunk map.
    // Do not duplicate large Uint8Arrays in another long-lived cache.
    return this.chunks.where('k')
      .between(worldId + ':', worldId + ':\uffff', true, true)
      .toArray();
  }

  async saveWorld(world: WorldRecord, chunks: readonly ChunkRecord[]): Promise<void> {
    // A single transaction prevents saving metadata without its changed chunks.
    await this.transaction('rw', this.worlds, this.chunks, async () => {
      await this.worlds.put(world);
      if (chunks.length) await this.chunks.bulkPut([...chunks]);
    });
    this.rememberWorld(world);
  }

  async deleteWorld(id: string): Promise<void> {
    await this.transaction('rw', this.worlds, this.chunks, async () => {
      await this.worlds.delete(id);
      await this.chunks.where('k')
        .between(id + ':', id + ':\uffff', true, true)
        .delete();
    });
    this.worldCache.delete(id);
  }

  override close(): void {
    this.worldCache.clear();
    super.close();
  }

  private rememberWorld(world: WorldRecord): void {
    this.worldCache.delete(world.id);
    this.worldCache.set(world.id, structuredClone(world));
    if (this.worldCache.size > MAX_CACHED_WORLDS) {
      const oldest = this.worldCache.keys().next().value;
      if (oldest !== undefined) this.worldCache.delete(oldest);
    }
  }
}

/** Open the existing database without deleting, upgrading or resetting it. */
export async function openWorldStorage(name = WORLD_DB_NAME): Promise<WorldStorage> {
  const storage = new WorldStorage(name);
  await storage.open();
  return storage;
}
