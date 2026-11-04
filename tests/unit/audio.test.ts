import { describe, expect, it } from 'vitest';
import { createAudioEngine } from '../../src/game/audio/sound-engine';

describe('game audio', () => {
  it('keeps existing saved default settings without requiring an AudioContext at startup', () => {
    const audio = createAudioEngine(() => ({ x: 0, y: 0, z: 0, yaw: 0 }), () => false);
    expect(audio.Snd.ctx).toBeNull();
    expect(audio.Snd.sfx).toBe(true);
    expect(audio.Snd.music).toBe(true);
    expect(audio.Snd.nextMusic).toBe(3);
  });
  it('does not crash when sound is unsupported in a browser or headless test', () => {
    const audio = createAudioEngine(() => ({ x: 0, y: 0, z: 0, yaw: 0 }), () => true);
    expect(() => audio.sfx('break', 1, 0, 36)).not.toThrow();
    expect(() => audio.sfxAt('place', 0, 0, 0, 3)).not.toThrow();
    expect(() => audio.tone({ f: 180 })).not.toThrow();
    expect(() => audio.hiss({ d: 0.1 })).not.toThrow();
    expect(() => audio.updateMusic(0.5)).not.toThrow();
    expect(() => audio.applySound()).not.toThrow();
    expect(() => audio.saveSound()).not.toThrow();
  });
});
