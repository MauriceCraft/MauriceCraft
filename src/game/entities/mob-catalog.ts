/** One source of creature stats, model factories, and drop rules.
 * References numeric block IDs from the canonical save-compatible catalog.
 */
import { makeZombie, makeCow, makePig, makeSheep, makeChicken, makeCreeper, makeSkeleton, makeSpider, makePillager, makeVindicator, makeIronGolem, makeCopperGolem, makeDiamondGolem, makeVillager, makeEnderDragon } from './mob-models';

export interface MobDropIds {
  GUNPOWDER: number;
  BONE: number;
  STRING: number;
  EMERALD: number;
  IRON_INGOT: number;
  COPPER_INGOT: number;
  DIAMOND: number;
  BEEF: number;
  LEATHER: number;
  PORK: number;
  MUTTON: number;
  WOOL: number;
  CHICKEN: number;
  FEATHER: number;
}

/** Preserve existing mob balance and loot IDs when changing the game runtime. */
export function createMobCatalog(ids: MobDropIds) {
  const { GUNPOWDER, BONE, STRING, EMERALD, IRON_INGOT, COPPER_INGOT, DIAMOND, BEEF, LEATHER, PORK, MUTTON, WOOL, CHICKEN, FEATHER } = ids;
  const randomCountUpTo = (maximum: number) => 1 + Math.floor(Math.random() * maximum);
  const KINDS = {
    zombie: { hostile: true, r: 0.3, h: 1.8, hp: 20, speed: 2.7, melee: { d: 1.15, dmg: 3, cd: 1.1 }, make: makeZombie, drops: function () { return [[GUNPOWDER, Math.random() < 0.5 ? 1 : 0]]; } },
    enderdragon: { hostile: true, r: 2.8, h: 5.5, hp: 300, speed: 5.0, make: makeEnderDragon, drops: function () { return []; } },
    creeper: { hostile: true, r: 0.3, h: 1.85, hp: 20, speed: 2.4, make: makeCreeper, drops: function () { return [[GUNPOWDER, randomCountUpTo(2)]]; } },
    skeleton: { hostile: true, r: 0.3, h: 1.95, hp: 20, speed: 2.2, make: makeSkeleton, drops: function () { return [[BONE, Math.floor(Math.random() * 3)]]; } },
    spider: { hostile: true, r: 0.5, h: 0.8, hp: 16, speed: 3.2, melee: { d: 1.5, dmg: 2, cd: 0.9 }, make: makeSpider, drops: function () { return [[STRING, Math.floor(Math.random() * 3)]]; } },
    pillager: { hostile: true, illager: true, r: 0.3, h: 1.95, hp: 24, speed: 2.5, make: makePillager, drops: function () { return [[EMERALD, Math.random() < 0.5 ? 1 : 0], [GUNPOWDER, Math.random() < 0.3 ? 1 : 0]]; } },
    vindicator: { hostile: true, illager: true, r: 0.3, h: 1.95, hp: 24, speed: 3.0, melee: { d: 1.5, dmg: 6, cd: 1.0 }, make: makeVindicator, drops: function () { return [[EMERALD, Math.random() < 0.6 ? 1 : 0]]; } },
    irongolem: { golem: true, follow: false, hostile: false, r: 0.45, h: 2.7, hp: 100, speed: 2.2, range: 16, melee: { d: 2.4, dmg: 18, cd: 1.1, lift: 9 }, make: makeIronGolem, drops: function () { return [[IRON_INGOT, 3 + Math.floor(Math.random() * 3)]]; } },
    coppergolem: { golem: true, follow: true, hostile: false, r: 0.28, h: 1.45, hp: 40, speed: 3.4, range: 12, melee: { d: 1.3, dmg: 6, cd: 0.7, lift: 3 }, make: makeCopperGolem, drops: function () { return [[COPPER_INGOT, randomCountUpTo(2)]]; } },
    diamondgolem: { golem: true, follow: true, hostile: false, r: 0.55, h: 3.4, hp: 200, speed: 2.8, range: 20, melee: { d: 2.8, dmg: 30, cd: 1.0, lift: 11 }, make: makeDiamondGolem, drops: function () { return [[DIAMOND, 2 + Math.floor(Math.random() * 3)]]; } },
    villager: { hostile: false, r: 0.3, h: 1.95, hp: 20, speed: 0.9, make: makeVillager, drops: function () { return []; } },
    cow: { hostile: false, r: 0.45, h: 1.5, hp: 10, speed: 1.0, make: makeCow, drops: function () { return [[BEEF, randomCountUpTo(3)], [LEATHER, Math.random() < 0.5 ? 1 : 0]]; } },
    pig: { hostile: false, r: 0.4, h: 0.95, hp: 10, speed: 1.1, make: makePig, drops: function () { return [[PORK, randomCountUpTo(3)]]; } },
    sheep: { hostile: false, r: 0.45, h: 1.4, hp: 8, speed: 1.0, make: makeSheep, drops: function () { return [[MUTTON, randomCountUpTo(2)], [WOOL, randomCountUpTo(2)]]; } },
    chicken: { hostile: false, r: 0.2, h: 0.8, hp: 4, speed: 1.4, make: makeChicken, drops: function () { return [[CHICKEN, 1], [FEATHER, Math.floor(Math.random() * 3)]]; } }
  };
  const ANIMALS = ['cow', 'pig', 'sheep', 'chicken'];
  return { KINDS, ANIMALS };
}

export type MobKind = keyof ReturnType<typeof createMobCatalog>['KINDS'];
