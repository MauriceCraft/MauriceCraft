import { coord } from './coordinates';
import type { RegisterCommand } from './world-commands';
import type { GameMode, Difficulty } from '../ui/game-menu';
import type { WeatherMode } from '../rendering/weather-system';

const TIME_PRESETS: Record<string, number> = {
  day: 1000, noon: 6000, sunset: 12000,
  night: 13000, midnight: 18000, sunrise: 23000,
};
const MODE_ALIASES: Record<string, GameMode> = {
  creative: 'creative', c: 'creative', '1': 'creative',
  survival: 'survival', s: 'survival', '0': 'survival',
  adventure: 'adventure', a: 'adventure', '2': 'adventure',
  spectator: 'spectator', sp: 'spectator', '3': 'spectator',
};
const DIFFICULTY_ALIASES: Record<string, Difficulty> = {
  peaceful: 'peaceful', p: 'peaceful', '0': 'peaceful',
  easy: 'easy', e: 'easy', '1': 'easy',
  normal: 'normal', n: 'normal', '2': 'normal',
  hard: 'hard', h: 'hard', '3': 'hard',
};

export interface PlayerCommandState {
  tod: number;
  isNight: boolean;
  weatherDuration: number;
  mode: GameMode;
  selected: number;
  health: number;
  sinceHurt: number;
  hunger: number;
  satiety: number;
  exhaustion: number;
}
export interface CommandPlayer {
  x: number; y: number; z: number;
  yaw: number; vx: number; vy: number; vz: number;
  fly: boolean; fallStart: number | null;
}
export interface PlayerCommandDependencies {
  register: RegisterCommand;
  state: PlayerCommandState;
  player: CommandPlayer;
  maxHeight: number;
  maxHealth: number;
  inventory: Record<number, number>;
  hotbar: number[];
  names: Readonly<Record<number, string>>;
  labels: Readonly<Record<GameMode, string>>;
  difficulties: Readonly<Record<Difficulty, { label: string }>>;
  weatherLabels: Readonly<Record<WeatherMode, string>>;
  findItem: (name: string, blocksOnly?: boolean) => number;
  itemMap: () => Record<string, number>;
  setWeather: (mode: WeatherMode) => void;
  setMode: (mode: GameMode) => void;
  setDifficulty: (difficulty: Difficulty) => void;
  refreshWorlds: () => Promise<void>;
  saveWorld: () => Promise<void>;
  updateHotbar: (showName?: boolean) => void;
  updateHearts: () => void;
  renderFood: () => void;
  toggleFly: () => void;
  ensureAround: (x: number, z: number) => void;
  topBlockY: (x: number, z: number) => number;
  collides: (x: number, y: number, z: number) => boolean;
  getSeed: () => number;
}

export function registerPlayerCommands(deps: PlayerCommandDependencies): void {
  const { register, state, player } = deps;
  register(['time'], '/time set <day|noon|sunset|night|midnight|sunrise|ticks> | add <ticks> | query',
    'Change or read the time of day (24000 ticks per day)', args => {
      const action = (args[0] || '').toLowerCase();
      if (action === 'query') {
        return 'It is ' + Math.round(state.tod * 24000) + ' ticks into the day (' +
          (state.isNight ? 'night' : 'day') + ')';
      }
      if (action === 'set' || action === 'add') {
        const argument = (args[1] || '').toLowerCase();
        const ticks = action === 'set' && TIME_PRESETS[argument] !== undefined
          ? TIME_PRESETS[argument] : Number.parseFloat(argument);
        if (!Number.isFinite(ticks)) throw new Error('Usage: /time ' + action +
          (action === 'set' ? ' <day|noon|sunset|night|midnight|sunrise|ticks>' : ' <ticks>'));
        state.tod = action === 'set'
          ? (((ticks % 24000) + 24000) % 24000) / 24000
          : (((state.tod + ticks / 24000) % 1) + 1) % 1;
        return 'Time ' + (action === 'set' ? 'set to ' : 'moved on to ') +
          Math.round(state.tod * 24000) + ' ticks';
      }
      throw new Error('Usage: /time set <day|noon|sunset|night|midnight|sunrise|ticks>, /time add <ticks>, /time query');
    }, index => index === 1 ? ['set', 'add', 'query'] : Object.keys(TIME_PRESETS));

  register(['day'], '/day', 'Set the time to morning', () => {
    state.tod = TIME_PRESETS.day / 24000;
    return 'Time set to day';
  });
  register(['night'], '/night', 'Set the time to night', () => {
    state.tod = TIME_PRESETS.night / 24000;
    return 'Time set to night';
  });

  register(['weather'], '/weather <clear|rain|storm> [seconds]', 'Change the weather', args => {
    const weather = (args[0] || '').toLowerCase() as WeatherMode;
    if (!deps.weatherLabels[weather]) throw new Error('Usage: /weather <clear|rain|storm> [seconds]');
    deps.setWeather(weather);
    if (args[1] !== undefined && Number(args[1]) > 0) state.weatherDuration = Number(args[1]);
    void deps.saveWorld().then(deps.refreshWorlds);
    return 'Weather set to ' + deps.weatherLabels[weather].toLowerCase();
  }, () => ['clear', 'rain', 'storm']);

  register(['gamemode', 'gm'], '/gamemode <creative|survival|adventure|spectator>',
    'Switch game mode', args => {
      const mode = MODE_ALIASES[(args[0] || '').toLowerCase()];
      if (!mode) throw new Error('Usage: /gamemode <creative|survival|adventure|spectator>');
      deps.setMode(mode);
      void deps.saveWorld().then(deps.refreshWorlds);
      return 'Game mode is now ' + deps.labels[mode];
    }, () => ['creative', 'survival', 'adventure', 'spectator']);

  register(['difficulty'], '/difficulty <peaceful|easy|normal|hard>', 'Change the difficulty', args => {
    const difficulty = DIFFICULTY_ALIASES[(args[0] || '').toLowerCase()];
    if (!difficulty) throw new Error('Usage: /difficulty <peaceful|easy|normal|hard>');
    deps.setDifficulty(difficulty);
    return 'Difficulty is now ' + deps.difficulties[difficulty].label.toLowerCase();
  }, () => ['peaceful', 'easy', 'normal', 'hard']);

  register(['give'], '/give <item> [count]',
    'Give yourself an item or block (Creative puts it in your hotbar)', args => {
      if (!args[0]) throw new Error('Usage: /give <item> [count]');
      const itemId = deps.findItem(args[0], false);
      let amount = args[1] === undefined ? 1 : Math.floor(Number(args[1]));
      if (!(amount >= 1)) throw new Error('The count must be 1 or more');
      amount = Math.min(amount, 9999);
      if (!deps.hotbar.includes(itemId)) deps.hotbar[state.selected] = itemId;
      if (state.mode === 'creative') {
        deps.updateHotbar(true);
        return deps.names[itemId] + ' is in your hotbar (Creative items are unlimited)';
      }
      deps.inventory[itemId] = Math.min(9999, (deps.inventory[itemId] || 0) + amount);
      deps.updateHotbar(true);
      return 'Gave you ' + amount + ' ' + deps.names[itemId];
    }, index => index === 1 ? Object.keys(deps.itemMap()) : []);

  register(['clear'], '/clear', 'Empty your backpack', () => {
    for (const itemId in deps.inventory) delete deps.inventory[Number(itemId)];
    deps.updateHotbar(false);
    return 'Backpack cleared';
  });
  register(['heal'], '/heal', 'Restore your health', () => {
    state.health = deps.maxHealth;
    state.sinceHurt = 99;
    deps.updateHearts();
    return 'You feel healthy again';
  });
  register(['feed'], '/feed', 'Fill your hunger bar', () => {
    state.hunger = 20;
    state.satiety = 5;
    state.exhaustion = 0;
    deps.renderFood();
    return 'You are no longer hungry';
  });
  register(['fly'], '/fly', 'Toggle flying (Creative)', () => {
    if (state.mode !== 'creative') throw new Error('Flying is a Creative mode ability');
    deps.toggleFly();
    return player.fly ? 'Flying on' : 'Flying off';
  });

  register(['tp', 'teleport'], '/tp <x> <y> <z> | <x> <z> | spawn   (~ means relative)',
    'Teleport', args => {
      let x: number, y: number, z: number;
      if ((args[0] || '').toLowerCase() === 'spawn') {
        x = 0.5;
        z = 0.5;
        deps.ensureAround(x, z);
        y = deps.topBlockY(0, 0) + 1.01;
      } else if (args.length >= 3) {
        x = coord(args[0], player.x);
        y = coord(args[1], player.y);
        z = coord(args[2], player.z);
        deps.ensureAround(x, z);
      } else if (args.length === 2) {
        x = coord(args[0], player.x);
        z = coord(args[1], player.z);
        deps.ensureAround(x, z);
        y = deps.topBlockY(Math.floor(x), Math.floor(z)) + 1.01;
      } else throw new Error('Usage: /tp <x> <y> <z>, /tp <x> <z>, or /tp spawn');
      if (!(y > -20 && y < deps.maxHeight + 200)) throw new Error('That height is out of range');
      for (let step = 0; step < 80 && state.mode !== 'spectator' && deps.collides(x, y, z); step++) y += 1;
      player.x = x;
      player.y = y;
      player.z = z;
      player.vx = player.vy = player.vz = 0;
      player.fallStart = null;
      return 'Teleported to ' + x.toFixed(1) + ' ' + y.toFixed(1) + ' ' + z.toFixed(1);
    }, index => index === 1 ? ['spawn'] : []);

  register(['pos'], '/pos', 'Show where you are', () =>
    'You are at ' + player.x.toFixed(1) + ' ' + player.y.toFixed(1) + ' ' + player.z.toFixed(1));
  register(['seed'], '/seed', 'Show the world seed', () => 'Seed: ' + deps.getSeed());
}
