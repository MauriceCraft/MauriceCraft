import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createGameTick, type TickDependencies, type TickState } from '../../src/game/runtime/game-tick';

function fixture() {
  const camera = new THREE.PerspectiveCamera();
  const player = { x: 4, y: 10, z: 6, yaw: 0, pitch: 0 };
  const state: TickState = {
    mode: 'creative', difficulty: 'normal', hunger: 20, health: 20,
    dead: false, sleepTime: 0, slept: false, timeOfDay: 0.2,
    sinceHurt: 99, regenerationTimer: 0, starvationTimer: 0, shake: 0,
  };
  const calls: string[] = [];
  const selection = { visible: false, position: { set: vi.fn() } };
  const fadeElement = { style: { opacity: '' } };
  const damagePlayer = vi.fn();
  const setWeather = vi.fn();
  const updateHearts = vi.fn();
  const exert = vi.fn();
  const handleActions = vi.fn();
  const target = { x: 5, y: 10, z: 6, nx: -1, ny: 0, nz: 0, t: 1 };
  const setTarget = vi.fn();
  const deps: TickDependencies = {
    state, player, camera, selection, fadeElement,
    difficulty: { normal: { regenAfter: 6, regenEvery: 1 }, easy: { regenAfter: 4, regenEvery: 1 },
      peaceful: { regenAfter: 1, regenEvery: 1 } },
    lavaBlock: 35, maximumHealth: 20, eyeHeight: 1.62,
    getBlock: () => 0, canInteract: () => true, hasHealth: () => true,
    raycast: () => target,
    setBlockHit: vi.fn(), setTarget, damagePlayer, setWeather,
    showHint: vi.fn(), playSound: vi.fn(), flashName: vi.fn(),
    updatePlayerMovement: () => { calls.push('move'); },
    updateMobs: () => { calls.push('mobs'); },
    updateBlasts: () => { calls.push('blasts'); },
    updateArrows: () => { calls.push('arrows'); },
    updateFx: () => { calls.push('effects'); },
    updateMusic: () => { calls.push('music'); },
    updateHearts, exert, checkRelics: () => { calls.push('relics'); },
    handleActions,
    random: () => 0.5,
  };
  return { tick: createGameTick(deps), deps, state, calls, player, camera,
    selection, fadeElement, damagePlayer, setWeather, updateHearts, exert, handleActions, setTarget };
}

describe('active gameplay tick', () => {
  it('caps frame steps, updates target before interactions and runs each subsystem in order', () => {
    const f = fixture();
    f.tick(1, 1234);
    expect(f.calls).toEqual(['move', 'mobs', 'blasts', 'arrows', 'effects', 'music']);
    expect(f.handleActions).toHaveBeenCalledWith(0.05, 1234);
    expect(f.camera.position.y).toBeCloseTo(11.62, 9);
    expect(f.selection.visible).toBe(true);
    expect(f.setTarget).toHaveBeenCalledWith(expect.objectContaining({ x: 5 }));
  });

  it('does not allow block interaction in spectator mode', () => {
    const f = fixture();
    f.state.mode = 'spectator';
    f.tick(0.01, 2);
    expect(f.setTarget).toHaveBeenCalledWith(null);
    expect(f.selection.visible).toBe(false);
  });

  it('applies lava damage once during cooldown and skips it in spectator mode', () => {
    const f = fixture();
    f.deps.getBlock = () => 35;
    // The callback is captured on the dependency object and therefore can change.
    f.tick(0.05, 1);
    f.tick(0.05, 2);
    expect(f.damagePlayer).toHaveBeenCalledTimes(1);
    expect(f.damagePlayer).toHaveBeenCalledWith(2, false);
    f.state.mode = 'spectator';
    f.tick(0.05, 3);
    expect(f.damagePlayer).toHaveBeenCalledTimes(1);
  });

  it('regenerates health under normal hunger and does not regenerate while hungry', () => {
    const f = fixture();
    f.state.mode = 'survival';
    f.state.health = 12;
    f.state.regenerationTimer = 0.98;
    f.tick(0.05, 1);
    expect(f.state.health).toBe(13);
    expect(f.updateHearts).toHaveBeenCalledOnce();
    expect(f.exert).toHaveBeenCalledWith(1.2);
    f.state.health = 12;
    f.state.hunger = 10;
    f.state.regenerationTimer = 0.98;
    f.tick(0.05, 2);
    expect(f.state.health).toBe(12);
  });

  it('applies starvation on the historical threshold and pauses actions while sleeping', () => {
    const f = fixture();
    f.state.mode = 'survival';
    f.state.health = 8;
    f.state.hunger = 0;
    f.state.starvationTimer = 3.98;
    f.state.sleepTime = 3;
    f.tick(0.05, 1);
    expect(f.damagePlayer).toHaveBeenCalledWith(1);
    expect(f.handleActions).not.toHaveBeenCalled();
  });

  it('changes weather and time once when sleep reaches its midpoint', () => {
    const f = fixture();
    f.state.sleepTime = 2.04;
    f.tick(0.05, 1);
    expect(f.state.slept).toBe(true);
    expect(f.state.timeOfDay).toBe(0.02);
    expect(f.setWeather).toHaveBeenCalledWith('clear');
    f.tick(0.05, 2);
    expect(f.setWeather).toHaveBeenCalledTimes(1);
  });
});
