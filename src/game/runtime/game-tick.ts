import type * as THREE from 'three';
import type { BlockRayHit } from '../world/raycast';

export interface TickState {
  mode: string;
  difficulty: string;
  hunger: number;
  health: number;
  dead: boolean;
  sleepTime: number;
  slept: boolean;
  timeOfDay: number;
  sinceHurt: number;
  regenerationTimer: number;
  starvationTimer: number;
  shake: number;
}

export interface TickDifficulty {
  regenAfter: number;
  regenEvery: number;
}

export interface TickDependencies {
  state: TickState;
  player: { x: number; y: number; z: number; yaw: number; pitch: number };
  camera: THREE.Camera;
  selection: { visible: boolean; position: { set: (x: number, y: number, z: number) => unknown } };
  fadeElement: { style: { opacity: string } };
  difficulty: Readonly<Record<string, TickDifficulty>>;
  lavaBlock: number;
  maximumHealth: number;
  eyeHeight: number;
  getBlock: (x: number, y: number, z: number) => number;
  canInteract: () => boolean;
  hasHealth: () => boolean;
  raycast: (maxDistance: number) => BlockRayHit | null;
  setBlockHit: (hit: BlockRayHit | null) => void;
  setTarget: (target: BlockRayHit | null) => void;
  damagePlayer: (damage: number, scaled?: boolean) => void;
  setWeather: (weather: 'clear') => void;
  showHint: (message: string, ms: number) => void;
  playSound: (event: string) => void;
  flashName: (message: string) => void;
  updatePlayerMovement: (deltaSeconds: number) => void;
  updateMobs: (deltaSeconds: number) => void;
  updateBlasts: (deltaSeconds: number) => void;
  updateArrows: (deltaSeconds: number) => void;
  updateFx: (deltaSeconds: number) => void;
  updateMusic: (deltaSeconds: number) => void;
  updateHearts: () => void;
  exert: (amount: number) => void;
  checkRelics: () => void;
  handleActions: (deltaSeconds: number, now: number) => void;
  random?: () => number;
}

/** One active gameplay frame; the frame scheduler owns readiness and render order. */
export function createGameTick(deps: TickDependencies): (deltaSeconds: number, now: number) => void {
  const { state, player, camera, selection, fadeElement } = deps;
  const random = deps.random ?? Math.random;
  let lavaDamageTimer = 0;

  return (deltaSeconds: number, now: number): void => {
    const dt = Math.min(deltaSeconds, 0.05);
    lavaDamageTimer -= dt;
    if (state.mode !== 'spectator' && lavaDamageTimer <= 0 &&
      deps.getBlock(Math.floor(player.x), Math.floor(player.y + 0.2), Math.floor(player.z)) === deps.lavaBlock) {
      deps.damagePlayer(2, false);
      lavaDamageTimer = 0.8;
      deps.flashName('Ouch! Lava burns you!');
    }
    if (state.sleepTime > 0) {
      state.sleepTime -= dt;
      const elapsed = 3.2 - state.sleepTime;
      fadeElement.style.opacity = String(state.sleepTime <= 0 ? 0 :
        (elapsed < 1 ? elapsed : (state.sleepTime > 1 ? 1 : state.sleepTime)));
      if (!state.slept && elapsed >= 1.2) {
        state.slept = true;
        state.timeOfDay = 0.02;
        deps.setWeather('clear');
        deps.showHint('Good morning!', 1800);
        deps.playSound('pop');
      }
    }
    deps.updatePlayerMovement(dt);
    camera.position.set(player.x, player.y + deps.eyeHeight, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0);

    const blockHit = state.mode === 'spectator' ? null :
      deps.raycast(deps.canInteract() ? (state.mode === 'creative' ? 6 : 5) : 4);
    const target = deps.canInteract() ? blockHit : null;
    deps.setBlockHit(blockHit);
    deps.setTarget(target);
    if (target) {
      selection.visible = true;
      selection.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
    } else selection.visible = false;

    deps.updateMobs(dt);
    deps.updateBlasts(dt);
    deps.updateArrows(dt);
    deps.updateFx(dt);
    deps.updateMusic(dt);
    if (deps.hasHealth()) {
      state.sinceHurt += dt;
      const config = deps.difficulty[state.difficulty];
      if (state.health < deps.maximumHealth && state.sinceHurt > config.regenAfter &&
        (state.mode !== 'survival' || state.difficulty === 'peaceful' || state.hunger >= 15)) {
        state.regenerationTimer += dt;
        if (state.regenerationTimer >= config.regenEvery) {
          state.regenerationTimer = 0;
          state.health = Math.min(deps.maximumHealth, state.health + 1);
          deps.updateHearts();
          deps.exert(1.2);
        }
      }
      if (state.mode === 'survival' && state.difficulty !== 'peaceful' && state.hunger <= 0) {
        state.starvationTimer += dt;
        if (state.starvationTimer >= 4) {
          state.starvationTimer = 0;
          if (state.health > (state.difficulty === 'easy' ? 10 : (state.difficulty === 'normal' ? 1 : 0))) {
            deps.damagePlayer(1);
          }
        }
      } else state.starvationTimer = 0;
      if (state.mode === 'adventure') deps.checkRelics();
    }
    if (!state.dead && state.sleepTime <= 0) deps.handleActions(dt, now);
    if (state.shake > 0) {
      camera.position.x += (random() - 0.5) * state.shake * 0.35;
      camera.position.y += (random() - 0.5) * state.shake * 0.35;
      camera.rotation.z = (random() - 0.5) * state.shake * 0.05;
      state.shake = Math.max(0, state.shake - dt * 2.2);
    } else camera.rotation.z = 0;
  };
}
