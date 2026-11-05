import { describe, expect, it, vi } from 'vitest';
import { createGameSessionControls, type GameSessionState, type GameSessionDependencies } from '../../src/game/runtime/game-session-controls';

function fixture(isTouch = true) {
  const state: GameSessionState = {
    mode: 'creative', difficulty: 'normal',
    mining: true, placing: true, pulseMine: true, pulsePlace: true,
    dead: false, hp: 5, sinceHurt: 0, regenT: 2, hunger: 6, sat: 1,
    exhaust: 3, starveT: 1, locked: false, fallback: false, playing: false,
    drag: { started: true }, ready: true, invOpen: false,
  };
  const player = { x: 1, y: 5, z: 1, vy: 4, fly: false, fallStart: 5 as number | null };
  const overlay = { classList: { add: vi.fn(), remove: vi.fn() } };
  const playButton = { textContent: '' }, subtitle = { textContent: '' };
  const keys = { KeyW: true, Space: true };
  const mobs: Array<{ hostile: boolean }> = [{ hostile: true }, { hostile: false }];
  const removeMobAt = vi.fn((index: number) => { mobs.splice(index, 1); });
  const clearMobs = vi.fn();
  const respawn = vi.fn();
  const saveWorld = vi.fn(async () => undefined);
  const refreshWorlds = vi.fn(async () => undefined);
  const showHint = vi.fn(), playSound = vi.fn(), updateModeUI = vi.fn(), updateDiffUI = vi.fn();
  const audioInit = vi.fn(), updateHearts = vi.fn(), renderFood = vi.fn();
  const listeners = new Map<string, EventListenerOrEventListenerObject>();
  const documentStub = {
    pointerLockElement: null as Element | null,
    exitPointerLock: vi.fn(),
    addEventListener: (event: string, handler: EventListenerOrEventListenerObject) => {
      listeners.set(event, handler);
    },
  } as unknown as GameSessionDependencies['document'];
  const canvas = { requestPointerLock: vi.fn(async () => undefined) } as unknown as HTMLCanvasElement;
  const dependencies: GameSessionDependencies = {
    state, player, overlay, playButton, subtitle, keys, mobs, canvas,
    document: documentStub, labels: { creative: 'Creative', survival: 'Survival',
      adventure: 'Adventure', spectator: 'Spectator' },
    difficulties: { peaceful: { cap: 0 }, easy: { cap: 4 }, normal: { cap: 8 }, hard: { cap: 12 } },
    maximumHealth: 20, isTouch, hasHealth: () => state.mode !== 'creative' && state.mode !== 'spectator',
    clearMobs, removeMobAt, respawn, collides: () => false, topY: () => 10,
    updateModeUI, updateDiffUI, updateHearts, renderFood,
    saveWorld, refreshWorlds, audioInit, playSound, showHint,
    schedule: () => undefined,
  };
  const actions = createGameSessionControls(dependencies);
  return { actions, state, player, overlay, playButton, subtitle, keys,
    mobs, removeMobAt, clearMobs, respawn, saveWorld, refreshWorlds,
    showHint, playSound, updateModeUI, updateDiffUI, audioInit, updateHearts, renderFood,
    listeners, canvas };
}

describe('game lifecycle controls', () => {
  it('resets survival stats and world interaction state when switching modes', () => {
    const f = fixture();
    f.actions.setMode('spectator');
    expect(f.state.mode).toBe('spectator');
    expect(f.state.hp).toBe(20);
    expect(f.state.hunger).toBe(20);
    expect(f.state.mining).toBe(false);
    expect(f.state.pulsePlace).toBe(false);
    expect(f.player.fly).toBe(true);
    expect(f.player.vy).toBe(0);
    expect(f.clearMobs).toHaveBeenCalledOnce();
    expect(f.updateModeUI).toHaveBeenCalledOnce();
  });

  it('removes only hostile creatures on peaceful and saves the setting', () => {
    const f = fixture();
    f.state.mode = 'survival';
    f.actions.setDifficulty('peaceful');
    expect(f.state.difficulty).toBe('peaceful');
    expect(f.mobs).toEqual([{ hostile: false }]);
    expect(f.removeMobAt).toHaveBeenCalledWith(0);
    expect(f.playSound).toHaveBeenCalledWith('click');
    expect(f.saveWorld).toHaveBeenCalledOnce();
  });

  it('starts only after loading and pauses with cleared input plus an autosave', () => {
    const f = fixture();
    f.state.ready = false;
    f.actions.startGame();
    expect(f.audioInit).not.toHaveBeenCalled();
    f.state.ready = true;
    f.actions.startGame();
    expect(f.state.playing).toBe(true);
    expect(f.overlay.classList.add).toHaveBeenCalledWith('hidden');
    f.actions.pause();
    expect(f.state.playing).toBe(false);
    expect(f.keys).toEqual({ KeyW: false, Space: false });
    expect(f.state.drag).toBeNull();
    expect(f.playButton.textContent).toBe('Resume');
    expect(f.saveWorld).toHaveBeenCalledOnce();
  });

  it('marks death, pauses the game and prepares the respawn button', () => {
    const f = fixture();
    f.actions.die();
    expect(f.state.dead).toBe(true);
    expect(f.playButton.textContent).toBe('Respawn');
    expect(f.subtitle.textContent).toContain('You died');
    f.actions.startGame();
    expect(f.state.dead).toBe(false);
    expect(f.respawn).toHaveBeenCalledOnce();
    expect(f.updateHearts).toHaveBeenCalledOnce();
    expect(f.renderFood).toHaveBeenCalledOnce();
  });

  it('uses mouse-capture fallback when pointer-lock is unavailable', () => {
    const f = fixture(false);
    f.actions.enterFallback();
    expect(f.state.fallback).toBe(true);
    expect(f.state.playing).toBe(true);
    expect(f.showHint).toHaveBeenCalledWith(expect.stringContaining('Mouse capture is blocked'), 6000);
    f.actions.enterFallback();
    expect(f.showHint).toHaveBeenCalledOnce();
  });
});
