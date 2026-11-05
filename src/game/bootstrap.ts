// Typed application wiring. Keep persisted world identifiers and block IDs compatible.
import * as THREE from 'three';
import { createFrameLoop, startFrameLoop } from './runtime/frame-loop';
import { createGameTick } from './runtime/game-tick';
import { createGameSessionControls } from './runtime/game-session-controls';
import { showStartupFailure } from '../startup/startup-health';
import { createPlayerMovement } from './player/player-movement';
import { createWeatherSystem } from './rendering/weather-system';
import { JOBS, JOB_NAMES } from './entities/mob-models';
import { createMobRuntime } from './entities/mob-runtime';
import { createWorldRuntime } from './world/world-runtime';
import { raycastBlocks } from './world/raycast';
import { createCollisionEngine } from './world/collision';
import { createToolUsage } from './items/tool-usage';
import { createBlockInteractions } from './interactions/block-interactions';
import { createActionController } from './input/action-controller';
import { createGameMenu, MODE_LABELS, type GameMode, type Difficulty } from './ui/game-menu';
import type { WeatherMode } from './rendering/weather-system';
import type { WorldDimension } from './portals/portal-system';
import type { PortalFrame } from './portals/frame';
import type { BlockRayHit } from './world/raycast';
import type { DragGesture, MovementTouch, CameraTouch } from './input/game-controls';
import type { SpawnMob } from './entities/mob-spawning';
import { createGameUiComposition } from './ui/game-ui-composition';
import { coord } from './commands/coordinates';
import { createCommandConsole } from './commands/command-console';
import { registerWorldCommands } from './commands/world-commands';
import { registerPlayerCommands } from './commands/player-commands';
import { registerGeneralCommands } from './commands/general-commands';
import { createItemResolver } from './commands/item-resolver';
import { findPortalFrame, portalContains } from './portals/frame';
import { createPortalSystem } from './portals/portal-system';
import { snapshotPortals } from './portals/persistence';
import { createGameplayWorldSession } from './session/gameplay-world-session';
import { createAudioEngine } from './audio/sound-engine';


function requireGameElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error('Missing game element #' + id);
  return element;
}

/* ---------- World services (typed terrain + renderer + chunk stores) ---------- */
const WORLD_HEIGHT = 48, CHUNK_SIZE = 16, SEA_LEVEL = 14, VIEW_DISTANCE = 5;
let seed = 1;
let generatorVersion = 1;
let dimension: WorldDimension = 'overworld';
const portals: PortalFrame[] = []; // Persistent portal pairs, stored with each world.
const {
  GRASS, DIRT, STONE, SAND, WOOD, LEAVES, PLANKS, BRICK,
  COBBLE, STONEBRICK, SANDSTONE, GRAVEL, HAY, GOLD, MOSSY, TNT,
  TORCH, CTABLE, BED, WATER, LAVA, OBSIDIAN, SNOW, PINE_LEAVES, RED_SAND, DARK_WOOD, COAL_ORE, COPPER_ORE,
  IRON_ORE, DIAMOND_ORE, IRON_BLOCK, COPPER_BLOCK, DIAMOND_BLOCK, BEEF, PORK, MUTTON,
  CHICKEN, COOKED, WOOL, FEATHER, LEATHER, GUNPOWDER, DYNAMITE, FLINT,
  EMERALD, BONE, STRING, STICK, COAL, RAW_COPPER, RAW_IRON, COPPER_INGOT,
  IRON_INGOT, DIAMOND, ITEM_TILE, EGG_KINDS, FOOD, TILES, tileOf, ATLAS_N,
  isBed, BED_H, BED_DIR, solid, opq, NAMES, ALL_BLOCKS, BREAK_TIME,
  DROPS, TOOL_KINDS, TOOL_TIERS, toolId, toolTile, TOOLS, TOOL_IDS, TOOL_MAX,
  TOOL_LVL, TOOL_SPD, TOOL_DMG, NEEDS_PICK,
  hotbar, toolWear, canvas, renderer, scene, camera, atlasCanvas, tex, mat, torchMat,
  dayUniform, glowMat, sun, moon, sel, disposeMesh, buildChunk, refreshAround, blockGeo,
  chunks, savedChunks, chunkAt, resetChunkCache, get, setBlock, inBounds,
  STRUCTURE_REGION_SIZE, STRUCT_NAMES, structCache, structureFor, structAt, inStructZone,
  groundH, forceSand, nearestStructure,
  genChunk, getOrGen, topY, resetWorld, streamChunks,
} = createWorldRuntime({
  height: WORLD_HEIGHT, chunkSize: CHUNK_SIZE, seaLevel: SEA_LEVEL,
  viewDistance: VIEW_DISTANCE, getSeed: () => seed,
  setSeed: newSeed => { seed = newSeed; },
  getGeneratorVersion: () => generatorVersion,
  setGeneratorVersion: version => { generatorVersion = version; },
  getDimension: () => dimension,
  getPlayer: () => player,
});

/* ---------- Game state ---------- */
let mode: GameMode = 'creative';
let difficulty: Difficulty = 'normal';
let spawnPoint: { x: number; y: number; z: number } | null = null;
let sleepT = 0, slept = false, omen = false;
let hunger = 20, sat = 5, exhaust = 0, starveT = 0, shownHunger = -1;
let weather: WeatherMode = 'clear';
let weatherT = 420, rainLevel = 0, rainTarget = 0, lightningT = 0, nextBolt = 8;   // rain and thunderstorms   // Survival hunger: 20 = full   // bed respawn point, sleeping timer, raid omen
// Difficulty only matters in Survival and Adventure (the modes with health and monsters)
const DIFF = {
  peaceful: { label: 'Peaceful', cap: 0, every: 99, dmg: 0, speed: 1, aggro: 32, fuse: 1.5, shoot: 1, regenAfter: 1, regenEvery: 1, raid: 0, patrol: [1e9, 1e9] },
  easy: { label: 'Easy', cap: 4, every: 3.4, dmg: 0.6, speed: 0.9, aggro: 24, fuse: 1.9, shoot: 1.35, regenAfter: 4, regenEvery: 2.5, raid: 0.6, patrol: [150, 240] },
  normal: { label: 'Normal', cap: 8, every: 2.2, dmg: 1, speed: 1, aggro: 32, fuse: 1.5, shoot: 1, regenAfter: 6, regenEvery: 3, raid: 1, patrol: [90, 160] },
  hard: { label: 'Hard', cap: 12, every: 1.6, dmg: 1.5, speed: 1.15, aggro: 42, fuse: 1.1, shoot: 0.75, regenAfter: 9, regenEvery: 4.5, raid: 1.5, patrol: [60, 110] }
};
const MAX_HEALTH = 20;
let hp = MAX_HEALTH, sinceHurt = 99, regenT = 0, dead = false;
const inv: Record<number, number> = {};
let specSpeed = 1;
// Shared with the weather engine, time commands, sleeping and saved worlds.
// The legacy bootstrap still owns this state until the final typed extraction.
let tod = 0.22;
let isNight = false, isDay = true;

const player = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: false, fly: false, fallStart: null as number | null };
function respawn(): void {
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
let shake = 0;
const raidElement = document.getElementById('raid');
if (!raidElement) throw new Error('Missing raid status element');
const { mobs, KINDS, addMob, removeMobAt, clearMobs, updateMobs, raycastMobs,
  attackMob, damageMob, arrows, blasts, fx, queueRebuild, flushRebuilds,
  rebuildSet, spawnTnt, addDynamite, removeBlastAt, removeFxAt, explode,
  updateBlasts, updateArrows, updateFx, RELIC_COUNT, relics, addRelic,
  clearRelics, createRelics, updateRelics, checkRelics, objectiveText,
  syncRelicVisibility } = createMobRuntime({
  scene, camera, player,
  mobDropIds: { GUNPOWDER, BONE, STRING, EMERALD, IRON_INGOT, COPPER_INGOT,
    DIAMOND, BEEF, LEATHER, PORK, MUTTON, WOOL, CHICKEN, FEATHER },
  diamondItem: DIAMOND, names: NAMES,
  getSeed: () => seed, getDimension: () => dimension,
  isDragonDefeated: () => enderDragonDefeated,
  setDragonDefeated: value => { enderDragonDefeated = value; },
  getDifficulty: () => DIFF[difficulty],
  getOmen: () => omen, setOmen: value => { omen = value; },
  isDead: () => dead, hasHealth: () => hasHealth(),
  isDaylight: () => isDay, isNight: () => isNight,
  getRainLevel: () => rainLevel, getWeather: () => weather,
  getMode: () => mode,
  regionSize: STRUCTURE_REGION_SIZE,
  grassBlock: GRASS, leavesBlock: LEAVES, woodBlock: WOOD,
  torchBlock: TORCH, emeraldItem: EMERALD, sandBlock: SAND,
  tntId: TNT, worldHeight: WORLD_HEIGHT, texture: tex,
  breakTimes: BREAK_TIME, blockGeometry: blockGeo,
  getChunk: chunkAt, getBlock: get, setBlock, topY, solid, collides,
  getStructure: structureFor, buildChunk, moveEntity: moveEnt,
  getOrGenerateChunk: getOrGen, inStructureZone: inStructZone,
  damagePlayer: (damage, scaled) => damagePlayer(damage, scaled),
  giveItem: (id, count) => giveItem(id, count),
  attackDamage: () => attackDamage(),
  showHint: (message, ms) => showHint(message, ms),
  flashName: message => flashName(message),
  playSound: event => sfx(event),
  playSoundAt: (event, x, y, z) => sfxAt(event, x, y, z),
  raidElement,
  increaseShake: amount => { shake = Math.max(shake, amount); },
  setShake: amount => { shake = amount; },
});
function giveItem(id: number, n: number): void { inv[id] = (inv[id] || 0) + n; updateHotbar(false); }

/* ---------- Input state ---------- */
const keys: Record<string, boolean> = {};
const touchMove = { x: 0, z: 0 };
let touchJump = false;
let selected = 0;
let playing = false, locked = false, fallback = false, ready = false;
const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
let invOpen = false, tradeOpen = false, craftOpen = false, cmdOpen = false;
let mining = false, placing = false, pulseMine = false, pulsePlace = false;
let mineCd = 0, placeCd = 0, attackCd = 0;
let drag: DragGesture | null = null;
let stick: MovementTouch | null = null, lookT: CameraTouch | null = null;
const mine = { x: -1, y: -1, z: -1, t: 0 };

const canInteract = () => mode === 'creative' || mode === 'survival';
const hasHealth = () => mode === 'survival' || mode === 'adventure';

/* ---------- Typed HUD, inventory, crafting and input composition ---------- */
/** Shared mutable state facade for UI, simulation, commands and saves. */
const gameState = {
  get mode() { return mode; }, set mode(value: string) { mode = value in MODE_LABELS ? value as GameMode : 'creative'; },
  get difficulty() { return difficulty; }, set difficulty(value: string) { difficulty = value in DIFF ? value as Difficulty : 'normal'; },
  get dimension() { return dimension; }, set dimension(value: string) { dimension = value as WorldDimension; },
  get enderDragonDefeated() { return enderDragonDefeated; }, set enderDragonDefeated(value: boolean) { enderDragonDefeated = value; },
  get spawnPoint() { return spawnPoint; }, set spawnPoint(value: typeof spawnPoint) { spawnPoint = value; },
  get omen() { return omen; }, set omen(value: boolean) { omen = value; },
  get selected() { return selected; }, set selected(value: number) { selected = value; },
  get playing() { return playing; }, set playing(value: boolean) { playing = value; },
  get ready() { return ready; }, set ready(value: boolean) { ready = value; },
  get dead() { return dead; }, set dead(value: boolean) { dead = value; },
  get hp() { return hp; }, set hp(value: number) { hp = value; },
  get health() { return hp; }, set health(value: number) { hp = value; },
  get hunger() { return hunger; }, set hunger(value: number) { hunger = value; },
  get sat() { return sat; }, set sat(value: number) { sat = value; },
  get satiety() { return sat; }, set satiety(value: number) { sat = value; },
  get exhaust() { return exhaust; }, set exhaust(value: number) { exhaust = value; },
  get exhaustion() { return exhaust; }, set exhaustion(value: number) { exhaust = value; },
  get sinceHurt() { return sinceHurt; }, set sinceHurt(value: number) { sinceHurt = value; },
  get regenT() { return regenT; }, set regenT(value: number) { regenT = value; },
  get regenerationTimer() { return regenT; }, set regenerationTimer(value: number) { regenT = value; },
  get starveT() { return starveT; }, set starveT(value: number) { starveT = value; },
  get starvationTimer() { return starveT; }, set starvationTimer(value: number) { starveT = value; },
  get sleepTime() { return sleepT; }, set sleepTime(value: number) { sleepT = value; },
  get slept() { return slept; }, set slept(value: boolean) { slept = value; },
  get tod() { return tod; }, set tod(value: number) { tod = value; },
  get timeOfDay() { return tod; }, set timeOfDay(value: number) { tod = value; },
  get isNight() { return isNight; },
  get weather() { return weather; }, set weather(value: string) { weather = value as WeatherMode; },
  get weatherT() { return weatherT; }, set weatherT(value: number) { weatherT = value; },
  get weatherDuration() { return weatherT; }, set weatherDuration(value: number) { weatherT = value; },
  get rainLevel() { return rainLevel; }, set rainLevel(value: number) { rainLevel = value; },
  get rainTarget() { return rainTarget; }, set rainTarget(value: number) { rainTarget = value; },
  get shake() { return shake; }, set shake(value: number) { shake = value; },
  get locked() { return locked; }, set locked(value: boolean) { locked = value; },
  get fallback() { return fallback; }, set fallback(value: boolean) { fallback = value; },
  get specSpeed() { return specSpeed; }, set specSpeed(value: number) { specSpeed = value; },
  get invOpen() { return invOpen; }, set invOpen(value: boolean) { invOpen = value; },
  get tradeOpen() { return tradeOpen; }, set tradeOpen(value: boolean) { tradeOpen = value; },
  get craftOpen() { return craftOpen; }, set craftOpen(value: boolean) { craftOpen = value; },
  get cmdOpen() { return cmdOpen; }, set cmdOpen(value: boolean) { cmdOpen = value; },
  get mining() { return mining; }, set mining(value: boolean) { mining = value; },
  get placing() { return placing; }, set placing(value: boolean) { placing = value; },
  get pulseMine() { return pulseMine; }, set pulseMine(value: boolean) { pulseMine = value; },
  get pulsePlace() { return pulsePlace; }, set pulsePlace(value: boolean) { pulsePlace = value; },
  get mineCd() { return mineCd; }, set mineCd(value: number) { mineCd = value; },
  get placeCd() { return placeCd; }, set placeCd(value: number) { placeCd = value; },
  get attackCd() { return attackCd; }, set attackCd(value: number) { attackCd = value; },
  get drag() { return drag; }, set drag(value: DragGesture | null) { drag = value; },
  get stick() { return stick; }, set stick(value: MovementTouch | null) { stick = value; },
  get lookT() { return lookT; }, set lookT(value: CameraTouch | null) { lookT = value; },
  get lookTouch() { return lookT; }, set lookTouch(value: CameraTouch | null) { lookT = value; },
  get touchJump() { return touchJump; }, set touchJump(value: boolean) { touchJump = value; },
};

const { hotbarEl, heartsEl, foodEl, flashEl, mineBar,
  updateHotbar, flashName, updateFood, updateHearts,
  openCraft, renderCraft, openInventory, closeInventory, renderInventory,
  openTrade, renderTrade, touchUI, jumpButton: bJump, placeButton: bPlace,
  flyButton: bFly, inventoryButton: bInv, toggleFly } = createGameUiComposition({
  state: gameState, player, canvas, atlasCanvas, tileOf,
  inventory: inv, hotbar, allBlocks: ALL_BLOCKS, names: NAMES,
  tools: TOOLS, toolMax: TOOL_MAX, toolWear,
  recipeItems: { BED, BEEF, BONE, BRICK, CHICKEN, COAL, COBBLE, COOKED,
    COPPER_BLOCK, COPPER_INGOT, CTABLE, DIAMOND, DIAMOND_BLOCK, DIRT,
    DYNAMITE, EMERALD, FEATHER, FLINT, GOLD, GRAVEL, GUNPOWDER,
    IRON_BLOCK, IRON_INGOT, LEATHER, MUTTON, PLANKS, PORK,
    RAW_COPPER, RAW_IRON, SAND, SANDSTONE, STICK, STONE,
    STONEBRICK, STRING, TNT, TORCH, WOOD, WOOL },
  itemIds: { HAY, WOOL, BONE, EMERALD, COOKED, BED, BEEF, PORK,
    CHICKEN, LEATHER, COBBLE, STONEBRICK, SANDSTONE, BRICK,
    COPPER_INGOT, GUNPOWDER, TORCH, FLINT, DYNAMITE, TNT,
    IRON_INGOT, COAL, GOLD, DIAMOND },
  toolTiers: TOOL_TIERS, toolId, jobNames: JOB_NAMES,
  keys, touchMove, isTouch, maxHealth: MAX_HEALTH,
  getMode: () => mode, getModeLabel: () => MODE_LABELS[mode],
  getSelected: () => selected, setSelected: slot => { selected = slot; },
  getHealth: () => hp, setHealth: health => { hp = health; },
  getHunger: () => hunger, canInteract, getFallback: () => fallback,
  showHint: (message, milliseconds) => showHint(message, milliseconds),
  playSound: event => sfx(event),
  playSoundAt: (event, x, y, z) => sfxAt(event, x, y, z),
  requestPointerLock: () => requestLock(), pauseGame: () => pause(),
  getCommandBar: () => cmdBar,
  openCommand: command => openCmd(command),
});

// Hunger drains slowly with activity (a lot when sprinting). Eat to refill it; at zero you starve.
function exert(n: number): void {
  if (mode !== 'survival' || difficulty === 'peaceful') return;
  exhaust += n;
  while (exhaust >= 4) {
    exhaust -= 4;
    if (sat > 0) sat = Math.max(0, sat - 1); else hunger = Math.max(0, hunger - 1);
  }
}
// Hunger and health displays are provided by the HUD adapter.
function renderFood(): void { shownHunger = hunger; updateFood(); }
function damagePlayer(n: number, scaled = false): void {
  if (scaled) n = Math.round(n * DIFF[difficulty].dmg);   // monster hits scale with difficulty
  if (!hasHealth() || dead || n <= 0) return;
  if (sleepT > 0) { sleepT = 0; fadeEl.style.opacity = '0'; }
  hp = Math.max(0, hp - n); sinceHurt = 0; regenT = 0; sfx('hurt');
  flashEl.style.opacity = '0.9';
  setTimeout(function () { flashEl.style.opacity = '0'; }, 140);
  updateHearts();
  if (hp <= 0) die();
}


/* ---------- Block interaction ---------- */
const dirV = new THREE.Vector3();
let blockHit: BlockRayHit | null = null, target: BlockRayHit | null = null;
function raycast(maxD: number): BlockRayHit | null {
  camera.getWorldDirection(dirV);
  return raycastBlocks(camera.position, dirV, maxD, get, solid, WORLD_HEIGHT);
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
const fadeEl = requireGameElement('fade');
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
const { handleActions, resetMine } = createActionController({
  state: gameState,
  mine, miningBar: mineBar, keys,
  getBlockHit: () => blockHit,
  getTarget: () => target,
  raycastMobs, getBlock: get, breakTimes: BREAK_TIME, toolSpeed, doBreak,
  attackMob, canInteract, openTrade: mob => openTrade(mob as SpawnMob & { job: string }), healGolem, isBed, useBed,
  craftingTableId: CTABLE, openCraft, useSelected,
});

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
  state: gameState,
  player, camera, selection: sel, fadeElement: fadeEl,
  difficulty: DIFF, lavaBlock: LAVA, maximumHealth: MAX_HEALTH, eyeHeight: EYE_HEIGHT,
  getBlock: get, canInteract, hasHealth,
  raycast, setBlockHit: hit => { blockHit = hit; }, setTarget: hit => { target = hit; },
  damagePlayer, setWeather: () => setWeather('clear'),
  showHint: (message, ms) => showHint(message, ms), playSound: event => sfx(event), flashName,
  updatePlayerMovement, updateMobs, updateBlasts, updateArrows, updateFx, updateMusic,
  updateHearts, exert, checkRelics, handleActions,
});

/* ---------- Day / night ---------- */
const boltEl = requireGameElement('bolt');
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
    getMobs: () => mobs, damageMob: (mob, damage) => { damageMob(mob as SpawnMob, damage); },
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

const sessionControls = createGameSessionControls({
  state: gameState,
  player, keys, canvas, document, overlay, playButton: playBtn, subtitle: subEl,
  labels: LABEL, difficulties: DIFF, maximumHealth: MAX_HEALTH, isTouch,
  hasHealth, clearMobs, removeMobAt, mobs,
  respawn, collides, topY, updateModeUI, updateDiffUI, updateHearts, renderFood,
  saveWorld, refreshWorlds, audioInit, playSound: event => sfx(event), showHint,
});

// Keep stable callable names for controls and menu callback registration.
function setMode(m: GameMode): void { sessionControls.setMode(m); }
function setDifficulty(d: Difficulty): void { sessionControls.setDifficulty(d); }
function requestLock(): void { sessionControls.requestLock(); }
function startGame(): void { sessionControls.startGame(); }
function pause(): void { sessionControls.pause(); }
function die(): void { sessionControls.die(); }

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
function spawnSpot(): [number, number, number] {
  const x = player.x - Math.sin(player.yaw) * 3, z = player.z - Math.cos(player.yaw) * 3;
  getOrGen(Math.floor(x) >> 4, Math.floor(z) >> 4);
  return [x, topY(Math.floor(x), Math.floor(z)) + 1.01, z];
}
function ensureAround(x: number, z: number): void { for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) getOrGen((Math.floor(x) >> 4) + dx, (Math.floor(z) >> 4) + dz); }
function rebuildRegion(x1: number, z1: number, x2: number, z2: number): void {
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
  state: gameState,
  player, maxHeight: WORLD_HEIGHT, maxHealth: MAX_HEALTH,
  inventory: inv, hotbar, names: NAMES, labels: LABEL, difficulties: DIFF,
  weatherLabels: WEATHER_LABEL, findItem, itemMap,
  setWeather, setMode, setDifficulty, refreshWorlds, saveWorld,
  updateHotbar: showName => updateHotbar(showName ?? false), updateHearts, renderFood, toggleFly, ensureAround,
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

/* ---------- World persistence and restoration ---------- */
// Declarations let earlier gameplay systems save without retaining the manager.
function saveWorld(): Promise<void> { return worldSession.saveWorld(); }
function refreshWorlds(): Promise<void> { return worldSession.refreshWorlds(); }

const worldSession = createGameplayWorldSession({
  state: gameState,
  snapshot: () => ({
    dimension, enderDragonDefeated, portals: snapshotPortals(portals),
    mode, difficulty, spawn: spawnPoint, omen, hunger, satiety: sat,
    weather: { w: weather, t: weatherT, r: rainLevel },
    timeOfDay: tod, health: dead ? MAX_HEALTH : hp,
    selected, hotbar, inventory: inv,
    player: { x: player.x, y: player.y, z: player.z, yaw: player.yaw,
      pitch: player.pitch, fly: !!player.fly },
    relics, toolWear, golems: mobs,
  }),
  player, portals, inventory: inv, toolWear, hotbar, allBlocks: ALL_BLOCKS,
  savedChunks, chunks, getDimension: () => dimension,
  validDifficulties: DIFF, weatherLabels: WEATHER_LABEL,
  kinds: KINDS, mobs, relics, maximumHealth: MAX_HEALTH,
  resetWorld, clearPortalVisuals, showPortalVisual, clearMobs, clearRelics,
  addRelic, createRelics,
  setMode: value => setMode(value in MODE_LABELS ? value as GameMode : 'creative'),
  updateHearts, renderFood, updateWeatherUI,
  addMob, hasChunk: (cx, cz) => !!chunkAt(cx, cz), respawn,
  startPlaying: () => startGame(),
  modeLabel: value => typeof value === 'string' && value in LABEL ? LABEL[value as GameMode] : 'Creative',
  showHint: (message, duration) => showHint(message, duration),
});

function init(): Promise<void> { return worldSession.initialize(); }

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
