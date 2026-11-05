import type { GameMode } from '../ui/game-menu';

export interface PlayerMovementBody {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number; pitch: number;
  onGround: boolean; fly: boolean;
  fallStart: number | null;
}

export interface PlayerMovementDependencies {
  player: PlayerMovementBody;
  keys: Record<string, boolean>;
  touchMovement: { x: number; z: number };
  getMode: () => GameMode;
  getHunger: () => number;
  isJumpPressed: () => boolean;
  isSleeping: () => boolean;
  getSpectatorSpeed: () => number;
  worldHeight: number;
  moveEntity: (axis: 0 | 1 | 2, distance: number) => void;
  checkPortal: (seconds: number) => void;
  respawn: () => void;
  exert: (amount: number) => void;
  refreshHunger: () => void;
  getSurfaceBlock: (x: number, y: number, z: number) => number;
  playStep: (blockId: number) => void;
  playLanding: (volume: number) => void;
  applyFallDamage: (damage: number) => void;
}

/** The game loop delegates only player input, physics, and fall handling here. */
export function createPlayerMovement(deps: PlayerMovementDependencies) {
  let distanceSinceStep = 0;

  function updateMovement(seconds: number): void {
    const { player, keys, touchMovement } = deps;
    const mode = deps.getMode();
    let horizontalInput = Number(Boolean(keys.KeyD)) - Number(Boolean(keys.KeyA));
    let forwardInput = Number(Boolean(keys.KeyS)) - Number(Boolean(keys.KeyW));
    if (keys.ArrowLeft) player.yaw += 2 * seconds;
    if (keys.ArrowRight) player.yaw -= 2 * seconds;
    if (keys.ArrowUp) player.pitch = Math.min(1.55, player.pitch + 1.6 * seconds);
    if (keys.ArrowDown) player.pitch = Math.max(-1.55, player.pitch - 1.6 * seconds);
    horizontalInput += touchMovement.x;
    forwardInput += touchMovement.z;
    if (deps.isSleeping()) {
      horizontalInput = 0;
      forwardInput = 0;
    }
    const inputLength = Math.hypot(horizontalInput, forwardInput);
    if (inputLength > 1) {
      horizontalInput /= inputLength;
      forwardInput /= inputLength;
    }
    const shiftPressed = Boolean(keys.ShiftLeft || keys.ShiftRight);
    const jumpPressed = deps.isJumpPressed() && !deps.isSleeping();
    const sinYaw = Math.sin(player.yaw);
    const cosYaw = Math.cos(player.yaw);

    if (mode === 'spectator') {
      const speed = 12 * deps.getSpectatorSpeed();
      const cosPitch = Math.cos(player.pitch);
      const sinPitch = Math.sin(player.pitch);
      const targetVelocityX = (horizontalInput * cosYaw + forwardInput * sinYaw * cosPitch) * speed;
      const targetVelocityZ = (-horizontalInput * sinYaw + forwardInput * cosYaw * cosPitch) * speed;
      const targetVelocityY = (-forwardInput * sinPitch + Number(jumpPressed) - Number(shiftPressed)) * speed;
      const smoothFactor = Math.min(1, 10 * seconds);
      player.vx += (targetVelocityX - player.vx) * smoothFactor;
      player.vy += (targetVelocityY - player.vy) * smoothFactor;
      player.vz += (targetVelocityZ - player.vz) * smoothFactor;
      player.x += player.vx * seconds;
      player.y = Math.max(-5, Math.min(deps.worldHeight + 40, player.y + player.vy * seconds));
      player.z += player.vz * seconds;
      player.onGround = false;
      player.fallStart = null;
      return;
    }

    const flying = player.fly && mode === 'creative';
    const moving = horizontalInput !== 0 || forwardInput !== 0;
    const sprinting = shiftPressed && !flying && moving && !(mode === 'survival' && deps.getHunger() <= 6);
    const speed = flying ? (keys.ControlLeft ? 18 : 10) : (sprinting ? 6.6 : 4.4);
    const targetVelocityX = (horizontalInput * cosYaw + forwardInput * sinYaw) * speed;
    const targetVelocityZ = (-horizontalInput * sinYaw + forwardInput * cosYaw) * speed;
    const acceleration = player.onGround || flying ? 14 : 3.5;
    const smoothFactor = Math.min(1, acceleration * seconds);
    player.vx += (targetVelocityX - player.vx) * smoothFactor;
    player.vz += (targetVelocityZ - player.vz) * smoothFactor;
    if (flying) {
      const verticalInput = Number(jumpPressed) - Number(shiftPressed);
      player.vy += (verticalInput * speed - player.vy) * Math.min(1, 10 * seconds);
    } else {
      player.vy = Math.max(-50, player.vy - 28 * seconds);
      if (jumpPressed && player.onGround) {
        player.vy = 8.6;
        deps.exert(sprinting ? 0.2 : 0.04);
      }
    }
    player.onGround = false;
    deps.moveEntity(0, player.vx * seconds);
    deps.moveEntity(2, player.vz * seconds);
    deps.moveEntity(1, player.vy * seconds);
    deps.checkPortal(seconds);
    if (player.y < -30) deps.respawn();

    const horizontalSpeed = Math.hypot(player.vx, player.vz);
    deps.exert(seconds * (0.015 + (horizontalSpeed > 1.2 && player.onGround ? (sprinting ? 0.13 : 0.03) : 0)));
    deps.refreshHunger();
    if (!flying && player.onGround && horizontalSpeed > 1.2) {
      distanceSinceStep += horizontalSpeed * seconds;
      if (distanceSinceStep > 2.2) {
        distanceSinceStep = 0;
        deps.playStep(deps.getSurfaceBlock(
          Math.floor(player.x), Math.floor(player.y - 0.2), Math.floor(player.z),
        ));
      }
    }

    if (flying) {
      player.fallStart = null;
    } else if (player.onGround) {
      if (player.fallStart !== null) {
        const fallDistance = player.fallStart - player.y;
        if (fallDistance > 3.5) deps.applyFallDamage(Math.floor(fallDistance - 3));
        else if (fallDistance > 1.6) deps.playLanding(Math.min(1, fallDistance / 5));
        player.fallStart = null;
      }
    } else if (player.vy < 0) {
      player.fallStart = player.fallStart === null
        ? player.y : Math.max(player.fallStart, player.y);
    } else {
      player.fallStart = null;
    }
  }

  return { updateMovement };
}
