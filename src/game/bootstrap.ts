// @ts-nocheck
// This legacy gameplay loop is being migrated to typed, focused modules.
// Keep IndexedDB store names/keys and world serialization compatible.
import * as THREE from 'three';
import { createFrameLoop, startFrameLoop } from './runtime/frame-loop';
import { createGameTick } from './runtime/game-tick';
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
import { createMobWorldCycle } from './entities/mob-world-cycle';
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
import { createBlockInteractions } from './interactions/block-interactions';
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
import { registerGeneralCommands } from './commands/general-commands';
import { createItemResolver } from './commands/item-resolver';
import { findPortalFrame, portalContains } from './portals/frame';
import { createPortalSystem } from './portals/portal-system';
import { snapshotPortals } from './portals/persistence';
import { createGameRenderer } from './rendering/game-renderer';
import { createExplosionSystem } from './effects/explosions';
import { createChunkMesher } from './rendering/chunk-mesher';
import { openWorldStorage } from './storage/world-storage';
import { createWorldSession } from './session/world-session';
import { snapshotWorldState, collectWorldSaveBatch } from './session/world-persistence';
import { createWorldRestore } from './session/world-restore';
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
const { updateMobs } = createMobWorldCycle({
  mobs, player, kinds: KINDS, hostileActors, defenders, pendingHits, pendingBlasts,
  getDifficulty: () => DIFF[difficulty], getDimension: () => dimension,
  isDragonDefeated: () => enderDragonDefeated,
  hasHealth: () => hasHealth(), isNight: () => isNight, getWeather: () => weather,
  addMob, trySpawnMob, trySpawnAnimals, manageVillagers, trySpawnPatrol, updateRaid,
  stepMobActors,
  setActiveIndexes: indexes => { activeMobIndexes = indexes; },
  damageMob, explode,
  showHint: (message, ms) => showHint(message, ms),
});

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
const fadeEl = document.getElementById('fade');
const { doBreak, useBed, useSelected, healGolem } = createBlockInteractions({
  camera, player, mobs, portals, hotbar, inventory: inv,
  names: NAMES, tools: TOOLS, kinds: KINDS, jobs: JOBS,
  food: FOOD, drops: DROPS, requiresPick: NEEDS_PICK,
  eggKinds: EGG_KINDS, bedDirections: BED_DIR,
  worldHeight: WORLD_HEIGHT, playerRadius: PLAYER_RADIUS,
  playerHeight: PLAYER_HEIGHT, bedHeight: BED_H,
  blockIds: { BED, GRAVEL, GUNPOWDER, TORCH, TNT, FLINT, DYNAMITE,
    OBSIDIAN, HAY, IRON_INGOT, COPPER_INGOT, DIAMOND },
  getSelected: () => selected, getTarget: () => target,
  getMode: () => mode, getDimension: () => dimension,
  getDifficultyCap: () => DIFF[difficulty].cap,
  getHunger: () => hunger, setHunger: value => { hunger = value; },
  getSatiety: () => sat, setSatiety: value => { sat = value; },
  isNight: () => isNight, getWeather: () => weather,
  hasHealth: () => hasHealth(),
  setSpawnPoint: point => { spawnPoint = point; },
  startSleeping: () => { sleepT = 3.2; slept = false; },
  getBlock: get, setBlock, inBounds,
  hasChunk: (cx, cz) => !!chunkAt(cx, cz),
  solid, isBed, collides, heldTool, canCollect, wearTool, spendItem,
  exert, giveItem,
  updateHotbar: withSound => updateHotbar(withSound ?? false),
  renderFood, flashName,
  showHint: (message, ms) => showHint(message, ms),
  playSound: (event, volume, pitch, blockId) => sfx(event, volume, pitch, blockId),
  playSoundAt: (event, x, y, z) => sfxAt(event, x, y, z),
  refreshAround, queueRebuild, flushRebuilds,
  rebuildRegion: (x1, z1, x2, z2) => rebuildRegion(x1, z1, x2, z2),
  ensureAround: (x, z) => ensureAround(x, z),
  showPortalVisual: portal => showPortalVisual(portal),
  saveWorld: () => { void saveWorld(); },
  spawnTnt, addDynamite, addMob,
});
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
const update = createGameTick({
  state: {
    get mode() { return mode; },
    get difficulty() { return difficulty; },
    get hunger() { return hunger; },
    get health() { return hp; }, set health(value) { hp = value; },
    get dead() { return dead; },
    get sleepTime() { return sleepT; }, set sleepTime(value) { sleepT = value; },
    get slept() { return slept; }, set slept(value) { slept = value; },
    get timeOfDay() { return tod; }, set timeOfDay(value) { tod = value; },
    get sinceHurt() { return sinceHurt; }, set sinceHurt(value) { sinceHurt = value; },
    get regenerationTimer() { return regenT; }, set regenerationTimer(value) { regenT = value; },
    get starvationTimer() { return starveT; }, set starvationTimer(value) { starveT = value; },
    get shake() { return shake; }, set shake(value) { shake = value; },
  },
  player, camera, selection: sel, fadeElement: fadeEl,
  difficulty: DIFF, lavaBlock: LAVA, maximumHealth: MAX_HEALTH, eyeHeight: EYE_HEIGHT,
  getBlock: get, canInteract, hasHealth,
  raycast, setBlockHit: hit => { blockHit = hit; }, setTarget: hit => { target = hit; },
  damagePlayer, setWeather: () => setWeather('clear'),
  showHint, playSound: event => sfx(event), flashName,
  updatePlayerMovement, updateMobs, updateBlasts, updateArrows, updateFx, updateMusic,
  updateHearts, exert, checkRelics, handleActions,
});

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
registerGeneralCommands({
  register: defCmd, commands: CMDS,
  player, maxHeight: WORLD_HEIGHT,
  getDimension: () => dimension,
  buildPortalFrame: (where, x, y, z) => buildPortalFrame(where, x, y, z),
  changeDimension: where => changeDimension(where),
  saveWorld: () => saveWorld(),
  refreshWorlds: () => { void refreshWorlds(); },
  isStorageAvailable: () => worldSession.isStorageAvailable(),
  slug, mobs, kinds: KINDS, jobs: JOBS,
  getDifficultyCap: () => DIFF[difficulty].cap,
  hasHealth: () => hasHealth(),
  setHealth: value => { hp = value; },
  damagePlayer: amount => damagePlayer(amount),
  spawnSpot, getOrGenerateChunk: getOrGen, topY, collides,
  addMob, removeMobAt,
});

/* ---------- Saved worlds: game state adapters ---------- */
function snapshotWorld(world) {
  return snapshotWorldState(world, {
    dimension, enderDragonDefeated, portals: snapshotPortals(portals),
    mode, difficulty, spawn: spawnPoint, omen, hunger, satiety: sat,
    weather: { w: weather, t: weatherT, r: rainLevel },
    timeOfDay: tod, health: dead ? MAX_HEALTH : hp,
    selected, hotbar, inventory: inv,
    player: { x: player.x, y: player.y, z: player.z, yaw: player.yaw,
      pitch: player.pitch, fly: !!player.fly },
    relics, toolWear, golems: mobs,
  });
}

function collectSaveBatch(world) {
  return collectWorldSaveBatch(world, dimension, chunks, savedChunks);
}

// Forwarders are declarations so earlier gameplay modules can call them.
function saveWorld() { return worldSession.saveWorld(); }
function refreshWorlds() { return worldSession.refreshWorlds(); }

const { applyWorld, prepareNewWorld } = createWorldRestore({
  state: {
    get dimension() { return dimension; }, set dimension(value) { dimension = value; },
    get enderDragonDefeated() { return enderDragonDefeated; }, set enderDragonDefeated(value) { enderDragonDefeated = value; },
    get selected() { return selected; }, set selected(value) { selected = value; },
    get tod() { return tod; }, set tod(value) { tod = value; },
    get mode() { return mode; }, set mode(value) { mode = value; },
    get difficulty() { return difficulty; }, set difficulty(value) { difficulty = value; },
    get spawnPoint() { return spawnPoint; }, set spawnPoint(value) { spawnPoint = value; },
    get omen() { return omen; }, set omen(value) { omen = value; },
    get weather() { return weather; }, set weather(value) { weather = value; },
    get weatherT() { return weatherT; }, set weatherT(value) { weatherT = value; },
    get rainLevel() { return rainLevel; }, set rainLevel(value) { rainLevel = value; },
    get rainTarget() { return rainTarget; }, set rainTarget(value) { rainTarget = value; },
    get ready() { return ready; }, set ready(value) { ready = value; },
    get dead() { return dead; }, set dead(value) { dead = value; },
    get hp() { return hp; }, set hp(value) { hp = value; },
    get hunger() { return hunger; }, set hunger(value) { hunger = value; },
    get sat() { return sat; }, set sat(value) { sat = value; },
  },
  player, portals, inventory: inv, toolWear, hotbar, allBlocks: ALL_BLOCKS,
  savedChunks, validDifficulties: DIFF, weatherLabels: WEATHER_LABEL,
  kinds: KINDS, mobs, relics, maximumHealth: MAX_HEALTH,
  resetWorld, clearPortalVisuals, showPortalVisual, clearMobs, clearRelics,
  addRelic, createRelics, setMode, updateHearts, renderFood, updateWeatherUI,
  addMob, hasChunk: (cx, cz) => !!chunkAt(cx, cz), respawn,
});

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
