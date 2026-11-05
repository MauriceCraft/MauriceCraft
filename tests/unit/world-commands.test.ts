import { describe, expect, it } from 'vitest';
import { registerWorldCommands, type RegisterCommand } from '../../src/game/commands/world-commands';
import type { GeneratedStructure } from '../../src/game/world/structure-regions';

function fixture() {
  const registered = new Map<string, {
    run: (arguments_: string[]) => string | void;
    options?: (argumentIndex: number, arguments_: string[]) => string[];
  }>();
  const register: RegisterCommand = (names, _usage, _description, run, options) => {
    for (const name of names) registered.set(name, { run, options });
  };
  const player = { x: 8, y: 12, z: 8, vx: 2, vy: 3, vz: 4, fallStart: 20 as number | null };
  const world = new Map<string, number>();
  const generated: string[] = [];
  const rebuilds: string[] = [];
  const blasts: number[] = [];
  let structure: GeneratedStructure | null = {
    type: 'village', cx: 35, cz: 44, gy: 18, pad: 20, blend: 8, reach: 22,
    zone: 22, rx: 0, rz: 0,
  };
  registerWorldCommands({
    register, player, maxHeight: 48, torchBlock: 17,
    names: { 3: 'Stone', 17: 'Torch' },
    findItem: item => {
      if (item === 'stone') return 3;
      if (item === 'torch') return 17;
      throw new Error('Unknown block');
    },
    itemMap: () => ({ stone: 3, torch: 17, sword: 151 }),
    getBlock: (x, y, z) => world.get(x + ',' + y + ',' + z) ?? 0,
    setBlock: (x, y, z, blockId) => { world.set(x + ',' + y + ',' + z, blockId); },
    getOrGenerateChunk: (x, z) => { generated.push(x + ',' + z); },
    queueRebuild: (x, z) => { rebuilds.push(x + ',' + z); },
    flushRebuilds: () => undefined,
    rebuildRegion: (x1, z1, x2, z2) => { rebuilds.push(x1 + ',' + z1 + ':' + x2 + ',' + z2); },
    spawnSpot: () => [9, 13, 9],
    explode: (_x, _y, _z, radius) => { blasts.push(radius); },
    structureRegionSize: 80,
    structureNames: { village: 'Village' },
    structureFor: () => structure,
    ensureAround: () => undefined, topBlockY: () => 19,
  });
  function run(name: string, args: string[] = []): string {
    const handler = registered.get(name);
    if (!handler) throw new Error('Missing command ' + name);
    return String(handler.run(args));
  }
  return { run, registered, player, world, generated, rebuilds, blasts,
    removeStructures: () => { structure = null; } };
}

describe('world commands', () => {
  it('places blocks using relative coordinates and preserves numeric IDs', () => {
    const t = fixture();
    expect(t.run('setblock', ['~1', '20', '~', 'stone'])).toContain('Set 9 20 8 to Stone');
    expect(t.world.get('9,20,8')).toBe(3);
    expect(t.generated).toEqual(['0,0']);
    expect(t.rebuilds).toEqual(['9,8']);
    expect(() => t.run('setblock', ['1', '49', '1', 'stone'])).toThrow('Height');
  });

  it('uses one block-name map for completion and limits large fills', () => {
    const t = fixture();
    expect(t.registered.get('fill')?.options?.(7, [])).toEqual(['air', 'stone', 'torch']);
    expect(() => t.run('fill', ['0', '0', '0', '100', '40', '100', 'stone']))
      .toThrow('limit is 32768');
    expect(t.world.size).toBe(0);
    expect(t.run('fill', ['0', '1', '0', '1', '2', '1', 'torch']))
      .toBe('Filled 8 blocks with Torch');
    expect(t.world.size).toBe(8);
    expect(t.generated).toEqual(['0,0']);
  });

  it('clamps explosion radius', () => {
    const t = fixture();
    expect(t.run('explode', ['99'])).toContain('radius 12');
    expect(t.blasts).toEqual([12]);
  });

  it('finds structures and teleports without leaving stale movement velocity', () => {
    const t = fixture();
    expect(t.run('locate', ['village'])).toContain('Nearest village: x 35, z 44');
    expect(t.run('locate', ['village', 'tp'])).toContain('Teleported to the village');
    expect(t.player).toMatchObject({ x: 35.5, y: 20.01, z: 48.5, vx: 0, vy: 0, vz: 0, fallStart: null });
    t.removeStructures();
    expect(() => t.run('locate', ['village'])).toThrow('No village');
    expect(() => t.run('locate', ['unknown'])).toThrow('Usage');
  });
});
