import { registerPlayerCommands, type PlayerCommandState, type PlayerCommandDependencies } from './player-commands';
import { registerWorldCommands, type RegisterCommand } from './world-commands';
import { registerGeneralCommands, type GeneralCommandsDependencies } from './general-commands';
import { createItemResolver } from './item-resolver';
import type { WorldDimension } from '../portals/portal-system';
import type { GameMode, Difficulty } from '../ui/game-menu';
import type { WeatherMode } from '../rendering/weather-system';
import type { PortalFrame } from '../portals/frame';
import type { SpawnMob } from '../entities/mob-spawning';
import type { GeneratedStructure } from '../world/structure-regions';

export interface CoreCommandWorld {
  BED: number; TORCH: number;
  NAMES: Readonly<Record<number, string>>;
  get: (x: number, y: number, z: number) => number;
  setBlock: (x: number, y: number, z: number, block: number) => void;
  getOrGen: (cx: number, cz: number) => unknown;
  topY: (x: number, z: number) => number;
  STRUCTURE_REGION_SIZE: number;
  STRUCT_NAMES: Readonly<Record<string, string>>;
  structureFor: (rx: number, rz: number) => GeneratedStructure | null;
}

export interface CoreGameCommandDependencies {
  register: RegisterCommand;
  commands: GeneralCommandsDependencies['commands'];
  state: PlayerCommandState;
  player: PlayerCommandDependencies['player'];
  world: CoreCommandWorld;
  inventory: Record<number, number>;
  hotbar: number[];
  kinds: GeneralCommandsDependencies['kinds'];
  mobs: SpawnMob[];
  jobs: readonly string[];
  labels: PlayerCommandDependencies['labels'];
  difficulties: PlayerCommandDependencies['difficulties'];
  weatherLabels: PlayerCommandDependencies['weatherLabels'];
  maxHeight: number; maxHealth: number;
  getSeed: () => number;
  getDimension: () => WorldDimension;
  getDifficultyCap: () => number;
  hasHealth: () => boolean;
  setMode: (mode: GameMode) => void;
  setDifficulty: (difficulty: Difficulty) => void;
  setWeather: (weather: WeatherMode) => void;
  refreshWorlds: () => Promise<void>;
  saveWorld: () => Promise<void>;
  isStorageAvailable: () => boolean;
  updateHotbar: (showName?: boolean) => void;
  updateHearts: () => void;
  renderFood: () => void;
  toggleFly: () => void;
  ensureAround: (x: number, z: number) => void;
  rebuildRegion: (x1: number, z1: number, x2: number, z2: number) => void;
  queueRebuild: (x: number, z: number, wide?: boolean) => void;
  flushRebuilds: () => void;
  explode: (x: number, y: number, z: number, radius: number, power: number) => void;
  collides: (x: number, y: number, z: number) => boolean;
  buildPortalFrame: (dimension: 'overworld' | 'nether', x: number, y: number, z: number) => PortalFrame;
  changeDimension: (dimension: WorldDimension) => void;
  damagePlayer: (damage: number) => void;
  addMob: GeneralCommandsDependencies['addMob'];
  removeMobAt: (index: number) => void;
}

/** Register every built-in command against one consistent world and session view. */
export function registerCoreGameCommands(deps: CoreGameCommandDependencies): void {
  const { player, state, world, register, inventory, hotbar } = deps;
  const { itemMap, findItem, slug } = createItemResolver(world.NAMES, world.BED);
  const spawnSpot = (): [number, number, number] => {
    const x = player.x - Math.sin(player.yaw) * 3;
    const z = player.z - Math.cos(player.yaw) * 3;
    world.getOrGen(Math.floor(x) >> 4, Math.floor(z) >> 4);
    return [x, world.topY(Math.floor(x), Math.floor(z)) + 1.01, z];
  };

  registerPlayerCommands({
    register, state, player,
    maxHeight: deps.maxHeight, maxHealth: deps.maxHealth,
    inventory, hotbar, names: world.NAMES, labels: deps.labels,
    difficulties: deps.difficulties, weatherLabels: deps.weatherLabels,
    findItem, itemMap,
    setWeather: deps.setWeather, setMode: deps.setMode,
    setDifficulty: deps.setDifficulty,
    refreshWorlds: deps.refreshWorlds, saveWorld: deps.saveWorld,
    updateHotbar: showName => deps.updateHotbar(showName ?? false),
    updateHearts: deps.updateHearts, renderFood: deps.renderFood,
    toggleFly: deps.toggleFly, ensureAround: deps.ensureAround,
    topBlockY: world.topY, collides: deps.collides, getSeed: deps.getSeed,
  });

  registerWorldCommands({
    register, player,
    maxHeight: deps.maxHeight, torchBlock: world.TORCH,
    names: world.NAMES, findItem, itemMap,
    getBlock: world.get, setBlock: world.setBlock,
    getOrGenerateChunk: world.getOrGen,
    queueRebuild: deps.queueRebuild, flushRebuilds: deps.flushRebuilds,
    rebuildRegion: deps.rebuildRegion, spawnSpot,
    explode: deps.explode, structureRegionSize: world.STRUCTURE_REGION_SIZE,
    structureNames: world.STRUCT_NAMES, structureFor: world.structureFor,
    ensureAround: deps.ensureAround, topBlockY: world.topY,
  });

  registerGeneralCommands({
    register, commands: deps.commands, player, maxHeight: deps.maxHeight,
    getDimension: deps.getDimension,
    buildPortalFrame: deps.buildPortalFrame,
    changeDimension: deps.changeDimension,
    saveWorld: deps.saveWorld,
    refreshWorlds: () => { void deps.refreshWorlds(); },
    isStorageAvailable: deps.isStorageAvailable,
    slug, mobs: deps.mobs, kinds: deps.kinds, jobs: deps.jobs,
    getDifficultyCap: deps.getDifficultyCap, hasHealth: deps.hasHealth,
    setHealth: hp => { state.health = hp; },
    damagePlayer: deps.damagePlayer, spawnSpot,
    getOrGenerateChunk: world.getOrGen, topY: world.topY,
    collides: deps.collides, addMob: deps.addMob,
    removeMobAt: deps.removeMobAt,
  });
}
