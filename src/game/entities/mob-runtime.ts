import * as THREE from 'three';
import { createMobCatalog, type MobDropIds, type MobKind } from './mob-catalog';
import { createMobSpawning, type SpawnMob, type MobSpawnDependencies } from './mob-spawning';
import { createMobSimulation, type MobCombatDependencies, type MobDifficulty } from './mob-simulation';
import { createMobWorldCycle, type MobWorldDifficulty } from './mob-world-cycle';
import { createArrowSystem } from './arrow-system';
import { raycastActors } from './actor-targeting';
import { SpatialIndex } from './spatial-index';
import { createExplosionSystem, type ExplosionDependencies } from '../effects/explosions';
import { createRelicSystem } from '../adventure/relics';
import { JOBS } from './mob-models';
import type { MovableEntity } from '../world/collision';

type MobBlueprint = {
  hostile?: boolean; golem?: boolean; r: number; h: number; hp: number;
  make: (opts: { job?: string; leader?: boolean; boss?: boolean }) => THREE.Group;
  drops: () => number[][];
};
export interface MobRuntimeDependencies {
  scene: THREE.Scene;
  camera: THREE.Camera;
  player: MobCombatDependencies['player'];
  mobDropIds: MobDropIds;
  diamondItem: number;
  names: Readonly<Record<number, string>>;
  getSeed: () => number;
  getDimension: () => string;
  isDragonDefeated: () => boolean;
  setDragonDefeated: (value: boolean) => void;
  getDifficulty: () => MobDifficulty & MobWorldDifficulty;
  getOmen: () => boolean;
  setOmen: (value: boolean) => void;
  isDead: () => boolean;
  hasHealth: () => boolean;
  isDaylight: () => boolean;
  isNight: () => boolean;
  getRainLevel: () => number;
  getWeather: () => string;
  getMode: () => string;
  regionSize: number;
  grassBlock: number;
  leavesBlock: number;
  woodBlock: number;
  torchBlock: number;
  emeraldItem: number;
  sandBlock: number;
  tntId: number;
  worldHeight: number;
  texture: THREE.Texture;
  breakTimes: ExplosionDependencies['breakTimes'];
  blockGeometry: ExplosionDependencies['blockGeometry'];
  getChunk: MobSpawnDependencies['getChunk'];
  getBlock: MobSpawnDependencies['getBlock'];
  setBlock: ExplosionDependencies['setBlock'];
  topY: MobSpawnDependencies['topY'];
  solid: MobSpawnDependencies['solid'];
  collides: MobSpawnDependencies['collides'];
  getStructure: MobSpawnDependencies['getStructure'];
  buildChunk: ExplosionDependencies['buildChunk'];
  moveEntity: (actor: MovableEntity, axis: number, distance: number) => void;
  getOrGenerateChunk: (cx: number, cz: number) => unknown;
  inStructureZone: (x: number, z: number) => boolean;
  damagePlayer: (damage: number, scaled: boolean) => void;
  giveItem: (id: number, count: number) => void;
  attackDamage: () => number;
  showHint: (message: string, ms: number) => void;
  flashName: (message: string) => void;
  playSound: (event: string) => void;
  playSoundAt: (event: string, x: number, y: number, z: number) => void;
  raidElement: MobSpawnDependencies['raidElement'];
  increaseShake: (value: number) => void;
  setShake: (value: number) => void;
}

/** Own the mob actors, population clocks, combat, arrows, blasts and relics. */
export function createMobRuntime(deps: MobRuntimeDependencies) {
  const { scene, player, camera } = deps;
  const get = deps.getBlock, topY = deps.topY, collides = deps.collides;
  const chunkAt = deps.getChunk, solid = deps.solid;
  const structureFor = deps.getStructure;
  const { grassBlock: GRASS, leavesBlock: LEAVES, woodBlock: WOOD,
    torchBlock: TORCH, emeraldItem: EMERALD, regionSize: STRUCTURE_REGION_SIZE } = deps;


const mobs: SpawnMob[] = [];
const hostileActors = new SpatialIndex<SpawnMob>(16);
const defenders = new SpatialIndex(16);
let activeMobIndexes: { hostiles: SpatialIndex<SpawnMob>; defenders: SpatialIndex<SpawnMob> } | null = null;
const { KINDS, ANIMALS } = createMobCatalog(deps.mobDropIds);
function addMob(kind: string, x: number, y: number, z: number, opts?: { job?: string; leader?: boolean; boss?: boolean } | null): SpawnMob {
  const K = KINDS[kind as MobKind] as unknown as MobBlueprint;
  const m: SpawnMob = { kind: kind, hostile: !!K.hostile, r: K.r, h: K.h, hp: K.hp, x: x, y: y, z: z, vx: 0, vy: 0, vz: 0, onGround: false, hit: false,
    atk: 0.8, burn: -1, phase: Math.random() * 6, ai: Math.random() * 3, walk: false, dx: 0, dz: 1, panic: 0, face: Math.random() * 6.28,
    jumpCd: 0, persist: false, golem: !!K.golem, fuse: -1, shoot: 1.5 + Math.random(), snd: 3 + Math.random() * 8, job: opts?.job, village: null, hx: 0, hz: 0,
    group: K.make(opts || {}) };
  m.group.position.set(x, y, z);
  scene.add(m.group); mobs.push(m);
  return m;
}
function removeMobAt(index: number): void {
  const mob = mobs[index];
  activeMobIndexes?.hostiles.delete(mob);
  activeMobIndexes?.defenders.delete(mob);
  scene.remove(mob.group);
  mobs.splice(index, 1);
}
function clearMobs(): void {
  mobs.forEach(function (m) { if (m.village) m.village.vSpawned = false; });   // villages repopulate afterwards
  while (mobs.length) removeMobAt(mobs.length - 1);
  while (blasts.length) removeBlastAt(blasts.length - 1);
  while (fx.length) removeFxAt(fx.length - 1);
  while (arrows.length) { scene.remove(arrows.pop()!.mesh); }
  pendingBlasts.length = 0; pendingHits.length = 0;
  endRaid(null);
  deps.setShake(0);
}
const { raid, endRaid, trySpawnMob, trySpawnAnimals, manageVillagers,
  trySpawnPatrol, updateRaid } = createMobSpawning({
  mobs, player, kinds: KINDS, animals: ANIMALS, jobs: JOBS,
  regionSize: STRUCTURE_REGION_SIZE,
  grassBlock: GRASS, leavesBlock: LEAVES, woodBlock: WOOD,
  torchBlock: TORCH, emeraldItem: EMERALD,
  getSeed: deps.getSeed,
  getChunk: chunkAt,
  getBlock: get, topY, solid, collides,
  getStructure: structureFor, addMob,
  getOmen: deps.getOmen, setOmen: deps.setOmen,
  isDead: deps.isDead, hasHealth: deps.hasHealth, getMode: deps.getMode,
  giveItem: deps.giveItem,
  showHint: deps.showHint,
  playSound: deps.playSound,
  raidElement: deps.raidElement,
});
const pendingBlasts: MobCombatDependencies['pendingBlasts'] = [];
const pendingHits: MobCombatDependencies['pendingHits'] = [];
const { arrows, hasLOS, shootArrow, updateArrows } = createArrowSystem({
  scene, player, mobs, getBlock: get, solid, collides,
  hasHealth: deps.hasHealth,
  damagePlayer: deps.damagePlayer, damageMob,
  playSound: deps.playSound,
  playSoundAt: deps.playSoundAt,
});
const stepMobActors = createMobSimulation({
  mobs, player, kinds: KINDS, raid, hostileActors, defenders,
  getDifficulty: deps.getDifficulty,
  isDaylight: deps.isDaylight, isNight: deps.isNight, getRainLevel: deps.getRainLevel,
  canTakeDamage: deps.hasHealth,
  removeMobAt, damagePlayer: deps.damagePlayer, showHint: deps.showHint,
  playSoundAt: deps.playSoundAt,
  hasLineOfSight: hasLOS, shootArrow,
  moveEntity: deps.moveEntity, pendingHits, pendingBlasts,
});
const { updateMobs } = createMobWorldCycle({
  mobs, player, kinds: KINDS, hostileActors, defenders, pendingHits, pendingBlasts,
  getDifficulty: deps.getDifficulty, getDimension: deps.getDimension,
  isDragonDefeated: deps.isDragonDefeated,
  hasHealth: deps.hasHealth, isNight: deps.isNight, getWeather: deps.getWeather,
  addMob, trySpawnMob, trySpawnAnimals, manageVillagers, trySpawnPatrol, updateRaid,
  stepMobActors,
  setActiveIndexes: indexes => { activeMobIndexes = indexes; },
  damageMob, explode: (x, y, z, radius, power) => explode(x, y, z, radius, power),
  showHint: (message, ms) => deps.showHint(message, ms),
});

const rayDir = new THREE.Vector3();
function raycastMobs(maxDistance: number) {
  camera.getWorldDirection(rayDir);
  return raycastActors(mobs, camera.position, rayDir, maxDistance);
}
function killMob(m: SpawnMob): void {
  const i = mobs.indexOf(m);
  if (i >= 0) removeMobAt(i);
  if (m.kind === 'enderdragon') {
    deps.setDragonDefeated(true);
    deps.showHint('THE ENDER DRAGON IS DEFEATED! You conquered the End!', 8000);
    deps.playSoundAt('explode', m.x, m.y, m.z);
    if (deps.getMode() === 'survival') deps.giveItem(deps.diamondItem, 5);
    return;
  }
  deps.playSoundAt('die', m.x, m.y + 0.5, m.z);
  if (m.leader && deps.hasHealth() && !deps.getOmen() && deps.getDifficulty().cap > 0) { deps.setOmen(true); deps.showHint('You feel an ominous presence... Enter a village and a raid will follow.', 5500); }
  if (deps.getMode() === 'survival') {
    const got: string[] = [];
    const blueprint = KINDS[m.kind as MobKind] as unknown as MobBlueprint;
    blueprint.drops().forEach(d => { if (d[1] > 0) { deps.giveItem(d[0], d[1]); got.push('+' + d[1] + ' ' + deps.names[d[0]]); } });
    if (got.length) deps.flashName(got.join('   '));
  }
}
function damageMob(m: SpawnMob, dmg: number): boolean {
  m.hp -= dmg;
  if (!m.hostile) m.panic = 3.5;
  if (m.hp <= 0) { killMob(m); return true; }
  return false;
}
function attackMob(m: SpawnMob): void {
  if (m.golem) { deps.flashName('That golem is on your side'); return; }
  const dx = m.x - player.x, dz = m.z - player.z, d = Math.hypot(dx, dz) || 1;
  m.vx += dx / d * 9; m.vz += dz / d * 9; m.vy = 5;
  deps.playSoundAt('hit', m.x, m.y + 0.8, m.z);
  damageMob(m, deps.attackDamage());
}


const { blasts, fx, rebuildSet, spawnTnt, addDynamite, removeBlastAt, removeFxAt,
  queueRebuild, flushRebuilds, explode, updateBlasts, updateFx } = createExplosionSystem({
  scene, texture: deps.texture, tntId: deps.tntId, torchId: deps.torchBlock, worldHeight: deps.worldHeight,
  breakTimes: deps.breakTimes, blockGeometry: deps.blockGeometry,
  getBlock: get, setBlock: deps.setBlock, hasChunk: (x, z) => !!chunkAt(x, z), buildChunk: deps.buildChunk,
  getMobs: () => mobs, getPlayer: () => player,
  damageMob: (mob, damage) => { damageMob(mob as SpawnMob, damage); },
  damagePlayer: damage => deps.damagePlayer(damage, false),
  moveEntity: deps.moveEntity, collides,
  playSound: deps.playSoundAt,
  increaseShake: deps.increaseShake,
});

const { RELIC_COUNT, relics, addRelic, clearRelics, createRelics,
  updateRelics, checkRelics, objectiveText, setMode: syncRelicVisibility } = createRelicSystem({
  scene, getMode: deps.getMode, getPlayer: () => player,
  getOrGenerateChunk: deps.getOrGenerateChunk, topBlockY: deps.topY, getBlock: get,
  inStructureZone: deps.inStructureZone, grassBlock: deps.grassBlock, sandBlock: deps.sandBlock,
  showHint: deps.showHint,
});


  return { mobs, KINDS, ANIMALS, addMob, removeMobAt, clearMobs, updateMobs, raycastMobs,
    attackMob, damageMob, arrows, blasts, fx, queueRebuild, flushRebuilds,
    rebuildSet, spawnTnt, addDynamite, removeBlastAt, removeFxAt,
    explode, updateBlasts, updateArrows, updateFx,
    RELIC_COUNT, relics, addRelic, clearRelics, createRelics, updateRelics, checkRelics,
    objectiveText, syncRelicVisibility };
}
