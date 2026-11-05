import { openWorldStorage } from '../storage/world-storage';
import { ckey } from '../world/chunk-key';
import type { WritableChunk } from '../world/block-access';
import { createWorldSession } from './world-session';
import { createWorldRestore, type WorldRestoreDependencies } from './world-restore';
import { collectWorldSaveBatch, snapshotWorldState, type WorldSnapshotState } from './world-persistence';

/** Coordinates browser persistence without owning terrain or gameplay rules. */
export interface GameplayWorldSessionDependencies extends WorldRestoreDependencies {
  chunks: Map<number, WritableChunk>;
  getDimension: () => string;
  snapshot: () => WorldSnapshotState;
  startPlaying: () => void;
  modeLabel: (mode: unknown) => string;
  showHint: (message: string, duration: number) => void;
}

export function createGameplayWorldSession(deps: GameplayWorldSessionDependencies) {
  const { applyWorld, prepareNewWorld } = createWorldRestore(deps);
  const { savedChunks, chunks } = deps;
  return createWorldSession({
    openStorage: openWorldStorage,
    isWorldReady: () => deps.state.ready,
    setWorldReady: value => { deps.state.ready = value; },
    snapshotWorld: world => snapshotWorldState(world, deps.snapshot()),
    collectSaveBatch: world => collectWorldSaveBatch(world, deps.getDimension(), chunks, savedChunks),
    applyLoadedWorld: (world, records) => {
      savedChunks.clear();
      for (const record of records) {
        savedChunks.set(ckey(record.cx, record.cz), record.data);
      }
      applyWorld(world);
    },
    prepareNewWorld,
    startPlaying: deps.startPlaying,
    modeLabel: deps.modeLabel,
    showHint: deps.showHint,
  });
}
