import { coord } from './coordinates';
import type { GeneratedStructure } from '../world/structure-regions';

export type RegisterCommand = (
  names: string[], usage: string, description: string,
  handler: (arguments_: string[]) => string | void,
  choices?: (argumentIndex: number, arguments_: string[]) => string[],
) => void;

export interface WorldCommandPlayer {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  fallStart: number | null;
}
export interface WorldCommandDependencies {
  register: RegisterCommand;
  player: WorldCommandPlayer;
  maxHeight: number;
  torchBlock: number;
  names: Readonly<Record<number, string>>;
  findItem: (name: string, blocksOnly?: boolean) => number;
  itemMap: () => Record<string, number>;
  getBlock: (x: number, y: number, z: number) => number;
  setBlock: (x: number, y: number, z: number, blockId: number) => void;
  getOrGenerateChunk: (cx: number, cz: number) => unknown;
  queueRebuild: (x: number, z: number, wide?: boolean) => void;
  flushRebuilds: () => void;
  rebuildRegion: (x1: number, z1: number, x2: number, z2: number) => void;
  spawnSpot: () => readonly [number, number, number];
  explode: (x: number, y: number, z: number, radius: number, power: number) => void;
  structureRegionSize: number;
  structureNames: Readonly<Record<string, string>>;
  structureFor: (rx: number, rz: number) => GeneratedStructure | null;
  ensureAround: (x: number, z: number) => void;
  topBlockY: (x: number, z: number) => number;
}

/** Register world editing and exploration commands without owning game state. */
export function registerWorldCommands(deps: WorldCommandDependencies): void {
  const { register, player, maxHeight, names, findItem } = deps;

  // Build completion options once. Rebuilding the item map for every key in
  // a completion scan used to do avoidable repeated work.
  const blockOptions = () => {
    const map = deps.itemMap();
    return ['air', ...Object.keys(map).filter(name => map[name] < 100)];
  };

  register(['setblock'], '/setblock <x> <y> <z> <block|air>', 'Place a single block', args => {
    if (args.length < 4) throw new Error('Usage: /setblock <x> <y> <z> <block|air>');
    const x = Math.floor(coord(args[0], player.x));
    const y = Math.floor(coord(args[1], player.y));
    const z = Math.floor(coord(args[2], player.z));
    if (y < 0 || y >= maxHeight) throw new Error('Height must be between 0 and ' + (maxHeight - 1));
    const blockId = args[3].toLowerCase() === 'air' ? 0 : findItem(args[3], true);
    deps.getOrGenerateChunk(x >> 4, z >> 4);
    const previousBlock = deps.getBlock(x, y, z);
    deps.setBlock(x, y, z, blockId);
    deps.queueRebuild(x, z, blockId === deps.torchBlock || previousBlock === deps.torchBlock);
    deps.flushRebuilds();
    return 'Set ' + x + ' ' + y + ' ' + z + ' to ' + (blockId ? names[blockId] : 'air');
  }, index => index === 4 ? blockOptions() : []);

  register(['fill'], '/fill <x1> <y1> <z1> <x2> <y2> <z2> <block|air>',
    'Fill a box with a block (up to 32768 blocks)', args => {
      if (args.length < 7) throw new Error('Usage: /fill <x1> <y1> <z1> <x2> <y2> <z2> <block|air>');
      const x1 = Math.floor(coord(args[0], player.x));
      const y1 = Math.floor(coord(args[1], player.y));
      const z1 = Math.floor(coord(args[2], player.z));
      const x2 = Math.floor(coord(args[3], player.x));
      const y2 = Math.floor(coord(args[4], player.y));
      const z2 = Math.floor(coord(args[5], player.z));
      const minX = Math.min(x1, x2);
      const maxX = Math.max(x1, x2);
      const minZ = Math.min(z1, z2);
      const maxZ = Math.max(z1, z2);
      const minY = Math.max(0, Math.min(y1, y2));
      const maxY = Math.min(maxHeight - 1, Math.max(y1, y2));
      const blockCount = (maxX - minX + 1) * (maxZ - minZ + 1) * (maxY - minY + 1);
      if (blockCount > 32768) throw new Error('That is ' + blockCount + ' blocks. The limit is 32768');
      const blockId = args[6].toLowerCase() === 'air' ? 0 : findItem(args[6], true);
      for (let cx = minX >> 4; cx <= maxX >> 4; cx++) {
        for (let cz = minZ >> 4; cz <= maxZ >> 4; cz++) deps.getOrGenerateChunk(cx, cz);
      }
      for (let x = minX; x <= maxX; x++) {
        for (let z = minZ; z <= maxZ; z++) {
          for (let y = minY; y <= maxY; y++) deps.setBlock(x, y, z, blockId);
        }
      }
      deps.rebuildRegion(minX, minZ, maxX, maxZ);
      return 'Filled ' + blockCount + ' block' + (blockCount === 1 ? '' : 's') +
        ' with ' + (blockId ? names[blockId] : 'air');
    }, index => index === 7 ? blockOptions() : []);

  register(['explode'], '/explode [radius]', 'Blow up the ground in front of you', args => {
    const radius = Math.max(1, Math.min(12, Number(args[0] || 4) || 4));
    const [x, y, z] = deps.spawnSpot();
    deps.explode(x, y, z, radius, 30 * radius / 4.2);
    return 'Boom (radius ' + radius + ')';
  });

  register(['locate'], '/locate <village|temple|tower|dungeon|cabin|circle> [tp]',
    'Find the nearest structure', args => {
      const kind = (args[0] || '').toLowerCase();
      const structureName = deps.structureNames[kind];
      if (!structureName) throw new Error('Usage: /locate <' + Object.keys(deps.structureNames).join('|') + '> [tp]');
      const playerRegionX = Math.floor(player.x / deps.structureRegionSize);
      const playerRegionZ = Math.floor(player.z / deps.structureRegionSize);
      let nearest: GeneratedStructure | null = null;
      let shortestDistance = Infinity;
      for (let offsetZ = -8; offsetZ <= 8; offsetZ++) {
        for (let offsetX = -8; offsetX <= 8; offsetX++) {
          const candidate = deps.structureFor(playerRegionX + offsetX, playerRegionZ + offsetZ);
          if (!candidate || candidate.type !== kind) continue;
          const distance = Math.hypot(candidate.cx - player.x, candidate.cz - player.z);
          if (distance < shortestDistance) {
            shortestDistance = distance;
            nearest = candidate;
          }
        }
      }
      if (!nearest) throw new Error('No ' + structureName.toLowerCase() + ' within about 600 blocks');
      if ((args[1] || '').toLowerCase() === 'tp') {
        const destinationX = nearest.cx + 0.5;
        const destinationZ = nearest.cz + 4.5;
        deps.ensureAround(destinationX, destinationZ);
        player.x = destinationX;
        player.z = destinationZ;
        player.y = deps.topBlockY(Math.floor(destinationX), Math.floor(destinationZ)) + 1.01;
        player.vx = player.vy = player.vz = 0;
        player.fallStart = null;
        return 'Teleported to the ' + structureName.toLowerCase() + ' at ' + nearest.cx + ' ' + nearest.cz;
      }
      return 'Nearest ' + structureName.toLowerCase() + ': x ' + nearest.cx + ', z ' + nearest.cz +
        ' (' + Math.round(shortestDistance) + ' blocks away)';
    }, index => index === 1 ? Object.keys(deps.structureNames) : (index === 2 ? ['tp'] : []));
}
