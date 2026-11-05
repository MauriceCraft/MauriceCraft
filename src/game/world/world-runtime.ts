import { createBlockAccess, type WritableChunk } from './block-access';
import { createBlockCatalog } from './block-catalog';
import { createChunkGenerator, type WorldDimension } from './chunk-generator';
import { createChunkLifecycle } from './chunk-lifecycle';
import { createChunkStreamer } from './chunk-streamer';
import { createStructureRegions } from './structure-regions';
import { createStructureBuilders } from './structure-builders';
import { fbm } from './noise';
import { createFluidSimulator } from './fluid-simulator';
import { createCaveCarver } from './cave-carver';
import { biomeAt, biomeHeightAt } from './biomes';
import { volcanoHeightAt } from './volcanoes';
import { createLandmarkFinder } from './world-landmarks';
import { createGameRenderer } from '../rendering/game-renderer';
import { createChunkMesher } from '../rendering/chunk-mesher';

export interface WorldRuntimeDependencies {
  height: number;
  chunkSize: number;
  seaLevel: number;
  viewDistance: number;
  getSeed: () => number;
  setSeed: (seed: number) => void;
  getGeneratorVersion: () => number;
  setGeneratorVersion: (version: number) => void;
  getDimension: () => WorldDimension;
  getPlayer: () => { x: number; z: number };
}

/**
 * Assemble terrain, chunk storage and meshes in one world-owned boundary.
 * Game, input and session systems only receive the explicit returned services.
 */
export function createWorldRuntime(deps: WorldRuntimeDependencies) {
  const { height: WORLD_HEIGHT, chunkSize: CHUNK_SIZE, seaLevel: SEA_LEVEL,
    viewDistance: VIEW_DISTANCE } = deps;
  const catalog = createBlockCatalog();
  const {
    BRICK, COBBLE, CTABLE, DIRT, GOLD, GRAVEL, HAY, LEAVES,
    MOSSY, PLANKS, SANDSTONE, STONEBRICK, TORCH, WOOD,
    COAL_ORE, COPPER_ORE, DIAMOND_ORE, GRASS, IRON_ORE, LAVA,
    SAND, STONE, WATER, SNOW, PINE_LEAVES, RED_SAND, DARK_WOOD,
    BIRCH_WOOD, BIRCH_LEAVES, ACACIA_WOOD, ACACIA_LEAVES, WILLOW_WOOD,
    WILLOW_LEAVES, AUTUMN_LEAVES, MUD, FLOWERING_GRASS, toolTile, ALL_BLOCKS, TILES,
    ATLAS_N, BED_H, isBed, opq, solid,
  } = catalog;
  const hotbar = ALL_BLOCKS.slice(0, 9);
  const toolWear: Record<number, number> = {};
  const renderer = createGameRenderer(toolTile);
  const { scene, mat, torchMat, glowMat } = renderer;
  const chunks = new Map<number, WritableChunk>();
  const { chunkAt, resetChunkCache, getBlock: get, setBlock: rawSetBlock, inBounds } =
    createBlockAccess(chunks, WORLD_HEIGHT);
  const mesher = createChunkMesher({
    scene, mat, torchMat, glowMat, chunks, chunkAt,
    getBlock: get, opq, isBed, tiles: TILES,
    height: WORLD_HEIGHT, chunkSize: CHUNK_SIZE,
    atlasTiles: ATLAS_N, bedHeight: BED_H, torchId: TORCH,
    waterId: WATER, lavaId: LAVA,
  });
  const { disposeMesh, buildChunk } = mesher;
  const fluids = createFluidSimulator({
    height: WORLD_HEIGHT, getBlock: get, setBlock: rawSetBlock,
    isLoaded: (x, z) => Boolean(chunkAt(x >> 4, z >> 4)),
    refreshChunk: (cx, cz) => { if (chunkAt(cx, cz)?.meshed) buildChunk(cx, cz); },
    getDimension: deps.getDimension, getGeneratorVersion: deps.getGeneratorVersion,
  });
  const setBlock = (x: number, y: number, z: number, block: number): void => {
    rawSetBlock(x, y, z, block);
    fluids.notify(x, y, z);
  };
  const savedChunks = new Map<number, Uint8Array>();

  function heightAt(x: number, z: number): number {
    const seed = deps.getSeed();
    if (deps.getGeneratorVersion() >= 2) {
      const base = biomeHeightAt(x, z, seed, WORLD_HEIGHT);
      return deps.getGeneratorVersion() >= 3 ? volcanoHeightAt(x, z, seed, base, WORLD_HEIGHT) : base;
    }
    const n = fbm(x / 40, z / 40, seed);
    const n2 = fbm(x / 170, z / 170, seed + 300);
    const m = fbm(x / 12, z / 12, seed + 50);
    const height = Math.floor(5 + (n * 0.72 + n2 * 0.28) * 34 + m * 4);
    return Math.max(3, Math.min(WORLD_HEIGHT - 12, height));
  }

  const regions = createStructureRegions({
    heightAt, getSeed: deps.getSeed, getPlayer: deps.getPlayer,
    getGeneratorVersion: deps.getGeneratorVersion,
    getBiome: (x, z) => biomeAt(x, z, deps.getSeed()),
    seaLevel: SEA_LEVEL, maxHeight: WORLD_HEIGHT,
  });
  const { REG: STRUCTURE_REGION_SIZE, groundH, forceSand,
    inStructZone, structureFor } = regions;
  const landmarks = createLandmarkFinder({
    getSeed: deps.getSeed, getVersion: deps.getGeneratorVersion,
    getDimension: deps.getDimension, getPlayer: deps.getPlayer,
    heightAt, inStructureZone: inStructZone,
    seaLevel: SEA_LEVEL, worldHeight: WORLD_HEIGHT,
  });
  const { buildStructure } = createStructureBuilders(deps.getSeed, {
    BRICK, COBBLE, CTABLE, DIRT, GOLD, GRAVEL, HAY,
    LEAVES, MOSSY, PLANKS, SANDSTONE, STONEBRICK, TORCH, WOOD,
  }, deps.getGeneratorVersion);
  const caveCarver = createCaveCarver({
    getSeed: deps.getSeed, heightAt: groundH, inStructureZone: inStructZone,
    worldHeight: WORLD_HEIGHT,
  });
  const generateChunkData = createChunkGenerator({
    getSeed: deps.getSeed, getDimension: deps.getDimension,
    getGeneratorVersion: deps.getGeneratorVersion,
    getBiome: (x, z) => biomeAt(x, z, deps.getSeed()),
    maxHeight: WORLD_HEIGHT, seaLevel: SEA_LEVEL,
    regionSize: STRUCTURE_REGION_SIZE, groundH, heightAt,
    forceSand, inStructZone, structureFor, buildStructure,
    carveCaves: caveCarver.carve,
    blocks: { BRICK, COAL_ORE, COPPER_ORE, DIAMOND_ORE, DIRT,
      GOLD, GRASS, IRON_ORE, LAVA, LEAVES, SAND, SANDSTONE,
      STONE, STONEBRICK, TORCH, WATER, WOOD, SNOW, PINE_LEAVES, RED_SAND, DARK_WOOD,
      BIRCH_WOOD, BIRCH_LEAVES, ACACIA_WOOD, ACACIA_LEAVES, WILLOW_WOOD,
      WILLOW_LEAVES, AUTUMN_LEAVES, MUD, FLOWERING_GRASS },
  });
  const lifecycle = createChunkLifecycle({
    chunks, savedChunks, height: WORLD_HEIGHT,
    getDimension: deps.getDimension, setSeed: deps.setSeed,
    setGeneratorVersion: deps.setGeneratorVersion,
    clearStructures: () => regions.structCache.clear(),
    onChunkLoaded: fluids.onChunkLoaded, onWorldReset: fluids.reset,
    chunkAt, resetChunkCache, generateChunkData, buildChunk,
    disposeMesh, solid, getBlock: get,
  });
  const streamChunks = createChunkStreamer({
    chunks, viewDistance: VIEW_DISTANCE, getPlayer: deps.getPlayer,
    ...lifecycle, buildChunk, disposeMesh, resetChunkCache,
  });

  return {
    ...catalog,
    ...renderer,
    ...mesher,
    ...regions,
    ...landmarks,
    ...lifecycle,
    chunks, savedChunks, hotbar, toolWear,
    chunkAt, resetChunkCache, get, setBlock, inBounds,
    heightAt, generateChunkData, streamChunks, stepFluids: fluids.tick,
    STRUCTURE_REGION_SIZE,
  };
}
