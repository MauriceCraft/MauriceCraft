import { describe, expect, it } from 'vitest';
import { registerPlayerCommands, type PlayerCommandState } from '../../src/game/commands/player-commands';
import type { RegisterCommand } from '../../src/game/commands/world-commands';

function fixture() {
  const actions = new Map<string, (args: string[]) => string | void>();
  const register: RegisterCommand = (aliases, _usage, _description, run) => {
    aliases.forEach(alias => actions.set(alias, run));
  };
  const state: PlayerCommandState = {
    tod: 0.22, isNight: false, weatherDuration: 300,
    mode: 'creative', selected: 0, health: 5, sinceHurt: 0,
    hunger: 2, satiety: 1, exhaustion: 3,
  };
  const player = { x: 8, y: 16, z: 8, yaw: 0, vx: 3, vy: 3, vz: 3, fly: false, fallStart: 30 as number | null };
  const inventory: Record<number, number> = {};
  const hotbar = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const chosen: string[] = [];
  let updates = 0;
  registerPlayerCommands({
    register, state, player, maxHeight: 48, maxHealth: 20, inventory, hotbar,
    names: { 3: 'Stone', 19: 'Bed', 101: 'Raw Beef' },
    labels: { creative: 'Creative', survival: 'Survival', adventure: 'Adventure', spectator: 'Spectator' },
    difficulties: { peaceful: { label: 'Peaceful' }, easy: { label: 'Easy' }, normal: { label: 'Normal' }, hard: { label: 'Hard' } },
    weatherLabels: { clear: 'Clear', rain: 'Rain', storm: 'Storm' },
    findItem: name => name === 'beef' ? 101 : 3,
    itemMap: () => ({ stone: 3, beef: 101 }),
    setWeather: weather => { chosen.push('weather:' + weather); },
    setMode: mode => { state.mode = mode; chosen.push('mode:' + mode); },
    setDifficulty: difficulty => { chosen.push('difficulty:' + difficulty); },
    refreshWorlds: async () => undefined, saveWorld: async () => undefined,
    updateHotbar: () => { updates++; },
    updateHearts: () => { updates++; }, renderFood: () => { updates++; },
    toggleFly: () => { player.fly = !player.fly; },
    ensureAround: () => undefined, topBlockY: () => 19,
    collides: () => false, getSeed: () => 321,
  });
  const run = (command: string, args: string[] = []) => {
    const action = actions.get(command);
    if (!action) throw new Error('Missing command ' + command);
    return String(action(args));
  };
  return { run, state, player, inventory, hotbar, chosen, getUpdates: () => updates };
}

describe('player and game commands', () => {
  it('supports time aliases, arithmetic and readable query messages', () => {
    const game = fixture();
    expect(game.run('time', ['set', 'night'])).toContain('13000 ticks');
    expect(game.state.tod).toBeCloseTo(13000 / 24000);
    expect(game.run('time', ['add', '12000'])).toContain('1000 ticks');
    expect(game.run('day')).toBe('Time set to day');
    expect(game.run('night')).toBe('Time set to night');
    expect(game.run('time', ['query'])).toContain('ticks into the day');
    expect(() => game.run('time', ['set', 'what'])).toThrow('Usage');
  });

  it('validates weather, aliases, and difficulty without rewriting world IDs', () => {
    const game = fixture();
    expect(game.run('weather', ['rain', '600'])).toBe('Weather set to rain');
    expect(game.state.weatherDuration).toBe(600);
    expect(() => game.run('weather', ['fog'])).toThrow('Usage');
    expect(game.run('gm', ['s'])).toBe('Game mode is now Survival');
    expect(game.state.mode).toBe('survival');
    expect(game.run('difficulty', ['3'])).toBe('Difficulty is now hard');
    expect(game.chosen).toContain('difficulty:hard');
  });

  it('keeps Creative grants unlimited but stores Survival item counts', () => {
    const game = fixture();
    expect(game.run('give', ['stone', '9'])).toContain('unlimited');
    expect(game.inventory[3]).toBeUndefined();
    game.run('gm', ['survival']);
    expect(game.run('give', ['beef', '3'])).toBe('Gave you 3 Raw Beef');
    expect(game.inventory[101]).toBe(3);
    expect(game.hotbar[0]).toBe(101);
    game.run('clear');
    expect(game.inventory[101]).toBeUndefined();
    expect(() => game.run('give', ['stone', '0'])).toThrow('count');
    expect(game.getUpdates()).toBeGreaterThan(0);
  });

  it('heals, feeds and toggles creative flight', () => {
    const game = fixture();
    expect(game.run('heal')).toContain('healthy');
    expect(game.state.health).toBe(20);
    expect(game.state.sinceHurt).toBe(99);
    game.run('feed');
    expect(game.state).toMatchObject({ hunger: 20, satiety: 5, exhaustion: 0 });
    expect(game.run('fly')).toBe('Flying on');
    game.run('gm', ['survival']);
    expect(() => game.run('fly')).toThrow('Creative');
  });

  it('teleports, resets motion and reports world position and seed', () => {
    const game = fixture();
    expect(game.run('tp', ['~2', '12', '~3'])).toContain('10.0 12.0 11.0');
    expect(game.player).toMatchObject({ x: 10, y: 12, z: 11, vx: 0, vy: 0, vz: 0, fallStart: null });
    expect(game.run('pos')).toContain('10.0');
    expect(game.run('seed')).toBe('Seed: 321');
    expect(game.run('teleport', ['spawn'])).toContain('0.5');
    expect(() => game.run('tp', ['1'])).toThrow('Usage');
  });
});
