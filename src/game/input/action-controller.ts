import type { ActorHit } from '../entities/actor-targeting';
import type { SpawnMob } from '../entities/mob-spawning';
import type { BlockRayHit } from '../world/raycast';

export interface ActionInputState {
  mineCd: number; placeCd: number; attackCd: number;
  mining: boolean; placing: boolean; pulseMine: boolean; pulsePlace: boolean;
  mode: string;
  drag: { t0: number; moved: number } | null;
  lookTouch: { t0: number; moved: number } | null;
}
interface MiningProgress { x: number; y: number; z: number; t: number }
export interface ActionDependencies {
  state: ActionInputState;
  mine: MiningProgress;
  miningBar: HTMLElement;
  keys: Readonly<Record<string, boolean>>;
  getBlockHit: () => BlockRayHit | null;
  getTarget: () => BlockRayHit | null;
  raycastMobs: (maxDistance: number) => ActorHit<SpawnMob> | null;
  getBlock: (x: number, y: number, z: number) => number;
  breakTimes: Readonly<Record<number, number>>;
  toolSpeed: (blockId: number) => number;
  doBreak: (target: BlockRayHit) => void;
  attackMob: (mob: SpawnMob) => void;
  canInteract: () => boolean;
  openTrade: (mob: SpawnMob) => void;
  healGolem: (mob: SpawnMob) => boolean;
  isBed: (block: number) => boolean;
  useBed: (target: BlockRayHit) => void;
  craftingTableId: number;
  openCraft: (size: number) => void;
  useSelected: () => number;
}

/** Input intent and cooldowns are kept distinct from block and mob rules. */
export function createActionController(deps: ActionDependencies) {
  const { state, mine, miningBar: mineBar, keys } = deps;
  const get = deps.getBlock;
  const resetMine = (): void => {
    mine.t = 0;
    mine.x = mine.y = mine.z = -1;
    mineBar.style.display = 'none';
  };

  function handleActions(dt: number, tNow: number): void {
    state.mineCd -= dt; state.placeCd -= dt; state.attackCd -= dt;
    const drag = state.drag, lookT = state.lookTouch;
    const holdOK = !drag || (tNow - drag.t0 > 160 && drag.moved < 6);
    const touchHold = !!(lookT && lookT.moved < 10 && tNow - lookT.t0 > 220);
    const heldMine = (state.mining && holdOK) || touchHold;
    const heldPlace = state.placing && holdOK;
    const wantMine = heldMine || state.pulseMine;
    const wantPlace = heldPlace || state.pulsePlace;
    const pm = state.pulseMine, pp = state.pulsePlace;
    state.pulseMine = false; state.pulsePlace = false;

    if (state.mode === 'spectator') { resetMine(); return; }

    const blockHit = deps.getBlockHit();
    const target = deps.getTarget();
    const mobHit = deps.raycastMobs(3.6);
    if (wantMine) {
      if (mobHit && (!blockHit || mobHit.t < blockHit.t + 0.01)) {
        if (state.attackCd <= 0) { deps.attackMob(mobHit.mob); state.attackCd = 0.45; }
        resetMine();
      } else if (state.mode === 'creative') {
        if (target && target.y > 0 && (pm || state.mineCd <= 0)) {
          deps.doBreak(target); state.mineCd = 0.2;
        }
      } else if (state.mode === 'survival') {
        if (heldMine && target && target.y > 0) {
          if (mine.x === target.x && mine.y === target.y && mine.z === target.z) mine.t += dt;
          else { mine.x = target.x; mine.y = target.y; mine.z = target.z; mine.t = dt; }
          const block = get(target.x, target.y, target.z);
          const total = (deps.breakTimes[block] || 1) / deps.toolSpeed(block);
          mineBar.style.display = 'block';
          const progressBar = mineBar.firstElementChild;
          if (progressBar instanceof HTMLElement) progressBar.style.width = Math.min(100, mine.t / total * 100) + '%';
          if (mine.t >= total) { deps.doBreak(target); resetMine(); }
        } else resetMine();
      }
    } else resetMine();

    if (wantPlace && deps.canInteract() && (pp || state.placeCd <= 0)) {
      if (mobHit && mobHit.mob.kind === 'villager' && (!blockHit || mobHit.t < blockHit.t)) {
        deps.openTrade(mobHit.mob); state.placeCd = 0.4;
      } else if (mobHit && mobHit.mob.golem && (!blockHit || mobHit.t < blockHit.t) && deps.healGolem(mobHit.mob)) {
        state.placeCd = 0.5;
      } else if (target && deps.isBed(get(target.x, target.y, target.z)) && !(keys.ShiftLeft || keys.ShiftRight)) {
        deps.useBed(target); state.placeCd = 0.6;
      } else if (target && get(target.x, target.y, target.z) === deps.craftingTableId && !(keys.ShiftLeft || keys.ShiftRight)) {
        deps.openCraft(3); state.placeCd = 0.4;
      } else state.placeCd = deps.useSelected();
    }
  }

  return { resetMine, handleActions };
}
