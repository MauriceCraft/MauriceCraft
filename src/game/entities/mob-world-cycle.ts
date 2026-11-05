import { SpatialIndex } from './spatial-index';
import type { MobActor } from './mob-simulation';

export interface MobWorldDifficulty {
  cap: number;
  every: number;
  patrol: readonly [number, number];
  raid: number;
}

export interface MobWorldCycleDeps<T extends MobActor> {
  mobs: T[];
  player: { x: number; y: number; z: number };
  kinds: Readonly<Record<string, { illager?: boolean }>>;
  hostileActors: SpatialIndex<T>;
  defenders: SpatialIndex<T>;
  pendingHits: Array<{ m: T; d: number }>;
  pendingBlasts: Array<{ x: number; y: number; z: number; r: number; p: number }>;
  getDifficulty: () => MobWorldDifficulty;
  getDimension: () => string;
  isDragonDefeated: () => boolean;
  hasHealth: () => boolean;
  isNight: () => boolean;
  getWeather: () => string;
  addMob: (kind: string, x: number, y: number, z: number, opts?: { boss?: boolean } | null) => T;
  trySpawnMob: () => void;
  trySpawnAnimals: () => void;
  manageVillagers: () => void;
  trySpawnPatrol: () => void;
  updateRaid: (dt: number, difficulty: MobWorldDifficulty) => void;
  stepMobActors: (dt: number) => void;
  setActiveIndexes: (indexes: { hostiles: SpatialIndex<T>; defenders: SpatialIndex<T> } | null) => void;
  damageMob: (mob: T, amount: number) => void;
  explode: (x: number, y: number, z: number, radius: number, power: number) => void;
  showHint: (message: string, ms: number) => void;
  random?: () => number;
}

/** Manage population budgets and a single spatial-index rebuild per game frame. */
export function createMobWorldCycle<T extends MobActor>(deps: MobWorldCycleDeps<T>) {
  const { mobs, player, kinds: KINDS, hostileActors, defenders,
    pendingHits, pendingBlasts, addMob, trySpawnMob, trySpawnAnimals,
    manageVillagers, trySpawnPatrol, updateRaid, stepMobActors } = deps;
  const random = deps.random ?? Math.random;
  let spawnT = 2, animalT = 0.5, villT = 0.2, patrolT = 70;

function updateMobs(dt: number): void {
  const D = deps.getDifficulty();
  if (deps.getDimension() === 'end') {
    if (!deps.isDragonDefeated() && !mobs.some(function (m) { return m.kind === 'enderdragon'; })) {
      addMob('enderdragon', player.x + 8, Math.max(28, player.y + 8), player.z + 1, { boss: true });
      deps.showHint('ENDER DRAGON! Hit it with your sword or shoot it with arrows!', 5500);
    }
    spawnT = Math.max(spawnT, 2); animalT = Math.max(animalT, 2); villT = Math.max(villT, 2);
  }
  spawnT -= dt; animalT -= dt; villT -= dt;
  if (deps.getDimension() !== 'end' && deps.hasHealth() && spawnT <= 0) {
    spawnT = D.every;
    if (D.cap > 0 && (deps.isNight() || deps.getWeather() === 'storm') && mobs.filter(function (m) { return m.hostile && !KINDS[m.kind].illager; }).length < D.cap) trySpawnMob();
  }
  if (deps.getDimension() !== 'end' && animalT <= 0) {
    animalT = 2.5;
    if (!deps.isNight() && mobs.filter(function (m) { return !m.hostile && m.kind !== 'villager'; }).length < 12) trySpawnAnimals();
  }
  if (deps.getDimension() !== 'end' && villT <= 0) { villT = 1.5; manageVillagers(); }
  patrolT -= dt;
  if (deps.getDimension() !== 'end' && patrolT <= 0) {
    patrolT = D.patrol[0] + random() * (D.patrol[1] - D.patrol[0]);
    if (hasHealth() && D.cap > 0 && mobs.filter(function (m) { return KINDS[m.kind].illager && !m.raid; }).length < 6) trySpawnPatrol();
  }
  if (deps.getDimension() !== 'end') updateRaid(dt, D);
  // Index mobs once per frame instead of searching everyone for every AI actor.
  hostileActors.clear();
  defenders.clear();
  for (const mob of mobs) {
    if (mob.hostile) hostileActors.upsert(mob);
    if (mob.kind === 'villager' || mob.golem) defenders.upsert(mob);
  }
  deps.setActiveIndexes({ hostiles: hostileActors, defenders });
  stepMobActors(dt);
  while (pendingHits.length) { const ph = pendingHits.pop(); if (mobs.indexOf(ph.m) >= 0) deps.damageMob(ph.m, ph.d); }
  while (pendingBlasts.length) { const pb = pendingBlasts.pop(); deps.explode(pb.x, pb.y, pb.z, pb.r, pb.p); }
  deps.setActiveIndexes(null);
}


  return { updateMobs };
}
