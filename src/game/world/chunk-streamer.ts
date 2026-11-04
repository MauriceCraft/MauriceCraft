import { ckey } from './chunk-key';

/** Only the fields needed by the streamer; the renderer owns mesh storage. */
export interface StreamChunk {
  cx: number;
  cz: number;
  meshed?: boolean;
  edited?: boolean;
}

export interface StreamDependencies<T extends StreamChunk> {
  chunks: Map<number, T>;
  viewDistance: number;
  getPlayer: () => { x: number; z: number };
  getOrGen: (cx: number, cz: number) => unknown;
  genChunk: (cx: number, cz: number) => unknown;
  buildChunk: (cx: number, cz: number) => unknown;
  disposeMesh: (chunk: T) => void;
  resetChunkCache: () => void;
  now?: () => number;
}

/**
 * Stream chunks in small per-frame batches to avoid long mobile freezes.
 * Edited chunks remain cached even when far away: dropping them loses work.
 */
export function createChunkStreamer<T extends StreamChunk>(
  deps: StreamDependencies<T>,
): () => void {
  const { chunks, getPlayer, getOrGen, genChunk, buildChunk, disposeMesh, resetChunkCache } = deps;
  const R = deps.viewDistance;
  const now = deps.now ?? (() => performance.now());
  // Load and mesh chunks around the player as they move; drop the ones left far behind
  const OFFS: { dx: number; dz: number; d: number; e: number }[] = [];
  for (let dz = -R - 1; dz <= R + 1; dz++) for (let dx = -R - 1; dx <= R + 1; dx++) OFFS.push({ dx: dx, dz: dz, d: Math.max(Math.abs(dx), Math.abs(dz)), e: dx * dx + dz * dz });
  OFFS.sort(function (a, b) { return a.e - b.e; });
  let streamTick = 0;
  function neighborsLoaded(cx: number, cz: number): boolean {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!chunks.has(ckey(cx + dx, cz + dz))) return false;
    return true;
  }
  function streamChunks(): void {
    const player = getPlayer();
    const pcx = Math.floor(player.x / 16), pcz = Math.floor(player.z / 16);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) getOrGen(pcx + dx, pcz + dz);
    const t0 = now();
    let n = 0;
    for (let i = 0; i < OFFS.length; i++) {
      const o = OFFS[i];
      if (chunks.has(ckey(pcx + o.dx, pcz + o.dz))) continue;
      genChunk(pcx + o.dx, pcz + o.dz);
      if (++n >= 3 || now() - t0 > 7) break;
    }
    n = 0;
    for (let i = 0; i < OFFS.length; i++) {
      const o = OFFS[i];
      if (o.d > R) continue;
      const c = chunks.get(ckey(pcx + o.dx, pcz + o.dz));
      if (!c || c.meshed || !neighborsLoaded(c.cx, c.cz)) continue;
      buildChunk(c.cx, c.cz);
      if (++n >= 2 || now() - t0 > 12) break;
    }
    if (++streamTick % 60 === 0) {
      const gone: number[] = [];
      chunks.forEach(function (c, k) {
        const d = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz));
        if (c.meshed && d > R + 1) disposeMesh(c);
        if (!c.edited && d > R + 3) { disposeMesh(c); gone.push(k); }
      });
      gone.forEach(function (k) { chunks.delete(k); });
      resetChunkCache();
    }
  }
  return streamChunks;
}
