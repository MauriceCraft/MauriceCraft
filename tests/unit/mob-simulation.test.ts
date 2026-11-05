import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { SpatialIndex } from '../../src/game/entities/spatial-index';
import { createMobSimulation, type MobActor } from '../../src/game/entities/mob-simulation';

function makeActor(kind: string, hostile: boolean, x: number): MobActor {
  const group = new THREE.Group();
  group.userData.legs = [new THREE.Group(), new THREE.Group()];
  return {
    kind, hostile, golem: false, persist: false, r: 0.3, h: 1.8, x, y: 1, z: 0,
    vx: 0, vy: 0, vz: 0, onGround: false, hit: false, atk: 3, burn: -1, phase: 0,
    ai: 3, walk: false, dx: 0, dz: 1, panic: 0, face: 0, jumpCd: 0,
    fuse: -1, shoot: 4, snd: 4, hx: 0, hz: 0, group, village: null,
  };
}
function fixture(actors: MobActor[], options: { daylight?: boolean; water?: boolean; sheltered?: boolean } = {}) {
  const mobs = actors;
  const hostileActors = new SpatialIndex<MobActor>();
  const defenders = new SpatialIndex<MobActor>();
  const player = { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, onGround: true };
  const pendingHits: Array<{ m: MobActor; d: number }> = [];
  const pendingBlasts: Array<{ x: number; y: number; z: number; r: number; p: number }> = [];
  const damagePlayer = vi.fn();
  for (const mob of mobs) {
    if (mob.hostile) hostileActors.upsert(mob);
    if (mob.kind === 'villager') defenders.upsert(mob);
  }
  const tick = createMobSimulation({
    mobs, player,
    kinds: {
      zombie: { speed: 2, melee: { d: 1.15, dmg: 3, cd: 1.1 } },
      villager: { speed: 1 },
      creeper: { speed: 2 }, cow: { speed: 0.8 }, skeleton: { speed: 2 },
    },
    raid: { st: null }, hostileActors, defenders,
    getDifficulty: () => ({ cap: 8, dmg: 1, fuse: 1.5, speed: 1, aggro: 32, shoot: 1 }),
    isDaylight: () => Boolean(options.daylight), isNight: () => !options.daylight, getRainLevel: () => 0,
    isSunExposed: () => !options.sheltered, getBlock: () => options.water ? 34 : 0,
    canTakeDamage: () => true,
    removeMobAt: index => { mobs.splice(index, 1); },
    damagePlayer, showHint: () => undefined, playSoundAt: () => undefined,
    hasLineOfSight: () => true, shootArrow: () => undefined,
    moveEntity: (mob, axis, distance) => {
      if (axis === 0) mob.x += distance;
      if (axis === 1) mob.y += distance;
      if (axis === 2) mob.z += distance;
    },
    pendingHits, pendingBlasts,
  });
  return { tick, mobs, player, damagePlayer, pendingHits, pendingBlasts };
}
describe('mob simulation', () => {
  it('keeps animals afloat when swimming', () => {
    const cow = makeActor('cow', false, 2);
    const { tick } = fixture([cow], { water: true });
    tick(0.1);
    expect(cow.vy).toBeGreaterThan(0);
  });
  it('does not burn sheltered zombies or daylight creepers', () => {
    const zombie = makeActor('zombie', true, 5);
    const creeper = makeActor('creeper', true, 7);
    const { tick } = fixture([zombie, creeper], { daylight: true, sheltered: true });
    tick(0.1);
    expect(zombie.burn).toBe(-1);
    expect(creeper.burn).toBe(-1);
  });
  it('moves a nearby zombie toward the player without full-crowd scans', () => {
    const actor = makeActor('zombie', true, 8);
    const { tick } = fixture([actor]);
    tick(0.1);
    expect(actor.x).toBeLessThan(8);
    expect(actor.group.position.x).toBe(actor.x);
  });
  it('despawns distant ordinary mobs but preserves nearby ones', () => {
    const far = makeActor('zombie', true, 100);
    const near = makeActor('zombie', true, 8);
    const { tick, mobs } = fixture([far, near]);
    tick(0.1);
    expect(mobs).toEqual([near]);
  });
  it('keeps creeper fuse state and requests explosion at zero', () => {
    const creeper = makeActor('creeper', true, 1);
    creeper.fuse = 0.01;
    const { tick, pendingBlasts } = fixture([creeper]);
    tick(0.1);
    expect(pendingBlasts).toHaveLength(1);
    expect(pendingBlasts[0].r).toBe(3.4);
  });
});
