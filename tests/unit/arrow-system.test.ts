import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createArrowSystem, type ArrowDependencies } from '../../src/game/entities/arrow-system';
import type { MobActor } from '../../src/game/entities/mob-simulation';

function fixture() {
  const player = { x: 8, y: 0, z: 0 };
  const scene = new THREE.Scene();
  const mobs: MobActor[] = [];
  let blocked = false;
  const damagePlayer = vi.fn();
  const damageMob = vi.fn();
  const playSound = vi.fn();
  const playSoundAt = vi.fn();
  const deps: ArrowDependencies = {
    scene, player, mobs,
    getBlock: x => blocked && x === 3 ? 3 : 0,
    solid: id => id !== 0,
    collides: () => false,
    hasHealth: () => true,
    damagePlayer, damageMob, playSound, playSoundAt,
  };
  const system = createArrowSystem(deps);
  const shooter = { x: 0, y: 0, z: 0 } as MobActor;
  return { player, scene, system, shooter, damagePlayer, damageMob, playSound, playSoundAt,
    setBlocked: (value: boolean) => { blocked = value; } };
}

describe('arrow flight and line of sight', () => {
  it('detects a solid block between shooter and target', () => {
    const f = fixture();
    expect(f.system.hasLOS(f.shooter)).toBe(true);
    f.setBlocked(true);
    expect(f.system.hasLOS(f.shooter)).toBe(false);
  });

  it('spawns an arrow mesh with the same initial damage and removes expired shots', () => {
    const f = fixture();
    f.system.shootArrow(f.shooter, 4);
    expect(f.system.arrows).toHaveLength(1);
    expect(f.system.arrows[0].dmg).toBe(4);
    expect(f.scene.children).toContain(f.system.arrows[0].mesh);
    expect(f.playSoundAt).toHaveBeenCalledWith('arrow', 0, 1.5, 0);
    f.system.updateArrows(7);
    expect(f.system.arrows).toHaveLength(0);
  });

  it('collides with the player, applies scaled damage, and disposes the arrow', () => {
    const f = fixture();
    f.player.x = 2;
    f.system.shootArrow(f.shooter, 5);
    f.system.updateArrows(0.2);
    expect(f.damagePlayer).toHaveBeenCalledWith(5, true);
    expect(f.playSound).toHaveBeenCalledWith('hit');
    expect(f.system.arrows).toHaveLength(0);
  });
});
