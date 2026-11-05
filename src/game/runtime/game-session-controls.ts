import type { GameMode, Difficulty } from '../ui/game-menu';

export interface GameSessionState {
  mode: GameMode;
  difficulty: Difficulty;
  mining: boolean; placing: boolean; pulseMine: boolean; pulsePlace: boolean;
  dead: boolean; hp: number; sinceHurt: number; regenT: number;
  hunger: number; sat: number; exhaust: number; starveT: number;
  locked: boolean; fallback: boolean; playing: boolean;
  drag: unknown | null; ready: boolean; invOpen: boolean;
}

export interface GameSessionDependencies {
  state: GameSessionState;
  player: { x: number; y: number; z: number; vy: number; fly: boolean; fallStart: number | null };
  keys: Record<string, boolean>;
  canvas: HTMLCanvasElement;
  document: Pick<Document, 'addEventListener' | 'pointerLockElement' | 'exitPointerLock'>;
  overlay: { classList: { add: (name: string) => void; remove: (name: string) => void } };
  playButton: { textContent: string | null };
  subtitle: { textContent: string | null };
  labels: Readonly<Record<GameMode, string>>;
  difficulties: Readonly<Record<Difficulty, { cap: number }>>;
  maximumHealth: number;
  isTouch: boolean;
  hasHealth: () => boolean;
  clearMobs: () => void;
  removeMobAt: (index: number) => void;
  mobs: Array<{ hostile: boolean }>;
  respawn: () => void;
  collides: (x: number, y: number, z: number) => boolean;
  topY: (x: number, z: number) => number;
  updateModeUI: () => void;
  updateDiffUI: () => void;
  updateHearts: () => void;
  renderFood: () => void;
  saveWorld: () => Promise<unknown>;
  refreshWorlds: () => Promise<unknown>;
  audioInit: () => void;
  playSound: (event: string) => void;
  showHint: (message: string, ms: number) => void;
  schedule?: (callback: () => void, ms: number) => unknown;
}

/** Owns game-mode transitions, pause/death, and pointer-lock fallback. */
export function createGameSessionControls(deps: GameSessionDependencies) {
  const { state, player, overlay, playButton, subtitle, canvas } = deps;
  const schedule = deps.schedule ?? setTimeout;

  function setMode(mode: GameMode): void {
    state.mode = mode;
    state.mining = state.placing = state.pulseMine = state.pulsePlace = false;
    deps.clearMobs();
    state.hp = deps.maximumHealth;
    state.sinceHurt = 99;
    state.regenT = 0;
    state.hunger = 20;
    state.sat = 5;
    state.exhaust = 0;
    state.starveT = 0;
    player.fly = mode === 'spectator';
    player.vy = 0;
    player.fallStart = null;
    if (state.dead) {
      state.dead = false;
      deps.respawn();
      playButton.textContent = state.ready ? 'Play' : 'Loading…';
      subtitle.textContent = 'Mode changed to ' + deps.labels[mode] + '.';
    }
    if (state.ready && mode !== 'spectator' && deps.collides(player.x, player.y, player.z)) {
      player.y = deps.topY(Math.floor(player.x), Math.floor(player.z)) + 1.01;
    }
    deps.updateModeUI();
  }

  function setDifficulty(difficulty: Difficulty): void {
    if (!deps.difficulties[difficulty]) return;
    state.difficulty = difficulty;
    if (deps.difficulties[difficulty].cap === 0 && deps.hasHealth()) {
      for (let i = deps.mobs.length - 1; i >= 0; i--) {
        if (deps.mobs[i].hostile) deps.removeMobAt(i);
      }
    }
    deps.updateDiffUI();
    deps.playSound('click');
    void deps.saveWorld().then(() => deps.refreshWorlds());
  }

  function enterFallback(): void {
    if (state.fallback || deps.isTouch) return;
    state.fallback = true;
    state.locked = false;
    state.playing = true;
    overlay.classList.add('hidden');
    deps.showHint('Mouse capture is blocked here. Drag to look, click to break, right-click to place.', 6000);
  }

  function requestLock(): void {
    try {
      const result = canvas.requestPointerLock?.();
      if (result && typeof result.catch === 'function') void result.catch(enterFallback);
      if (!canvas.requestPointerLock) enterFallback();
    } catch {
      enterFallback();
    }
    schedule(() => {
      if (state.playing && !state.locked && !state.fallback && !deps.isTouch) enterFallback();
    }, 500);
  }

  deps.document.addEventListener('pointerlockerror', enterFallback);
  deps.document.addEventListener('pointerlockchange', () => {
    if (deps.document.pointerLockElement === canvas) state.locked = true;
    else if (state.locked) {
      state.locked = false;
      state.mining = state.placing = false;
      if (!state.fallback && !state.invOpen) pause();
    }
  });

  function startGame(): void {
    if (!state.ready) return;
    deps.audioInit();
    if (state.dead) {
      state.dead = false;
      deps.respawn();
      state.hp = deps.maximumHealth;
      state.hunger = 20;
      state.sat = 5;
      state.exhaust = 0;
      state.sinceHurt = 99;
      deps.clearMobs();
      deps.updateHearts();
      deps.renderFood();
    }
    overlay.classList.add('hidden');
    state.playing = true;
    if (state.mode === 'spectator') {
      deps.showHint('Space up, Shift down, scroll changes speed. You fly where you look.', 5000);
    } else if (state.mode === 'adventure') {
      deps.showHint('Find the glowing beams. Each one marks a relic.', 5000);
    }
    if (!deps.isTouch && !state.fallback) requestLock();
  }

  function pause(): void {
    state.playing = false;
    state.mining = state.placing = false;
    state.drag = null;
    for (const key in deps.keys) deps.keys[key] = false;
    subtitle.textContent = 'Paused. Pick a mode or keep playing.';
    playButton.textContent = 'Resume';
    overlay.classList.remove('hidden');
    if (deps.document.pointerLockElement) deps.document.exitPointerLock();
    void deps.saveWorld().then(() => deps.refreshWorlds());
  }

  function die(): void {
    state.dead = true;
    pause();
    subtitle.textContent = 'You died. Respawn to try again.';
    playButton.textContent = 'Respawn';
  }

  return { setMode, setDifficulty, startGame, pause, die, requestLock, enterFallback };
}
