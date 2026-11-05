// @ts-nocheck
// This legacy gameplay loop is being migrated to typed, focused modules.
// Keep IndexedDB store names/keys and world serialization compatible.
import * as THREE from 'three';
import { createFrameLoop, startFrameLoop } from './runtime/frame-loop';
import { showStartupFailure } from '../startup/startup-health';
import { raycastActors } from './entities/actor-targeting';
import { createMobCatalog } from './entities/mob-catalog';
import { createPlayerMovement } from './player/player-movement';
import { createRelicSystem } from './adventure/relics';
import { createWeatherSystem } from './rendering/weather-system';
import { SpatialIndex } from './entities/spatial-index';
import { createMobSimulation } from './entities/mob-simulation';
import { createArrowSystem } from './entities/arrow-system';
import { createMobSpawning } from './entities/mob-spawning';
import { part, JOBS, JOB_NAMES } from './entities/mob-models';
import { ckey } from './world/chunk-key';
import { createBlockAccess } from './world/block-access';
import { createChunkLifecycle } from './world/chunk-lifecycle';
import { createChunkStreamer } from './world/chunk-streamer';
import { primeWorldChunks } from './world/prime-chunks';
import { createStructureRegions } from './world/structure-regions';
import { createStructureBuilders } from './world/structure-builders';
import { createChunkGenerator } from './world/chunk-generator';
import { raycastBlocks } from './world/raycast';
import { createCollisionEngine } from './world/collision';
import { mulberry32, hash2, fbm, smooth } from './world/noise';
import { createToolUsage } from './items/tool-usage';
import { createBlockCatalog } from './world/block-catalog';
import { createRecipeMatcher } from './crafting/recipes';
import { createRecipeCatalog } from './crafting/recipe-catalog';
import { createInventoryUi } from './ui/inventory-ui';
import { createInputControls } from './input/game-controls';
import { createHud } from './ui/hud';
import { createGameMenu, MODE_LABELS } from './ui/game-menu';
import { coord } from './commands/coordinates';
import { createCommandConsole } from './commands/command-console';
import { registerWorldCommands } from './commands/world-commands';
import { registerPlayerCommands } from './commands/player-commands';
import { createItemResolver } from './commands/item-resolver';
import { findPortalFrame, portalContains } from './portals/frame';
import { createPortalSystem } from './portals/portal-system';
import { restorePortals, snapshotPortals } from './portals/persistence';
import { createGameRenderer } from './rendering/game-renderer';
import { createExplosionSystem } from './effects/explosions';
import { createChunkMesher } from './rendering/chunk-mesher';
import { openWorldStorage } from './storage/world-storage';
import { createWorldSession } from './session/world-session';
import { createAudioEngine } from './audio/sound-engine';


/* ---------- World constants ---------- */
const WORLD_HEIGHT = 48, CHUNK_SIZE = 16, SEA_LEVEL = 14, VIEW_DISTANCE = 5;   // VIEW_DISTANCE = view distance in chunks
const chunks = new Map();
const { chunkAt, resetChunkCache, getBlock: get, setBlock, inBounds } =
  createBlockAccess(chunks, WORLD_HEIGHT);

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
  getBlock: get, opq, isBed, tiles: TILES, height: WORLD_HEIGHT, chunkSize: CHUNK_SIZE,
  atlasTiles: ATLAS_N, bedHeight: BED_H, torchId: TORCH,
});

/* ---------- Endless world generation, one chunk at a time ---------- */
let seed = 1;
let dimension = 'overworld'; // overworld, nether, or end
const portals = []; // portal frames are saved with the world and paired between Overworld and Nether
const savedChunks = new Map();   // edited chunks loaded from a saved world, keyed like chunks
function heightAt(x, z) {
  const n = fbm(x / 40, z / 40, seed), n2 = fbm(x / 170, z / 170, seed + 300), m = fbm(x / 12, z / 12, seed + 50);
  const h = Math.floor(5 + (n * 0.72 + n2 * 0.28) * 34 + m * 4);
  return Math.max(3, Math.min(WORLD_HEIGHT - 12, h));
}
/* ---------- Structures: villages, temples, towers, dungeons ---------- */
const { REG: STRUCTURE_REGION_SIZE, STRUCT_NAMES, structCache, structureFor, structAt, inStructZone,
  groundH, forceSand, nearestStructure } = createStructureRegions({
  heightAt, getSeed: () => seed, getPlayer: () => player, seaLevel: SEA_LEVEL, maxHeight: WORLD_HEIGHT,
});

const { buildStructure } = createStructureBuilders(() => seed, {
  BRICK, COBBLE, CTABLE, DIRT, GOLD, GRAVEL, HAY, LEAVES, MOSSY, PLANKS, SANDSTONE, STONEBRICK, TORCH, WOOD
});

const generateChunkData = createChunkGenerator({
  getSeed: () => seed,
  getDimension: () => dimension,
  maxHeight: WORLD_HEIGHT, seaLevel: SEA_LEVEL, regionSize: STRUCTURE_REGION_SIZE,
  groundH, heightAt, forceSand, inStructZone, structureFor, buildStructure,
  blocks: { BRICK, COAL_ORE, COPPER_ORE, DIAMOND_ORE, DIRT, GOLD, GRASS, IRON_ORE, LAVA, LEAVES, SAND, SANDSTONE, STONE, STONEBRICK, TORCH, WATER, WOOD },
});
const { genChunk, getOrGen, topY, resetWorld } = createChunkLifecycle({
  chunks, savedChunks, height: WORLD_HEIGHT,
  getDimension: () => dimension,
  setSeed: value => { seed = value; },
  clearStructures: () => structCache.clear(),
  chunkAt, resetChunkCache, generateChunkData, buildChunk, disposeMesh,
  solid, getBlock: get,
});

const streamChunks = createChunkStreamer({
  chunks, viewDistance: VIEW_DISTANCE,
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
const MAX_HEALTH = 20;
let hp = MAX_HEALTH, sinceHurt = 99, regenT = 0, dead = false;
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
const PLAYER_RADIUS = 0.3, PLAYER_HEIGHT = 1.8, EYE_HEIGHT = 1.62;
const { collides, moveEnt } = createCollisionEngine({
  getBlock: get, solid, defaultRadius: PLAYER_RADIUS, defaultHeight: PLAYER_HEIGHT, bedHeight: BED_H,
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
const { KINDS, ANIMALS } = createMobCatalog({ GUNPOWDER, BONE, STRING, EMERALD, IRON_INGOT, COPPER_INGOT, DIAMOND, BEEF, LEATHER, PORK, MUTTON, WOOL, CHICKEN, FEATHER });
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
const { raid, endRaid, trySpawnMob, trySpawnAnimals, manageVillagers,
  trySpawnPatrol, updateRaid } = createMobSpawning({
  mobs, player, kinds: KINDS, animals: ANIMALS, jobs: JOBS,
  regionSize: STRUCTURE_REGION_SIZE,
  grassBlock: GRASS, leavesBlock: LEAVES, woodBlock: WOOD,
  torchBlock: TORCH, emeraldItem: EMERALD,
  getSeed: () => seed,
  getChunk: chunkAt,
  getBlock: get, topY, solid, collides,
  getStructure: structureFor, addMob,
  getOmen: () => omen, setOmen: next => { omen = next; },
  isDead: () => dead, hasHealth: () => hasHealth(), getMode: () => mode,
  giveItem: (id, count) => giveItem(id, count),
  showHint: (message, ms) => showHint(message, ms),
  playSound: event => sfx(event),
  raidElement: document.getElementById('raid'),
});
let spawnT = 2, animalT = 0.5, villT = 0.2, patrolT = 70;
const pendingBlasts = [], pendingHits = [];
const { arrows, hasLOS, shootArrow, updateArrows } = createArrowSystem({
  scene, player, mobs, getBlock: get, solid, collides,
  hasHealth: () => hasHealth(),
  damagePlayer, damageMob,
  playSound: event => sfx(event),
  playSoundAt: (event, x, y, z) => sfxAt(event, x, y, z),
});
const stepMobActors = createMobSimulation({
  mobs, player, kinds: KINDS, raid, hostileActors, defenders,
  getDifficulty: () => DIFF[difficulty],
  isDaylight: () => isDay, isNight: () => isNight, getRainLevel: () => rainLevel,
  canTakeDamage: hasHealth,
  removeMobAt, damagePlayer, showHint,
  playSoundAt: (sound, x, y, z) => sfxAt(sound, x, y, z),
  hasLineOfSight: hasLOS, shootArrow,
  moveEntity: moveEnt, pendingHits, pendingBlasts,
});
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
  stepMobActors(dt);
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
  scene, texture: tex, tntId: TNT, torchId: TORCH, worldHeight: WORLD_HEIGHT,
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
  canInteract, maxHealth: MAX_HEALTH,
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
  maxHealth: MAX_HEALTH, updateHearts, updateHotbar, showHint,
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
  return raycastBlocks(camera.position, dirV, maxD, get, solid, WORLD_HEIGHT);
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
const { heldTool, toolSpeed, canCollect, wearTool, attackDamage, spendItem } = createToolUsage({
  getMode: () => mode,
  getSelectedItem: () => hotbar[selected],
  inventory: inv, wear: toolWear,
  tools: TOOLS, names: NAMES,
  maxWear: TOOL_MAX, toolLevels: TOOL_LVL, toolSpeeds: TOOL_SPD,
  toolDamages: TOOL_DMG, requiresPick: NEEDS_PICK,
  updateHotbar: () => updateHotbar(false),
  flashName, showHint: (message, ms) => showHint(message, ms),
  playSound: event => sfx(event), exert,
});
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
  const portal = findPortalFrame(get, { x: px, y: py, z: pz }, dimension, OBSIDIAN, WORLD_HEIGHT);
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
  for (let i = 0; i < 2; i++) { const c = cells[i]; if (c[0] + 1 > player.x - PLAYER_RADIUS && c[0] < player.x + PLAYER_RADIUS && y + BED_H > player.y && y < player.y + PLAYER_HEIGHT && c[1] + 1 > player.z - PLAYER_RADIUS && c[1] < player.z + PLAYER_RADIUS) return; }
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
  if (hotbar[selected] !== TORCH && x + 1 > player.x - PLAYER_RADIUS && x < player.x + PLAYER_RADIUS && y + 1 > player.y && y < player.y + PLAYER_HEIGHT && z + 1 > player.z - PLAYER_RADIUS && z < player.z + PLAYER_RADIUS) return;
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
let gtime = 0, lavaDamageTimer = 0;
const { updateMovement: updatePlayerMovement } = createPlayerMovement({
  player,
  keys,
  touchMovement: touchMove,
  getMode: () => mode,
  getHunger: () => hunger,
  isJumpPressed: () => Boolean(keys.Space || touchJump),
  isSleeping: () => sleepT > 0,
  getSpectatorSpeed: () => specSpeed,
  worldHeight: WORLD_HEIGHT,
  moveEntity: (axis, distance) => moveEnt(player, axis, distance),
  checkPortal: seconds => checkPortal(seconds),
  respawn: () => respawn(),
  exert: amount => exert(amount),
  refreshHunger: () => {
    if (mode === 'survival' && hunger !== shownHunger) renderFood();
  },
  getSurfaceBlock: get,
  playStep: blockId => sfx('step', 0.8, 0, blockId),
  playLanding: volume => sfx('land', volume),
  applyFallDamage: amount => damagePlayer(amount),
});
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
  updatePlayerMovement(dt);

  camera.position.set(player.x, player.y + EYE_HEIGHT, player.z);
  camera.rotation.set(player.pitch, player.yaw, 0);

  blockHit = mode === 'spectator' ? null : raycast(canInteract() ? (mode === 'creative' ? 6 : 5) : 4);
  target = canInteract() ? blockHit : null;
  if (target) { sel.visible = true; sel.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5); }
  else sel.visible = false;

  updateMobs(dt); updateBlasts(dt); updateArrows(dt); updateFx(dt); updateMusic(dt);
  if (hasHealth()) {
    sinceHurt += dt;
    if (hp < MAX_HEALTH && sinceHurt > DIFF[difficulty].regenAfter && (mode !== 'survival' || difficulty === 'peaceful' || hunger >= 15)) {
      regenT += dt;
      if (regenT >= DIFF[difficulty].regenEvery) { regenT = 0; hp = Math.min(MAX_HEALTH, hp + 1); updateHearts(); exert(1.2); }
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
const LABEL = MODE_LABELS;
const { overlay, playBtn, newBtn, subEl, infoEl, objEl,
  updateModeUI, updateDiffUI, updateWeatherUI, showHint } = createGameMenu({
  getMode: () => mode, getDifficulty: () => difficulty, getWeather: () => weather,
  canInteract, hasHealth, isTouch, relicCount: RELIC_COUNT,
  touchUi: touchUI, hotbar: hotbarEl, hearts: heartsEl, food: foodEl,
  placeButton: bPlace, flyButton: bFly, inventoryButton: bInv, jumpButton: bJump,
  hideSelection: () => { sel.visible = false; resetMine(); },
  syncRelics: syncRelicVisibility,
  updateHotbar: () => updateHotbar(false), updateHearts, updateFood: renderFood,
  setMode: value => setMode(value), setDifficulty: value => setDifficulty(value),
  setWeather: value => setWeather(value), sound: Snd,
  initializeAudio: audioInit, applySound, saveSound, playClick: () => sfx('click'),
  isPlaying: () => playing,
  saveAndRefreshWorlds: () => { void saveWorld().then(refreshWorlds); },
  onPlay: () => startGame(),
});

function setMode(m) {
  mode = m;
  mining = placing = pulseMine = pulsePlace = false;
  clearMobs();
  hp = MAX_HEALTH; sinceHurt = 99; regenT = 0; hunger = 20; sat = 5; exhaust = 0; starveT = 0;
  player.fly = (m === 'spectator'); player.vy = 0; player.fallStart = null;
  if (dead) { dead = false; respawn(); playBtn.textContent = ready ? 'Play' : 'Loading\u2026'; subEl.textContent = 'Mode changed to ' + LABEL[m] + '.'; }
  if (ready && m !== 'spectator' && collides(player.x, player.y, player.z)) player.y = topY(Math.floor(player.x), Math.floor(player.z)) + 1.01;
  updateModeUI();
}
function setDifficulty(d) {
  if (!DIFF[d]) return;
  difficulty = d;
  if (DIFF[d].cap === 0 && hasHealth()) for (let i = mobs.length - 1; i >= 0; i--) if (mobs[i].hostile) removeMobAt(i);
  updateDiffUI();
  sfx('click');
  saveWorld().then(refreshWorlds);
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
  if (dead) { dead = false; respawn(); hp = MAX_HEALTH; hunger = 20; sat = 5; exhaust = 0; sinceHurt = 99; clearMobs(); updateHearts(); renderFood(); }
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

/* ---------- Commands (press T or /) ---------- */
const { commands: CMDS, commandBar: cmdBar, defCmd, openCmd } =
  createCommandConsole({
    onOpen: () => {
      invOpen = true; cmdOpen = true; playing = false; mining = placing = false; drag = null;
      for (const code in keys) keys[code] = false;
      touchMove.x = 0; touchMove.z = 0; touchJump = false; stick = null; lookT = null;
    },
    onClose: resume => closeInventory(resume),
    isDead: () => dead,
    canOpen: () => playing && !invOpen,
    isCommandOpen: () => cmdOpen,
    isTouch,
  });
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
const { clearPortalVisuals, showPortalVisual, buildPortalFrame,
  changeDimension, checkPortal } = createPortalSystem({
  scene, portals, chunks, savedChunks, obsidian: OBSIDIAN, worldHeight: WORLD_HEIGHT,
  getDimension: () => dimension,
  setDimension: nextDimension => { dimension = nextDimension; },
  getPlayer: () => player,
  isPlaying: () => playing,
  ensureAround, getOrGenerate: getOrGen, setBlock, topBlockY: topY,
  rebuildRegion, disposeMesh, resetChunkCache, clearStructures: () => structCache.clear(),
  clearMobs, collides, saveWorld, showHint,
});
defCmd(['portal'], '/portal [build]', 'Build an obsidian Nether portal frame in front of you; walk through it to travel', function (a) {
  if (dimension === 'end') throw new Error('Nether portals do not work in the End. Return to the Overworld first.');
  if (a.length && a[0].toLowerCase() !== 'build') throw new Error('Usage: /portal [build]');
  const cx = Math.round(player.x - Math.sin(player.yaw) * 3);
  const cz = Math.round(player.z - Math.cos(player.yaw) * 3);
  const by = Math.max(1, Math.min(WORLD_HEIGHT - 6, Math.floor(player.y) - 1));
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
registerPlayerCommands({
  register: defCmd,
  state: {
    get tod() { return tod; }, set tod(value) { tod = value; },
    get isNight() { return isNight; },
    get weatherDuration() { return weatherT; },
    set weatherDuration(value) { weatherT = value; },
    get mode() { return mode; },
    get selected() { return selected; },
    get health() { return hp; }, set health(value) { hp = value; },
    get sinceHurt() { return sinceHurt; }, set sinceHurt(value) { sinceHurt = value; },
    get hunger() { return hunger; }, set hunger(value) { hunger = value; },
    get satiety() { return sat; }, set satiety(value) { sat = value; },
    get exhaustion() { return exhaust; }, set exhaustion(value) { exhaust = value; },
  },
  player, maxHeight: WORLD_HEIGHT, maxHealth: MAX_HEALTH,
  inventory: inv, hotbar, names: NAMES, labels: LABEL, difficulties: DIFF,
  weatherLabels: WEATHER_LABEL, findItem, itemMap,
  setWeather, setMode, setDifficulty, refreshWorlds, saveWorld,
  updateHotbar, updateHearts, renderFood, toggleFly, ensureAround,
  topBlockY: topY, collides: (x, y, z) => collides(x, y, z),
  getSeed: () => seed,
});
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
registerWorldCommands({
  register: defCmd,
  player,
  maxHeight: WORLD_HEIGHT,
  torchBlock: TORCH,
  names: NAMES,
  findItem,
  itemMap,
  getBlock: get,
  setBlock,
  getOrGenerateChunk: getOrGen,
  queueRebuild,
  flushRebuilds,
  rebuildRegion,
  spawnSpot,
  explode,
  structureRegionSize: STRUCTURE_REGION_SIZE,
  structureNames: STRUCT_NAMES,
  structureFor,
  ensureAround,
  topBlockY: topY,
});
defCmd(['save'], '/save', 'Save the world now', function () { saveWorld().then(refreshWorlds); return worldSession.isStorageAvailable() ? 'Saving the world...' : 'Saving is not available in this browser'; });
defCmd(['say'], '/say <message>', 'Write a message in the chat', function (a) { return '[You] ' + a.join(' '); });

/* ---------- Saved worlds: game state adapters ---------- */
function snapshotWorld(world) {
  const m = world;
  m.dimension = dimension; m.enderDragonDefeated = enderDragonDefeated; m.portals = snapshotPortals(portals); m.mode = mode; m.difficulty = difficulty; m.spawn = spawnPoint; m.omen = omen; m.hunger = hunger; m.sat = sat; m.weather = { w: weather, t: weatherT, r: rainLevel }; m.lastPlayed = Date.now(); m.tod = tod; m.hp = dead ? MAX_HEALTH : hp;
  m.selected = selected; m.hotbar = hotbar.slice(); m.inv = Object.assign({}, inv);
  m.player = { x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch, fly: !!player.fly };
  m.relics = relics.map(function (r) { return { x: r.x, y: r.y, z: r.z, got: r.got }; });
  m.toolWear = Object.assign({}, toolWear);
  m.golems = mobs.filter(function (g) { return g.golem && g.persist; }).map(function (g) { return { kind: g.kind, x: g.x, y: g.y, z: g.z, hp: g.hp, hx: g.hx, hz: g.hz }; });
  return m;
}

/**
 * Only modified chunk data is copied to IndexedDB. The world manager owns
 * transactions and retries; gameplay continues to own its chunk cache.
 */
function collectSaveBatch(world) {
  const dirtyChunks = [];
  if (dimension === 'overworld') {
    for (const chunk of chunks.values()) {
      if (chunk.dirty) dirtyChunks.push(chunk);
    }
  }
  const records = new Map();
  for (const chunk of dirtyChunks) {
    chunk.dirty = false;
    records.set(ckey(chunk.cx, chunk.cz), {
      k: world.id + ':' + chunk.cx + ',' + chunk.cz,
      w: world.id, cx: chunk.cx, cz: chunk.cz, data: chunk.data.slice(),
    });
  }
  if (dimension !== 'overworld') {
    for (const [chunkKey, data] of savedChunks) {
      const chunkX = ((chunkKey >> 16) << 16) >> 16;
      const chunkZ = (chunkKey << 16) >> 16;
      records.set(chunkKey, {
        k: world.id + ':' + chunkX + ',' + chunkZ,
        w: world.id, cx: chunkX, cz: chunkZ, data: data.slice(),
      });
    }
  }
  return {
    records: [...records.values()],
    restoreDirty: () => { for (const chunk of dirtyChunks) chunk.dirty = true; },
  };
}

// Forwarders are declarations so earlier gameplay modules can call them.
function saveWorld() { return worldSession.saveWorld(); }
function refreshWorlds() { return worldSession.refreshWorlds(); }

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
  hp = (m.hp > 0) ? m.hp : MAX_HEALTH; updateHearts();
  hunger = (typeof m.hunger === 'number') ? m.hunger : 20; sat = (typeof m.sat === 'number') ? m.sat : 5; renderFood();
  (m.golems || []).forEach(function (g) {
    if (!KINDS[g.kind] || Math.hypot(g.x - player.x, g.z - player.z) > 60 || !chunkAt(Math.floor(g.x) >> 4, Math.floor(g.z) >> 4)) return;
    const gm = addMob(g.kind, g.x, g.y, g.z, null); gm.hp = g.hp; gm.persist = true; gm.hx = g.hx; gm.hz = g.hz;
  });
  if (mode === 'creative') player.fly = !!p.fly;
}

function prepareNewWorld(world) {
  savedChunks.clear();
  resetWorld(world.seed, 0, 0);
  spawnPoint = null;
  omen = false;
  weather = 'clear';
  weatherT = 420 + Math.random() * 300;
  rainLevel = 0;
  rainTarget = 0;
  updateWeatherUI();
  respawn();
  clearMobs();
  for (const itemId in inv) delete inv[itemId];
  for (let slotIndex = 0; slotIndex < 9; slotIndex++) hotbar[slotIndex] = ALL_BLOCKS[slotIndex];
  selected = 0;
  tod = 0.22;
  for (const toolId in toolWear) delete toolWear[toolId];
  createRelics();
  ready = true;
  dead = false;
  setMode(mode);
}

const worldSession = createWorldSession({
  openStorage: openWorldStorage,
  isWorldReady: () => ready,
  setWorldReady: value => { ready = value; },
  snapshotWorld,
  collectSaveBatch,
  applyLoadedWorld: (world, records) => {
    savedChunks.clear();
    for (const record of records) {
      savedChunks.set(ckey(record.cx, record.cz), record.data);
    }
    applyWorld(world);
  },
  prepareNewWorld,
  startPlaying: () => startGame(),
  modeLabel: value => LABEL[value] || 'Creative',
  showHint: (message, duration) => showHint(message, duration),
});

function init() { return worldSession.initialize(); }

const frame = createFrameLoop({
  isReady: () => ready,
  isPlaying: () => playing,
  streamChunks,
  update,
  updateIdleCamera: () => {
    camera.position.set(player.x, player.y + EYE_HEIGHT, player.z); camera.rotation.set(player.pitch, player.yaw, 0);
  },
  daylight,
  updateWeather,
  updateRain,
  updateRainSound,
  updateRelics,
  updateInfo: fps => {
    const state = mode === 'creative' ? (player.fly ? 'Flying' : 'Walking') : (isNight && hasHealth() ? 'Night' : (mode === 'spectator' ? 'x' + specSpeed.toFixed(2) : 'Day'));
        infoEl.textContent = LABEL[mode] + (hasHealth() ? ' \u00b7 ' + DIFF[difficulty].label : '') + '  ' + state + '\nX ' + player.x.toFixed(1) + '  Y ' + player.y.toFixed(1) + '  Z ' + player.z.toFixed(1) + '\n' + fps + ' fps' + (weather === 'clear' ? '' : ' \u00b7 ' + WEATHER_LABEL[weather]) + '\nNearby: ' + nearestStructure();
    if (mode === 'adventure') objEl.textContent = objectiveText();
  },
  render: () => renderer.render(scene, camera),
}, performance.now());

/** Explicit application entry; importing this module no longer begins gameplay. */
export function startGameApplication(): void {
  setMode('creative');
  setTimeout(() => { void init().catch(error => showStartupFailure(error)); }, 30);
  startFrameLoop(frame);
}
