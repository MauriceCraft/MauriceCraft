import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { bg, bm, makeZombie, makeCow, makeVillager, makePillager, makeEnderDragon } from '../../src/game/entities/mob-models';

describe('mob model factories', () => {
  it('creates a zombie with animated legs and independently placed meshes', () => {
    const zombie = makeZombie();
    expect(zombie).toBeInstanceOf(THREE.Group);
    expect(zombie.children.length).toBeGreaterThan(2);
    expect(zombie.userData.legs).toHaveLength(2);
  });
  it('creates farm animals and villagers without browser APIs', () => {
    expect(makeCow().userData.legs).toHaveLength(4);
    expect(makeVillager({ job: 'farmer' }).userData.legs).toHaveLength(2);
    expect(makeVillager({ job: 'cleric' }).children.length).toBeGreaterThan(2);
  });
  it('supports both regular and leader pillager models', () => {
    expect(makePillager({ leader: true }).children.length).toBeGreaterThan(makePillager({ leader: false }).children.length);
  });
  it('builds an Ender Dragon with animated wing references', () => {
    expect(makeEnderDragon().userData.wings).toHaveLength(2);
  });
  it('reuses geometry and material objects instead of reallocating each time', () => {
    expect(bg(0.5, 1, 0.5)).toBe(bg(0.5, 1, 0.5));
    expect(bm(0xff0000)).toBe(bm(0xff0000));
  });
});
