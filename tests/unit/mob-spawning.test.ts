import { describe, expect, it, vi } from 'vitest';
import { createMobSpawning, type MobSpawnDependencies, type SpawnMob, type SpawnStructure } from '../../src/game/entities/mob-spawning';

function fixture() {
  const mobs: SpawnMob[] = [];
  const player = { x: 25, z: 25 };
  const village: SpawnStructure = { type: 'village', cx: 25, cz: 25, gy: 14, rx: 0, rz: 0, pad: 20, blend: 8, reach: 22, zone: 30 };
  const raidElement = { style: { display: '' }, textContent: '' };
  let omen = false;
  let dead = false;
  let canTakeDamage = true;
  let chunksLoaded = true;
  let block = 1;
  let submerged = false;
  const showHint = vi.fn();
  const playSound = vi.fn();
  const giveItem = vi.fn();
  const addMob = vi.fn((kind: string, x: number, y: number, z: number): SpawnMob => {
    const mob = { kind, x, y, z, raid: false, village: null, hx: 0, hz: 0 } as SpawnMob;
    mobs.push(mob);
    return mob;
  });
  const deps: MobSpawnDependencies = {
    mobs, player,
    kinds: { zombie: { r: 0.3, h: 1.8, hostile: true }, creeper: { r: 0.3, h: 1.8, hostile: true },
      skeleton: { r: 0.3, h: 1.95, hostile: true }, spider: { r: 0.5, h: 0.8, hostile: true }, cow: { r: 0.45, h: 1.5 }, chicken: { r: 0.2, h: 0.8 },
      pig: { r: 0.4, h: 1 }, sheep: { r: 0.4, h: 1 }, villager: { r: 0.3, h: 1.95 },
      irongolem: { r: 0.45, h: 2.7 }, pillager: { r: 0.3, h: 1.95, hostile: true },
      vindicator: { r: 0.3, h: 1.95, hostile: true } },
    animals: ['cow', 'pig', 'sheep', 'chicken'], jobs: ['farmer', 'librarian'],
    regionSize: 80, grassBlock: 1, leavesBlock: 6, woodBlock: 5, torchBlock: 17, emeraldItem: 42,
    getSeed: () => 42,
    getChunk: () => chunksLoaded ? {} : null,
    getBlock: (_x, y) => y === 14 ? block : (submerged && y === 15 ? 34 : 0), topY: () => 14,
    solid: id => id !== 0,
    collides: () => false,
    getStructure: () => village,
    addMob, getOmen: () => omen, setOmen: value => { omen = value; },
    isDead: () => dead, hasHealth: () => canTakeDamage, getMode: () => 'survival',
    giveItem, showHint, playSound, raidElement,
  };
  const spawning = createMobSpawning(deps);
  return { mobs, spawning, village, raidElement, addMob, giveItem, showHint,
    setOmen: (value: boolean) => { omen = value; },
    hasOmen: () => omen,
    setDead: (value: boolean) => { dead = value; },
    setCanTakeDamage: (value: boolean) => { canTakeDamage = value; },
    setChunksLoaded: (value: boolean) => { chunksLoaded = value; },
    setBlock: (value: number) => { block = value; },
    setSubmerged: (value: boolean) => { submerged = value; } };
}

describe('mob spawning and raids', () => {
  it('never spawns creatures in unloaded world chunks', () => {
    const f = fixture();
    f.setChunksLoaded(false);
    f.spawning.trySpawnMob();
    f.spawning.trySpawnAnimals();
    f.spawning.trySpawnPatrol();
    expect(f.addMob).not.toHaveBeenCalled();
  });

  it('does not spawn cows on submerged grass or in liquid', () => {
    const f = fixture();
    f.setSubmerged(true);
    f.spawning.trySpawnAnimals();
    expect(f.addMob).not.toHaveBeenCalled();
    f.setSubmerged(false);
    f.spawning.trySpawnAnimals();
    expect(f.addMob).toHaveBeenCalled();
  });

  it('does not spawn natural monsters near a torch', () => {
    const f = fixture();
    f.setBlock(17);
    f.spawning.trySpawnMob();
    expect(f.addMob).not.toHaveBeenCalled();
  });

  it('populates a village only once and marks it spawned', () => {
    const f = fixture();
    f.spawning.manageVillagers();
    expect(f.village.vSpawned).toBe(true);
    expect(f.addMob).toHaveBeenCalled();
    const count = f.addMob.mock.calls.length;
    f.spawning.manageVillagers();
    expect(f.addMob).toHaveBeenCalledTimes(count);
  });

  it('uses an ominous presence to start a raid and resets it when ended', () => {
    const f = fixture();
    f.setOmen(true);
    f.spawning.updateRaid(0.1, { cap: 8, raid: 1 });
    expect(f.spawning.raid.active).toBe(true);
    expect(f.spawning.raid.st).toBe(f.village);
    expect(f.hasOmen()).toBe(false);
    f.spawning.endRaid('Raid ended');
    expect(f.spawning.raid.active).toBe(false);
    expect(f.raidElement.style.display).toBe('none');
    expect(f.showHint).toHaveBeenCalledWith('Raid ended', 4000);
  });

  it('disables raids on peaceful and rewards a successful final wave', () => {
    const f = fixture();
    f.setOmen(true);
    f.spawning.updateRaid(0.1, { cap: 0, raid: 0 });
    expect(f.spawning.raid.active).toBe(false);
    expect(f.hasOmen()).toBe(true);
    f.setOmen(false);
    f.spawning.raid.active = true;
    f.spawning.raid.st = f.village;
    f.spawning.raid.wave = 3;
    f.spawning.raid.cd = 0;
    f.spawning.updateRaid(0.1, { cap: 8, raid: 1 });
    expect(f.giveItem).toHaveBeenCalledWith(42, 8);
    expect(f.spawning.raid.active).toBe(false);
  });
});
