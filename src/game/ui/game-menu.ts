/** Main menu, difficulty, weather, sound and HUD visibility.
 * Gameplay transitions and save persistence remain in the game runtime.
 */
import type { WeatherMode } from '../rendering/weather-system';

export type GameMode = 'creative' | 'survival' | 'adventure' | 'spectator';
export type Difficulty = 'peaceful' | 'easy' | 'normal' | 'hard';
export const MODE_LABELS: Record<GameMode, string> = {
  creative: 'Creative', survival: 'Survival', adventure: 'Adventure', spectator: 'Spectator',
};
export const DIFFICULTY_DESCRIPTIONS: Record<Difficulty, string> = {
  peaceful: 'No monsters, no hunger, and health comes back quickly. Falls and explosions still hurt.',
  easy: 'Fewer, slower monsters that hit softly, with slow-firing skeletons and longer creeper fuses.',
  normal: 'The standard challenge.',
  hard: 'Lots of fast monsters that spot you from far away and hit hard. Skeletons shoot quickly, creepers blow sooner, and health returns slowly.',
};
export function describeMode(mode: GameMode, relicCount: number): string {
  const descriptions: Record<GameMode, string> = {
    creative: 'Unlimited blocks, instant building and flying. Nothing can hurt you.',
    survival: 'Mine blocks to collect them, then build with what you gather. Stone needs a pickaxe, and better tools mine faster. Keep an eye on your hunger and eat meat. Dig for coal, copper, iron and diamonds. Zombies, skeletons, creepers and spiders come out at night, and falls hurt. Torches light up the dark and keep them from spawning nearby. Craft a table from planks for bigger recipes.',
    adventure: 'The world is protected, so you can’t break or place blocks. Find all ' + relicCount + ' glowing relics and stay alive.',
    spectator: 'Fly through anything and look around. You can’t touch the world. Scroll to change speed.',
  };
  return descriptions[mode];
}
interface SoundFlags {
  sfx: boolean;
  music: boolean;
  nextMusic: number;
}
export interface GameMenuDependencies {
  getMode: () => GameMode;
  getDifficulty: () => Difficulty;
  getWeather: () => WeatherMode;
  canInteract: () => boolean;
  hasHealth: () => boolean;
  isTouch: boolean;
  relicCount: number;
  touchUi: HTMLElement;
  hotbar: HTMLElement;
  hearts: HTMLElement;
  food: HTMLElement;
  placeButton: HTMLElement;
  flyButton: HTMLElement;
  inventoryButton: HTMLElement;
  jumpButton: HTMLElement;
  hideSelection: () => void;
  syncRelics: () => void;
  updateHotbar: () => void;
  updateHearts: () => void;
  updateFood: () => void;
  setMode: (mode: GameMode) => void;
  setDifficulty: (difficulty: Difficulty) => void;
  setWeather: (weather: WeatherMode) => void;
  sound: SoundFlags;
  initializeAudio: () => void;
  applySound: () => void;
  saveSound: () => void;
  playClick: () => void;
  isPlaying: () => boolean;
  saveAndRefreshWorlds: () => void;
  onPlay: () => void;
}
function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error('Game menu is missing #' + id);
  return element;
}
export function createGameMenu(deps: GameMenuDependencies) {
  const overlay = requireElement('overlay');
  const playBtn = requireElement('play') as HTMLButtonElement;
  const newBtn = requireElement('newworld') as HTMLButtonElement;
  const subEl = requireElement('sub');
  const infoEl = requireElement('info');
  const objEl = requireElement('objective');
  const hintEl = requireElement('hint');
  const modeDescription = requireElement('modeDesc');
  const difficultyDescription = requireElement('diffDesc');
  const modeButtons = Array.from(document.querySelectorAll<HTMLElement>('.mode'));
  const difficultyButtons = Array.from(document.querySelectorAll<HTMLElement>('.dmode'));
  const weatherButtons = Array.from(document.querySelectorAll<HTMLElement>('.wmode'));

  if (deps.isTouch) {
    deps.touchUi.style.display = 'block';
    requireElement('controls').innerHTML =
      '<dt>Left side</dt><dd>Drag to move</dd><dt>Right side</dt><dd>Drag to look, tap to break or hit, hold to mine</dd>' +
      '<dt>Place</dt><dd>Puts down the selected block</dd><dt>Hotbar</dt><dd>Tap to choose a block</dd><dt>Bag</dt><dd>Open the inventory</dd>';
  }

  function updateDifficultyUI(): void {
    const difficulty = deps.getDifficulty();
    for (const button of difficultyButtons) {
      const active = button.dataset.diff === difficulty;
      button.classList.toggle('on', active);
      button.setAttribute('aria-pressed', String(active));
    }
    difficultyDescription.textContent = DIFFICULTY_DESCRIPTIONS[difficulty] +
      (deps.hasHealth() ? '' : ' (Applies in Survival and Adventure.)');
  }

  function updateModeUI(): void {
    const mode = deps.getMode();
    const canInteract = deps.canInteract();
    const hasHealth = deps.hasHealth();
    deps.hotbar.style.display = canInteract ? 'flex' : 'none';
    deps.hearts.style.display = hasHealth ? 'flex' : 'none';
    deps.hearts.classList.toggle('raised', canInteract);
    deps.food.style.display = mode === 'survival' ? 'flex' : 'none';
    deps.food.classList.toggle('raised', canInteract);
    objEl.style.display = mode === 'adventure' ? 'block' : 'none';
    deps.hideSelection();
    deps.placeButton.style.display = canInteract ? 'block' : 'none';
    deps.flyButton.style.display = mode === 'creative' ? 'block' : 'none';
    deps.inventoryButton.style.display = canInteract ? 'block' : 'none';
    deps.jumpButton.textContent = mode === 'spectator' ? 'Up' : 'Jump';
    deps.syncRelics();
    for (const button of modeButtons) {
      const active = button.dataset.mode === mode;
      button.classList.toggle('on', active);
      button.setAttribute('aria-pressed', String(active));
    }
    modeDescription.textContent = describeMode(mode, deps.relicCount);
    updateDifficultyUI();
    deps.updateHotbar();
    deps.updateHearts();
    deps.updateFood();
  }

  function updateWeatherUI(): void {
    for (const button of weatherButtons) {
      const active = button.dataset.weather === deps.getWeather();
      button.classList.toggle('on', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }
  for (const button of weatherButtons) {
    button.addEventListener('click', () => {
      const weather = button.dataset.weather as WeatherMode;
      deps.setWeather(weather);
      deps.playClick();
      deps.saveAndRefreshWorlds();
    });
  }
  updateWeatherUI();

  const soundButton = requireElement('sfxBtn');
  const musicButton = requireElement('musicBtn');
  function syncSoundButtons(): void {
    const { sfx, music } = deps.sound;
    soundButton.textContent = 'Sound: ' + (sfx ? 'On' : 'Off');
    musicButton.textContent = 'Music: ' + (music ? 'On' : 'Off');
    soundButton.setAttribute('aria-pressed', String(sfx));
    musicButton.setAttribute('aria-pressed', String(music));
  }
  soundButton.addEventListener('click', () => {
    deps.initializeAudio();
    deps.sound.sfx = !deps.sound.sfx;
    deps.applySound(); deps.saveSound(); syncSoundButtons(); deps.playClick();
  });
  musicButton.addEventListener('click', () => {
    deps.initializeAudio();
    deps.sound.music = !deps.sound.music;
    deps.applySound(); deps.saveSound(); syncSoundButtons();
    if (deps.sound.music) deps.sound.nextMusic = 0.2;
  });
  window.addEventListener('keydown', event => {
    if (event.code !== 'KeyM' || event.repeat) return;
    deps.initializeAudio();
    const enabled = !(deps.sound.sfx || deps.sound.music);
    deps.sound.sfx = deps.sound.music = enabled;
    deps.applySound(); deps.saveSound(); syncSoundButtons();
    if (deps.isPlaying()) showHint('Sound ' + (enabled ? 'on' : 'off'), 1200);
  });
  syncSoundButtons();

  for (const button of difficultyButtons) {
    button.addEventListener('click', () => deps.setDifficulty(button.dataset.diff as Difficulty));
  }
  for (const button of modeButtons) {
    button.addEventListener('click', () => {
      deps.setMode(button.dataset.mode as GameMode);
      deps.saveAndRefreshWorlds();
    });
  }
  playBtn.addEventListener('click', deps.onPlay);

  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  function showHint(message: string, milliseconds = 6000): void {
    hintEl.textContent = message;
    hintEl.style.display = 'block';
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { hintEl.style.display = 'none'; }, milliseconds);
  }
  return { overlay, playBtn, newBtn, subEl, infoEl, objEl,
    updateModeUI, updateDiffUI: updateDifficultyUI, updateWeatherUI,
    showHint, syncSoundBtns: syncSoundButtons };
}
