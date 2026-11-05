import { describe, expect, it } from 'vitest';
import { createBlockCatalog } from '../../src/game/world/block-catalog';
import { createMobCatalog } from '../../src/game/entities/mob-catalog';

describe('canonical creature catalog', () => {
  const blocks = createBlockCatalog();
  const { KINDS, ANIMALS } = createMobCatalog(blocks);

  it('keeps existing creature identities and spawnable animal types', () => {
    expect(Object.keys(KINDS)).toEqual([
      'zombie', 'enderdragon', 'creeper', 'skeleton', 'spider',
      'pillager', 'vindicator', 'irongolem', 'coppergolem', 'diamondgolem',
      'villager', 'cow', 'pig', 'sheep', 'chicken',
    ]);
    expect(ANIMALS).toEqual(['cow', 'pig', 'sheep', 'chicken']);
  });

  it('preserves golem stats, boss HP, and persistent loot identities', () => {
    expect(KINDS.enderdragon.hp).toBe(300);
    expect(KINDS.irongolem.hp).toBe(100);
    expect(KINDS.irongolem.melee.dmg).toBe(18);
    expect(KINDS.coppergolem.follow).toBe(true);
    expect(KINDS.zombie.drops()[0][0]).toBe(blocks.GUNPOWDER);
    expect(KINDS.chicken.drops()[0][0]).toBe(blocks.CHICKEN);
  });

  it('can instantiate independent passive creature geometry', () => {
    const model = KINDS.pig.make();
    expect(model.children.length).toBeGreaterThan(0);
    expect(KINDS.sheep.make()).not.toBe(model);
  });
});
