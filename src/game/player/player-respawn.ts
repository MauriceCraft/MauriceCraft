/** Restore the player's previous bed spawn, or return to the world origin. */
export interface RespawnPlayer {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number; pitch: number;
  fallStart: number | null;
}
export interface RespawnDependencies {
  player: RespawnPlayer;
  getSpawnPoint: () => { x: number; y: number; z: number } | null;
  clearSpawnPoint: () => void;
  getOrGenerateChunk: (cx: number, cz: number) => unknown;
  getBlock: (x: number, y: number, z: number) => number;
  isBed: (id: number) => boolean;
  collides: (x: number, y: number, z: number) => boolean;
  topBlockY: (x: number, z: number) => number;
}
export function createRespawn(deps: RespawnDependencies): () => void {
  const { player, getOrGenerateChunk, getBlock, isBed, collides, topBlockY } = deps;
  const resetMotion = (): void => {
    player.vx = player.vy = player.vz = 0;
    player.yaw = 0;
    player.pitch = -0.1;
    player.fallStart = null;
  };
  return (): void => {
    const spawn = deps.getSpawnPoint();
    if (spawn) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        getOrGenerateChunk((spawn.x >> 4) + dx, (spawn.z >> 4) + dz);
      }
      if (isBed(getBlock(spawn.x, spawn.y, spawn.z))) {
        let y = spawn.y + 0.57;
        for (let attempt = 0; attempt < 4 &&
          collides(spawn.x + 0.5, y, spawn.z + 0.5); attempt++) y += 1;
        player.x = spawn.x + 0.5;
        player.z = spawn.z + 0.5;
        player.y = y;
        resetMotion();
        return;
      }
      deps.clearSpawnPoint();
    }
    player.x = 0.5;
    player.z = 0.5;
    player.y = topBlockY(0, 0) + 1.01;
    resetMotion();
  };
}
