import type { ChunkRecord, WorldRecord, WorldStorage } from '../storage/world-storage';

export interface SaveBatch {
  records: ChunkRecord[];
  /** Re-mark modified chunks so a failed write can be retried safely. */
  restoreDirty: () => void;
}

export interface WorldSessionDependencies {
  openStorage: () => Promise<WorldStorage>;
  isWorldReady: () => boolean;
  setWorldReady: (ready: boolean) => void;
  snapshotWorld: (world: WorldRecord) => WorldRecord;
  collectSaveBatch: (world: WorldRecord) => SaveBatch;
  applyLoadedWorld: (world: WorldRecord, chunks: readonly ChunkRecord[]) => void;
  prepareNewWorld: (world: WorldRecord) => void;
  startPlaying: () => void;
  modeLabel: (mode: unknown) => string;
  showHint: (message: string, duration: number) => void;
}

export function timeAgo(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, (now - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + ' min ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + ' h ago';
  return Math.floor(seconds / 86400) + ' d ago';
}

/** World names are human-readable; IDs must not depend on name or order. */
export const CURRENT_WORLD_GENERATOR_VERSION = 2;

/** Full 32-bit seeds; avoid reuse among locally saved worlds where possible. */
export function nextWorldSeed(worlds: readonly WorldRecord[], random: () => number = Math.random): number {
  const used = new Set(worlds.map(world => world.seed));
  for (let attempt = 0; attempt < 32; attempt++) {
    const seed = Math.floor(random() * 0x100000000) >>> 0;
    if (!used.has(seed)) return seed;
  }
  let seed = 0;
  while (used.has(seed)) seed = (seed + 1) >>> 0;
  return seed;
}

export function nextWorldName(worlds: readonly WorldRecord[]): string {
  let highestNumber = 0;
  for (const world of worlds) {
    const match = /^World (\d+)$/.exec(world.name);
    if (match) highestNumber = Math.max(highestNumber, Number(match[1]));
  }
  return 'World ' + (highestNumber + 1);
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error('World session is missing #' + id);
  return element as T;
}

/**
 * Owns the IndexedDB connection, serialized autosaves, menu world list, and
 * world lifecycle. Gameplay state remains with the game runtime callbacks.
 */
export function createWorldSession(deps: WorldSessionDependencies) {
  const worldsElement = requireElement<HTMLElement>('worlds');
  const storageNotice = requireElement<HTMLElement>('saveNote');
  const subtitle = requireElement<HTMLElement>('sub');
  const playButton = requireElement<HTMLButtonElement>('play');
  const newWorldButton = requireElement<HTMLButtonElement>('newworld');
  let database: WorldStorage | null = null;
  let storageAvailable = false;
  let currentWorld: WorldRecord | null = null;
  let worlds: WorldRecord[] = [];
  let pendingSave: Promise<void> = Promise.resolve();
  let busy = false;

  async function persistSnapshot(): Promise<void> {
    if (!storageAvailable || !database || !currentWorld || !deps.isWorldReady()) return;
    const metadata = deps.snapshotWorld(currentWorld);
    const batch = deps.collectSaveBatch(metadata);
    try {
      await database.saveWorld(metadata, batch.records);
    } catch (error) {
      batch.restoreDirty();
      throw error;
    }
  }

  function saveWorld(): Promise<void> {
    pendingSave = pendingSave.then(persistSnapshot).catch(error => {
      console.error('MauriceCraft save failed:', error);
      deps.showHint('Saving failed. Your changes are still in memory; keep this tab open and try again.', 6500);
    });
    return pendingSave;
  }

  function setBusy(isBusy: boolean, status?: string): void {
    busy = isBusy;
    playButton.disabled = isBusy;
    newWorldButton.disabled = isBusy;
    worldsElement.classList.toggle('busy', isBusy);
    if (isBusy) {
      playButton.textContent = 'Loading…';
      subtitle.textContent = status ?? 'Loading…';
    }
  }

  function renderWorldList(): void {
    worldsElement.replaceChildren();
    storageNotice.textContent = storageAvailable
      ? 'Worlds save automatically in this browser, including every block you change.'
      : 'Saving is not available in this browser, so this world will be lost when you leave.';
    for (const world of worlds) {
      const selected = currentWorld?.id === world.id;
      const row = document.createElement('div');
      row.className = 'world' + (selected ? ' on' : '');
      const openButton = document.createElement('button');
      openButton.type = 'button';
      openButton.className = 'wmain';
      openButton.appendChild(document.createTextNode(world.name));
      const details = document.createElement('small');
      details.textContent = deps.modeLabel(world.mode) + ' · played ' +
        timeAgo(world.lastPlayed || world.created || Date.now());
      openButton.appendChild(details);
      openButton.addEventListener('click', () => {
        if (busy) return;
        if (selected) deps.startPlaying();
        else void loadWorld(world.id);
      });
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'wdel';
      deleteButton.textContent = 'Delete';
      deleteButton.setAttribute('aria-label', 'Delete ' + world.name);
      let confirmTimeout: ReturnType<typeof setTimeout> | undefined;
      deleteButton.addEventListener('click', () => {
        if (busy) return;
        if (confirmTimeout === undefined) {
          deleteButton.textContent = 'Sure?';
          deleteButton.classList.add('armed');
          confirmTimeout = setTimeout(() => {
            confirmTimeout = undefined;
            deleteButton.textContent = 'Delete';
            deleteButton.classList.remove('armed');
          }, 2500);
        } else {
          clearTimeout(confirmTimeout);
          confirmTimeout = undefined;
          void deleteWorld(world.id);
        }
      });
      row.append(openButton, deleteButton);
      worldsElement.appendChild(row);
    }
  }

  async function refreshWorlds(): Promise<void> {
    if (storageAvailable && database) {
      try {
        worlds = (await database.listWorlds()).sort((left, right) => right.lastPlayed - left.lastPlayed);
      } catch (error) {
        console.error('MauriceCraft could not refresh world list:', error);
      }
    }
    renderWorldList();
  }

  function finishLoad(): void {
    if (!currentWorld) return;
    subtitle.textContent = currentWorld.name + '. Choose a mode and play.';
    playButton.textContent = 'Play';
    setBusy(false);
    renderWorldList();
    playButton.focus({ preventScroll: true });
  }

  async function loadWorld(id: string): Promise<void> {
    if (!database) return;
    setBusy(true, 'Loading world…');
    try {
      await saveWorld();
      deps.setWorldReady(false);
      const world = await database.getWorld(id);
      if (!world) throw new Error('World metadata not found');
      const storedChunks = await database.getChunks(id);
      currentWorld = world;
      await new Promise(resolve => setTimeout(resolve, 20));
      deps.applyLoadedWorld(world, storedChunks);
      finishLoad();
    } catch (error) {
      console.error('MauriceCraft could not load world:', error);
      deps.setWorldReady(false);
      currentWorld = null;
      setBusy(false);
      playButton.disabled = true;
      subtitle.textContent = 'Could not load this world. Its save is still in your browser. Select another world or create a new one.';
      deps.showHint('World load failed. Your saved data was not deleted.', 6000);
      renderWorldList();
    }
  }

  async function newWorld(): Promise<void> {
    setBusy(true, 'Building your world…');
    await saveWorld();
    deps.setWorldReady(false);
    await new Promise(resolve => setTimeout(resolve, 20));
    const now = Date.now();
    const world: WorldRecord = {
      id: 'w' + now.toString(36) + Math.floor(Math.random() * 1296).toString(36),
      name: nextWorldName(worlds), seed: nextWorldSeed(worlds),
      generatorVersion: CURRENT_WORLD_GENERATOR_VERSION,
      created: now, lastPlayed: now,
    };
    currentWorld = world;
    deps.prepareNewWorld(world);
    await saveWorld();
    await refreshWorlds();
    finishLoad();
  }

  async function deleteWorld(id: string): Promise<void> {
    if (busy || !database) return;
    const deletingCurrentWorld = currentWorld?.id === id;
    setBusy(true, 'Deleting…');
    try {
      await pendingSave;
      await database.deleteWorld(id);
    } catch (error) {
      console.error('MauriceCraft could not delete world:', error);
      setBusy(false);
      subtitle.textContent = 'World deletion failed. Your saved world has been kept.';
      deps.showHint('Could not delete the world. Its save has not been removed.', 5000);
      renderWorldList();
      return;
    }
    if (deletingCurrentWorld) {
      currentWorld = null;
      deps.setWorldReady(false);
    }
    await refreshWorlds();
    if (deletingCurrentWorld) {
      if (worlds.length) await loadWorld(worlds[0].id);
      else await newWorld();
    } else {
      setBusy(false);
    }
  }

  async function initialize(): Promise<void> {
    try {
      database = await deps.openStorage();
      storageAvailable = true;
    } catch (error) {
      console.warn('World storage unavailable; running in temporary mode:', error);
      storageAvailable = false;
    }
    if (storageAvailable && database) {
      try {
        worlds = (await database.listWorlds()).sort((a, b) => b.lastPlayed - a.lastPlayed);
      } catch (error) {
        console.error('Could not list saved worlds:', error);
        storageAvailable = false;
        worlds = [];
      }
    }
    renderWorldList();
    if (storageAvailable && worlds.length) await loadWorld(worlds[0].id);
    else await newWorld();
  }

  newWorldButton.addEventListener('click', () => {
    if (!busy) void newWorld().catch(error => showWorldLifecycleError(error));
  });
  function showWorldLifecycleError(error: unknown): void {
    console.error('MauriceCraft world operation failed:', error);
    setBusy(false);
    subtitle.textContent = 'World operation failed. Your existing saved worlds have not been deleted.';
    deps.showHint('World operation failed. Check browser storage and try again.', 6000);
  }
  window.setInterval(() => {
    if (deps.isWorldReady()) void saveWorld();
  }, 15_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void saveWorld();
  });
  window.addEventListener('pagehide', () => { void saveWorld(); });

  return { initialize, saveWorld, refreshWorlds,
    isStorageAvailable: () => storageAvailable };
}
