import { describe, expect, it, vi } from 'vitest';
import { createFrameLoop, startFrameLoop, type FrameLoopDependencies } from '../../src/game/runtime/frame-loop';

function harness() {
  const calls: string[] = [];
  let ready = false;
  let playing = false;
  const deps: FrameLoopDependencies = {
    isReady: () => ready,
    isPlaying: () => playing,
    streamChunks: () => { calls.push('stream'); },
    update: (dt, now) => { calls.push('update:' + dt.toFixed(2) + ':' + now); },
    updateIdleCamera: () => { calls.push('idle'); },
    daylight: () => { calls.push('daylight'); },
    updateWeather: () => { calls.push('weather'); },
    updateRain: () => { calls.push('rain'); },
    updateRainSound: () => { calls.push('rainSound'); },
    updateRelics: () => { calls.push('relics'); },
    updateInfo: fps => { calls.push('hud:' + fps); },
    render: () => { calls.push('render'); },
  };
  return { calls, deps, setReady: (value: boolean) => { ready = value; }, setPlaying: (value: boolean) => { playing = value; } };
}

describe('game runtime frame loop', () => {
  it('renders while loading without touching uninitialized game state', () => {
    const h = harness();
    createFrameLoop(h.deps, 0)(16);
    expect(h.calls).toEqual(['render']);
  });

  it('streams chunks, syncs the idle camera and updates the world while paused', () => {
    const h = harness();
    h.setReady(true);
    createFrameLoop(h.deps, 0)(100);
    expect(h.calls).toEqual(['stream', 'idle', 'daylight', 'weather', 'rain', 'rainSound', 'relics', 'render']);
  });

  it('updates simulation before weather, relics and rendering when playing', () => {
    const h = harness();
    h.setReady(true);
    h.setPlaying(true);
    createFrameLoop(h.deps, 0)(100);
    expect(h.calls).toEqual(['stream', 'update:0.10:100', 'daylight', 'weather', 'rain', 'rainSound', 'relics', 'render']);
  });

  it('retains HUD throttling and the sampled FPS after a second of frames', () => {
    const h = harness();
    h.setReady(true);
    h.setPlaying(true);
    const frame = createFrameLoop(h.deps, 0);
    frame(100);
    frame(250);
    frame(1100);
    expect(h.calls.filter(call => call.startsWith('hud:'))).toEqual(['hud:0', 'hud:3']);
  });

  it('resumes simulation from a paused frame without reinitializing the loop', () => {
    const h = harness();
    h.setReady(true);
    const frame = createFrameLoop(h.deps, 0);
    frame(100);
    h.setPlaying(true);
    frame(200);
    expect(h.calls).toContain('idle');
    expect(h.calls).toContain('update:0.10:200');
    expect(h.calls.filter(call => call === 'render')).toHaveLength(2);
  });

  it('schedules one animation frame at a time', () => {
    const scheduled: FrameRequestCallback[] = [];
    const step = vi.fn();
    const schedule = vi.fn((callback: FrameRequestCallback) => {
      scheduled.push(callback);
      return scheduled.length;
    });
    startFrameLoop(step, schedule);
    expect(schedule).toHaveBeenCalledTimes(1);
    scheduled[0](32);
    expect(step).toHaveBeenCalledWith(32);
    expect(schedule).toHaveBeenCalledTimes(2);
    scheduled[1](64);
    expect(step).toHaveBeenCalledWith(64);
    expect(schedule).toHaveBeenCalledTimes(3);
  });
});
