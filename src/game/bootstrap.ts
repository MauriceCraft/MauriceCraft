// @ts-nocheck
// This legacy gameplay loop is being migrated to typed, focused modules.
// Keep IndexedDB store names/keys and world serialization compatible.
import * as THREE from 'three';
import { raycastActors } from './entities/actor-targeting';
import { createRelicSystem } from './adventure/relics';
import { createWeatherSystem } from './rendering/weather-system';
import { SpatialIndex } from './entities/spatial-index';
import { bg, bm, part, JOBS, JOB_NAMES, makeZombie, makeCow, makePig, makeSheep, makeChicken, makeCreeper, makeSkeleton, makeSpider, makePillager, makeVindicator, makeIronGolem, makeCopperGolem, makeDiamondGolem, makeVillager, makeEnderDragon } from './entities/mob-models';
import { ckey } from './world/chunk-key';
import { createChunkStreamer } from './world/chunk-streamer';
import { createStructureRegions } from './world/structure-regions';
import { createStructureBuilders } from './world/structure-builders';
import { createChunkGenerator } from './world/chunk-generator';
import { raycastBlocks } from './world/raycast';
import { createCollisionEngine } from './world/collision';
import { mulberry32, hash2, fbm, smooth } from './world/noise';
import { blockKind } from './world/block-kind';
import { createBlockCatalog } from './world/block-catalog';
import { createRecipeMatcher } from './crafting/recipes';
import { createRecipeCatalog } from './crafting/recipe-catalog';
import { createInventoryUi } from './ui/inventory-ui';
import { createInputControls } from './input/game-controls';
import { createHud } from './ui/hud';
import { coord } from './commands/coordinates';
import { createItemResolver } from './commands/item-resolver';
import { findPortalFrame, portalContains } from './portals/frame';
import { restorePortals, snapshotPortals } from './portals/persistence';
import { createGameRenderer } from './rendering/game-renderer';
import { createExplosionSystem } from './effects/explosions';
import { createChunkMesher } from './rendering/chunk-mesher';
import { openWorldStorage } from './storage/world-storage';
import { createAudioEngine } from './audio/sound-engine';

(function () {
  'use strict';

  /* ---------- World constants ---------- */
  const H = 48, CS = 16, SEA = 14, R = 5;   // R = view distance in chunks
  const chunks = new Map();
  let _ck = null, _cc = null;
  function chunkAt(cx, cz) { const k = ckey(cx, cz); if (k === _ck) return _cc; _ck = k; _cc = chunks.get(k) || null; return _cc; }
  function resetChunkCache() { _ck = null; _cc = null; }
  // Unloaded space counts as solid, so nothing can walk into it
  function get(x, y, z) {
    if (y < 0) return 3;
    if (y >= H) return 0;
    const c = chunkAt(x >> 4, z >> 4);
    if (!c) return 3;
    return c.data[(y * 16 + (z & 15)) * 16 + (x & 15)];
  }
  function setBlock(x, y, z, b) {
    if (y < 0 || y >= H) return;
    const c = chunkAt(x >> 4, z >> 4);
    if (!c) return;
    c.data[(y * 16 + (z & 15)) * 16 + (x & 15)] = b; c.edited = true; c.dirty = true; c.torches = null;
  }
  function inBounds(x, y, z) { return y >= 0 && y < H; }

  // Persistent items, blocks, and mining rules live in a typed catalog.
  const {
    GRASS, DIRT, STONE, SAND, WOOD, LEAVES, PLANKS, BRICK,
    COBBLE, STONEBRICK, SANDSTONE, GRAVEL, HAY, GOLD, MOSSY, TNT,
    TORCH, CTABLE, BED, WATER, LAVA, OBSIDIAN, COAL_ORE, COPPER_ORE,
    IRON_ORE, DIAMOND_ORE, IRON_BLOCK, COPPER_BLOCK, DIAMOND_BLOCK, BEEF, PORK, MUTTON,
    CHICKEN, COOKED, WOOL, FEATHER, LEATHER, GUNPOWDER, DYNAMITE, FLINT,
    EMERALD, BONE, STRING, STICK, COAL, RAW_COPPER, RAW_IRON, COPPER_INGOT,
    IRON_INGOT, DIAMOND, ITEM_TILE, EGG_KINDS, FOOD, TILES, tileOf, ATLAS_N,
    isBed, BED_H, BED_DIR, solid, opq, NAMES, ALL_BLOCKS, BREAK_TIME,
    DROPS, TOOL_KINDS, TOOL_TIERS, toolId, toolTile, TOOLS, TOOL_IDS, TOOL_MAX,
    TOOL_LVL, TOOL_SPD, TOOL_DMG, NEEDS_PICK,
  } = createBlockCatalog();
  const hotbar = ALL_BLOCKS.slice(0, 9);
  const toolWear = {};

  const { canvas, renderer, scene, camera, atlasCanvas, tex, mat, torchMat,
    dayUniform, glowMat, sun, moon, sel } = createGameRenderer(toolTile);

  const { disposeMesh, buildChunk, refreshAround, blockGeo } = createChunkMesher({
    scene, mat, torchMat, glowMat, chunks, chunkAt,
    getBlock: get, opq, isBed, tiles: TILES, height: H, chunkSize: CS,
    atlasTiles: ATLAS_N, bedHeight: BED_H, torchId: TORCH,
  });

  /* ---------- Endless world generation, one chunk at a time ---------- */
  let seed = 1;
  let dimension = 'overworld'; // overworld, nether, or end
  const portals = []; // portal frames are saved with the world and paired between Overworld and Nether
  const portalVisuals = [];
  let portalCooldown = 0;
  const savedChunks = new Map();   // edited chunks loaded from a saved world, keyed like chunks
  function heightAt(x, z) {
    const n = fbm(x / 40, z / 40, seed), n2 = fbm(x / 170, z / 170, seed + 300), m = fbm(x / 12, z / 12, seed + 50);
    const h = Math.floor(5 + (n * 0.72 + n2 * 0.28) * 34 + m * 4);
    return Math.max(3, Math.min(H - 12, h));
  }
  /* ---------- Structures: villages, temples, towers, dungeons ---------- */
  const { REG, STRUCT_NAMES, structCache, structureFor, structAt, inStructZone,
    groundH, forceSand, nearestStructure } = createStructureRegions({
    heightAt, getSeed: () => seed, getPlayer: () => player, seaLevel: SEA, maxHeight: H,
  });

  const { buildStructure } = createStructureBuilders(() => seed, {
    BRICK, COBBLE, CTABLE, DIRT, GOLD, GRAVEL, HAY, LEAVES, MOSSY, PLANKS, SANDSTONE, STONEBRICK, TORCH, WOOD
  });

  const generateChunkData = createChunkGenerator({
    getSeed: () => seed,
    getDimension: () => dimension,
    maxHeight: H, seaLevel: SEA, regionSize: REG,
    groundH, heightAt, forceSand, inStructZone, structureFor, buildStructure,
    blocks: { BRICK, COAL_ORE, COPPER_ORE, DIAMOND_ORE, DIRT, GOLD, GRASS, IRON_ORE, LAVA, LEAVES, SAND, SANDSTONE, STONE, STONEBRICK, TORCH, WATER, WOOD },
  });
  function genChunk(cx, cz) {
    const sv = dimension === 'overworld' ? savedChunks.get(ckey(cx, cz)) : null;
    if (sv) {
      const sc = { cx: cx, cz: cz, data: new Uint8Array(sv), mesh: null, meshed: false, edited: true, dirty: false };
      chunks.set(ckey(cx, cz), sc); resetChunkCache();
      return sc;
    }
    const data = generateChunkData(cx, cz);
    const generated = { cx, cz, data, mesh: null, meshed: false, edited: false, dirty: false };
    chunks.set(ckey(cx, cz), generated);
    resetChunkCache();
    return generated;
  }
  function getOrGen(cx, cz) { return chunkAt(cx, cz) || genChunk(cx, cz); }
  function topY(x, z) { for (let y = H - 1; y >= 0; y--) if (solid(get(x, y, z))) return y; return 0; }

  function resetWorld(newSeed, ox, oz) {
    chunks.forEach(function (c) { disposeMesh(c); });
    chunks.clear(); resetChunkCache();
    seed = newSeed; structCache.clear();
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) genChunk(ox + dx, oz + dz);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) buildChunk(ox + dx, oz + dz);
  }

  const streamChunks = createChunkStreamer({
    chunks, viewDistance: R,
    getPlayer: () => player,
    getOrGen, genChunk, buildChunk, disposeMesh, resetChunkCache,
  });

  /* ---------- Game state ---------- */
  let mode = 'creative';
  let difficulty = 'normal';
  let spawnPoint = null, sleepT = 0, slept = false, omen = false;
  let hunger = 20, sat = 5, exhaust = 0, starveT = 0, shownHunger = -1;
  let weather = 'clear', weatherT = 420, rainLevel = 0, rainTarget = 0, lightningT = 0, nextBolt = 8;   // rain and thunderstorms   // Survival hunger: 20 = full   // bed respawn point, sleeping timer, raid omen
  // Difficulty only matters in Survival and Adventure (the modes with health and monsters)
  const DIFF = {
    peaceful: { label: 'Peaceful', cap: 0, every: 99, dmg: 0, speed: 1, aggro: 32, fuse: 1.5, shoot: 1, regenAfter: 1, regenEvery: 1, raid: 0, patrol: [1e9, 1e9] },
    easy: { label: 'Easy', cap: 4, every: 3.4, dmg: 0.6, speed: 0.9, aggro: 24, fuse: 1.9, shoot: 1.35, regenAfter: 4, regenEvery: 2.5, raid: 0.6, patrol: [150, 240] },
    normal: { label: 'Normal', cap: 8, every: 2.2, dmg: 1, speed: 1, aggro: 32, fuse: 1.5, shoot: 1, regenAfter: 6, regenEvery: 3, raid: 1, patrol: [90, 160] },
    hard: { label: 'Hard', cap: 12, every: 1.6, dmg: 1.5, speed: 1.15, aggro: 42, fuse: 1.1, shoot: 0.75, regenAfter: 9, regenEvery: 4.5, raid: 1.5, patrol: [60, 110] }
  };
  const MAXHP = 20;
  let hp = MAXHP, sinceHurt = 99, regenT = 0, dead = false;
  const inv = {};
  let specSpeed = 1;
  // Shared with the weather engine, time commands, sleeping and saved worlds.
  // The legacy bootstrap still owns this state until the final typed extraction.
  let tod = 0.22;
  let isNight = false, isDay = true;

  const player = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: false, fly: false, fallStart: null };
  function respawn() {
    if (spawnPoint) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) getOrGen((spawnPoint.x >> 4) + dx, (spawnPoint.z >> 4) + dz);
      if (isBed(get(spawnPoint.x, spawnPoint.y, spawnPoint.z))) {
        let by = spawnPoint.y + 0.57;
        for (let k = 0; k < 4 && collides(spawnPoint.x + 0.5, by, spawnPoint.z + 0.5); k++) by += 1;
        player.x = spawnPoint.x + 0.5; player.z = spawnPoint.z + 0.5; player.y = by;
        player.vx = player.vy = player.vz = 0; player.yaw = 0; player.pitch = -0.1; player.fallStart = null;
        return;
      }
      spawnPoint = null;   // the bed is gone
    }
    const x = 0, z = 0;
    player.x = x + 0.5; player.z = z + 0.5; player.y = topY(x, z) + 1.01;
    player.vx = player.vy = player.vz = 0; player.yaw = 0; player.pitch = -0.1; player.fallStart = null;
  }
  const PR = 0.3, PH = 1.8, EYE = 1.62;
  const { collides, moveEnt } = createCollisionEngine({
    getBlock: get, solid, defaultRadius: PR, defaultHeight: PH, bedHeight: BED_H,
  });

  /* ---------- Sound ---------- */
  const { Snd, saveSound, applySound, audioInit, sfx, sfxAt, updateMusic, tone, hiss } =
    createAudioEngine(() => player, () => isNight);

  /* ---------- Mobs: hostile monsters, villagers and farm animals ---------- */
  let enderDragonDefeated = false;
  const mobs = [];
  const hostileActors = new SpatialIndex(16);
  const defenders = new SpatialIndex(16);
  let activeMobIndexes = null;
  const rnd3 = n => 1 + Math.floor(Math.random() * n);
  const KINDS = {
    zombie: { hostile: true, r: 0.3, h: 1.8, hp: 20, speed: 2.7, melee: { d: 1.15, dmg: 3, cd: 1.1 }, make: makeZombie, drops: function () { return [[GUNPOWDER, Math.random() < 0.5 ? 1 : 0]]; } },
    enderdragon: { hostile: true, r: 2.8, h: 5.5, hp: 300, speed: 5.0, make: makeEnderDragon, drops: function () { return []; } },
    creeper: { hostile: true, r: 0.3, h: 1.85, hp: 20, speed: 2.4, make: makeCreeper, drops: function () { return [[GUNPOWDER, rnd3(2)]]; } },
    skeleton: { hostile: true, r: 0.3, h: 1.95, hp: 20, speed: 2.2, make: makeSkeleton, drops: function () { return [[BONE, Math.floor(Math.random() * 3)]]; } },
    spider: { hostile: true, r: 0.5, h: 0.8, hp: 16, speed: 3.2, melee: { d: 1.5, dmg: 2, cd: 0.9 }, make: makeSpider, drops: function () { return [[STRING, Math.floor(Math.random() * 3)]]; } },
    pillager: { hostile: true, illager: true, r: 0.3, h: 1.95, hp: 24, speed: 2.5, make: makePillager, drops: function () { return [[EMERALD, Math.random() < 0.5 ? 1 : 0], [GUNPOWDER, Math.random() < 0.3 ? 1 : 0]]; } },
    vindicator: { hostile: true, illager: true, r: 0.3, h: 1.95, hp: 24, speed: 3.0, melee: { d: 1.5, dmg: 6, cd: 1.0 }, make: makeVindicator, drops: function () { return [[EMERALD, Math.random() < 0.6 ? 1 : 0]]; } },
    irongolem: { golem: true, follow: false, hostile: false, r: 0.45, h: 2.7, hp: 100, speed: 2.2, range: 16, melee: { d: 2.4, dmg: 18, cd: 1.1, lift: 9 }, make: makeIronGolem, drops: function () { return [[IRON_INGOT, 3 + Math.floor(Math.random() * 3)]]; } },
    coppergolem: { golem: true, follow: true, hostile: false, r: 0.28, h: 1.45, hp: 40, speed: 3.4, range: 12, melee: { d: 1.3, dmg: 6, cd: 0.7, lift: 3 }, make: makeCopperGolem, drops: function () { return [[COPPER_INGOT, rnd3(2)]]; } },
    diamondgolem: { golem: true, follow: true, hostile: false, r: 0.55, h: 3.4, hp: 200, speed: 2.8, range: 20, melee: { d: 2.8, dmg: 30, cd: 1.0, lift: 11 }, make: makeDiamondGolem, drops: function () { return [[DIAMOND, 2 + Math.floor(Math.random() * 3)]]; } },
    villager: { hostile: false, r: 0.3, h: 1.95, hp: 20, speed: 0.9, make: makeVillager, drops: function () { return []; } },
    cow: { hostile: false, r: 0.45, h: 1.5, hp: 10, speed: 1.0, make: makeCow, drops: function () { return [[BEEF, rnd3(3)], [LEATHER, Math.random() < 0.5 ? 1 : 0]]; } },
    pig: { hostile: false, r: 0.4, h: 0.95, hp: 10, speed: 1.1, make: makePig, drops: function () { return [[PORK, rnd3(3)]]; } },
    sheep: { hostile: false, r: 0.45, h: 1.4, hp: 8, speed: 1.0, make: makeSheep, drops: function () { return [[MUTTON, rnd3(2)], [WOOL, rnd3(2)]]; } },
    chicken: { hostile: false, r: 0.2, h: 0.8, hp: 4, speed: 1.4, make: makeChicken, drops: function () { return [[CHICKEN, 1], [FEATHER, Math.floor(Math.random() * 3)]]; } }
  };
  const ANIMALS = ['cow', 'pig', 'sheep', 'chicken'];
  function addMob(kind, x, y, z, opts) {
    const K = KINDS[kind];
    const m = { kind: kind, hostile: K.hostile, r: K.r, h: K.h, hp: K.hp, x: x, y: y, z: z, vx: 0, vy: 0, vz: 0, onGround: false, hit: false,
      atk: 0.8, burn: -1, phase: Math.random() * 6, ai: Math.random() * 3, walk: false, dx: 0, dz: 1, panic: 0, face: Math.random() * 6.28,
      jumpCd: 0, persist: false, golem: !!K.golem, fuse: -1, shoot: 1.5 + Math.random(), snd: 3 + Math.random() * 8, job: opts && opts.job, village: null, hx: 0, hz: 0,
      group: K.make(opts || {}) };
    m.group.position.set(x, y, z);
    scene.add(m.group); mobs.push(m);
    return m;
  }
  function removeMobAt(index) {
    const mob = mobs[index];
    activeMobIndexes?.hostiles.delete(mob);
    activeMobIndexes?.defenders.delete(mob);
    scene.remove(mob.group);
    mobs.splice(index, 1);
  }
  function clearMobs() {
    mobs.forEach(function (m) { if (m.village) m.village.vSpawned = false; });   // villages repopulate afterwards
    while (mobs.length) removeMobAt(mobs.length - 1);
    while (blasts.length) removeBlastAt(blasts.length - 1);
    while (fx.length) removeFxAt(fx.length - 1);
    while (arrows.length) { scene.remove(arrows.pop().mesh); }
    pendingBlasts.length = 0; pendingHits.length = 0;
    endRaid(null);
    shake = 0;
  }
  function nearTorch(x, y, z, rad) {
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    for (let dy = -3; dy <= 4; dy++) for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) if (get(bx + dx, by + dy, bz + dz) === TORCH) return true;
    return false;
  }
  function trySpawnMob() {
    const a = Math.random() * Math.PI * 2, d = 14 + Math.random() * 12;
    const x = Math.floor(player.x + Math.cos(a) * d), z = Math.floor(player.z + Math.sin(a) * d);
    if (!chunkAt(x >> 4, z >> 4)) return;
    const y = topY(x, z), b = get(x, y, z);
    if (b === LEAVES || b === WOOD) return;
    const r = Math.random(), kind = r < 0.42 ? 'zombie' : (r < 0.62 ? 'creeper' : (r < 0.82 ? 'skeleton' : 'spider')), K = KINDS[kind];
    if (collides(x + 0.5, y + 1.01, z + 0.5, K.r, K.h)) return;
    if (nearTorch(x + 0.5, y + 1, z + 0.5, 8)) return;    // torches keep monsters from spawning nearby
    addMob(kind, x + 0.5, y + 1.01, z + 0.5);
  }
  function trySpawnAnimals() {
    const a = Math.random() * Math.PI * 2, d = 16 + Math.random() * 26;
    const bx = player.x + Math.cos(a) * d, bz = player.z + Math.sin(a) * d;
    const kind = ANIMALS[Math.floor(Math.random() * ANIMALS.length)], K = KINDS[kind];
    const n = kind === 'chicken' ? 2 + Math.floor(Math.random() * 2) : 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const x = Math.floor(bx + (Math.random() - 0.5) * 5), z = Math.floor(bz + (Math.random() - 0.5) * 5);
      if (!chunkAt(x >> 4, z >> 4)) continue;
      const y = topY(x, z);
      if (get(x, y, z) !== GRASS) continue;
      if (collides(x + 0.5, y + 1.01, z + 0.5, K.r, K.h)) continue;
      addMob(kind, x + 0.5, y + 1.01, z + 0.5);
    }
  }
  let spawnT = 2, animalT = 0.5, villT = 0.2, patrolT = 70;
  const pendingBlasts = [], pendingHits = [], arrows = [];
  function hasLOS(m, tgt) {
    const tx0 = tgt ? tgt.x : player.x, ty0 = (tgt ? tgt.y : player.y) + 1.2, tz0 = tgt ? tgt.z : player.z;
    const ox = m.x, oy = m.y + 1.5, oz = m.z, dx = tx0 - ox, dy = ty0 - oy, dz = tz0 - oz, d = Math.hypot(dx, dy, dz);
    const n = Math.ceil(d / 0.6);
    for (let i = 1; i < n; i++) { const t = i / n; if (solid(get(Math.floor(ox + dx * t), Math.floor(oy + dy * t), Math.floor(oz + dz * t)))) return false; }
    return true;
  }
  function shootArrow(m, dmg, tgt) {
    const tx0 = tgt ? tgt.x : player.x, ty0 = (tgt ? tgt.y : player.y) + 1.2, tz0 = tgt ? tgt.z : player.z;
    const ox = m.x, oy = m.y + 1.5, oz = m.z, dx = tx0 - ox, dy = ty0 - oy, dz = tz0 - oz;
    const d = Math.hypot(dx, dy, dz) || 1, sp = 20;
    const vx = dx / d * sp, vz = dz / d * sp, vy = dy / d * sp + 0.3 * d;
    const g = new THREE.Group();
    part(g, 0.05, 0.05, 0.6, 0x8a6a3c, 0, 0, 0); part(g, 0.08, 0.08, 0.08, 0xcfcfcf, 0, 0, 0.32);
    g.position.set(ox, oy, oz); scene.add(g); g.lookAt(ox + vx, oy + vy, oz + vz);
    arrows.push({ x: ox, y: oy, z: oz, vx: vx, vy: vy, vz: vz, mesh: g, life: 6, stuck: false, dmg: dmg || 3 });
    sfxAt('arrow', ox, oy, oz);
  }
  function updateArrows(dt) {
    for (let i = arrows.length - 1; i >= 0; i--) {
      const a = arrows[i];
      a.life -= dt;
      if (a.life <= 0) { scene.remove(a.mesh); arrows.splice(i, 1); continue; }
      if (a.stuck) continue;
      a.vy -= 12 * dt;
      const steps = Math.max(1, Math.ceil(Math.hypot(a.vx, a.vy, a.vz) * dt / 0.3));
      let gone = false;
      for (let s2 = 0; s2 < steps; s2++) {
        const nx = a.x + a.vx * dt / steps, ny = a.y + a.vy * dt / steps, nz = a.z + a.vz * dt / steps;
        if (collides(nx, ny - 0.05, nz, 0.05, 0.1)) { a.stuck = true; a.life = Math.min(a.life, 3); break; }
        a.x = nx; a.y = ny; a.z = nz;
        if (hasHealth() && Math.abs(a.x - player.x) < 0.45 && Math.abs(a.z - player.z) < 0.45 && a.y > player.y && a.y < player.y + 1.8) {
          damagePlayer(a.dmg || 3, true); sfx('hit'); scene.remove(a.mesh); arrows.splice(i, 1); gone = true; break;
        }
        for (let q = 0; q < mobs.length; q++) {   // arrows hit villagers too
          const o = mobs[q];
          if ((o.kind === 'villager' || o.golem) && Math.abs(a.x - o.x) < o.r + 0.15 && Math.abs(a.z - o.z) < o.r + 0.15 && a.y > o.y && a.y < o.y + o.h) {
            sfxAt('hit', o.x, o.y + 1, o.z); scene.remove(a.mesh); arrows.splice(i, 1); gone = true;
            damageMob(o, a.dmg || 3);
            break;
          }
        }
        if (gone) break;
      }
      if (gone) continue;
      a.mesh.position.set(a.x, a.y, a.z);
      if (!a.stuck) a.mesh.lookAt(a.x + a.vx, a.y + a.vy, a.z + a.vz);
    }
  }
  function spawnVillagers(st) {
    st.vSpawned = true;
    const n = 3 + Math.floor(hash2(st.rx, st.rz, seed + 900) * 3), off = Math.floor(hash2(st.rx, st.rz, seed + 901) * JOBS.length);
    for (let i = 0; i < n; i++) {
      const job = JOBS[(off + i) % JOBS.length];
      for (let tries = 0; tries < 16; tries++) {
        const rr = 3 + Math.random() * 9, a = Math.random() * Math.PI * 2;
        const x = st.cx + Math.cos(a) * rr, z = st.cz + Math.sin(a) * rr, y = st.gy + 1.01;
        if (!chunkAt(Math.floor(x) >> 4, Math.floor(z) >> 4)) continue;
        if (collides(x, y, z, 0.3, 1.95) || !solid(get(Math.floor(x), st.gy, Math.floor(z)))) continue;
        const m = addMob('villager', x, y, z, { job: job });
        m.village = st; m.hx = st.cx; m.hz = st.cz;
        break;
      }
    }
    for (let gi = 0; gi < (n >= 5 ? 2 : 1); gi++) {   // every village has an iron golem guard
      for (let tries = 0; tries < 16; tries++) {
        const rr = 4 + Math.random() * 8, a = Math.random() * Math.PI * 2;
        const x = st.cx + Math.cos(a) * rr, z = st.cz + Math.sin(a) * rr, y = st.gy + 1.01;
        if (!chunkAt(Math.floor(x) >> 4, Math.floor(z) >> 4)) continue;
        if (collides(x, y, z, 0.45, 2.7) || !solid(get(Math.floor(x), st.gy, Math.floor(z)))) continue;
        const gm = addMob('irongolem', x, y, z, null);
        gm.village = st; gm.hx = st.cx; gm.hz = st.cz;
        break;
      }
    }
  }
  function manageVillagers() {
    const prx = Math.floor(player.x / REG), prz = Math.floor(player.z / REG);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const st = structureFor(prx + dx, prz + dz);
      if (!st || st.type !== 'village') continue;
      if (Math.hypot(st.cx - player.x, st.cz - player.z) < 70 && !st.vSpawned) spawnVillagers(st);
    }
  }
  // Pillager patrols wander in from afar. Killing the banner-carrying leader brings a Bad Omen:
  // the next village you enter is raided in three waves.
  function trySpawnPatrol() {
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 12;
      const bx = Math.floor(player.x + Math.cos(a) * d), bz = Math.floor(player.z + Math.sin(a) * d);
      if (!chunkAt(bx >> 4, bz >> 4)) continue;
      const n = 2 + Math.floor(Math.random() * 3);
      let made = 0;
      for (let i = 0; i < n; i++) {
        const x = bx + Math.floor((Math.random() - 0.5) * 6), z = bz + Math.floor((Math.random() - 0.5) * 6);
        if (!chunkAt(x >> 4, z >> 4)) continue;
        const y = topY(x, z), b = get(x, y, z);
        if (b === LEAVES || b === WOOD || b === 0) continue;
        const kind = (i > 0 && Math.random() < 0.25) ? 'vindicator' : 'pillager', K = KINDS[kind];
        if (collides(x + 0.5, y + 1.01, z + 0.5, K.r, K.h)) continue;
        const lead = made === 0 && kind === 'pillager';
        const m = addMob(kind, x + 0.5, y + 1.01, z + 0.5, { leader: lead });
        m.leader = lead; made++;
      }
      if (made) { showHint('A pillager patrol is nearby!', 3500); sfx('pillager'); return; }
    }
  }
  const raid = { active: false, st: null, wave: 0, cd: 0 };
  const RAID_WAVES = [[3, 0], [4, 1], [5, 2]];   // [pillagers, vindicators] on Normal
  const raidEl = document.getElementById('raid');
  function endRaid(msg) {
    const was = raid.active;
    raid.active = false; raid.st = null; raid.wave = 0;
    mobs.forEach(function (m) { m.raid = false; });
    raidEl.style.display = 'none';
    if (msg && was) showHint(msg, 4000);
  }
  function spawnRaiders(n, kind) {
    const st = raid.st, K = KINDS[kind];
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 14; tries++) {
        const a = Math.random() * Math.PI * 2, rr = 26 + Math.random() * 8;
        const x = Math.floor(st.cx + Math.cos(a) * rr), z = Math.floor(st.cz + Math.sin(a) * rr);
        if (!chunkAt(x >> 4, z >> 4)) continue;
        const y = topY(x, z), b = get(x, y, z);
        if (b === LEAVES || b === WOOD || b === 0) continue;
        if (collides(x + 0.5, y + 1.01, z + 0.5, K.r, K.h)) continue;
        const m = addMob(kind, x + 0.5, y + 1.01, z + 0.5, null); m.raid = true;
        break;
      }
    }
  }
  function updateRaid(dt, D) {
    if (!raid.active) {
      raidEl.style.display = 'none';
      if (omen && hasHealth() && D.cap > 0 && !dead) {
        const prx = Math.floor(player.x / REG), prz = Math.floor(player.z / REG);
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const st = structureFor(prx + dx, prz + dz);
          if (st && st.type === 'village' && Math.hypot(st.cx - player.x, st.cz - player.z) < 30) {
            raid.active = true; raid.st = st; raid.wave = 0; raid.cd = 5; omen = false;
            showHint('A raid is coming to the village! Defend it.', 4500); sfx('pillager');
            return;
          }
        }
      }
      return;
    }
    if (dead || !hasHealth() || D.cap === 0 || Math.hypot(raid.st.cx - player.x, raid.st.cz - player.z) > 110) { endRaid('The raid has ended.'); return; }
    let alive = 0;
    for (let i = 0; i < mobs.length; i++) if (mobs[i].raid) alive++;
    raidEl.style.display = 'block';
    if (alive === 0) {
      raidEl.textContent = raid.wave >= RAID_WAVES.length ? 'Raid \u00b7 victory!' : 'Raid \u00b7 next wave incoming';
      raid.cd -= dt;
      if (raid.cd <= 0) {
        if (raid.wave >= RAID_WAVES.length) {
          endRaid(null);
          if (mode === 'survival') giveItem(EMERALD, 8);
          showHint('Raid defeated! The villagers reward you with emeralds.', 5000); sfx('yes');
        } else {
          const w = RAID_WAVES[raid.wave];
          raid.wave++;
          spawnRaiders(Math.max(1, Math.round(w[0] * D.raid)), 'pillager');
          const v = Math.round(w[1] * D.raid);
          if (v > 0) spawnRaiders(v, 'vindicator');
          raid.cd = 4; sfx('pillager');
        }
      }
    } else raidEl.textContent = 'Raid \u00b7 wave ' + raid.wave + ' of ' + RAID_WAVES.length + ' \u00b7 ' + alive + ' raider' + (alive === 1 ? '' : 's') + ' left';
  }
  function updateMobs(dt) {
    const D = DIFF[difficulty];
    if (dimension === 'end') {
      if (!enderDragonDefeated && !mobs.some(function (m) { return m.kind === 'enderdragon'; })) {
        addMob('enderdragon', player.x + 8, Math.max(28, player.y + 8), player.z + 1, { boss: true });
        showHint('ENDER DRAGON! Hit it with your sword or shoot it with arrows!', 5500);
      }
      spawnT = Math.max(spawnT, 2); animalT = Math.max(animalT, 2); villT = Math.max(villT, 2);
    }
    spawnT -= dt; animalT -= dt; villT -= dt;
    if (dimension !== 'end' && hasHealth() && spawnT <= 0) {
      spawnT = D.every;
      if (D.cap > 0 && (isNight || weather === 'storm') && mobs.filter(function (m) { return m.hostile && !KINDS[m.kind].illager; }).length < D.cap) trySpawnMob();
    }
    if (dimension !== 'end' && animalT <= 0) {
      animalT = 2.5;
      if (!isNight && mobs.filter(function (m) { return !m.hostile && m.kind !== 'villager'; }).length < 12) trySpawnAnimals();
    }
    if (dimension !== 'end' && villT <= 0) { villT = 1.5; manageVillagers(); }
    patrolT -= dt;
    if (dimension !== 'end' && patrolT <= 0) {
      patrolT = D.patrol[0] + Math.random() * (D.patrol[1] - D.patrol[0]);
      if (hasHealth() && D.cap > 0 && mobs.filter(function (m) { return KINDS[m.kind].illager && !m.raid; }).length < 6) trySpawnPatrol();
    }
    if (dimension !== 'end') updateRaid(dt, D);
    // Index mobs once per frame instead of searching everyone for every AI actor.
    hostileActors.clear();
    defenders.clear();
    for (const mob of mobs) {
      if (mob.hostile) hostileActors.upsert(mob);
      if (mob.kind === 'villager' || mob.golem) defenders.upsert(mob);
    }
    activeMobIndexes = { hostiles: hostileActors, defenders };
    for (let i = mobs.length - 1; i >= 0; i--) {
      const m = mobs[i], K = KINDS[m.kind];
      const dx = player.x - m.x, dz = player.z - m.z;
      const dist = Math.hypot(dx, dz) || 0.0001;
      if (m.kind === 'enderdragon') {
        m.phase += dt * 2.4;
        const targetX = player.x + Math.sin(m.phase * 0.55) * 10;
        const targetZ = player.z + Math.cos(m.phase * 0.55) * 10;
        const targetY = 27 + Math.sin(m.phase * 1.3) * 4;
        const ex = targetX - m.x, ez = targetZ - m.z, ey = targetY - m.y;
        const ed = Math.hypot(ex, ez) || 1;
        m.x += ex / ed * Math.min(ed, K.speed * dt);
        m.z += ez / ed * Math.min(ed, K.speed * dt);
        m.y += Math.max(-1, Math.min(1, ey)) * dt * 2.2;
        m.group.position.set(m.x, m.y + Math.sin(m.phase * 2) * 0.35, m.z);
        m.group.rotation.y = Math.atan2(ex, ez);
        hostileActors.upsert(m);
        if (m.group.userData.wings) m.group.userData.wings.forEach(function (w) { w.rotation.z = Math.sin(m.phase * 5) * 0.55 * w.userData.flapSide; });
        m.atk -= dt;
        if (dist < 5.5 && Math.abs(player.y - m.y) < 7 && m.atk <= 0) {
          m.atk = 1.4; damagePlayer(5, true); player.vx += dx / dist * 7; player.vz += dz / dist * 7; player.vy = 5;
          showHint('The Ender Dragon knocked you back!', 1400);
        }
        continue;
      }
      if (m.y < -30) { removeMobAt(i); continue; }
      if (m.hostile && D.cap === 0 && hasHealth()) { removeMobAt(i); continue; }   // Peaceful: no monsters at all
      if (m.kind === 'villager' || m.village) { if (dist > 140) { if (m.village) m.village.vSpawned = false; removeMobAt(i); continue; } }
      else if (dist > (m.persist ? 120 : (K.illager ? 130 : (m.hostile ? 70 : 95)))) { removeMobAt(i); continue; }
      m.snd -= dt;
      if (m.snd <= 0) {
        m.snd = 6 + Math.random() * 10;
        if (m.kind !== 'creeper' && dist < (m.hostile ? 18 : 26)) sfxAt(m.kind, m.x, m.y + 1, m.z);
      }
      let tx = 0, tz = 0, ax = dx, az = dz, ad = dist, huntV = null;   // a*, huntV: who this monster is going after
      if (m.hostile) {
        if (isDay && rainLevel < 0.5 && !m.persist && !K.illager) {   // rain keeps monsters from burning in daylight
          if (m.burn < 0) m.burn = 1 + Math.random() * 5; m.burn -= dt; if (m.burn <= 0) { removeMobAt(i); continue; } }
        else m.burn = -1;
        const ill = !!K.illager;
        if (m.kind === 'zombie' || ill) {   // zombies and illagers go for the nearest villager when it is closer than you
          for (const o of defenders.near(m.x, m.z, 40)) {
            const vd = Math.hypot(o.x - m.x, o.z - m.z);
            if (vd < ad && vd < 40) { ad = vd; ax = o.x - m.x; az = o.z - m.z; huntV = o; }
          }
        }
        const sees = ad < (ill ? (m.raid ? 70 : D.aggro + 12) : D.aggro);
        if (ill && !sees) {   // patrols and raiders march towards the player or the village
          const hx = (m.raid && raid.st) ? raid.st.cx : player.x, hz = (m.raid && raid.st) ? raid.st.cz : player.z, hd = Math.hypot(hx - m.x, hz - m.z) || 1;
          tx = (hx - m.x) / hd * 1.5; tz = (hz - m.z) / hd * 1.5;
        }
        m.jumpCd -= dt;
        if (m.kind === 'creeper') {
          if (m.fuse >= 0) {
            m.fuse -= dt;
            const sw = 1 + (D.fuse - m.fuse) * 0.2 + (Math.floor(m.fuse * 8) % 2 ? 0.05 : 0);
            m.group.scale.setScalar(sw);
            if (m.fuse <= 0) { pendingBlasts.push({ x: m.x, y: m.y + 0.8, z: m.z, r: 3.4, p: 24 * D.dmg }); removeMobAt(i); continue; }
            if (dist > 5) { m.fuse = -1; m.group.scale.setScalar(1); }
          } else if (sees) {
            if (dist < 3.2) { m.fuse = D.fuse; sfxAt('creeper', m.x, m.y + 1, m.z); }
            else if (dist > 0.9) { tx = dx / dist * K.speed * D.speed; tz = dz / dist * K.speed * D.speed; }
          }
        } else if (m.kind === 'skeleton') {
          if (sees && dist > 11) { tx = dx / dist * K.speed * D.speed; tz = dz / dist * K.speed * D.speed; }
          else if (sees && dist < 6) { tx = -dx / dist * K.speed * D.speed; tz = -dz / dist * K.speed * D.speed; }
          m.shoot -= dt;
          if (dist < 22 && m.shoot <= 0 && hasLOS(m)) { m.shoot = (2 + Math.random() * 0.8) * D.shoot; shootArrow(m); }
        } else if (m.kind === 'pillager') {
          if (sees && ad > 13) { tx = ax / ad * K.speed * D.speed; tz = az / ad * K.speed * D.speed; }
          else if (sees && ad < 8) { tx = -ax / ad * K.speed * D.speed; tz = -az / ad * K.speed * D.speed; }
          m.shoot -= dt;
          if (ad < 26 && m.shoot <= 0 && hasLOS(m, huntV)) { m.shoot = (2.4 + Math.random() * 0.8) * D.shoot; shootArrow(m, 4, huntV); }
        } else {
          if (sees && ad > 0.9) { tx = ax / ad * K.speed * D.speed; tz = az / ad * K.speed * D.speed; }
          if (m.kind === 'spider' && sees && dist < 4.5 && m.onGround && m.jumpCd <= 0) { m.jumpCd = 1.2; m.vy = 7; m.vx = dx / dist * 5; m.vz = dz / dist * 5; }
        }
      } else if (K.golem) {
        // Golems fight any monster nearby. Copper and diamond golems tag along with you; iron golems guard their post.
        let tgt = null, td = K.range;
        for (const o of hostileActors.near(m.x, m.z, K.range)) {
          const d2 = Math.hypot(o.x - m.x, o.z - m.z);
          if (d2 < td) { td = d2; tgt = o; }
        }
        m.atk -= dt; m.ai -= dt;
        if (tgt) {
          const ex = tgt.x - m.x, ez = tgt.z - m.z;
          if (td > K.melee.d * 0.7) { tx = ex / td * K.speed; tz = ez / td * K.speed; }
          if (td < K.melee.d && Math.abs(tgt.y - m.y) < 3 && m.atk <= 0) {
            m.atk = K.melee.cd;
            tgt.vx += ex / (td || 1) * 6; tgt.vz += ez / (td || 1) * 6; tgt.vy = K.melee.lift;
            pendingHits.push({ m: tgt, d: K.melee.dmg });
            sfxAt('hit', tgt.x, tgt.y + 1, tgt.z);
          }
        } else if (K.follow) {
          // snap back to you when it falls far behind or gets stuck on a cliff
          m.stuckT = (dist > 6 && Math.hypot(m.vx, m.vz) < 0.5) ? (m.stuckT || 0) + dt : 0;
          if (dist > 40 || m.stuckT > 2.5) { m.stuckT = 0; m.x = player.x + (Math.random() - 0.5) * 3; m.z = player.z + (Math.random() - 0.5) * 3; m.y = player.y + 0.2; m.vx = m.vy = m.vz = 0; }
          else if (dist > 5) { tx = dx / dist * K.speed; tz = dz / dist * K.speed; }
        } else {
          const hd = Math.hypot(m.hx - m.x, m.hz - m.z) || 0.01;
          if (hd > 18) { tx = (m.hx - m.x) / hd * 1.5; tz = (m.hz - m.z) / hd * 1.5; }
          else {
            if (m.ai <= 0) { m.ai = 3 + Math.random() * 5; m.walk = Math.random() < 0.4; const a = Math.random() * Math.PI * 2; m.dx = Math.cos(a); m.dz = Math.sin(a); }
            if (m.walk) { tx = m.dx; tz = m.dz; }
          }
        }
      } else if (m.kind === 'villager') {
        m.panic -= dt; m.ai -= dt;
        let fx = 0, fz = 0, scared = false;
        for (const o of hostileActors.near(m.x, m.z, 9)) {
          const ox = m.x - o.x, oz = m.z - o.z, od = Math.hypot(ox, oz);
          if (od < 9 && od > 0.01) { fx += ox / od; fz += oz / od; scared = true; }
        }
        const hd = Math.hypot(m.hx - m.x, m.hz - m.z) || 0.01;
        if (scared) { const fl = Math.hypot(fx, fz) || 1; tx = fx / fl * 3.2; tz = fz / fl * 3.2; }
        else if (m.panic > 0) { tx = -dx / dist * 3.4; tz = -dz / dist * 3.4; }
        else if (hd > 18) { tx = (m.hx - m.x) / hd * 1.2; tz = (m.hz - m.z) / hd * 1.2; }
        else {
          if (m.ai <= 0) { m.ai = 2 + Math.random() * 4; m.walk = Math.random() < (isNight ? 0.2 : 0.45); const a = Math.random() * Math.PI * 2; m.dx = Math.cos(a); m.dz = Math.sin(a); }
          if (m.walk) { tx = m.dx * K.speed; tz = m.dz * K.speed; }
        }
      } else {
        m.panic -= dt; m.ai -= dt;
        if (m.panic > 0) { tx = -dx / dist * 3.6; tz = -dz / dist * 3.6; }
        else {
          if (m.ai <= 0) { m.ai = 2 + Math.random() * 4; m.walk = Math.random() < 0.55; const a = Math.random() * Math.PI * 2; m.dx = Math.cos(a); m.dz = Math.sin(a); }
          if (m.walk) { tx = m.dx * K.speed; tz = m.dz * K.speed; }
        }
      }
      const k = Math.min(1, 8 * dt);
      if (m.kind === 'spider' && !m.onGround) { /* keep the pounce going */ }
      else { m.vx += (tx - m.vx) * k; m.vz += (tz - m.vz) * k; }
      m.vy = Math.max(-50, m.vy - 28 * dt);
      m.onGround = false; m.hit = false;
      moveEnt(m, 0, m.vx * dt); moveEnt(m, 2, m.vz * dt); moveEnt(m, 1, m.vy * dt);
      if (m.hit && m.onGround && (!m.hostile || dist > 1)) m.vy = m.hostile ? 8.2 : 7.8;
      if (m.hostile) {
        const ml = K.melee;
        m.atk -= dt;
        if (ml && huntV && m.atk <= 0 && Math.hypot(huntV.x - m.x, huntV.z - m.z) < ml.d && Math.abs(huntV.y - m.y) < 1.6) {
          m.atk = ml.cd;
          huntV.vx += ax / ad * 6; huntV.vz += az / ad * 6; huntV.vy = 4;
          pendingHits.push({ m: huntV, d: ml.dmg });
          sfxAt('hit', huntV.x, huntV.y + 1, huntV.z);
        } else if (ml && dist < ml.d && Math.abs(player.y - m.y) < 1.6 && m.atk <= 0) {
          m.atk = ml.cd;
          damagePlayer(ml.dmg, true);
          player.vx += dx / dist * 6; player.vz += dz / dist * 6; if (player.onGround) player.vy = 4;
        }
        m.face = Math.atan2(ax, az);
      } else if (Math.hypot(m.vx, m.vz) > 0.25) m.face = Math.atan2(m.vx, m.vz);
      else if (m.kind === 'villager' && dist < 4) m.face = Math.atan2(dx, dz);
      m.group.position.set(m.x, m.y, m.z);
      m.group.rotation.y = m.face;
      if (m.hostile) hostileActors.upsert(m);
      if (m.kind === 'villager' || m.golem) defenders.upsert(m);
      const sp = Math.hypot(m.vx, m.vz);
      m.phase += dt * sp * 3.2;
      const sw = Math.sin(m.phase) * Math.min(0.8, sp * 0.5 + 0.05), legs = m.group.userData.legs;
      for (let j = 0; j < legs.length; j++) legs[j].rotation.x = (legs.length === 4 ? (j === 0 || j === 3) : (j === 0)) ? sw : -sw;
    }
    while (pendingHits.length) { const ph = pendingHits.pop(); if (mobs.indexOf(ph.m) >= 0) damageMob(ph.m, ph.d); }
    while (pendingBlasts.length) { const pb = pendingBlasts.pop(); explode(pb.x, pb.y, pb.z, pb.r, pb.p); }
    activeMobIndexes = null;
  }

  const rayDir = new THREE.Vector3();
  function raycastMobs(maxDistance) {
    camera.getWorldDirection(rayDir);
    return raycastActors(mobs, camera.position, rayDir, maxDistance);
  }
  function giveItem(id, n) { inv[id] = (inv[id] || 0) + n; updateHotbar(false); }
  function killMob(m) {
    const i = mobs.indexOf(m);
    if (i >= 0) removeMobAt(i);
    if (m.kind === 'enderdragon') {
      enderDragonDefeated = true;
      showHint('THE ENDER DRAGON IS DEFEATED! You conquered the End!', 8000);
      sfxAt('explode', m.x, m.y, m.z);
      if (mode === 'survival') giveItem(DIAMOND, 5);
      return;
    }
    sfxAt('die', m.x, m.y + 0.5, m.z);
    if (m.leader && hasHealth() && !omen && DIFF[difficulty].cap > 0) { omen = true; showHint('You feel an ominous presence... Enter a village and a raid will follow.', 5500); }
    if (mode === 'survival') {
      const got = [];
      KINDS[m.kind].drops().forEach(function (d) { if (d[1] > 0) { giveItem(d[0], d[1]); got.push('+' + d[1] + ' ' + NAMES[d[0]]); } });
      if (got.length) flashName(got.join('   '));
    }
  }
  function damageMob(m, dmg) {
    m.hp -= dmg;
    if (!m.hostile) m.panic = 3.5;
    if (m.hp <= 0) { killMob(m); return true; }
    return false;
  }
  function attackMob(m) {
    if (m.golem) { flashName('That golem is on your side'); return; }
    const dx = m.x - player.x, dz = m.z - player.z, d = Math.hypot(dx, dz) || 1;
    m.vx += dx / d * 9; m.vz += dz / d * 9; m.vy = 5;
    sfxAt('hit', m.x, m.y + 0.8, m.z);
    damageMob(m, attackDamage());
  }

  let shake = 0;
  const { blasts, fx, rebuildSet, spawnTnt, addDynamite, removeBlastAt, removeFxAt,
    queueRebuild, flushRebuilds, explode, updateBlasts, updateFx } = createExplosionSystem({
    scene, texture: tex, tntId: TNT, torchId: TORCH, worldHeight: H,
    breakTimes: BREAK_TIME, blockGeometry: blockGeo,
    getBlock: get, setBlock, hasChunk: (x, z) => !!chunkAt(x, z), buildChunk,
    getMobs: () => mobs, getPlayer: () => player,
    damageMob: (mob, damage) => { damageMob(mob, damage); },
    damagePlayer: damage => damagePlayer(damage),
    moveEntity: moveEnt, collides,
    playSound: (name, x, y, z) => sfxAt(name, x, y, z),
    increaseShake: amount => { shake = Math.max(shake, amount); },
  });

  const { RELIC_COUNT, relics, addRelic, clearRelics, createRelics,
    updateRelics, checkRelics, objectiveText, setMode: syncRelicVisibility } = createRelicSystem({
    scene, getMode: () => mode, getPlayer: () => player,
    getOrGenerateChunk: getOrGen, topBlockY: topY, getBlock: get,
    inStructureZone: inStructZone, grassBlock: GRASS, sandBlock: SAND,
    showHint: (message, milliseconds) => showHint(message, milliseconds),
  });

  /* ---------- Input state ---------- */
  const keys = {};
  const touchMove = { x: 0, z: 0 };
  let touchJump = false;
  let selected = 0;
  let playing = false, locked = false, fallback = false, ready = false;
  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  let invOpen = false, tradeOpen = false, craftOpen = false, cmdOpen = false;
  let mining = false, placing = false, pulseMine = false, pulsePlace = false;
  let mineCd = 0, placeCd = 0, attackCd = 0;
  let drag = null;
  let stick = null, lookT = null;
  const mine = { x: -1, y: -1, z: -1, t: 0 };

  const canInteract = () => mode === 'creative' || mode === 'survival';
  const hasHealth = () => mode === 'survival' || mode === 'adventure';

  /* ---------- Hotbar & hearts ---------- */
  const { hotbarEl, heartsEl, foodEl, flashEl, mineBar,
    updateHotbar, flashName, updateFood, updateHearts } = createHud({
    hotbar, inventory: inv, names: NAMES, atlasCanvas, tileOf,
    tools: TOOLS, toolMax: TOOL_MAX, toolWear,
    getMode: () => mode, getSelected: () => selected,
    setSelected: slot => { selected = slot; },
    getHunger: () => hunger, getHealth: () => hp,
    canInteract, maxHealth: MAXHP,
  });

  // Hunger drains slowly with activity (a lot when sprinting). Eat to refill it; at zero you starve.
  function exert(n) {
    if (mode !== 'survival' || difficulty === 'peaceful') return;
    exhaust += n;
    while (exhaust >= 4) {
      exhaust -= 4;
      if (sat > 0) sat = Math.max(0, sat - 1); else hunger = Math.max(0, hunger - 1);
    }
  }
  // Hunger and health displays are provided by the HUD adapter.
  function renderFood(): void { shownHunger = hunger; updateFood(); }
  function damagePlayer(n, scaled) {
    if (scaled) n = Math.round(n * DIFF[difficulty].dmg);   // monster hits scale with difficulty
    if (!hasHealth() || dead || n <= 0) return;
    if (sleepT > 0) { sleepT = 0; fadeEl.style.opacity = 0; }
    hp = Math.max(0, hp - n); sinceHurt = 0; regenT = 0; sfx('hurt');
    flashEl.style.opacity = 0.9;
    setTimeout(function () { flashEl.style.opacity = 0; }, 140);
    updateHearts();
    if (hp <= 0) die();
  }

  const RECIPES = createRecipeCatalog({
    items: { BED, BEEF, BONE, BRICK, CHICKEN, COAL, COBBLE, COOKED, COPPER_BLOCK, COPPER_INGOT, CTABLE, DIAMOND, DIAMOND_BLOCK, DIRT, DYNAMITE, EMERALD, FEATHER, FLINT, GOLD, GRAVEL, GUNPOWDER, IRON_BLOCK, IRON_INGOT, LEATHER, MUTTON, PLANKS, PORK, RAW_COPPER, RAW_IRON, SAND, SANDSTONE, STICK, STONE, STONEBRICK, STRING, TNT, TORCH, WOOD, WOOL },
    toolTiers: TOOL_TIERS, toolId,
  });
  const inventoryUiState = {
    get locked() { return locked; }, set locked(value) { locked = value; },
    get fallback() { return fallback; }, set fallback(value) { fallback = value; },
    get specSpeed() { return specSpeed; }, set specSpeed(value) { specSpeed = value; },
    get pulseMine() { return pulseMine; }, set pulseMine(value) { pulseMine = value; },
    get pulsePlace() { return pulsePlace; }, set pulsePlace(value) { pulsePlace = value; },
    get mineCd() { return mineCd; }, set mineCd(value) { mineCd = value; },
    get placeCd() { return placeCd; }, set placeCd(value) { placeCd = value; },
    get selected() { return selected; }, set selected(value) { selected = value; },
    get playing() { return playing; }, set playing(value) { playing = value; },
    get invOpen() { return invOpen; }, set invOpen(value) { invOpen = value; },
    get tradeOpen() { return tradeOpen; }, set tradeOpen(value) { tradeOpen = value; },
    get craftOpen() { return craftOpen; }, set craftOpen(value) { craftOpen = value; },
    get cmdOpen() { return cmdOpen; }, set cmdOpen(value) { cmdOpen = value; },
    get mining() { return mining; }, set mining(value) { mining = value; },
    get placing() { return placing; }, set placing(value) { placing = value; },
    get drag() { return drag; }, set drag(value) { drag = value; },
    get touchJump() { return touchJump; }, set touchJump(value) { touchJump = value; },
    get stick() { return stick; }, set stick(value) { stick = value; },
    get lookT() { return lookT; }, set lookT(value) { lookT = value; },
  };
  const { openCraft, renderCraft, openInventory, closeInventory, renderInventory,
    openTrade, renderTrade } = createInventoryUi({
    state: inventoryUiState, atlasCanvas, tileOf, inventory: inv, hotbar,
    allBlocks: ALL_BLOCKS, names: NAMES, recipes: RECIPES,
    itemIds: { HAY, WOOL, BONE, EMERALD, COOKED, BED, BEEF, PORK, CHICKEN, LEATHER, COBBLE, STONEBRICK, SANDSTONE, BRICK, COPPER_INGOT, GUNPOWDER, TORCH, FLINT, DYNAMITE, TNT, IRON_INGOT, COAL, GOLD, DIAMOND },
    jobNames: JOB_NAMES, keys, touchMove, isTouch,
    getMode: () => mode, getModeLabel: () => LABEL[mode],
    getFallback: () => fallback,
    getHealth: () => hp, setHealth: health => { hp = health; },
    maxHealth: MAXHP, updateHearts, updateHotbar, showHint,
    playSound: event => sfx(event),
    playSoundAt: (event, x, y, z) => sfxAt(event, x, y, z),
    requestPointerLock: () => requestLock(), pauseGame: () => pause(),
    getCommandBar: () => cmdBar,
  });

  /* ---------- Keyboard / mouse / touch ---------- */
  const { touchUI, jumpButton: bJump, placeButton: bPlace, flyButton: bFly,
    inventoryButton: bInv, toggleFly } = createInputControls({
    canvas, keys, touchMove, player, state: inventoryUiState, isTouch,
    getMode: () => mode, canInteract, updateHotbar, showHint,
    openInventory, openCommand: (command) => openCmd(command), pause,
  });

  /* ---------- Block interaction ---------- */
  const dirV = new THREE.Vector3();
  let blockHit = null, target = null;
  function raycast(maxD) {
    camera.getWorldDirection(dirV);
    return raycastBlocks(camera.position, dirV, maxD, get, solid, H);
  }
  function resetMine() { mine.t = 0; mine.x = mine.y = mine.z = -1; mineBar.style.display = 'none'; }
  function doBreak(t) {
    const b = get(t.x, t.y, t.z);
    if (mode === 'survival') {
      exert(0.02);
      if (canCollect(b)) { const drop = isBed(b) ? BED : (DROPS[b] || b); inv[drop] = (inv[drop] || 0) + 1; updateHotbar(false); }
      else flashName('You need a ' + (NEEDS_PICK[b] > 0 ? 'stronger ' : '') + 'pickaxe to collect this');
      const ht = heldTool();
      if (ht) wearTool(ht.id, ht.kind === 'sword' ? 2 : 1);
    }
    if (mode === 'survival' && b === GRAVEL && Math.random() < 0.3) { giveItem(GUNPOWDER, 1); flashName('+1 Gunpowder'); }
    setBlock(t.x, t.y, t.z, 0);
    if (isBed(b)) {   // take the other half of the bed with it
      const k = b - 19, dv = BED_DIR[k >> 1], head = k & 1, sg = head ? -1 : 1;
      const px = t.x + dv[0] * sg, pz = t.z + dv[1] * sg, pid = 19 + (k >> 1) * 2 + (1 - head);
      if (get(px, t.y, pz) === pid) { setBlock(px, t.y, pz, 0); refreshAround(px, pz); }
    }
    sfx('break', 1, 0, b);
    let torchGone = b === TORCH;
    if (get(t.x, t.y + 1, t.z) === TORCH) { setBlock(t.x, t.y + 1, t.z, 0); torchGone = true; if (mode === 'survival') giveItem(TORCH, 1); }
    refreshAround(t.x, t.z, torchGone);
  }
  // The tool in the selected hotbar slot (in Survival you must own it)
  function heldTool() {
    const it = hotbar[selected], T = TOOLS[it];
    if (!T || mode === 'adventure' || mode === 'spectator') return null;
    if (mode === 'survival' && !(inv[it] > 0)) return null;
    return { id: it, kind: T.kind, tier: T.tier };
  }
  function toolSpeed(b) {
    const t = heldTool();
    if (!t) return 1;
    if (t.kind === blockKind(b)) return TOOL_SPD[t.tier];
    if (t.kind === 'sword' && (b === 6 || b === 13)) return 2;
    return 1;
  }
  function canCollect(b) {
    if (!(b in NEEDS_PICK)) return true;
    const t = heldTool();
    return !!t && t.kind === 'pickaxe' && TOOL_LVL[t.tier] >= NEEDS_PICK[b];
  }
  function wearTool(id, n) {
    if (mode !== 'survival') return;
    toolWear[id] = (toolWear[id] || 0) + n;
    if (toolWear[id] >= TOOL_MAX[TOOLS[id].tier]) {
      toolWear[id] = 0; inv[id] = Math.max(0, (inv[id] || 0) - 1);
      flashName('Your ' + NAMES[id].toLowerCase() + ' broke!'); sfx('die');
    }
    updateHotbar(false);
  }
  function attackDamage() {
    if (mode === 'creative') return 20;
    exert(0.08);
    const t = heldTool();
    if (!t) return 3;
    wearTool(t.id, 1);
    return TOOL_DMG[t.kind][t.tier];
  }
  function spendItem(id) {
    if (mode !== 'survival') return true;
    if (!(inv[id] > 0)) { showHint('You have no ' + NAMES[id].toLowerCase() + '.', 1500); return false; }
    inv[id]--; updateHotbar(false);
    return true;
  }
  function eatItem(id) {
    if (mode !== 'survival') { flashName('Food only matters in Survival'); return 0.4; }
    if (hunger >= 20) { showHint('You are not hungry.', 1200); return 0.4; }
    if (!spendItem(id)) return 0.4;
    hunger = Math.min(20, hunger + FOOD[id]); sat = Math.min(hunger, sat + FOOD[id] * 0.6); renderFood(); sfx('eat');
    return 0.8;
  }
  function throwDynamite() {
    if (!spendItem(DYNAMITE)) return 0.4;
    sfx('throw');
    const d = new THREE.Vector3(); camera.getWorldDirection(d);
    addDynamite(camera.position.x + d.x * 0.6, camera.position.y + d.y * 0.6 - 0.1, camera.position.z + d.z * 0.6,
      d.x * 14 + player.vx * 0.3, d.y * 14 + 2.5, d.z * 14 + player.vz * 0.3);
    return 0.5;
  }
  function lightPortalAt(px, py, pz) {
    if (dimension === 'end') return false;
    // Both the final obsidian placement and flint-and-steel use this one
    // validator, so the two controls cannot disagree about valid frames.
    ensureAround(px, pz);
    const portal = findPortalFrame(get, { x: px, y: py, z: pz }, dimension, OBSIDIAN, H);
    if (!portal) return false;
    const already = portals.some(p => p.dimension === portal.dimension && p.axis === portal.axis &&
      p.x === portal.x && p.y === portal.y && p.z === portal.z);
    if (!already) {
      portals.push(portal);
      showPortalVisual(portal);
      rebuildRegion(Math.floor(portal.x - 4), Math.floor(portal.z - 4), Math.ceil(portal.x + 4), Math.ceil(portal.z + 4));
      saveWorld();
    }
    showHint('Nether portal activated! Walk through the purple opening.', 3500);
    sfx('click');
    return true;
  }
  function activatePortalAtTarget() {
    return !!target && get(target.x, target.y, target.z) === OBSIDIAN &&
      lightPortalAt(target.x, target.y, target.z);
  }
  function lightTnt() {
    if (mode === 'survival' && !(inv[FLINT] > 0)) { showHint('You have no flint & steel.', 1500); return 0.3; }
    if (activatePortalAtTarget()) return 0.3;
    if (!target || get(target.x, target.y, target.z) !== TNT) {
      flashName('Aim flint & steel at a complete obsidian frame or TNT'); return 0.3;
    }
    setBlock(target.x, target.y, target.z, 0); queueRebuild(target.x, target.z); flushRebuilds();
    spawnTnt(target.x + 0.5, target.y, target.z + 0.5, 3, 0, 0, 0);
    return 0.4;
  }
  function useEgg(id) {
    const kind = EGG_KINDS[id], K = KINDS[kind];
    if (K.hostile && hasHealth() && DIFF[difficulty].cap === 0) { flashName('Monsters cannot spawn on Peaceful'); return 0.4; }
    if (!target) { flashName('Aim at a block to spawn a ' + kind); return 0.3; }
    const x = target.x + target.nx + 0.5, z = target.z + target.nz + 0.5;
    let y = target.y + target.ny + 0.01, ok = false;
    for (let k = 0; k < 3 && !ok; k++) { if (!collides(x, y + k, z, K.r, K.h)) { y += k; ok = true; } }
    if (!ok) { flashName('Not enough room there'); return 0.3; }
    if (!spendItem(id)) return 0.4;
    const m = addMob(kind, x, y, z, kind === 'villager' ? { job: JOBS[Math.floor(Math.random() * JOBS.length)] } : null);
    m.persist = true; m.hx = x; m.hz = z;   // egg creatures stay put (no daylight burn-off, villagers adopt this spot as home)
    sfx('pop'); sfxAt(kind, x, y + 1, z);
    return 0.4;
  }
  const fadeEl = document.getElementById('fade');
  function useBed(t) {
    spawnPoint = { x: t.x, y: t.y, z: t.z };
    if (!isNight && weather !== 'storm') { showHint('Respawn point set. You can only sleep at night or in a storm.', 2800); sfx('click'); return; }
    if (hasHealth()) for (let i = 0; i < mobs.length; i++) if (mobs[i].hostile && Math.hypot(mobs[i].x - t.x, mobs[i].z - t.z) < 14) { showHint('You cannot sleep with monsters nearby.', 2600); sfx('no'); return; }
    sleepT = 3.2; slept = false;
    showHint('Respawn point set. Sleeping\u2026', 2000);
  }
  // Right click / E: place a block, or use the item in the selected slot. Returns the cooldown to wait.
  function useSelected() {
    const it = hotbar[selected];
    if (it < 100) { doPlace(); return 0.22; }
    if (FOOD[it] !== undefined) return eatItem(it);
    if (it === DYNAMITE) return throwDynamite();
    if (it === FLINT) return lightTnt();
    if (TOOLS[it]) { flashName(NAMES[it] + ' (left click to use)'); return 0.3; }
    if (EGG_KINDS[it]) return useEgg(it);
    flashName(NAMES[it] + ' is a crafting item');
    return 0.4;
  }
  // Build a golem: four blocks of iron, copper or diamond in a T (three across, one below the middle) with a hay bale on top.
  const GOLEM_OF = { 31: 'irongolem', 32: 'coppergolem', 33: 'diamondgolem' };
  const GOLEM_INGOT = { irongolem: IRON_INGOT, coppergolem: COPPER_INGOT, diamondgolem: DIAMOND };
  function spawnGolem(kind, x, y, z) {
    const m = addMob(kind, x, y, z, null);
    m.persist = true; m.hx = x; m.hz = z;
    sfx('pop'); sfxAt('hit', x, y + 1, z);
    return m;
  }
  function tryBuildGolem(px, py, pz) {
    for (let dx = -2; dx <= 2; dx++) for (let dy = -1; dy <= 3; dy++) for (let dz = -2; dz <= 2; dz++) {
      const hx = px + dx, hy = py + dy, hz = pz + dz;
      if (get(hx, hy, hz) !== HAY) continue;
      const m = get(hx, hy - 1, hz), kind = GOLEM_OF[m];
      if (!kind || get(hx, hy - 2, hz) !== m) continue;
      const axes = [[1, 0], [0, 1]];
      for (let a = 0; a < 2; a++) {
        const ax = axes[a];
        if (get(hx + ax[0], hy - 1, hz + ax[1]) === m && get(hx - ax[0], hy - 1, hz - ax[1]) === m) {
          [[hx, hy, hz], [hx, hy - 1, hz], [hx, hy - 2, hz], [hx + ax[0], hy - 1, hz + ax[1]], [hx - ax[0], hy - 1, hz - ax[1]]].forEach(function (c) {
            setBlock(c[0], c[1], c[2], 0); queueRebuild(c[0], c[2]);
          });
          flushRebuilds();
          spawnGolem(kind, hx + 0.5, hy - 2 + 0.01, hz + 0.5);
          flashName('You built a golem!');
          return true;
        }
      }
    }
    return false;
  }
  function healGolem(m) {
    const ing = GOLEM_INGOT[m.kind], K = KINDS[m.kind];
    if (hotbar[selected] !== ing || m.hp >= K.hp) return false;
    if (!spendItem(ing)) return false;
    m.hp = Math.min(K.hp, m.hp + K.hp * 0.25); sfx('pop'); flashName('Golem repaired');
    return true;
  }
  function placeBed(x, y, z) {
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    const dir = Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 0 : 2) : (fz > 0 ? 1 : 3);
    const dv = BED_DIR[dir], hx = x + dv[0], hz = z + dv[1];
    if (!chunkAt(hx >> 4, hz >> 4) || get(hx, y, hz) || !solid(get(x, y - 1, z)) || !solid(get(hx, y - 1, hz))) { flashName('A bed needs two free spots on solid ground'); return; }
    const cells = [[x, z], [hx, hz]];
    for (let i = 0; i < 2; i++) { const c = cells[i]; if (c[0] + 1 > player.x - PR && c[0] < player.x + PR && y + BED_H > player.y && y < player.y + PH && c[1] + 1 > player.z - PR && c[1] < player.z + PR) return; }
    if (mode === 'survival') {
      if (!(inv[BED] > 0)) { showHint('You have no bed.', 1500); return; }
      inv[BED]--; updateHotbar(false);
    }
    setBlock(x, y, z, 19 + dir * 2); setBlock(hx, y, hz, 19 + dir * 2 + 1);
    sfx('place', 1, 0, BED); refreshAround(x, z); refreshAround(hx, hz);
  }
  function detectObsidianPortal(px, py, pz) {
    return lightPortalAt(px, py, pz);
  }

  function doPlace() {
    if (!target) return;
    const x = target.x + target.nx, y = target.y + target.ny, z = target.z + target.nz;
    if (!inBounds(x, y, z) || get(x, y, z)) return;
    if (hotbar[selected] === BED) { placeBed(x, y, z); return; }
    if (hotbar[selected] !== TORCH && x + 1 > player.x - PR && x < player.x + PR && y + 1 > player.y && y < player.y + PH && z + 1 > player.z - PR && z < player.z + PR) return;
    const b = hotbar[selected];
    if (b === TORCH && !solid(get(x, y - 1, z))) { flashName('Torches need something to stand on'); return; }
    if (mode === 'survival') {
      if (!(inv[b] > 0)) { showHint('You have no ' + NAMES[b].toLowerCase() + '. Mine some first.', 1800); return; }
      inv[b]--; updateHotbar(false);
    }
    setBlock(x, y, z, b);
    if (b === OBSIDIAN) detectObsidianPortal(x, y, z);
    sfx('place', 1, 0, b);
    refreshAround(x, z, b === TORCH);
    if (b === HAY || GOLEM_OF[b]) tryBuildGolem(x, y, z);
  }

  function handleActions(dt, tNow) {
    mineCd -= dt; placeCd -= dt; attackCd -= dt;
    const holdOK = !drag || (tNow - drag.t0 > 160 && drag.moved < 6);
    const touchHold = !!(lookT && lookT.moved < 10 && tNow - lookT.t0 > 220);
    const heldMine = (mining && holdOK) || touchHold;
    const heldPlace = placing && holdOK;
    const wantMine = heldMine || pulseMine;
    const wantPlace = heldPlace || pulsePlace;
    const pm = pulseMine, pp = pulsePlace;
    pulseMine = false; pulsePlace = false;

    if (mode === 'spectator') { resetMine(); return; }

    const mobHit = raycastMobs(3.6);
    if (wantMine) {
      if (mobHit && (!blockHit || mobHit.t < blockHit.t + 0.01)) {
        if (attackCd <= 0) { attackMob(mobHit.mob); attackCd = 0.45; }
        resetMine();
      } else if (mode === 'creative') {
        if (target && target.y > 0 && (pm || mineCd <= 0)) { doBreak(target); mineCd = 0.2; }
      } else if (mode === 'survival') {
        if (heldMine && target && target.y > 0) {
          if (mine.x === target.x && mine.y === target.y && mine.z === target.z) mine.t += dt;
          else { mine.x = target.x; mine.y = target.y; mine.z = target.z; mine.t = dt; }
          const tb = get(target.x, target.y, target.z), total = (BREAK_TIME[tb] || 1) / toolSpeed(tb);
          mineBar.style.display = 'block'; mineBar.firstChild.style.width = Math.min(100, mine.t / total * 100) + '%';
          if (mine.t >= total) { doBreak(target); resetMine(); }
        } else resetMine();
      }
    } else resetMine();

    if (wantPlace && canInteract() && (pp || placeCd <= 0)) {
      if (mobHit && mobHit.mob.kind === 'villager' && (!blockHit || mobHit.t < blockHit.t)) { openTrade(mobHit.mob); placeCd = 0.4; }
      else if (mobHit && mobHit.mob.golem && (!blockHit || mobHit.t < blockHit.t) && healGolem(mobHit.mob)) { placeCd = 0.5; }
      else if (target && isBed(get(target.x, target.y, target.z)) && !(keys.ShiftLeft || keys.ShiftRight)) { useBed(target); placeCd = 0.6; }
      else if (target && get(target.x, target.y, target.z) === CTABLE && !(keys.ShiftLeft || keys.ShiftRight)) { openCraft(3); placeCd = 0.4; }
      else placeCd = useSelected();
    }
  }

  /* ---------- Update loop ---------- */
  let gtime = 0, stepDist = 0, lavaDamageTimer = 0;
  function update(dt, tNow) {
    dt = Math.min(dt, 0.05);
    gtime += dt;
    lavaDamageTimer -= dt;
    if (mode !== 'spectator' && lavaDamageTimer <= 0 && get(Math.floor(player.x), Math.floor(player.y + 0.2), Math.floor(player.z)) === LAVA) {
      damagePlayer(2, false); lavaDamageTimer = 0.8; flashName('Ouch! Lava burns you!');
    }
    if (sleepT > 0) {
      sleepT -= dt;
      const el = 3.2 - sleepT;
      fadeEl.style.opacity = sleepT <= 0 ? 0 : (el < 1 ? el : (sleepT > 1 ? 1 : sleepT));
      if (!slept && el >= 1.2) { slept = true; tod = 0.02; setWeather('clear'); showHint('Good morning!', 1800); sfx('pop'); }
    }
    let mx = 0, mz = 0;
    if (keys.KeyW) mz -= 1;
    if (keys.KeyS) mz += 1;
    if (keys.KeyA) mx -= 1;
    if (keys.KeyD) mx += 1;
    if (keys.ArrowLeft) player.yaw += 2.0 * dt;
    if (keys.ArrowRight) player.yaw -= 2.0 * dt;
    if (keys.ArrowUp) player.pitch = Math.min(1.55, player.pitch + 1.6 * dt);
    if (keys.ArrowDown) player.pitch = Math.max(-1.55, player.pitch - 1.6 * dt);
    mx += touchMove.x; mz += touchMove.z;
    if (sleepT > 0) { mx = 0; mz = 0; }
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const shift = keys.ShiftLeft || keys.ShiftRight;
    const jumpHeld = (keys.Space || touchJump) && sleepT <= 0;
    const sn = Math.sin(player.yaw), cs = Math.cos(player.yaw);

    if (mode === 'spectator') {
      const speed = 12 * specSpeed, cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
      const tvx = (mx * cs + mz * sn * cp) * speed;
      const tvz = (-mx * sn + mz * cs * cp) * speed;
      const tvy = (-mz * sp + ((jumpHeld ? 1 : 0) - (shift ? 1 : 0))) * speed;
      const k = Math.min(1, 10 * dt);
      player.vx += (tvx - player.vx) * k; player.vy += (tvy - player.vy) * k; player.vz += (tvz - player.vz) * k;
      player.x += player.vx * dt;
      player.y = Math.max(-5, Math.min(H + 40, player.y + player.vy * dt));
      player.z += player.vz * dt;
      player.onGround = false; player.fallStart = null;
    } else {
      const flying = player.fly && mode === 'creative';
      const sprinting = shift && !flying && (mx !== 0 || mz !== 0) && !(mode === 'survival' && hunger <= 6);   // too hungry to sprint
      const speed = flying ? (keys.ControlLeft ? 18 : 10) : (sprinting ? 6.6 : 4.4);
      const tvx = (mx * cs + mz * sn) * speed;
      const tvz = (-mx * sn + mz * cs) * speed;
      const accel = (player.onGround || flying) ? 14 : 3.5;
      const k = Math.min(1, accel * dt);
      player.vx += (tvx - player.vx) * k;
      player.vz += (tvz - player.vz) * k;
      if (flying) {
        const up = (jumpHeld ? 1 : 0) - (shift ? 1 : 0);
        player.vy += (up * speed - player.vy) * Math.min(1, 10 * dt);
      } else {
        player.vy = Math.max(-50, player.vy - 28 * dt);
        if (jumpHeld && player.onGround) { player.vy = 8.6; exert(sprinting ? 0.2 : 0.04); }
      }
      player.onGround = false;
      moveEnt(player, 0, player.vx * dt);
      moveEnt(player, 2, player.vz * dt);
      moveEnt(player, 1, player.vy * dt);
      checkPortal(dt);
      if (player.y < -30) respawn();
      const wspd = Math.hypot(player.vx, player.vz);
      exert(dt * (0.015 + (wspd > 1.2 && player.onGround ? (sprinting ? 0.13 : 0.03) : 0)));
      if (mode === 'survival' && hunger !== shownHunger) renderFood();
      if (!flying && player.onGround && wspd > 1.2) {
        stepDist += wspd * dt;
        if (stepDist > 2.2) { stepDist = 0; sfx('step', 0.8, 0, get(Math.floor(player.x), Math.floor(player.y - 0.2), Math.floor(player.z))); }
      }

      if (flying) player.fallStart = null;
      else if (player.onGround) {
        if (player.fallStart !== null) {
          const dist = player.fallStart - player.y;
          if (dist > 3.5) damagePlayer(Math.floor(dist - 3)); else if (dist > 1.6) sfx('land', Math.min(1, dist / 5));
          player.fallStart = null;
        }
      } else if (player.vy < 0) {
        player.fallStart = (player.fallStart === null) ? player.y : Math.max(player.fallStart, player.y);
      } else player.fallStart = null;
    }

    camera.position.set(player.x, player.y + EYE, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0);

    blockHit = mode === 'spectator' ? null : raycast(canInteract() ? (mode === 'creative' ? 6 : 5) : 4);
    target = canInteract() ? blockHit : null;
    if (target) { sel.visible = true; sel.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5); }
    else sel.visible = false;

    updateMobs(dt); updateBlasts(dt); updateArrows(dt); updateFx(dt); updateMusic(dt);
    if (hasHealth()) {
      sinceHurt += dt;
      if (hp < MAXHP && sinceHurt > DIFF[difficulty].regenAfter && (mode !== 'survival' || difficulty === 'peaceful' || hunger >= 15)) {
        regenT += dt;
        if (regenT >= DIFF[difficulty].regenEvery) { regenT = 0; hp = Math.min(MAXHP, hp + 1); updateHearts(); exert(1.2); }
      }
      if (mode === 'survival' && difficulty !== 'peaceful' && hunger <= 0) {
        starveT += dt;
        if (starveT >= 4) { starveT = 0; if (hp > (difficulty === 'easy' ? 10 : (difficulty === 'normal' ? 1 : 0))) damagePlayer(1); }
      } else starveT = 0;
      if (mode === 'adventure') checkRelics();
    }
    if (!dead && sleepT <= 0) handleActions(dt, tNow);
    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * shake * 0.35; camera.position.y += (Math.random() - 0.5) * shake * 0.35;
      camera.rotation.z = (Math.random() - 0.5) * shake * 0.05;
      shake = Math.max(0, shake - dt * 2.2);
    } else camera.rotation.z = 0;
  }

  /* ---------- Day / night ---------- */
  const boltEl = document.getElementById('bolt');
  const { WEATHER_LABEL, setWeather, updateWeather, updateRain, updateRainSound, daylight } =
    createWeatherSystem({
      scene, camera, sun, moon, dayUniform, glowMat,
      state: {
        get weather() { return weather; }, set weather(value) { weather = value; },
        get weatherT() { return weatherT; }, set weatherT(value) { weatherT = value; },
        get rainLevel() { return rainLevel; }, set rainLevel(value) { rainLevel = value; },
        get rainTarget() { return rainTarget; }, set rainTarget(value) { rainTarget = value; },
        get lightningT() { return lightningT; }, set lightningT(value) { lightningT = value; },
        get nextBolt() { return nextBolt; }, set nextBolt(value) { nextBolt = value; },
        get tod() { return tod; }, set tod(value) { tod = value; },
        get isNight() { return isNight; }, set isNight(value) { isNight = value; },
        get isDay() { return isDay; }, set isDay(value) { isDay = value; },
      },
      sound: Snd, getPlayer: () => player, getDimension: () => dimension,
      hasChunk: (chunkX, chunkZ) => !!chunkAt(chunkX, chunkZ), topY, hasHealth,
      damagePlayer: (damage) => damagePlayer(damage),
      getMobs: () => mobs, damageMob: (mob, damage) => { damageMob(mob, damage); },
      updateWeatherUI: () => updateWeatherUI(),
      setLightningOpacity: (opacity) => { boltEl.style.opacity = String(opacity); },
      tone, hiss,
    });

  /* ---------- UI / state ---------- */
  const overlay = document.getElementById('overlay');
  const playBtn = document.getElementById('play');
  const newBtn = document.getElementById('newworld');
  const subEl = document.getElementById('sub');
  const infoEl = document.getElementById('info');
  const hintEl = document.getElementById('hint');
  const objEl = document.getElementById('objective');
  const modeDescEl = document.getElementById('modeDesc');
  const modeBtns = Array.prototype.slice.call(document.querySelectorAll('.mode'));
  const diffBtns = Array.prototype.slice.call(document.querySelectorAll('.dmode'));
  const diffDescEl = document.getElementById('diffDesc');
  const DIFF_DESC = {
    peaceful: 'No monsters, no hunger, and health comes back quickly. Falls and explosions still hurt.',
    easy: 'Fewer, slower monsters that hit softly, with slow-firing skeletons and longer creeper fuses.',
    normal: 'The standard challenge.',
    hard: 'Lots of fast monsters that spot you from far away and hit hard. Skeletons shoot quickly, creepers blow sooner, and health returns slowly.'
  };
  const DESC = {
    creative: 'Unlimited blocks, instant building and flying. Nothing can hurt you.',
    survival: 'Mine blocks to collect them, then build with what you gather. Stone needs a pickaxe, and better tools mine faster. Keep an eye on your hunger and eat meat. Dig for coal, copper, iron and diamonds. Zombies, skeletons, creepers and spiders come out at night, and falls hurt. Torches light up the dark and keep them from spawning nearby. Craft a table from planks for bigger recipes.',
    adventure: 'The world is protected, so you can\u2019t break or place blocks. Find all ' + RELIC_COUNT + ' glowing relics and stay alive.',
    spectator: 'Fly through anything and look around. You can\u2019t touch the world. Scroll to change speed.'
  };
  const LABEL = { creative: 'Creative', survival: 'Survival', adventure: 'Adventure', spectator: 'Spectator' };

  if (isTouch) {
    touchUI.style.display = 'block';
    document.getElementById('controls').innerHTML =
      '<dt>Left side</dt><dd>Drag to move</dd><dt>Right side</dt><dd>Drag to look, tap to break or hit, hold to mine</dd>' +
      '<dt>Place</dt><dd>Puts down the selected block</dd><dt>Hotbar</dt><dd>Tap to choose a block</dd><dt>Bag</dt><dd>Open the inventory</dd>';
  }

  function updateModeUI() {
    const inter = canInteract(), health = hasHealth();
    hotbarEl.style.display = inter ? 'flex' : 'none';
    heartsEl.style.display = health ? 'flex' : 'none';
    heartsEl.classList.toggle('raised', inter);
    foodEl.style.display = mode === 'survival' ? 'flex' : 'none'; foodEl.classList.toggle('raised', inter);
    objEl.style.display = mode === 'adventure' ? 'block' : 'none';
    sel.visible = false; resetMine();
    bPlace.style.display = inter ? 'block' : 'none';
    bFly.style.display = mode === 'creative' ? 'block' : 'none';
    bInv.style.display = inter ? 'block' : 'none';
    bJump.textContent = mode === 'spectator' ? 'Up' : 'Jump';
    syncRelicVisibility();
    modeBtns.forEach(function (b) { const on = b.dataset.mode === mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    modeDescEl.textContent = DESC[mode];
    updateDiffUI();
    updateHotbar(false); updateHearts(); renderFood();
  }
  function setMode(m) {
    mode = m;
    mining = placing = pulseMine = pulsePlace = false;
    clearMobs();
    hp = MAXHP; sinceHurt = 99; regenT = 0; hunger = 20; sat = 5; exhaust = 0; starveT = 0;
    player.fly = (m === 'spectator'); player.vy = 0; player.fallStart = null;
    if (dead) { dead = false; respawn(); playBtn.textContent = ready ? 'Play' : 'Loading\u2026'; subEl.textContent = 'Mode changed to ' + LABEL[m] + '.'; }
    if (ready && m !== 'spectator' && collides(player.x, player.y, player.z)) player.y = topY(Math.floor(player.x), Math.floor(player.z)) + 1.01;
    updateModeUI();
  }
  const wBtns = Array.prototype.slice.call(document.querySelectorAll('.wmode'));
  function updateWeatherUI() {
    wBtns.forEach(function (b) { const on = b.dataset.weather === weather; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  }
  wBtns.forEach(function (b) { b.addEventListener('click', function () { setWeather(b.dataset.weather); sfx('click'); saveWorld().then(refreshWorlds); }); });
  updateWeatherUI();
  const sfxBtn = document.getElementById('sfxBtn'), musicBtn = document.getElementById('musicBtn');
  function syncSoundBtns() {
    sfxBtn.textContent = 'Sound: ' + (Snd.sfx ? 'On' : 'Off'); musicBtn.textContent = 'Music: ' + (Snd.music ? 'On' : 'Off');
    sfxBtn.setAttribute('aria-pressed', Snd.sfx ? 'true' : 'false'); musicBtn.setAttribute('aria-pressed', Snd.music ? 'true' : 'false');
  }
  sfxBtn.addEventListener('click', function () { audioInit(); Snd.sfx = !Snd.sfx; applySound(); saveSound(); syncSoundBtns(); sfx('click'); });
  musicBtn.addEventListener('click', function () { audioInit(); Snd.music = !Snd.music; applySound(); saveSound(); syncSoundBtns(); if (Snd.music) Snd.nextMusic = 0.2; });
  window.addEventListener('keydown', function (e) {
    if (e.code !== 'KeyM' || e.repeat) return;
    audioInit();
    const on = !(Snd.sfx || Snd.music);
    Snd.sfx = Snd.music = on; applySound(); saveSound(); syncSoundBtns();
    if (playing) showHint('Sound ' + (on ? 'on' : 'off'), 1200);
  });
  syncSoundBtns();
  function updateDiffUI() {
    diffBtns.forEach(function (b) { const on = b.dataset.diff === difficulty; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    diffDescEl.textContent = DIFF_DESC[difficulty] + (hasHealth() ? '' : ' (Applies in Survival and Adventure.)');
  }
  function setDifficulty(d) {
    if (!DIFF[d]) return;
    difficulty = d;
    if (DIFF[d].cap === 0 && hasHealth()) for (let i = mobs.length - 1; i >= 0; i--) if (mobs[i].hostile) removeMobAt(i);
    updateDiffUI();
    sfx('click');
    saveWorld().then(refreshWorlds);
  }
  diffBtns.forEach(function (b) { b.addEventListener('click', function () { setDifficulty(b.dataset.diff); }); });
  modeBtns.forEach(function (b) { b.addEventListener('click', function () { setMode(b.dataset.mode); saveWorld().then(refreshWorlds); }); });

  let hintTimer = 0;
  function showHint(msg, ms) {
    hintEl.textContent = msg; hintEl.style.display = 'block';
    clearTimeout(hintTimer); hintTimer = setTimeout(function () { hintEl.style.display = 'none'; }, ms || 6000);
  }
  function enterFallback() {
    if (fallback || isTouch) return;
    fallback = true; locked = false;
    playing = true; overlay.classList.add('hidden');
    showHint('Mouse capture is blocked here. Drag to look, click to break, right-click to place.', 6000);
  }
  function requestLock() {
    try {
      const p = canvas.requestPointerLock && canvas.requestPointerLock();
      if (p && p.catch) p.catch(enterFallback);
      if (!canvas.requestPointerLock) enterFallback();
    } catch (err) { enterFallback(); }
    setTimeout(function () { if (playing && !locked && !fallback && !isTouch) enterFallback(); }, 500);
  }
  document.addEventListener('pointerlockerror', enterFallback);
  document.addEventListener('pointerlockchange', function () {
    if (document.pointerLockElement === canvas) locked = true;
    else if (locked) { locked = false; mining = placing = false; if (!fallback && !invOpen) pause(); }
  });

  function startGame() {
    if (!ready) return;
    audioInit();
    if (dead) { dead = false; respawn(); hp = MAXHP; hunger = 20; sat = 5; exhaust = 0; sinceHurt = 99; clearMobs(); updateHearts(); renderFood(); }
    overlay.classList.add('hidden');
    playing = true;
    if (mode === 'spectator') showHint('Space up, Shift down, scroll changes speed. You fly where you look.', 5000);
    else if (mode === 'adventure') showHint('Find the glowing beams. Each one marks a relic.', 5000);
    if (!isTouch && !fallback) requestLock();
  }
  function pause() {
    playing = false; mining = placing = false; drag = null;
    for (const k in keys) keys[k] = false;
    subEl.textContent = 'Paused. Pick a mode or keep playing.';
    playBtn.textContent = 'Resume';
    overlay.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    saveWorld().then(refreshWorlds);
  }
  function die() {
    dead = true;
    pause();
    subEl.textContent = 'You died. Respawn to try again.';
    playBtn.textContent = 'Respawn';
  }
  playBtn.addEventListener('click', startGame);
  /* ---------- Commands (press T or /) ---------- */
  const chatEl = document.getElementById('chatlog'), cmdBar = document.getElementById('cmdbar'), cmdInput = document.getElementById('cmdinput');
  const cmdHist = []; let cmdHistI = 0;
  const chatLines = [];
  function chat(msg, kind) {
    const line = document.createElement('div');
    line.className = 'cl' + (kind ? ' ' + kind : ''); line.textContent = msg;
    chatEl.appendChild(line); chatLines.push(line);
    while (chatLines.length > 9) chatEl.removeChild(chatLines.shift());
    setTimeout(function () { const i = chatLines.indexOf(line); if (i >= 0) { chatLines.splice(i, 1); chatEl.removeChild(line); } }, 12000);
  }
  const CMDS = {};
  function defCmd(names, usage, desc, fn, choices) {
    const c = { name: names[0], usage: usage, desc: desc, fn: fn, choices: choices };
    names.forEach(function (n) { CMDS[n] = c; });
  }
  const { slug, itemMap, findItem } = createItemResolver(NAMES, BED);
  function spawnSpot() {
    const x = player.x - Math.sin(player.yaw) * 3, z = player.z - Math.cos(player.yaw) * 3;
    getOrGen(Math.floor(x) >> 4, Math.floor(z) >> 4);
    return [x, topY(Math.floor(x), Math.floor(z)) + 1.01, z];
  }
  function ensureAround(x, z) { for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) getOrGen((Math.floor(x) >> 4) + dx, (Math.floor(z) >> 4) + dz); }
  function rebuildRegion(x1, z1, x2, z2) {
    for (let cx = (Math.min(x1, x2) >> 4) - 1; cx <= (Math.max(x1, x2) >> 4) + 1; cx++) for (let cz = (Math.min(z1, z2) >> 4) - 1; cz <= (Math.max(z1, z2) >> 4) + 1; cz++) rebuildSet.add(cx + ',' + cz);
    flushRebuilds();
  }
  const MODE_ALIASES = { creative: 'creative', c: 'creative', '1': 'creative', survival: 'survival', s: 'survival', '0': 'survival', adventure: 'adventure', a: 'adventure', '2': 'adventure', spectator: 'spectator', sp: 'spectator', '3': 'spectator' };
  const DIFF_ALIASES = { peaceful: 'peaceful', p: 'peaceful', '0': 'peaceful', easy: 'easy', e: 'easy', '1': 'easy', normal: 'normal', n: 'normal', '2': 'normal', hard: 'hard', h: 'hard', '3': 'hard' };
  const TIME_NAMES = { day: 1000, noon: 6000, sunset: 12000, night: 13000, midnight: 18000, sunrise: 23000 };
  const mobNames = function () { return Object.keys(KINDS); };

  defCmd(['help', '?'], '/help [command]', 'List the commands, or explain one', function (a) {
    if (a[0]) {
      const c = CMDS[a[0].toLowerCase().replace(/^\//, '')];
      if (!c) throw new Error('No command called "' + a[0] + '"');
      return c.usage + '  -  ' + c.desc;
    }
    const names = []; Object.keys(CMDS).forEach(function (k) { if (CMDS[k].name === k) names.push(k); });
    return 'Commands: ' + names.sort().map(function (n) { return '/' + n; }).join('  ') + '   (try /help <command>)';
  }, function () { return Object.keys(CMDS); });
  function clearPortalVisuals() { while (portalVisuals.length) { const m = portalVisuals.pop(); scene.remove(m); m.geometry.dispose(); m.material.dispose(); } }
  function showPortalVisual(portal) {
    if (portal.dimension !== dimension) return;
    const geo = new THREE.PlaneGeometry(portal.width + 0.85, portal.height - 0.15);
    const mat = new THREE.MeshBasicMaterial({ color: 0x9a42ff, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(portal.x + 0.5, portal.y + 1 + portal.height / 2, portal.z + 0.5);
    if (portal.axis === 'z') mesh.rotation.y = Math.PI / 2;
    scene.add(mesh); portalVisuals.push(mesh);
  }
  function buildPortalFrame(dim, centerX, baseY, centerZ) {
    // Build a classic obsidian portal frame (5 blocks wide, 5 blocks tall).
    const cx = Math.round(centerX), cz = Math.round(centerZ), by = Math.max(1, Math.min(H - 6, Math.floor(baseY)));
    // Load all nearby chunks before placing the frame, including Z-side chunks.
    ensureAround(cx, cz);
    // Standard 4-by-5 frame (two blocks wide and three blocks tall inside).
    const portal = { dimension: dim, x: cx - 0.5, y: by, z: cz, width: 2, height: 3, axis: 'x' };
    for (let dx = -2; dx <= 1; dx++) {
      for (let dy = 0; dy <= 4; dy++) {
        const edge = dx === -2 || dx === 1 || dy === 0 || dy === 4;
        setBlock(cx + dx, by + dy, cz, edge ? OBSIDIAN : 0);
      }
    }
    portals.push(portal);
    showPortalVisual(portal);
    rebuildRegion(cx - 2, cz, cx + 2, cz);
    saveWorld();
    showHint('Portal activated! Walk through the purple opening.', 3000);
    return portal;
  }
  function changeDimension(target, x, z, y) {
    clearPortalVisuals();
    if (dimension === 'overworld') chunks.forEach(function (c) { if (c.edited) savedChunks.set(ckey(c.cx, c.cz), c.data.slice()); });
    chunks.forEach(function (c) { disposeMesh(c); });
    chunks.clear(); resetChunkCache(); structCache.clear(); clearMobs();
    dimension = target;
    portals.forEach(showPortalVisual);
    const tx = x === undefined ? 0.5 : x, tz = z === undefined ? 0.5 : z;
    ensureAround(tx, tz);
    player.x = tx; player.z = tz;
    player.y = y === undefined ? (target === 'nether' ? 15 : (target === 'end' ? 22 : topY(Math.floor(tx), Math.floor(tz)) + 1.01)) : y;
    for (let tries = 0; tries < 12 && collides(player.x, player.y, player.z); tries++) player.y += 1;
    player.vx = player.vy = player.vz = 0; player.fallStart = null;
    saveWorld();
    showHint(target === 'nether' ? 'Welcome to the Nether! Watch your step in the red-hot caverns.' : target === 'end' ? 'Welcome to the End! Stay on the floating islands.' : 'Back to the Overworld.', 5000);
  }
  function checkPortal(dt) {
    portalCooldown = Math.max(0, portalCooldown - dt);
    if (portalCooldown > 0 || !playing || dimension === 'end') return;
    const p = portals.find(q => portalContains(q, dimension, player));
    if (!p) return;
    const target = dimension === 'overworld' ? 'nether' : 'overworld';
    const scale = dimension === 'overworld' ? 1 / 8 : 8;
    const tx = Math.round(p.x * scale), tz = Math.round(p.z * scale);
    let destination = portals.find(function (q) { return q.dimension === target && Math.abs(q.x - tx) < 3 && Math.abs(q.z - tz) < 3; });
    // Load the destination dimension before building a paired frame there.
    changeDimension(target, tx, tz, target === 'nether' ? 15 : undefined);
    if (!destination) {
      getOrGen(tx >> 4, tz >> 4);
      const floorY = target === 'nether' ? 13 : topY(tx, tz) + 1;
      destination = buildPortalFrame(target, tx, floorY, tz);
    }
    // Move just in front of the matching doorway so the player won't bounce straight back.
    player.x = destination.x + (destination.axis === 'z' ? 2.1 : 0); player.z = destination.z + (destination.axis === 'z' ? 0 : 2.1); player.y = destination.y + 1.05;
    for (let tries = 0; tries < 12 && collides(player.x, player.y, player.z); tries++) player.y += 1;
    portalCooldown = 2.5;
    showHint('Portal travel: ' + (target === 'nether' ? 'Overworld → Nether' : 'Nether → Overworld'), 3000);
  }
  defCmd(['portal'], '/portal [build]', 'Build an obsidian Nether portal frame in front of you; walk through it to travel', function (a) {
    if (dimension === 'end') throw new Error('Nether portals do not work in the End. Return to the Overworld first.');
    if (a.length && a[0].toLowerCase() !== 'build') throw new Error('Usage: /portal [build]');
    const cx = Math.round(player.x - Math.sin(player.yaw) * 3);
    const cz = Math.round(player.z - Math.cos(player.yaw) * 3);
    const by = Math.max(1, Math.min(H - 6, Math.floor(player.y) - 1));
    const made = buildPortalFrame(dimension, cx, by, cz);
    saveWorld();
    return 'Built an obsidian Nether portal frame at ' + made.x + ' ' + made.y + ' ' + made.z + '. Walk through the doorway to travel.';
  }, function () { return ['build']; });
  defCmd(['dimension', 'dim'], '/dimension <overworld|nether|end>', 'Travel between the Overworld, Nether, and End', function (a) {
    const target = (a[0] || '').toLowerCase();
    if (['overworld', 'nether', 'end'].indexOf(target) < 0) throw new Error('Usage: /dimension <overworld|nether|end>');
    if (target === dimension) return 'You are already in the ' + target + '.';
    changeDimension(target);
    return 'Entered the ' + target + '.';
  }, function () { return ['overworld', 'nether', 'end']; });
  defCmd(['time'], '/time set <day|noon|sunset|night|midnight|sunrise|ticks> | add <ticks> | query', 'Change or read the time of day (24000 ticks per day)', function (a) {
    const sub = (a[0] || '').toLowerCase();
    if (sub === 'query') return 'It is ' + Math.round(tod * 24000) + ' ticks into the day (' + (isNight ? 'night' : 'day') + ')';
    if (sub === 'set' || sub === 'add') {
      const v = (a[1] || '').toLowerCase();
      const n = (sub === 'set' && TIME_NAMES[v] !== undefined) ? TIME_NAMES[v] : parseFloat(v);
      if (!isFinite(n)) throw new Error('Usage: /time ' + sub + (sub === 'set' ? ' <day|noon|sunset|night|midnight|sunrise|ticks>' : ' <ticks>'));
      tod = sub === 'set' ? ((((n % 24000) + 24000) % 24000) / 24000) : ((((tod + n / 24000) % 1) + 1) % 1);
      return 'Time ' + (sub === 'set' ? 'set to ' : 'moved on to ') + Math.round(tod * 24000) + ' ticks';
    }
    throw new Error('Usage: /time set <day|noon|sunset|night|midnight|sunrise|ticks>, /time add <ticks>, /time query');
  }, function (i) { return i === 1 ? ['set', 'add', 'query'] : Object.keys(TIME_NAMES); });
  defCmd(['day'], '/day', 'Set the time to morning', function () { tod = TIME_NAMES.day / 24000; return 'Time set to day'; });
  defCmd(['night'], '/night', 'Set the time to night', function () { tod = TIME_NAMES.night / 24000; return 'Time set to night'; });
  defCmd(['weather'], '/weather <clear|rain|storm> [seconds]', 'Change the weather', function (a) {
    const w = (a[0] || '').toLowerCase();
    if (!WEATHER_LABEL[w]) throw new Error('Usage: /weather <clear|rain|storm> [seconds]');
    setWeather(w);
    if (a[1] !== undefined && +a[1] > 0) weatherT = +a[1];
    saveWorld().then(refreshWorlds);
    return 'Weather set to ' + WEATHER_LABEL[w].toLowerCase();
  }, function () { return ['clear', 'rain', 'storm']; });
  defCmd(['gamemode', 'gm'], '/gamemode <creative|survival|adventure|spectator>', 'Switch game mode', function (a) {
    const m = MODE_ALIASES[(a[0] || '').toLowerCase()];
    if (!m) throw new Error('Usage: /gamemode <creative|survival|adventure|spectator>');
    setMode(m); saveWorld().then(refreshWorlds);
    return 'Game mode is now ' + LABEL[m];
  }, function () { return ['creative', 'survival', 'adventure', 'spectator']; });
  defCmd(['difficulty'], '/difficulty <peaceful|easy|normal|hard>', 'Change the difficulty', function (a) {
    const d = DIFF_ALIASES[(a[0] || '').toLowerCase()];
    if (!d) throw new Error('Usage: /difficulty <peaceful|easy|normal|hard>');
    setDifficulty(d);
    return 'Difficulty is now ' + DIFF[d].label.toLowerCase();
  }, function () { return ['peaceful', 'easy', 'normal', 'hard']; });
  defCmd(['give'], '/give <item> [count]', 'Give yourself an item or block (Creative puts it in your hotbar)', function (a) {
    if (!a[0]) throw new Error('Usage: /give <item> [count]');
    const id = findItem(a[0], false);
    let n = a[1] === undefined ? 1 : Math.floor(+a[1]);
    if (!(n >= 1)) throw new Error('The count must be 1 or more');
    n = Math.min(n, 9999);
    if (hotbar.indexOf(id) < 0) hotbar[selected] = id;
    if (mode === 'creative') { updateHotbar(true); return NAMES[id] + ' is in your hotbar (Creative items are unlimited)'; }
    inv[id] = Math.min(9999, (inv[id] || 0) + n); updateHotbar(true);
    return 'Gave you ' + n + ' ' + NAMES[id];
  }, function (i) { return i === 1 ? Object.keys(itemMap()) : []; });
  defCmd(['clear'], '/clear', 'Empty your backpack', function () { for (const k in inv) delete inv[k]; updateHotbar(false); return 'Backpack cleared'; });
  defCmd(['heal'], '/heal', 'Restore your health', function () { hp = MAXHP; sinceHurt = 99; updateHearts(); return 'You feel healthy again'; });
  defCmd(['feed'], '/feed', 'Fill your hunger bar', function () { hunger = 20; sat = 5; exhaust = 0; renderFood(); return 'You are no longer hungry'; });
  defCmd(['fly'], '/fly', 'Toggle flying (Creative)', function () {
    if (mode !== 'creative') throw new Error('Flying is a Creative mode ability');
    toggleFly(); return player.fly ? 'Flying on' : 'Flying off';
  });
  defCmd(['tp', 'teleport'], '/tp <x> <y> <z> | <x> <z> | spawn   (~ means relative)', 'Teleport', function (a) {
    let x, y, z;
    if ((a[0] || '').toLowerCase() === 'spawn') { x = 0.5; z = 0.5; ensureAround(x, z); y = topY(0, 0) + 1.01; }
    else if (a.length >= 3) { x = coord(a[0], player.x); y = coord(a[1], player.y); z = coord(a[2], player.z); ensureAround(x, z); }
    else if (a.length === 2) { x = coord(a[0], player.x); z = coord(a[1], player.z); ensureAround(x, z); y = topY(Math.floor(x), Math.floor(z)) + 1.01; }
    else throw new Error('Usage: /tp <x> <y> <z>, /tp <x> <z>, or /tp spawn');
    if (!(y > -20 && y < H + 200)) throw new Error('That height is out of range');
    for (let k = 0; k < 80 && mode !== 'spectator' && collides(x, y, z); k++) y += 1;
    player.x = x; player.y = y; player.z = z; player.vx = player.vy = player.vz = 0; player.fallStart = null;
    return 'Teleported to ' + x.toFixed(1) + ' ' + y.toFixed(1) + ' ' + z.toFixed(1);
  }, function (i) { return i === 1 ? ['spawn'] : []; });
  defCmd(['pos'], '/pos', 'Show where you are', function () { return 'You are at ' + player.x.toFixed(1) + ' ' + player.y.toFixed(1) + ' ' + player.z.toFixed(1); });
  defCmd(['seed'], '/seed', 'Show the world seed', function () { return 'Seed: ' + seed; });
  defCmd(['spawn', 'summon'], '/spawn <creature> [count]', 'Spawn creatures in front of you', function (a) {
    if (!a[0]) throw new Error('Usage: /spawn <creature> [count]. Creatures: ' + mobNames().join(', '));
    const q = slug(a[0]).replace(/_/g, '');
    let kind = mobNames().filter(function (k) { return k === q; })[0] || (q === 'golem' ? 'irongolem' : null);
    if (!kind) { const c = mobNames().filter(function (k) { return k.indexOf(q) === 0; }); if (c.length === 1) kind = c[0]; }
    if (!kind) throw new Error('Unknown creature "' + a[0] + '". Creatures: ' + mobNames().join(', '));
    const K = KINDS[kind];
    if (K.hostile && hasHealth() && DIFF[difficulty].cap === 0) throw new Error('Monsters cannot spawn on Peaceful');
    const n = Math.max(1, Math.min(20, Math.floor(+(a[1] || 1)) || 1)), sp = spawnSpot();
    let made = 0;
    for (let i = 0; i < n; i++) {
      const x = sp[0] + (Math.random() - 0.5) * (n > 1 ? 4 : 0), z = sp[2] + (Math.random() - 0.5) * (n > 1 ? 4 : 0);
      getOrGen(Math.floor(x) >> 4, Math.floor(z) >> 4);
      let y = topY(Math.floor(x), Math.floor(z)) + 1.01;
      for (let k = 0; k < 3 && collides(x, y, z, K.r, K.h); k++) y += 1;
      if (collides(x, y, z, K.r, K.h)) continue;
      const m = addMob(kind, x, y, z, kind === 'villager' ? { job: JOBS[Math.floor(Math.random() * JOBS.length)] } : null);
      m.persist = true; m.hx = x; m.hz = z; made++;
    }
    return made ? 'Spawned ' + made + ' ' + kind + (made === 1 ? '' : 's') : 'There was no room to spawn that here';
  }, function (i) { return i === 1 ? mobNames() : []; });
  defCmd(['kill'], '/kill [hostile|passive|villagers|golems|all|me]', 'Remove creatures (or yourself)', function (a) {
    const what = (a[0] || 'hostile').toLowerCase();
    if (what === 'me' || what === 'self') {
      if (!hasHealth()) throw new Error('You can only do that in Survival or Adventure');
      hp = 1; damagePlayer(1); return 'Ouch.';
    }
    const sel = { hostile: function (m) { return m.hostile; }, passive: function (m) { return !m.hostile && !m.golem && m.kind !== 'villager'; }, villagers: function (m) { return m.kind === 'villager'; }, golems: function (m) { return m.golem; }, all: function () { return true; } }[what];
    if (!sel) throw new Error('Usage: /kill [hostile|passive|villagers|golems|all|me]');
    let n = 0;
    for (let i = mobs.length - 1; i >= 0; i--) if (sel(mobs[i])) { removeMobAt(i); n++; }
    return 'Removed ' + n + ' creature' + (n === 1 ? '' : 's');
  }, function () { return ['hostile', 'passive', 'villagers', 'golems', 'all', 'me']; });
  defCmd(['setblock'], '/setblock <x> <y> <z> <block|air>', 'Place a single block', function (a) {
    if (a.length < 4) throw new Error('Usage: /setblock <x> <y> <z> <block|air>');
    const x = Math.floor(coord(a[0], player.x)), y = Math.floor(coord(a[1], player.y)), z = Math.floor(coord(a[2], player.z));
    if (y < 0 || y >= H) throw new Error('Height must be between 0 and ' + (H - 1));
    const id = a[3].toLowerCase() === 'air' ? 0 : findItem(a[3], true);
    getOrGen(x >> 4, z >> 4);
    const old = get(x, y, z);
    setBlock(x, y, z, id); queueRebuild(x, z, id === TORCH || old === TORCH); flushRebuilds();
    return 'Set ' + x + ' ' + y + ' ' + z + ' to ' + (id ? NAMES[id] : 'air');
  }, function (i) { return i === 4 ? ['air'].concat(Object.keys(itemMap()).filter(function (k) { return itemMap()[k] < 100; })) : []; });
  defCmd(['fill'], '/fill <x1> <y1> <z1> <x2> <y2> <z2> <block|air>', 'Fill a box with a block (up to 32768 blocks)', function (a) {
    if (a.length < 7) throw new Error('Usage: /fill <x1> <y1> <z1> <x2> <y2> <z2> <block|air>');
    const x1 = Math.floor(coord(a[0], player.x)), y1 = Math.floor(coord(a[1], player.y)), z1 = Math.floor(coord(a[2], player.z));
    const x2 = Math.floor(coord(a[3], player.x)), y2 = Math.floor(coord(a[4], player.y)), z2 = Math.floor(coord(a[5], player.z));
    const lx = Math.min(x1, x2), hx = Math.max(x1, x2), lz = Math.min(z1, z2), hz = Math.max(z1, z2), ly = Math.max(0, Math.min(y1, y2)), hy = Math.min(H - 1, Math.max(y1, y2));
    const vol = (hx - lx + 1) * (hz - lz + 1) * (hy - ly + 1);
    if (vol > 32768) throw new Error('That is ' + vol + ' blocks. The limit is 32768');
    const id = a[6].toLowerCase() === 'air' ? 0 : findItem(a[6], true);
    for (let cx = lx >> 4; cx <= hx >> 4; cx++) for (let cz = lz >> 4; cz <= hz >> 4; cz++) getOrGen(cx, cz);
    for (let x = lx; x <= hx; x++) for (let z = lz; z <= hz; z++) for (let y = ly; y <= hy; y++) setBlock(x, y, z, id);
    rebuildRegion(lx, lz, hx, hz);
    return 'Filled ' + vol + ' block' + (vol === 1 ? '' : 's') + ' with ' + (id ? NAMES[id] : 'air');
  }, function (i) { return i === 7 ? ['air'].concat(Object.keys(itemMap()).filter(function (k) { return itemMap()[k] < 100; })) : []; });
  defCmd(['explode'], '/explode [radius]', 'Blow up the ground in front of you', function (a) {
    const r = Math.max(1, Math.min(12, +(a[0] || 4) || 4)), sp = spawnSpot();
    explode(sp[0], sp[1], sp[2], r, 30 * r / 4.2);
    return 'Boom (radius ' + r + ')';
  });
  defCmd(['locate'], '/locate <village|temple|tower|dungeon|cabin|circle> [tp]', 'Find the nearest structure', function (a) {
    const type = (a[0] || '').toLowerCase();
    if (!STRUCT_NAMES[type]) throw new Error('Usage: /locate <' + Object.keys(STRUCT_NAMES).join('|') + '> [tp]');
    const prx = Math.floor(player.x / REG), prz = Math.floor(player.z / REG);
    let best = null, bd = 1e9;
    for (let dz = -8; dz <= 8; dz++) for (let dx = -8; dx <= 8; dx++) {
      const st = structureFor(prx + dx, prz + dz);
      if (!st || st.type !== type) continue;
      const d = Math.hypot(st.cx - player.x, st.cz - player.z);
      if (d < bd) { bd = d; best = st; }
    }
    if (!best) throw new Error('No ' + STRUCT_NAMES[type].toLowerCase() + ' within about 600 blocks');
    if ((a[1] || '').toLowerCase() === 'tp') {
      const x = best.cx + 0.5, z = best.cz + 4.5; ensureAround(x, z);
      player.x = x; player.z = z; player.y = topY(Math.floor(x), Math.floor(z)) + 1.01; player.vx = player.vy = player.vz = 0; player.fallStart = null;
      return 'Teleported to the ' + STRUCT_NAMES[type].toLowerCase() + ' at ' + best.cx + ' ' + best.cz;
    }
    return 'Nearest ' + STRUCT_NAMES[type].toLowerCase() + ': x ' + best.cx + ', z ' + best.cz + ' (' + Math.round(bd) + ' blocks away)';
  }, function (i) { return i === 1 ? Object.keys(STRUCT_NAMES) : (i === 2 ? ['tp'] : []); });
  defCmd(['save'], '/save', 'Save the world now', function () { saveWorld().then(refreshWorlds); return storageOK ? 'Saving the world...' : 'Saving is not available in this browser'; });
  defCmd(['say'], '/say <message>', 'Write a message in the chat', function (a) { return '[You] ' + a.join(' '); });

  function execute(line) {
    line = line.trim();
    if (!line) return;
    if (line.charAt(0) !== '/') { chat('[You] ' + line); return; }
    chat(line, 'echo');
    const parts = line.slice(1).trim().split(/\s+/), name = (parts.shift() || '').toLowerCase();
    if (!name) return;
    const c = CMDS[name];
    if (!c) { chat('Unknown command "' + name + '". Type /help for the list.', 'bad'); return; }
    try { const out = c.fn(parts); if (out) chat(out); }
    catch (err) { chat(err.message || String(err), 'bad'); }
  }
  function openCmd(prefill) {
    invOpen = true; cmdOpen = true; playing = false; mining = placing = false; drag = null;
    for (const k in keys) keys[k] = false;
    touchMove.x = 0; touchMove.z = 0; touchJump = false; stick = null; lookT = null;
    cmdBar.classList.remove('hidden'); cmdInput.value = prefill || ''; cmdHistI = cmdHist.length;
    if (document.pointerLockElement) document.exitPointerLock();
    setTimeout(function () { cmdInput.focus(); }, 0);
  }
  function completeCmd() {
    const raw = cmdInput.value.replace(/^\//, ''), parts = raw.split(/\s+/);
    if (parts.length === 1) {
      const names = Object.keys(CMDS).filter(function (n) { return n.indexOf(parts[0].toLowerCase()) === 0; });
      if (names.length === 1) cmdInput.value = '/' + names[0] + ' '; else if (names.length > 1) chat(names.join('  '), 'echo');
      return;
    }
    const c = CMDS[parts[0].toLowerCase()];
    if (!c || !c.choices) return;
    const cur = (parts[parts.length - 1] || '').toLowerCase();
    const opts = c.choices(parts.length - 1, parts).filter(function (x) { return String(x).indexOf(cur) === 0; });
    if (opts.length === 1) { parts[parts.length - 1] = opts[0]; cmdInput.value = '/' + parts.join(' ') + ' '; }
    else if (opts.length > 1) chat(opts.slice(0, 14).join('  ') + (opts.length > 14 ? '  ...' : ''), 'echo');
  }
  cmdInput.addEventListener('keydown', function (e) {
    e.stopPropagation();   // typing here must not trigger game keys
    if (e.key === 'Enter') {
      const line = cmdInput.value;
      if (line.trim()) { cmdHist.push(line); if (cmdHist.length > 50) cmdHist.shift(); }
      execute(line);
      closeInventory(!dead);   // if a command killed you, stay on the respawn screen
    } else if (e.key === 'Escape') { e.preventDefault(); closeInventory(false); }
    else if (e.key === 'Tab') { e.preventDefault(); completeCmd(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (cmdHistI > 0) { cmdHistI--; cmdInput.value = cmdHist[cmdHistI]; } }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (cmdHistI < cmdHist.length - 1) { cmdHistI++; cmdInput.value = cmdHist[cmdHistI]; } else { cmdHistI = cmdHist.length; cmdInput.value = ''; } }
  });
  cmdInput.addEventListener('keyup', function (e) { e.stopPropagation(); });
  window.addEventListener('keydown', function (e) {
    if (cmdOpen || !playing || invOpen || e.repeat) return;
    if (e.code === 'KeyT') { e.preventDefault(); openCmd(''); }
    else if (e.key === '/') { e.preventDefault(); openCmd('/'); }
  });
  document.getElementById('btnCmd').addEventListener('click', function () { if (!isTouch && playing) openCmd('/'); });

  /* ---------- Saved worlds (IndexedDB, kept in this browser) ---------- */
  const worldsEl = document.getElementById('worlds');
  const saveNote = document.getElementById('saveNote');
  let db = null, storageOK = false, currentWorld = null, worldList = [], saveChain = Promise.resolve(), busy = false;
  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  // Dexie uses the existing v1 database/stores without a destructive upgrade.
  function openDB() { return openWorldStorage(); }
  function dbListWorlds() { return db.listWorlds(); }
  function dbGetWorld(id) { return db.getWorld(id); }
  function dbGetChunks(id) { return db.getChunks(id); }
  function dbDeleteWorld(id) { return db.deleteWorld(id); }

  function snapshot() {
    const m = currentWorld;
    m.dimension = dimension; m.enderDragonDefeated = enderDragonDefeated; m.portals = snapshotPortals(portals); m.mode = mode; m.difficulty = difficulty; m.spawn = spawnPoint; m.omen = omen; m.hunger = hunger; m.sat = sat; m.weather = { w: weather, t: weatherT, r: rainLevel }; m.lastPlayed = Date.now(); m.tod = tod; m.hp = dead ? MAXHP : hp;
    m.selected = selected; m.hotbar = hotbar.slice(); m.inv = Object.assign({}, inv);
    m.player = { x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch, fly: !!player.fly };
    m.relics = relics.map(function (r) { return { x: r.x, y: r.y, z: r.z, got: r.got }; });
    m.toolWear = Object.assign({}, toolWear);
    m.golems = mobs.filter(function (g) { return g.golem && g.persist; }).map(function (g) { return { kind: g.kind, x: g.x, y: g.y, z: g.z, hp: g.hp, hx: g.hx, hz: g.hz }; });
    return m;
  }
  function doSave() {
    if (!storageOK || !currentWorld || !ready) return Promise.resolve();
    const meta = snapshot();
    const dirty = [];
    if (dimension === 'overworld') chunks.forEach(function (c) { if (c.dirty) dirty.push(c); });
    const recMap = new Map();
    dirty.forEach(function (c) {
      c.dirty = false;
      recMap.set(ckey(c.cx, c.cz), { k: meta.id + ':' + c.cx + ',' + c.cz, w: meta.id, cx: c.cx, cz: c.cz, data: c.data.slice() });
    });
    // Keep modified Overworld chunks safe while the player explores other dimensions.
    if (dimension !== 'overworld') savedChunks.forEach(function (data, key) {
      const parts = key; // key is the packed chunk coordinate used by the chunk cache
      const cx = (parts >> 16) << 16 >> 16, cz = (parts << 16) >> 16;
      const k = meta.id + ':' + cx + ',' + cz;
      recMap.set(key, { k: k, w: meta.id, cx: cx, cz: cz, data: data.slice() });
    });
    const recs = Array.from(recMap.values());
    return db.saveWorld(meta, recs).catch(function (err) {
      // Keep dirty chunks in memory if the transaction fails; retry on autosave.
      dirty.forEach(function (c) { c.dirty = true; });
      throw err;
    });
  }
  function saveWorld() {
    saveChain = saveChain.then(doSave).catch(function (err) {
      console.error('MauriceCraft save failed:', err);
      showHint('Saving failed. Your changes are still in memory; please keep this tab open and try again.', 6500);
    });
    return saveChain;
  }


  function ago(t) {
    const sec = Math.max(0, (Date.now() - t) / 1000);
    if (sec < 60) return 'just now';
    if (sec < 3600) return Math.floor(sec / 60) + ' min ago';
    if (sec < 86400) return Math.floor(sec / 3600) + ' h ago';
    return Math.floor(sec / 86400) + ' d ago';
  }
  function renderWorlds() {
    worldsEl.innerHTML = '';
    saveNote.textContent = storageOK
      ? 'Worlds save automatically in this browser, including every block you change.'
      : 'Saving is not available in this browser, so this world will be lost when you leave.';
    worldList.forEach(function (w) {
      const isCur = !!currentWorld && currentWorld.id === w.id;
      const row = document.createElement('div'); row.className = 'world' + (isCur ? ' on' : '');
      const main = document.createElement('button'); main.type = 'button'; main.className = 'wmain';
      main.appendChild(document.createTextNode(w.name));
      const sm = document.createElement('small'); sm.textContent = (LABEL[w.mode] || 'Creative') + ' \u00b7 played ' + ago(w.lastPlayed || w.created || Date.now()); main.appendChild(sm);
      main.addEventListener('click', function () { if (busy) return; if (isCur) startGame(); else loadWorld(w.id); });
      const del = document.createElement('button'); del.type = 'button'; del.className = 'wdel'; del.textContent = 'Delete';
      del.setAttribute('aria-label', 'Delete ' + w.name);
      let armed = false, t = 0;
      del.addEventListener('click', function () {
        if (busy) return;
        if (!armed) { armed = true; del.textContent = 'Sure?'; del.classList.add('armed'); t = setTimeout(function () { armed = false; del.textContent = 'Delete'; del.classList.remove('armed'); }, 2500); }
        else { clearTimeout(t); deleteWorld(w.id); }
      });
      row.appendChild(main); row.appendChild(del); worldsEl.appendChild(row);
    });
  }
  async function refreshWorlds() {
    if (storageOK) {
      try { worldList = (await dbListWorlds()).sort(function (a, b) { return (b.lastPlayed || 0) - (a.lastPlayed || 0); }); } catch (e) { /* keep old list */ }
    }
    renderWorlds();
  }
  function setBusy(b, text) {
    busy = b;
    playBtn.disabled = newBtn.disabled = b;
    worldsEl.classList.toggle('busy', b);
    if (b) { playBtn.textContent = 'Loading\u2026'; subEl.textContent = text || 'Loading\u2026'; }
  }
  function finishLoad() {
    subEl.textContent = currentWorld.name + '. Choose a mode and play.';
    playBtn.textContent = 'Play';
    setBusy(false);
    renderWorlds();
    playBtn.focus({ preventScroll: true });
  }

  function applyWorld(m) {
    const p = m.player || { x: 0.5, y: 60, z: 0.5, yaw: 0, pitch: 0, fly: false };
    dimension = ['overworld', 'nether', 'end'].includes(m.dimension) ? m.dimension : 'overworld';
    enderDragonDefeated = !!m.enderDragonDefeated;
    portals.length = 0; portals.push(...restorePortals(m.portals));
    clearPortalVisuals(); portals.forEach(showPortalVisual);
    resetWorld(m.seed, Math.floor(p.x / 16), Math.floor(p.z / 16));
    clearMobs();
    player.x = p.x; player.y = p.y; player.z = p.z; player.vx = player.vy = player.vz = 0;
    player.yaw = p.yaw || 0; player.pitch = p.pitch || 0; player.fallStart = null;
    for (const k in inv) delete inv[k];
    Object.keys(m.inv || {}).forEach(function (k) { inv[k] = m.inv[k]; });
    if (m.hotbar && m.hotbar.length === 9) for (let i = 0; i < 9; i++) hotbar[i] = m.hotbar[i];
    selected = m.selected || 0;
    tod = (typeof m.tod === 'number') ? m.tod : 0.22;
    for (const k in toolWear) delete toolWear[k];
    Object.keys(m.toolWear || {}).forEach(function (k) { toolWear[k] = m.toolWear[k]; });
    mode = m.mode || 'creative';
    difficulty = DIFF[m.difficulty] ? m.difficulty : 'normal';
    spawnPoint = m.spawn || null; omen = !!m.omen;
    if (m.weather && WEATHER_LABEL[m.weather.w]) { weather = m.weather.w; weatherT = m.weather.t || 300; rainLevel = m.weather.r || 0; }
    else { weather = 'clear'; weatherT = 420; rainLevel = 0; }
    rainTarget = weather === 'clear' ? 0 : (weather === 'rain' ? 0.75 : 1); updateWeatherUI();
    clearRelics();
    (m.relics || []).forEach(function (r) { addRelic(r.x, r.y, r.z, r.got); });
    ready = true; dead = false;
    if (!relics.length) createRelics();
    setMode(mode);
    hp = (m.hp > 0) ? m.hp : MAXHP; updateHearts();
    hunger = (typeof m.hunger === 'number') ? m.hunger : 20; sat = (typeof m.sat === 'number') ? m.sat : 5; renderFood();
    (m.golems || []).forEach(function (g) {
      if (!KINDS[g.kind] || Math.hypot(g.x - player.x, g.z - player.z) > 60 || !chunkAt(Math.floor(g.x) >> 4, Math.floor(g.z) >> 4)) return;
      const gm = addMob(g.kind, g.x, g.y, g.z, null); gm.hp = g.hp; gm.persist = true; gm.hx = g.hx; gm.hz = g.hz;
    });
    if (mode === 'creative') player.fly = !!p.fly;
  }
  async function loadWorld(id) {
    setBusy(true, 'Loading world\u2026');
    try {
      await saveWorld();
      ready = false;
      const meta = await dbGetWorld(id);
      if (!meta) throw new Error('missing');
      const recs = await dbGetChunks(id);
      savedChunks.clear();
      recs.forEach(function (r) { savedChunks.set(ckey(r.cx, r.cz), r.data); });
      currentWorld = meta;
      await sleep(20);
      applyWorld(meta);
      finishLoad();
    } catch (error) {
      // Never replace or modify a player's world because loading failed.
      // They may be able to recover it after fixing browser storage access.
      console.error('MauriceCraft could not load world:', error);
      ready = false;
      currentWorld = null;
      setBusy(false);
      playBtn.disabled = true;
      subEl.textContent = 'Could not load this world. Its save is still in your browser. Select another world or create a new one.';
      showHint('World load failed. Your saved data was not deleted.', 6000);
      renderWorlds();
    }
  }
  async function newWorld() {
    setBusy(true, 'Building your world\u2026');
    try { await saveWorld(); } catch (e) { /* ignore */ }
    ready = false;
    await sleep(20);
    let maxN = 0;
    worldList.forEach(function (w) { const mm = /^World (\d+)$/.exec(w.name); if (mm) maxN = Math.max(maxN, +mm[1]); });
    const sd = (Math.random() * 1e6) | 0;
    savedChunks.clear();
    currentWorld = { id: 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36), name: 'World ' + (maxN + 1), seed: sd, created: Date.now(), lastPlayed: Date.now() };
    resetWorld(sd, 0, 0);
    spawnPoint = null; omen = false;
    weather = 'clear'; weatherT = 420 + Math.random() * 300; rainLevel = 0; rainTarget = 0; updateWeatherUI();
    respawn(); clearMobs();
    for (const k in inv) delete inv[k];
    for (let i = 0; i < 9; i++) hotbar[i] = ALL_BLOCKS[i];
    selected = 0; tod = 0.22;
    for (const k in toolWear) delete toolWear[k];
    createRelics();
    ready = true; dead = false;
    setMode(mode);
    await saveWorld();
    await refreshWorlds();
    finishLoad();
  }
  async function deleteWorld(id) {
    if (busy) return;
    const wasCurrent = !!currentWorld && currentWorld.id === id;
    setBusy(true, 'Deleting\u2026');
    try {
      await saveChain;
      await dbDeleteWorld(id);
    } catch (error) {
      console.error('MauriceCraft could not delete world:', error);
      setBusy(false);
      subEl.textContent = 'World deletion failed. Your saved world has been kept.';
      showHint('Could not delete the world. Its save has not been removed.', 5000);
      renderWorlds();
      return;
    }
    if (wasCurrent) { currentWorld = null; ready = false; }
    await refreshWorlds();
    if (wasCurrent) { if (worldList.length) await loadWorld(worldList[0].id); else await newWorld(); }
    else setBusy(false);
  }
  newBtn.addEventListener('click', function () { if (!busy) newWorld(); });
  async function init() {
    try { db = await openDB(); storageOK = true; } catch (e) { storageOK = false; }
    if (storageOK) {
      try { worldList = (await dbListWorlds()).sort(function (a, b) { return (b.lastPlayed || 0) - (a.lastPlayed || 0); }); }
      catch (e) { storageOK = false; worldList = []; }
    }
    renderWorlds();
    if (storageOK && worldList.length) await loadWorld(worldList[0].id); else await newWorld();
  }
  setInterval(function () { if (ready && playing) saveWorld(); }, 15000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') saveWorld(); });
  window.addEventListener('pagehide', function () { saveWorld(); });

  let frames = 0, fpsT = 0, fps = 0, infoT = 0;
  let last = performance.now();
  function frame(now) {
    const dt = (now - last) / 1000; last = now;
    if (ready) {
      streamChunks();
      if (playing) update(dt, now);
      else { camera.position.set(player.x, player.y + EYE, player.z); camera.rotation.set(player.pitch, player.yaw, 0); }
      daylight(dt);
      updateWeather(dt); updateRain(dt); updateRainSound(dt);
      updateRelics(dt, now / 1000);
      if (playing) {
        frames++; fpsT += dt; infoT += dt;
        if (fpsT >= 1) { fps = frames; frames = 0; fpsT = 0; }
        if (infoT > 0.2) {
          infoT = 0;
          const state = mode === 'creative' ? (player.fly ? 'Flying' : 'Walking') : (isNight && hasHealth() ? 'Night' : (mode === 'spectator' ? 'x' + specSpeed.toFixed(2) : 'Day'));
          infoEl.textContent = LABEL[mode] + (hasHealth() ? ' \u00b7 ' + DIFF[difficulty].label : '') + '  ' + state + '\nX ' + player.x.toFixed(1) + '  Y ' + player.y.toFixed(1) + '  Z ' + player.z.toFixed(1) + '\n' + fps + ' fps' + (weather === 'clear' ? '' : ' \u00b7 ' + WEATHER_LABEL[weather]) + '\nNearby: ' + nearestStructure();
          if (mode === 'adventure') objEl.textContent = objectiveText();
        }
      }
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  setMode('creative');
  setTimeout(init, 30);
  requestAnimationFrame(frame);
})();
