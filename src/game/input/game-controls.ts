/** Browser input adapters: keyboard, mouse, multitouch and mobile action buttons. */
export interface DragGesture {
  place: boolean;
  moved: number;
  t0: number;
}
export interface MovementTouch {
  id: number;
  sx: number;
  sy: number;
}
export interface CameraTouch {
  id: number;
  lx: number;
  ly: number;
  t0: number;
  moved: number;
}
export interface InputControlState {
  playing: boolean;
  locked: boolean;
  fallback: boolean;
  selected: number;
  specSpeed: number;
  mining: boolean;
  placing: boolean;
  pulseMine: boolean;
  pulsePlace: boolean;
  mineCd: number;
  placeCd: number;
  drag: DragGesture | null;
  stick: MovementTouch | null;
  lookT: CameraTouch | null;
  touchJump: boolean;
}
export interface InputControlDependencies {
  canvas: HTMLCanvasElement;
  keys: Record<string, boolean>;
  touchMove: { x: number; z: number };
  player: { yaw: number; pitch: number; fly: boolean; vy: number };
  state: InputControlState;
  isTouch: boolean;
  getMode: () => string;
  canInteract: () => boolean;
  updateHotbar: (showName: boolean) => void;
  showHint: (message: string, milliseconds: number) => void;
  openInventory: () => void;
  openCommand: (command: string) => void;
  pause: () => void;
}

export function scrollHotbar(currentSlot: number, down: boolean): number {
  return (currentSlot + (down ? 1 : 8)) % 9;
}

export function spectatorScrollSpeed(speed: number, down: boolean): number {
  return Math.max(0.25, Math.min(6, speed * (down ? 0.8 : 1.25)));
}

export function rotateLook(yaw: number, pitch: number, deltaX: number, deltaY: number, sensitivity: number) {
  return {
    yaw: yaw - deltaX * sensitivity,
    pitch: Math.max(-1.55, Math.min(1.55, pitch - deltaY * sensitivity)),
  };
}

/** The adapter has no gameplay/world ownership; callers share one input state. */
export function createInputControls(deps: InputControlDependencies) {
  const { canvas, keys, touchMove, player, state, isTouch } = deps;
  const touchUI = document.getElementById('touchui');
  const jumpButton = document.getElementById('btnJump');
  const placeButton = document.getElementById('btnPlace');
  const flyButton = document.getElementById('btnFly');
  const inventoryButton = document.getElementById('btnInv');
  const commandButton = document.getElementById('btnCmd');
  if (!touchUI || !jumpButton || !placeButton || !flyButton || !inventoryButton || !commandButton) {
    throw new Error('Missing touch controls in the game page');
  }
  let lastJumpTime = 0;

  function toggleFly(): void {
    if (deps.getMode() !== 'creative') return;
    player.fly = !player.fly;
    player.vy = 0;
  }

  function doubleTapFly(): void {
    const now = performance.now();
    if (deps.getMode() === 'creative' && now - lastJumpTime < 320) {
      toggleFly();
      lastJumpTime = 0;
    } else lastJumpTime = now;
  }

  function look(deltaX: number, deltaY: number, sensitivity: number): void {
    const angle = rotateLook(player.yaw, player.pitch, deltaX, deltaY, sensitivity);
    player.yaw = angle.yaw;
    player.pitch = angle.pitch;
  }

  window.addEventListener('keydown', event => {
    if (!state.playing) return;
    keys[event.code] = true;
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
    if (event.code.startsWith('Digit') && deps.canInteract()) {
      const digit = Number.parseInt(event.code.slice(5), 10);
      if (digit >= 1 && digit <= 9) {
        state.selected = digit - 1;
        deps.updateHotbar(true);
      }
    }
    if (event.code === 'Space' && !event.repeat) doubleTapFly();
    if (event.code === 'KeyF' && !event.repeat) toggleFly();
    if (event.code === 'KeyE' && !event.repeat) state.pulsePlace = true;
    if (event.code === 'KeyQ' && !event.repeat) state.pulseMine = true;
    if (event.code === 'KeyP' && state.fallback) deps.pause();
  });
  window.addEventListener('keyup', event => { keys[event.code] = false; });
  window.addEventListener('blur', () => {
    for (const code in keys) keys[code] = false;
    state.mining = false;
    state.placing = false;
  });
  window.addEventListener('wheel', event => {
    if (!state.playing) return;
    if (deps.getMode() === 'spectator') {
      state.specSpeed = spectatorScrollSpeed(state.specSpeed, event.deltaY > 0);
      deps.showHint('Fly speed x' + state.specSpeed.toFixed(2), 1200);
    } else if (deps.canInteract()) {
      state.selected = scrollHotbar(state.selected, event.deltaY > 0);
      deps.updateHotbar(true);
    }
  }, { passive: true });
  window.addEventListener('contextmenu', event => event.preventDefault());

  canvas.addEventListener('mousedown', event => {
    if (!state.playing) return;
    const place = event.button === 2 ||
      (event.button === 0 && (event.ctrlKey || event.metaKey || event.altKey));
    if (!state.locked) state.drag = { place, moved: 0, t0: performance.now() };
    if (place) {
      state.placing = true;
      state.placeCd = 0;
    } else if (event.button === 0) {
      state.mining = true;
      state.mineCd = 0;
    }
  });
  window.addEventListener('mouseup', () => {
    const gesture = state.drag;
    if (gesture && gesture.moved < 6 && performance.now() - gesture.t0 <= 160) {
      if (gesture.place) state.pulsePlace = true;
      else state.pulseMine = true;
    }
    state.drag = null;
    state.mining = false;
    state.placing = false;
  });
  window.addEventListener('mousemove', event => {
    if (!state.playing) return;
    if (state.locked) look(event.movementX, event.movementY, 0.0023);
    else if (state.drag) {
      state.drag.moved += Math.abs(event.movementX) + Math.abs(event.movementY);
      if (state.drag.moved >= 6) look(event.movementX, event.movementY, 0.0028);
    }
  });

  canvas.addEventListener('touchstart', event => {
    if (!state.playing) return;
    event.preventDefault();
    for (const touch of event.changedTouches) {
      if (touch.clientX < window.innerWidth * 0.4 && !state.stick) {
        state.stick = { id: touch.identifier, sx: touch.clientX, sy: touch.clientY };
      } else if (!state.lookT) {
        state.lookT = { id: touch.identifier, lx: touch.clientX, ly: touch.clientY, t0: performance.now(), moved: 0 };
      }
    }
  }, { passive: false });
  canvas.addEventListener('touchmove', event => {
    if (!state.playing) return;
    event.preventDefault();
    for (const touch of event.changedTouches) {
      const stick = state.stick;
      const lookTouch = state.lookT;
      if (stick && touch.identifier === stick.id) {
        touchMove.x = Math.max(-1, Math.min(1, (touch.clientX - stick.sx) / 50));
        touchMove.z = Math.max(-1, Math.min(1, (touch.clientY - stick.sy) / 50));
      } else if (lookTouch && touch.identifier === lookTouch.id) {
        look(touch.clientX - lookTouch.lx, touch.clientY - lookTouch.ly, 0.0055);
        lookTouch.moved += Math.abs(touch.clientX - lookTouch.lx) + Math.abs(touch.clientY - lookTouch.ly);
        lookTouch.lx = touch.clientX;
        lookTouch.ly = touch.clientY;
      }
    }
  }, { passive: false });
  function endTouch(event: TouchEvent): void {
    for (const touch of event.changedTouches) {
      if (state.stick && touch.identifier === state.stick.id) {
        state.stick = null;
        touchMove.x = 0;
        touchMove.z = 0;
      } else if (state.lookT && touch.identifier === state.lookT.id) {
        if (performance.now() - state.lookT.t0 < 260 && state.lookT.moved < 10) state.pulseMine = true;
        state.lookT = null;
      }
    }
  }
  canvas.addEventListener('touchend', endTouch);
  canvas.addEventListener('touchcancel', endTouch);

  jumpButton.addEventListener('touchstart', event => {
    event.preventDefault();
    state.touchJump = true;
    doubleTapFly();
  }, { passive: false });
  jumpButton.addEventListener('touchend', () => { state.touchJump = false; });
  placeButton.addEventListener('touchstart', event => { event.preventDefault(); state.pulsePlace = true; }, { passive: false });
  flyButton.addEventListener('touchstart', event => { event.preventDefault(); toggleFly(); }, { passive: false });
  placeButton.addEventListener('click', () => { if (!isTouch) state.pulsePlace = true; });
  flyButton.addEventListener('click', () => { if (!isTouch) toggleFly(); });
  inventoryButton.addEventListener('touchstart', event => {
    event.preventDefault();
    if (state.playing) deps.openInventory();
  }, { passive: false });
  inventoryButton.addEventListener('click', () => { if (!isTouch && state.playing) deps.openInventory(); });
  commandButton.addEventListener('touchstart', event => {
    event.preventDefault();
    if (state.playing) deps.openCommand('/');
  }, { passive: false });

  return { touchUI, jumpButton, placeButton, flyButton, inventoryButton, toggleFly };
}
