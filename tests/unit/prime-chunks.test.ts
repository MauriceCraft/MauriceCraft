import { describe, expect, it, vi } from 'vitest';
import { primeWorldChunks } from '../../src/game/world/prime-chunks';

describe('startup chunk priming', () => {
  it('generates only the nine immediately needed chunks and renders the center', () => {
    const chunks: string[] = [];
    const meshes: string[] = [];
    primeWorldChunks(-3, 7,
      (x, z) => { chunks.push(x + ',' + z); },
      (x, z) => { meshes.push(x + ',' + z); });
    expect(chunks).toHaveLength(9);
    expect(new Set(chunks).size).toBe(9);
    expect(chunks).toContain('-4,6');
    expect(chunks).toContain('-2,8');
    expect(meshes).toEqual(['-3,7']);
  });

  it('generates neighbors before meshing the center', () => {
    const events: string[] = [];
    const generate = vi.fn((x: number, z: number) => { events.push('generate:' + x + ',' + z); });
    const mesh = vi.fn(() => { events.push('mesh'); });
    primeWorldChunks(0, 0, generate, mesh);
    expect(events.at(-1)).toBe('mesh');
    expect(generate).toHaveBeenCalledTimes(9);
    expect(mesh).toHaveBeenCalledOnce();
  });
});
