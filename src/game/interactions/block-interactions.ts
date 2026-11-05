import * as THREE from 'three';
import { findPortalFrame, type PortalFrame, type PortalDimension } from '../portals/frame';
import type { SpawnMob } from '../entities/mob-spawning';

export interface BlockPosition { x: number; y: number; z: number }
export interface BlockTarget extends BlockPosition { nx: number; ny: number; nz: number }
type MobKindInfo = { r: number; h: number; hp: number; hostile?: boolean };

export interface BlockInteractionDependencies {
  camera: THREE.Camera;
  player: { x: number; y: number; z: number; yaw: number; vx: number; vz: number };
  mobs: SpawnMob[];
  portals: PortalFrame[];
  hotbar: number[];
  inventory: Record<number, number>;
  names: Readonly<Record<number, string>>;
  tools: Readonly<Record<number, { kind: string; tier: number }>>;
  kinds: Readonly<Record<string, MobKindInfo>>;
  jobs: readonly string[];
  food: Readonly<Record<number, number>>;
  drops: Readonly<Record<number, number>>;
  requiresPick: Readonly<Record<number, number>>;
  eggKinds: Readonly<Record<number, string>>;
  bedDirections: readonly (readonly number[])[];
  worldHeight: number;
  playerRadius: number;
  playerHeight: number;
  bedHeight: number;
  blockIds: { BED: number; GRAVEL: number; GUNPOWDER: number; TORCH: number; TNT: number;
    FLINT: number; DYNAMITE: number; OBSIDIAN: number; HAY: number;
    IRON_INGOT: number; COPPER_INGOT: number; DIAMOND: number };
  getSelected: () => number;
  getTarget: () => BlockTarget | null;
  getMode: () => string;
  getDimension: () => PortalDimension | 'end';
  getDifficultyCap: () => number;
  getHunger: () => number;
  setHunger: (value: number) => void;
  getSatiety: () => number;
  setSatiety: (value: number) => void;
  isNight: () => boolean;
  getWeather: () => string;
  hasHealth: () => boolean;
  setSpawnPoint: (point: BlockPosition) => void;
  startSleeping: () => void;
  getBlock: (x: number, y: number, z: number) => number;
  setBlock: (x: number, y: number, z: number, id: number) => void;
  inBounds: (x: number, y: number, z: number) => boolean;
  hasChunk: (cx: number, cz: number) => boolean;
  solid: (id: number) => boolean;
  isBed: (id: number) => boolean;
  collides: (x: number, y: number, z: number, radius?: number, height?: number) => boolean;
  heldTool: () => { id: number; kind: string; tier: number } | null;
  canCollect: (block: number) => boolean;
  wearTool: (id: number, wear: number) => void;
  spendItem: (id: number) => boolean;
  exert: (amount: number) => void;
  giveItem: (id: number, amount: number) => void;
  updateHotbar: (withSound?: boolean) => void;
  renderFood: () => void;
  showHint: (message: string, ms: number) => void;
  flashName: (message: string) => void;
  playSound: (event: string, volume?: number, pitch?: number, blockId?: number) => void;
  playSoundAt: (event: string, x: number, y: number, z: number) => void;
  refreshAround: (x: number, z: number, torches?: boolean) => void;
  queueRebuild: (x: number, z: number) => void;
  flushRebuilds: () => void;
  rebuildRegion: (x1: number, z1: number, x2: number, z2: number) => void;
  ensureAround: (x: number, z: number) => void;
  showPortalVisual: (portal: PortalFrame) => void;
  saveWorld: () => void;
  spawnTnt: (x: number, y: number, z: number, fuse: number, vx: number, vy: number, vz: number) => void;
  addDynamite: (x: number, y: number, z: number, vx: number, vy: number, vz: number) => void;
  addMob: (kind: string, x: number, y: number, z: number, options?: { job?: string } | null) => SpawnMob;
}

/** World interaction and item use; all live state crosses an explicit boundary. */
export function createBlockInteractions(deps: BlockInteractionDependencies) {
  const { camera, player, mobs, portals, hotbar, inventory: inv } = deps;
  const { names: NAMES, tools: TOOLS, kinds: KINDS, jobs: JOBS,
    food: FOOD, drops: DROPS, requiresPick: NEEDS_PICK, eggKinds: EGG_KINDS,
    bedDirections: BED_DIR } = deps;
  const { worldHeight: WORLD_HEIGHT, playerRadius: PLAYER_RADIUS,
    playerHeight: PLAYER_HEIGHT, bedHeight: BED_H } = deps;
  const { BED, GRAVEL, GUNPOWDER, TORCH, TNT, FLINT, DYNAMITE, OBSIDIAN,
    HAY, IRON_INGOT, COPPER_INGOT, DIAMOND } = deps.blockIds;
  const get = deps.getBlock, setBlock = deps.setBlock, inBounds = deps.inBounds;
  const solid = deps.solid, isBed = deps.isBed, chunkAt = deps.hasChunk;
  const collides = deps.collides, hasHealth = deps.hasHealth;
  const heldTool = deps.heldTool, canCollect = deps.canCollect, wearTool = deps.wearTool;
  const spendItem = deps.spendItem, exert = deps.exert, giveItem = deps.giveItem;
  const updateHotbar = deps.updateHotbar, renderFood = deps.renderFood;
  const showHint = deps.showHint, flashName = deps.flashName;
  const sfx = deps.playSound, sfxAt = deps.playSoundAt;
  const refreshAround = deps.refreshAround, queueRebuild = deps.queueRebuild;
  const flushRebuilds = deps.flushRebuilds, rebuildRegion = deps.rebuildRegion;
  const ensureAround = deps.ensureAround, showPortalVisual = deps.showPortalVisual;
  const saveWorld = deps.saveWorld, spawnTnt = deps.spawnTnt;
  const addDynamite = deps.addDynamite, addMob = deps.addMob;

function doBreak(t: BlockPosition): void {
  const b = get(t.x, t.y, t.z);
  if (deps.getMode() === 'survival') {
    exert(0.02);
    if (canCollect(b)) { const drop = isBed(b) ? BED : (DROPS[b] || b); inv[drop] = (inv[drop] || 0) + 1; updateHotbar(false); }
    else flashName('You need a ' + (NEEDS_PICK[b] > 0 ? 'stronger ' : '') + 'pickaxe to collect this');
    const ht = heldTool();
    if (ht) wearTool(ht.id, ht.kind === 'sword' ? 2 : 1);
  }
  if (deps.getMode() === 'survival' && b === GRAVEL && Math.random() < 0.3) { giveItem(GUNPOWDER, 1); flashName('+1 Gunpowder'); }
  setBlock(t.x, t.y, t.z, 0);
  if (isBed(b)) {   // take the other half of the bed with it
    const k = b - 19, dv = BED_DIR[k >> 1], head = k & 1, sg = head ? -1 : 1;
    const px = t.x + dv[0] * sg, pz = t.z + dv[1] * sg, pid = 19 + (k >> 1) * 2 + (1 - head);
    if (get(px, t.y, pz) === pid) { setBlock(px, t.y, pz, 0); refreshAround(px, pz); }
  }
  sfx('break', 1, 0, b);
  let torchGone = b === TORCH;
  if (get(t.x, t.y + 1, t.z) === TORCH) { setBlock(t.x, t.y + 1, t.z, 0); torchGone = true; if (deps.getMode() === 'survival') giveItem(TORCH, 1); }
  refreshAround(t.x, t.z, torchGone);
}
function eatItem(id: number): number {
  if (deps.getMode() !== 'survival') { flashName('Food only matters in Survival'); return 0.4; }
  if (deps.getHunger() >= 20) { showHint('You are not hungry.', 1200); return 0.4; }
  if (!spendItem(id)) return 0.4;
  const hunger = Math.min(20, deps.getHunger() + FOOD[id]);
  deps.setHunger(hunger);
  deps.setSatiety(Math.min(hunger, deps.getSatiety() + FOOD[id] * 0.6)); renderFood(); sfx('eat');
  return 0.8;
}
function throwDynamite(): number {
  if (!spendItem(DYNAMITE)) return 0.4;
  sfx('throw');
  const d = new THREE.Vector3(); camera.getWorldDirection(d);
  addDynamite(camera.position.x + d.x * 0.6, camera.position.y + d.y * 0.6 - 0.1, camera.position.z + d.z * 0.6,
    d.x * 14 + player.vx * 0.3, d.y * 14 + 2.5, d.z * 14 + player.vz * 0.3);
  return 0.5;
}
function lightPortalAt(px: number, py: number, pz: number): boolean {
  const dimension = deps.getDimension();
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
function activatePortalAtTarget(): boolean {
  const target = deps.getTarget();
  return !!target && get(target.x, target.y, target.z) === OBSIDIAN &&
    lightPortalAt(target.x, target.y, target.z);
}
function lightTnt(): number {
  const target = deps.getTarget();
  if (deps.getMode() === 'survival' && !(inv[FLINT] > 0)) { showHint('You have no flint & steel.', 1500); return 0.3; }
  if (activatePortalAtTarget()) return 0.3;
  if (!target || get(target.x, target.y, target.z) !== TNT) {
    flashName('Aim flint & steel at a complete obsidian frame or TNT'); return 0.3;
  }
  setBlock(target.x, target.y, target.z, 0); queueRebuild(target.x, target.z); flushRebuilds();
  spawnTnt(target.x + 0.5, target.y, target.z + 0.5, 3, 0, 0, 0);
  return 0.4;
}
function useEgg(id: number): number {
  const target = deps.getTarget();
  const kind = EGG_KINDS[id], K = KINDS[kind];
  if (K.hostile && hasHealth() && deps.getDifficultyCap() === 0) { flashName('Monsters cannot spawn on Peaceful'); return 0.4; }
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
function useBed(t: BlockPosition): void {
  deps.setSpawnPoint({ x: t.x, y: t.y, z: t.z });
  if (!deps.isNight() && deps.getWeather() !== 'storm') { showHint('Respawn point set. You can only sleep at night or in a storm.', 2800); sfx('click'); return; }
  if (hasHealth()) for (let i = 0; i < mobs.length; i++) if (mobs[i].hostile && Math.hypot(mobs[i].x - t.x, mobs[i].z - t.z) < 14) { showHint('You cannot sleep with monsters nearby.', 2600); sfx('no'); return; }
  deps.startSleeping();
  showHint('Respawn point set. Sleeping\u2026', 2000);
}
// Right click / E: place a block, or use the item in the selected slot. Returns the cooldown to wait.
function useSelected(): number {
  const it = hotbar[deps.getSelected()];
  if (!it) return 0.22;
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
const GOLEM_OF: Record<number, string> = { 31: 'irongolem', 32: 'coppergolem', 33: 'diamondgolem' };
const GOLEM_INGOT: Record<string, number> = { irongolem: IRON_INGOT, coppergolem: COPPER_INGOT, diamondgolem: DIAMOND };
function spawnGolem(kind: string, x: number, y: number, z: number): SpawnMob {
  const m = addMob(kind, x, y, z, null);
  m.persist = true; m.hx = x; m.hz = z;
  sfx('pop'); sfxAt('hit', x, y + 1, z);
  return m;
}
function tryBuildGolem(px: number, py: number, pz: number): boolean {
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
function healGolem(m: SpawnMob): boolean {
  const ing = GOLEM_INGOT[m.kind], K = KINDS[m.kind];
  if (hotbar[deps.getSelected()] !== ing || m.hp >= K.hp) return false;
  if (!spendItem(ing)) return false;
  m.hp = Math.min(K.hp, m.hp + K.hp * 0.25); sfx('pop'); flashName('Golem repaired');
  return true;
}
function placeBed(x: number, y: number, z: number): void {
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  const dir = Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 0 : 2) : (fz > 0 ? 1 : 3);
  const dv = BED_DIR[dir], hx = x + dv[0], hz = z + dv[1];
  if (!chunkAt(hx >> 4, hz >> 4) || get(hx, y, hz) || !solid(get(x, y - 1, z)) || !solid(get(hx, y - 1, hz))) { flashName('A bed needs two free spots on solid ground'); return; }
  const cells = [[x, z], [hx, hz]];
  for (let i = 0; i < 2; i++) { const c = cells[i]; if (c[0] + 1 > player.x - PLAYER_RADIUS && c[0] < player.x + PLAYER_RADIUS && y + BED_H > player.y && y < player.y + PLAYER_HEIGHT && c[1] + 1 > player.z - PLAYER_RADIUS && c[1] < player.z + PLAYER_RADIUS) return; }
  if (deps.getMode() === 'survival') {
    if (!(inv[BED] > 0)) { showHint('You have no bed.', 1500); return; }
    inv[BED]--; updateHotbar(false);
  }
  setBlock(x, y, z, 19 + dir * 2); setBlock(hx, y, hz, 19 + dir * 2 + 1);
  sfx('place', 1, 0, BED); refreshAround(x, z); refreshAround(hx, hz);
}
function detectObsidianPortal(px: number, py: number, pz: number): boolean {
  return lightPortalAt(px, py, pz);
}

function doPlace(): void {
  if (!hotbar[deps.getSelected()]) return;
  const target = deps.getTarget();
  if (!target) return;
  const x = target.x + target.nx, y = target.y + target.ny, z = target.z + target.nz;
  if (!inBounds(x, y, z) || get(x, y, z)) return;
  if (hotbar[deps.getSelected()] === BED) { placeBed(x, y, z); return; }
  if (hotbar[deps.getSelected()] !== TORCH && x + 1 > player.x - PLAYER_RADIUS && x < player.x + PLAYER_RADIUS && y + 1 > player.y && y < player.y + PLAYER_HEIGHT && z + 1 > player.z - PLAYER_RADIUS && z < player.z + PLAYER_RADIUS) return;
  const b = hotbar[deps.getSelected()];
  if (b === TORCH && !solid(get(x, y - 1, z))) { flashName('Torches need something to stand on'); return; }
  if (deps.getMode() === 'survival') {
    if (!(inv[b] > 0)) { showHint('You have no ' + NAMES[b].toLowerCase() + '. Mine some first.', 1800); return; }
    inv[b]--; updateHotbar(false);
  }
  setBlock(x, y, z, b);
  if (b === OBSIDIAN) detectObsidianPortal(x, y, z);
  sfx('place', 1, 0, b);
  refreshAround(x, z, b === TORCH);
  if (b === HAY || GOLEM_OF[b]) tryBuildGolem(x, y, z);
}


  return { doBreak, eatItem, throwDynamite, lightPortalAt, lightTnt, useEgg,
    useBed, useSelected, tryBuildGolem, healGolem, placeBed, doPlace };
}
