import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { WorldStore, type ChunkRecord, type WorldRecord } from '../../src/game/storage/world-store';

const dbNames: string[] = [];
function makeStore(): { db: WorldStore; name: string } {
  const name = `mauricecraft-test-${dbNames.length}`;
  dbNames.push(name);
  return { db: new WorldStore(name), name };
}
const world: WorldRecord = { id: 'w-one', name: 'My World', seed: 125, mode: 'creative' };
const chunk: ChunkRecord = { k: 'w-one:0,0', w: 'w-one', cx: 0, cz: 0, data: new Uint8Array([1, 2, 36]) };

afterEach(async () => {
  await Promise.all(dbNames.splice(0).map(name => Dexie.delete(name)));
});

describe('world persistence with Dexie', () => {
  it('opens the existing native IndexedDB v1 schema without resetting records', async () => {
    const { db, name } = makeStore();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('worlds', { keyPath: 'id' });
        request.result.createObjectStore('chunks', { keyPath: 'k' });
      };
      request.onsuccess = () => {
        const raw = request.result;
        const tx = raw.transaction(['worlds', 'chunks'], 'readwrite');
        tx.objectStore('worlds').put(world);
        tx.objectStore('chunks').put(chunk);
        tx.oncomplete = () => { raw.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
    await db.open();
    expect((await db.getWorld('w-one'))?.seed).toBe(125);
    expect(await db.getChunks('w-one')).toEqual([chunk]);
    db.close();
  });

  it('writes chunks atomically and loads each world separately', async () => {
    const { db } = makeStore();
    await db.open();
    await db.saveWorld(world, [chunk]);
    await db.saveWorld({ id: 'w-two', name: 'Other', seed: 444 }, [
      { k: 'w-two:0,0', w: 'w-two', cx: 0, cz: 0, data: [9] },
    ]);
    expect((await db.getChunks('w-one'))[0].data).toEqual(chunk.data);
    expect(await db.getChunks('w-two')).toHaveLength(1);
    expect(await db.listWorlds()).toHaveLength(2);
    db.close();
  });

  it('invalidates the metadata cache on save and delete', async () => {
    const { db } = makeStore();
    await db.open();
    expect(await db.listWorlds()).toEqual([]);
    await db.saveWorld(world, [chunk]);
    expect((await db.listWorlds()).map(item => item.name)).toEqual(['My World']);
    await db.saveWorld({ ...world, name: 'Renamed' }, []);
    expect((await db.listWorlds()).map(item => item.name)).toEqual(['Renamed']);
    await db.deleteWorld('w-one');
    expect(await db.listWorlds()).toEqual([]);
    expect(await db.getChunks('w-one')).toEqual([]);
    db.close();
  });
});
