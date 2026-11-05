import { flowingBlock, liquidKind, liquidLevel, type LiquidKind, WATER_REACH, LAVA_REACH } from './fluid-blocks';

interface FluidDependencies {
  height: number;
  getBlock: (x: number, y: number, z: number) => number;
  setBlock: (x: number, y: number, z: number, id: number) => void;
  isLoaded: (x: number, z: number) => boolean;
  refreshChunk: (cx: number, cz: number) => void;
  getDimension: () => string;
  getGeneratorVersion: () => number;
}
type Position = [number, number, number];
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]] as const;
const ADJACENT = [[0, 0, 0], [0, 1, 0], [0, -1, 0], ...DIRS] as const;

/**
 * Bounded, event-driven water/lava update. No unloaded-chunk reads or writes.
 * Sources stay in place. Flow distances are persisted in block IDs, not hidden state.
 */
export function createFluidSimulator(deps: FluidDependencies) {
  const pending: Position[] = [], enqueued = new Set<string>();
  let tickClock = 0;
  const key = (x: number, y: number, z: number) => x + ',' + y + ',' + z;
  const enabled = () => deps.getDimension() === 'overworld' && deps.getGeneratorVersion() >= 2;
  const loaded = (x: number, z: number) => deps.isLoaded(x, z);
  function schedule(x: number, y: number, z: number): void {
    if (y <= 0 || y >= deps.height - 1 || !loaded(x, z) || pending.length >= 24000) return;
    const k = key(x, y, z);
    if (enqueued.has(k)) return;
    pending.push([x, y, z]); enqueued.add(k);
  }
  function notify(x: number, y: number, z: number): void {
    if (!enabled()) return;
    for (const [dx, dy, dz] of ADJACENT) schedule(x + dx, y + dy, z + dz);
  }
  function onChunkLoaded(cx: number, cz: number, data: Uint8Array): void {
    if (!enabled()) return;
    // Seed the flow front only at exposed liquid, avoiding scans each frame.
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      for (let y = 1; y < deps.height - 1; y++) {
        const b = data[(y * 16 + z) * 16 + x];
        if (!liquidKind(b)) continue;
        const wx = cx * 16 + x, wz = cz * 16 + z;
        if (x === 0 || x === 15 || z === 0 || z === 15 ||
          data[((y + 1) * 16 + z) * 16 + x] === 0) notify(wx, y, wz);
      }
    }
    // Adjacent previously loaded chunks may have liquids waiting at the border.
    for (let y = 1; y < deps.height - 1; y++) {
      for (let i = 0; i < 16; i++) {
        schedule(cx * 16 - 1, y, cz * 16 + i);
        schedule(cx * 16 + 16, y, cz * 16 + i);
        schedule(cx * 16 + i, y, cz * 16 - 1);
        schedule(cx * 16 + i, y, cz * 16 + 16);
      }
    }
  }
  function reset(): void { pending.length = 0; enqueued.clear(); tickClock = 0; }

  function candidate(x: number, y: number, z: number, kind: LiquidKind): number {
    const max = kind === 'water' ? WATER_REACH : LAVA_REACH;
    if (y < deps.height - 2 && liquidKind(deps.getBlock(x, y + 1, z)) === kind) return 1;
    let best = max + 1;
    for (const [dx, , dz] of DIRS) {
      const nx = x + dx, nz = z + dz;
      if (!loaded(nx, nz)) continue;
      const block = deps.getBlock(nx, y, nz);
      if (liquidKind(block) !== kind) continue;
      const level = liquidLevel(block);
      if (level < max) best = Math.min(best, level + 1);
    }
    return best;
  }

  function tick(dt: number): void {
    if (!enabled()) { reset(); return; }
    tickClock += Math.min(0.25, dt);
    if (tickClock < 0.13) return;
    tickClock = 0;
    const touched = new Set<string>();
    // Per-frame mutation and rebuild budgets protect low-power mobile GPUs.
    let work = Math.min(pending.length, 96);
    while (work-- > 0) {
      const [x, y, z] = pending.shift()!;
      enqueued.delete(key(x, y, z));
      if (!loaded(x, z)) continue;
      const old = deps.getBlock(x, y, z);
      if (old !== 0 && !liquidKind(old)) continue;
      const kind = liquidKind(old);
      const around: LiquidKind[] = kind ? [kind] : ['water', 'lava'];
      let next = old;
      if (old !== 34 && old !== 35) {
        let result: { kind: LiquidKind; level: number } | null = null;
        for (const candidateKind of around) {
          const level = candidate(x, y, z, candidateKind);
          if (level > (candidateKind === 'water' ? WATER_REACH : LAVA_REACH)) continue;
          if (!result || level < result.level) result = { kind: candidateKind, level };
        }
        next = result ? flowingBlock(result.kind, result.level) : 0;
      }
      // Water turns flowing lava into rock and cools stationary source lava.
      if (kind === 'lava' && [ ...DIRS, [0, 1, 0], [0, -1, 0] ].some(([dx, dy, dz]) =>
        loaded(x + dx, z + dz) && liquidKind(deps.getBlock(x + dx, y + dy, z + dz)) === 'water')) {
        next = old === 35 ? 36 : 9;
      }
      if (next === old) continue;
      deps.setBlock(x, y, z, next);
      touched.add((x >> 4) + ',' + (z >> 4));
      if ((x & 15) === 0) touched.add(((x >> 4) - 1) + ',' + (z >> 4));
      if ((x & 15) === 15) touched.add(((x >> 4) + 1) + ',' + (z >> 4));
      if ((z & 15) === 0) touched.add((x >> 4) + ',' + ((z >> 4) - 1));
      if ((z & 15) === 15) touched.add((x >> 4) + ',' + ((z >> 4) + 1));
      notify(x, y, z);
    }
    for (const k of touched) {
      const [cx, cz] = k.split(',').map(Number);
      if (loaded(cx * 16, cz * 16)) deps.refreshChunk(cx, cz);
    }
  }
  return { notify, onChunkLoaded, reset, tick, queued: () => pending.length };
}
