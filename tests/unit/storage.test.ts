import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { openWorldStorage, type ChunkRecord, type WorldRecord, type WorldStorage } from '../../src/game/storage/world-storage';

let current: WorldStorage | undefined;
const name = (): string => 'mauricecraft-test-' + crypto.randomUUID();
const world = (id = 'w1'): WorldRecord => ({
  id, name: 'Practice world', seed: 1234, created: 1, lastPlayed: 2,
  portals: [{ dimension: 'nether', axis: 'z', x: 6, y: 10, z: 4 }],
});
const chunk = (w = 'w1', cx = 2, cz = 3): ChunkRecord => ({
  k: `${w}:${cx},${cz}`, w, cx, cz, data: Uint8Array.from([0, 36, 0, 7]),
});

afterEach(async () => {
  if (!current) return;
  const db = current;
  current = undefined;
  await db.delete();
});

describe('Dexie storage and cache', () => {
  it('round-trips metadata and typed chunk buffers in one transaction', async () => {
    current = await openWorldStorage(name());
    await current.saveWorld(world(), [chunk()]);
    expect(await current.listWorlds()).toMatchObject([{ id: 'w1', seed: 1234 }]);
    expect((await current.getChunks('w1'))[0].data).toEqual(chunk().data);
    expect(await current.getWorld('w1')).toEqual(world());
  });

  it('does not allow callers to mutate cached metadata', async () => {
    current = await openWorldStorage(name());
    await current.saveWorld(world(), []);
    const first = await current.getWorld('w1');
    if (!first) throw new Error('World missing');
    first.name = 'Not saved';
    expect((await current.getWorld('w1'))?.name).toBe('Practice world');
    await current.saveWorld({ ...world(), name: 'Updated' }, []);
    expect((await current.getWorld('w1'))?.name).toBe('Updated');
  });

  it('rolls back metadata when a chunk write fails', async () => {
    current = await openWorldStorage(name());
    const invalid = { ...chunk(), k: undefined } as unknown as ChunkRecord;
    await expect(current.saveWorld(world(), [invalid])).rejects.toThrow();
    // The world and its chunks must commit together, never half-save.
    expect(await current.listWorlds()).toEqual([]);
    expect(await current.getChunks('w1')).toEqual([]);
    await current.saveWorld(world(), [chunk()]);
    expect(await current.getWorld('w1')).toMatchObject({ id: 'w1' });
  });

  it('removes only the chosen world and its chunks', async () => {
    current = await openWorldStorage(name());
    await current.saveWorld(world('w1'), [chunk('w1')]);
    await current.saveWorld(world('w2'), [chunk('w2')]);
    await current.getWorld('w1'); // warm the metadata cache first
    await current.deleteWorld('w1');
    expect(await current.getWorld('w1')).toBeUndefined();
    expect(await current.getChunks('w1')).toEqual([]);
    expect((await current.getChunks('w2')).length).toBe(1);
  });
});

describe('existing browser saves', () => {
  it('opens the old raw IndexedDB v1 schema and keeps its world and chunks', async () => {
    const dbName = name();
    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('worlds', { keyPath: 'id' });
        req.result.createObjectStore('chunks', { keyPath: 'k' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = raw.transaction(['worlds', 'chunks'], 'readwrite');
      tx.objectStore('worlds').put(world());
      tx.objectStore('chunks').put(chunk());
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    raw.close();

    current = await openWorldStorage(dbName);
    expect((await current.getWorld('w1'))?.seed).toBe(1234);
    expect((await current.getChunks('w1'))[0].data).toEqual(chunk().data);
    expect(current.verno).toBe(1);
  });
});
