import { describe, expect, it } from 'vitest';
import { ckey } from '../../src/game/world/chunk-key';
import { createChunkStreamer, type StreamChunk } from '../../src/game/world/chunk-streamer';

interface Chunk extends StreamChunk { disposed?: boolean }
function harness(viewDistance = 2) {
  const chunks = new Map<number, Chunk>();
  const player = { x: 0.5, z: 0.5 };
  let generated = 0;
  let meshes = 0;
  let resets = 0;
  function create(cx: number, cz: number): Chunk {
    const key = ckey(cx, cz);
    const existing = chunks.get(key);
    if (existing) return existing;
    const chunk: Chunk = { cx, cz, meshed: false, edited: false };
    chunks.set(key, chunk);
    generated++;
    return chunk;
  }
  const tick = createChunkStreamer({
    chunks, viewDistance,
    getPlayer: () => player,
    getOrGen: create,
    genChunk: create,
    buildChunk: (cx: number, cz: number) => {
      const chunk = chunks.get(ckey(cx, cz));
      if (!chunk) throw new Error('Mesh generation without a chunk');
      chunk.meshed = true;
      meshes++;
    },
    disposeMesh: (chunk: Chunk) => { chunk.meshed = false; chunk.disposed = true; },
    resetChunkCache: () => { resets++; },
    now: () => 0,
  });
  return { chunks, player, tick, counts: () => ({ generated, meshes, resets }) };
}
describe('chunk streaming regression', () => {
  it('generates immediate surrounding chunks and caps additional work per frame', () => {
    const stream = harness();
    stream.tick();
    expect(stream.chunks.has(ckey(0, 0))).toBe(true);
    expect(stream.chunks.has(ckey(-1, 1))).toBe(true);
    expect(stream.counts().generated).toBe(12); // 9 immediate + at most 3 extra
    expect(stream.counts().meshes).toBeLessThanOrEqual(2);
  });
  it('does not lose edits when a chunk gets far from the player', () => {
    const stream = harness();
    const safe: Chunk = { cx: 100, cz: 100, edited: true, meshed: true };
    const disposable: Chunk = { cx: 101, cz: 101, edited: false, meshed: true };
    stream.chunks.set(ckey(100, 100), safe);
    stream.chunks.set(ckey(101, 101), disposable);
    for (let i = 0; i < 60; i++) stream.tick();
    expect(stream.chunks.get(ckey(100, 100))).toBe(safe);
    expect(stream.chunks.has(ckey(101, 101))).toBe(false);
    expect(safe.disposed).toBe(true);
    expect(stream.counts().resets).toBe(1);
  });
  it("streams from the player's new position after movement", () => {
    const stream = harness();
    stream.tick();
    stream.player.x = 16 * 11 + 0.5;
    stream.player.z = 16 * -4 + 0.5;
    stream.tick();
    expect(stream.chunks.has(ckey(11, -4))).toBe(true);
  });
});
