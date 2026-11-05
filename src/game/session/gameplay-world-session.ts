import { openWorldStorage } from '../storage/world-storage';
import { hydrateDimensionChunks } from './dimension-chunk-records';
import type { WritableChunk } from '../world/block-access';
import { createWorldSession } from './world-session';
import { createWorldRestore, type WorldRestoreDependencies } from './world-restore';
import { collectWorldSaveBatch, snapshotWorldState, type WorldSnapshotState } from './world-persistence';

/** Coordinates browser persistence without owning terrain or gameplay rules. */
export interface GameplayWorldSessionDependencies extends WorldRestoreDependencies {
  chunks: Map<number, WritableChunk>;
  dimensionChunks: Map<string, Map<number, Uint8Array>>;
  getDimension: () => string;
  snapshot: () => WorldSnapshotState;
  startPlaying: () => void;
  modeLabel: (mode: unknown) => string;
  showHint: (message: string, duration: number) => void;
}

export function createGameplayWorldSession(deps: GameplayWorldSessionDependencies) {
  const { applyWorld, prepareNewWorld } = createWorldRestore(deps);
  const { savedChunks, dimensionChunks, chunks } = deps;
  return createWorldSession({
    openStorage: openWorldStorage,
    isWorldReady: () => deps.state.ready,
    setWorldReady: value => { deps.state.ready = value; },
    snapshotWorld: world => snapshotWorldState(world, deps.snapshot()),
    collectSaveBatch: world => collectWorldSaveBatch(world, deps.getDimension(), chunks, savedChunks, dimensionChunks),
    applyLoadedWorld: (world, records) => {
      hydrateDimensionChunks(records, savedChunks, dimensionChunks);
      applyWorld(world);
    },
    prepareNewWorld: world => {
      dimensionChunks.clear();
      prepareNewWorld(world);
    },
    startPlaying: deps.startPlaying,
    modeLabel: deps.modeLabel,
    showHint: deps.showHint,
  });
}
