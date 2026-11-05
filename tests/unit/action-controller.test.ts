import { describe, expect, it, vi } from 'vitest';
import { createActionController, type ActionInputState, type ActionDependencies } from '../../src/game/input/action-controller';
import type { SpawnMob } from '../../src/game/entities/mob-spawning';

function fixture() {
  const state: ActionInputState = {
    mineCd: 0, placeCd: 0, attackCd: 0,
    mining: false, placing: false, pulseMine: false, pulsePlace: false,
    mode: 'creative', drag: null, lookTouch: null,
  };
  const mine = { x: -1, y: -1, z: -1, t: 0 };
  const progress = { style: { width: '' } };
  const miningBar = { style: { display: '' }, firstElementChild: progress } as unknown as HTMLElement;
  const target = { x: 2, y: 4, z: -1, nx: 0, ny: 1, nz: 0, t: 1 };
  let mob: SpawnMob | null = null;
  let block = 3;
  const doBreak = vi.fn(), attackMob = vi.fn(), openTrade = vi.fn();
  const healGolem = vi.fn(() => true);
  const useBed = vi.fn(), openCraft = vi.fn();
  const useSelected = vi.fn(() => 0.4);
  const deps: ActionDependencies = {
    state, mine, miningBar,
    keys: {}, getBlockHit: () => target, getTarget: () => target,
    raycastMobs: () => mob ? { mob, t: 0.5 } : null,
    getBlock: () => block, breakTimes: { 3: 2, 19: 1 },
    toolSpeed: () => 2,
    doBreak, attackMob,
    canInteract: () => state.mode !== 'spectator' && state.mode !== 'adventure',
    openTrade, healGolem, isBed: b => b === 19, useBed,
    craftingTableId: 18, openCraft, useSelected,
  };
  const actions = createActionController(deps);
  return { state, mine, progress, miningBar, actions,
    doBreak, attackMob, openTrade, healGolem, useBed, openCraft, useSelected,
    setMob: (value: SpawnMob | null) => { mob = value; },
    setBlock: (value: number) => { block = value; } };
}

describe('input actions and cooldowns', () => {
  it('instantly breaks a creative target and throttles repeated mining', () => {
    const f = fixture();
    f.state.pulseMine = true;
    f.actions.handleActions(0.01, 300);
    expect(f.doBreak).toHaveBeenCalledOnce();
    expect(f.state.mineCd).toBeCloseTo(0.2);
    f.state.pulseMine = true;
    f.actions.handleActions(0.01, 320);
    expect(f.doBreak).toHaveBeenCalledTimes(2);
    expect(f.state.pulseMine).toBe(false);
  });

  it('tracks survival mining progress and resets when the trigger is released', () => {
    const f = fixture();
    f.state.mode = 'survival';
    f.state.mining = true;
    f.actions.handleActions(0.5, 100);
    expect(f.mine.t).toBe(0.5);
    expect(f.progress.style.width).toBe('50%');
    f.actions.handleActions(0.5, 200);
    expect(f.doBreak).toHaveBeenCalledOnce();
    expect(f.mine.t).toBe(0);
    f.state.mining = false;
    f.actions.handleActions(0.1, 400);
    expect(f.miningBar.style.display).toBe('none');
  });

  it('attacks the nearest creature, including a cooldown', () => {
    const f = fixture();
    f.state.mining = true;
    f.setMob({ kind: 'zombie', golem: false } as SpawnMob);
    f.actions.handleActions(0.01, 100);
    f.actions.handleActions(0.01, 150);
    expect(f.attackMob).toHaveBeenCalledOnce();
    expect(f.state.attackCd).toBeGreaterThan(0);
  });

  it('trades with villagers and heals friendly golems before placing blocks', () => {
    const f = fixture();
    f.state.placing = true;
    f.setMob({ kind: 'villager', golem: false } as SpawnMob);
    f.actions.handleActions(0.1, 300);
    expect(f.openTrade).toHaveBeenCalledOnce();
    f.state.placeCd = 0;
    f.setMob({ kind: 'irongolem', golem: true } as SpawnMob);
    f.actions.handleActions(0.1, 310);
    expect(f.healGolem).toHaveBeenCalledOnce();
    expect(f.useSelected).not.toHaveBeenCalled();
  });

  it('prioritizes beds and crafting tables over normal placement', () => {
    const f = fixture();
    f.state.pulsePlace = true;
    f.setBlock(19);
    f.actions.handleActions(0.01, 300);
    expect(f.useBed).toHaveBeenCalledOnce();
    f.state.pulsePlace = true;
    f.state.placeCd = 0;
    f.setBlock(18);
    f.actions.handleActions(0.01, 320);
    expect(f.openCraft).toHaveBeenCalledWith(3);
  });

  it('blocks all interaction in spectator mode', () => {
    const f = fixture();
    f.state.mode = 'spectator';
    f.state.pulseMine = true;
    f.state.pulsePlace = true;
    f.actions.handleActions(0.1, 100);
    expect(f.doBreak).not.toHaveBeenCalled();
    expect(f.useSelected).not.toHaveBeenCalled();
    expect(f.state.pulsePlace).toBe(false);
  });
});
