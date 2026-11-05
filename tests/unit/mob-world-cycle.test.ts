import { describe, expect, it, vi } from 'vitest';
import { SpatialIndex } from '../../src/game/entities/spatial-index';
import type { MobActor } from '../../src/game/entities/mob-simulation';
import { createMobWorldCycle, type MobWorldCycleDeps } from '../../src/game/entities/mob-world-cycle';

function fixture() {
  const mobs: MobActor[] = [];
  const hostileActors = new SpatialIndex<MobActor>(16);
  const defenders = new SpatialIndex<MobActor>(16);
  const pendingHits: Array<{ m: MobActor; d: number }> = [];
  const pendingBlasts: Array<{ x: number; y: number; z: number; r: number; p: number }> = [];
  const trySpawnMob = vi.fn(), trySpawnAnimals = vi.fn(), manageVillagers = vi.fn();
  const trySpawnPatrol = vi.fn(), updateRaid = vi.fn(), stepMobActors = vi.fn();
  const setActiveIndexes = vi.fn();
  const damageMob = vi.fn(), explode = vi.fn(), showHint = vi.fn(), addMob = vi.fn();
  let dimension = 'overworld', night = false, health = true, dragonDefeated = false, mobCap = 8;
  const deps: MobWorldCycleDeps<MobActor> = {
    mobs, player: { x: 0, y: 15, z: 0 }, kinds: { zombie: {}, villager: {}, pillager: { illager: true } },
    hostileActors, defenders, pendingHits, pendingBlasts,
    getDifficulty: () => ({ cap: mobCap, every: 2, patrol: [90, 160], raid: 1 }),
    getDimension: () => dimension, isDragonDefeated: () => dragonDefeated,
    hasHealth: () => health, isNight: () => night, getWeather: () => 'clear',
    addMob, trySpawnMob, trySpawnAnimals, manageVillagers, trySpawnPatrol, updateRaid,
    stepMobActors, setActiveIndexes, damageMob, explode, showHint,
    random: () => 0,
  };
  const { updateMobs, resetSpawnTimers } = createMobWorldCycle(deps);
  return { mobs, hostileActors, defenders, pendingHits, pendingBlasts,
    updateMobs, resetSpawnTimers, trySpawnMob, trySpawnAnimals, manageVillagers,
    trySpawnPatrol, updateRaid, stepMobActors, setActiveIndexes, damageMob, explode, addMob,
    setDimension: (v: string) => { dimension = v; }, setNight: (v: boolean) => { night = v; },
    setHealth: (v: boolean) => { health = v; }, setMobCap: (v: number) => { mobCap = v; },
    setDragonDefeated: (v: boolean) => { dragonDefeated = v; } };
}

describe('mob world population cycle', () => {
  it('checks for cave spawns in daylight and still manages animals and villagers', () => {
    const f = fixture();
    f.updateMobs(2.1);
    expect(f.trySpawnMob).toHaveBeenCalledOnce();
    expect(f.trySpawnAnimals).toHaveBeenCalledTimes(1);
    expect(f.manageVillagers).toHaveBeenCalledTimes(1);
    expect(f.updateRaid).toHaveBeenCalledTimes(1);
  });

  it('spawns nighttime monsters only when health mode is enabled', () => {
    const f = fixture();
    f.setNight(true);
    f.updateMobs(2.1);
    expect(f.trySpawnMob).toHaveBeenCalledOnce();
    expect(f.trySpawnAnimals).not.toHaveBeenCalled();
    f.setHealth(false);
    f.updateMobs(2.1);
    expect(f.trySpawnMob).toHaveBeenCalledOnce();
  });

  it('holds off overworld spawning and creates one dragon while in the End', () => {
    const f = fixture();
    f.setDimension('end');
    f.updateMobs(100);
    expect(f.addMob).toHaveBeenCalledTimes(1);
    expect(f.addMob).toHaveBeenCalledWith('enderdragon', 8, 28, 1, { boss: true });
    expect(f.trySpawnMob).not.toHaveBeenCalled();
    expect(f.trySpawnAnimals).not.toHaveBeenCalled();
    expect(f.updateRaid).not.toHaveBeenCalled();
  });

  it('waits ten active minutes before a patrol and then uses the difficulty interval', () => {
    const f = fixture();
    f.updateMobs(599);
    expect(f.trySpawnPatrol).not.toHaveBeenCalled();
    f.updateMobs(1);
    expect(f.trySpawnPatrol).toHaveBeenCalledTimes(1);
    f.updateMobs(89);
    expect(f.trySpawnPatrol).toHaveBeenCalledTimes(1);
    f.updateMobs(1);
    expect(f.trySpawnPatrol).toHaveBeenCalledTimes(2);
  });

  it('restarts the patrol grace period after switching worlds', () => {
    const f = fixture();
    f.updateMobs(600);
    expect(f.trySpawnPatrol).toHaveBeenCalledTimes(1);
    f.resetSpawnTimers();
    f.updateMobs(599);
    expect(f.trySpawnPatrol).toHaveBeenCalledTimes(1);
    f.updateMobs(1);
    expect(f.trySpawnPatrol).toHaveBeenCalledTimes(2);
  });

  it('does not count time spent in the Nether towards Overworld patrols', () => {
    const f = fixture();
    f.setDimension('nether');
    f.updateMobs(1200);
    expect(f.trySpawnPatrol).not.toHaveBeenCalled();
    f.setDimension('overworld');
    f.updateMobs(599);
    expect(f.trySpawnPatrol).not.toHaveBeenCalled();
    f.updateMobs(1);
    expect(f.trySpawnPatrol).toHaveBeenCalledTimes(1);
  });

  it('prevents patrols on Peaceful difficulty', () => {
    const f = fixture();
    f.setMobCap(0);
    f.updateMobs(600);
    expect(f.trySpawnPatrol).not.toHaveBeenCalled();
  });

  it('rebuilds indexes and drains hits before explosions, clearing active indexes', () => {
    const f = fixture();
    const zombie = { kind: 'zombie', x: 2, z: -3, hostile: true, golem: false } as MobActor;
    const villager = { kind: 'villager', x: 4, z: 5, hostile: false, golem: false } as MobActor;
    f.mobs.push(zombie, villager);
    f.pendingHits.push({ m: villager, d: 2 });
    f.pendingBlasts.push({ x: 1, y: 2, z: 3, r: 4, p: 5 });
    f.updateMobs(0.1);
    expect(f.hostileActors.size).toBe(1);
    expect(f.defenders.size).toBe(1);
    expect(f.damageMob).toHaveBeenCalledWith(villager, 2);
    expect(f.explode).toHaveBeenCalledWith(1, 2, 3, 4, 5);
    expect(f.pendingHits).toHaveLength(0);
    expect(f.pendingBlasts).toHaveLength(0);
    expect(f.setActiveIndexes).toHaveBeenLastCalledWith(null);
  });
});
