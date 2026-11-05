import { hash2 } from '../world/noise';
import type { MobActor } from './mob-simulation';
import type { GeneratedStructure } from '../world/structure-regions';

export type SpawnStructure = GeneratedStructure & { vSpawned?: boolean };
export type SpawnMob = MobActor & { leader?: boolean; job?: string };

export interface RaidDifficulty { cap: number; raid: number; }
export interface MobSpawnDependencies {
  mobs: SpawnMob[];
  player: { x: number; z: number };
  kinds: Readonly<Record<string, { r: number; h: number; hostile?: boolean; illager?: boolean }>>;
  animals: readonly string[];
  jobs: readonly string[];
  regionSize: number;
  grassBlock: number;
  leavesBlock: number;
  woodBlock: number;
  torchBlock: number;
  emeraldItem: number;
  getSeed: () => number;
  getChunk: (cx: number, cz: number) => unknown;
  getBlock: (x: number, y: number, z: number) => number;
  topY: (x: number, z: number) => number;
  solid: (block: number) => boolean;
  collides: (x: number, y: number, z: number, radius?: number, height?: number) => boolean;
  getStructure: (rx: number, rz: number) => SpawnStructure | null;
  addMob: (kind: string, x: number, y: number, z: number, options?: { job?: string; leader?: boolean } | null) => SpawnMob;
  getOmen: () => boolean;
  setOmen: (value: boolean) => void;
  isDead: () => boolean;
  hasHealth: () => boolean;
  getMode: () => string;
  giveItem: (id: number, count: number) => void;
  showHint: (message: string, ms: number) => void;
  playSound: (event: string) => void;
  raidElement: { style: { display: string }; textContent: string | null };
}

/** Owns natural mob spawning, village population, patrols and the raid lifecycle. */
export function createMobSpawning(deps: MobSpawnDependencies) {
  const { mobs, player, animals: ANIMALS, jobs: JOBS, kinds: KINDS } = deps;
  const { grassBlock: GRASS, leavesBlock: LEAVES, woodBlock: WOOD,
    torchBlock: TORCH, emeraldItem: EMERALD, regionSize: STRUCTURE_REGION_SIZE } = deps;
  const get = deps.getBlock, topY = deps.topY, collides = deps.collides;
  const chunkAt = deps.getChunk, solid = deps.solid;
  const addMob = deps.addMob, structureFor = deps.getStructure;
  const hasHealth = deps.hasHealth, showHint = deps.showHint;
  const sfx = deps.playSound, giveItem = deps.giveItem;

function nearTorch(x: number, y: number, z: number, rad: number): boolean {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  for (let dy = -3; dy <= 4; dy++) for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) if (get(bx + dx, by + dy, bz + dz) === TORCH) return true;
  return false;
}
function trySpawnMob(): void {
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
function trySpawnAnimals(): void {
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

function spawnVillagers(st: SpawnStructure): void {
  st.vSpawned = true;
  const n = 3 + Math.floor(hash2(st.rx, st.rz, deps.getSeed() + 900) * 3), off = Math.floor(hash2(st.rx, st.rz, deps.getSeed() + 901) * JOBS.length);
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
function manageVillagers(): void {
  const prx = Math.floor(player.x / STRUCTURE_REGION_SIZE), prz = Math.floor(player.z / STRUCTURE_REGION_SIZE);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const st = structureFor(prx + dx, prz + dz);
    if (!st || st.type !== 'village') continue;
    if (Math.hypot(st.cx - player.x, st.cz - player.z) < 70 && !st.vSpawned) spawnVillagers(st);
  }
}
// Pillager patrols wander in from afar. Killing the banner-carrying leader brings a Bad Omen:
// the next village you enter is raided in three waves.
function trySpawnPatrol(): void {
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
const raid: { active: boolean; st: SpawnStructure | null; wave: number; cd: number } = { active: false, st: null, wave: 0, cd: 0 };
const RAID_WAVES = [[3, 0], [4, 1], [5, 2]];   // [pillagers, vindicators] on Normal
const raidEl = deps.raidElement;
function endRaid(msg: string | null): void {
  const was = raid.active;
  raid.active = false; raid.st = null; raid.wave = 0;
  mobs.forEach(function (m) { m.raid = false; });
  raidEl.style.display = 'none';
  if (msg && was) showHint(msg, 4000);
}
function spawnRaiders(n: number, kind: string): void {
  const st = raid.st, K = KINDS[kind];
  if (!st) return;
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
function updateRaid(dt: number, D: RaidDifficulty): void {
  if (!raid.active) {
    raidEl.style.display = 'none';
    if (deps.getOmen() && hasHealth() && D.cap > 0 && !deps.isDead()) {
      const prx = Math.floor(player.x / STRUCTURE_REGION_SIZE), prz = Math.floor(player.z / STRUCTURE_REGION_SIZE);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const st = structureFor(prx + dx, prz + dz);
        if (st && st.type === 'village' && Math.hypot(st.cx - player.x, st.cz - player.z) < 30) {
          raid.active = true; raid.st = st; raid.wave = 0; raid.cd = 5; deps.setOmen(false);
          showHint('A raid is coming to the village! Defend it.', 4500); sfx('pillager');
          return;
        }
      }
    }
    return;
  }
  if (!raid.st || deps.isDead() || !hasHealth() || D.cap === 0 || Math.hypot(raid.st.cx - player.x, raid.st.cz - player.z) > 110) { endRaid('The raid has ended.'); return; }
  let alive = 0;
  for (let i = 0; i < mobs.length; i++) if (mobs[i].raid) alive++;
  raidEl.style.display = 'block';
  if (alive === 0) {
    raidEl.textContent = raid.wave >= RAID_WAVES.length ? 'Raid \u00b7 victory!' : 'Raid \u00b7 next wave incoming';
    raid.cd -= dt;
    if (raid.cd <= 0) {
      if (raid.wave >= RAID_WAVES.length) {
        endRaid(null);
        if (deps.getMode() === 'survival') giveItem(EMERALD, 8);
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

  return { raid, endRaid, trySpawnMob, trySpawnAnimals, manageVillagers, trySpawnPatrol, updateRaid };
}
