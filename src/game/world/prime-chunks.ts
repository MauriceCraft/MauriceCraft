/**
 * Keep the first frame responsive, particularly on mobile GPUs.
 *
 * Generating a 7×7 region and meshing 5×5 synchronously during startup
 * made the Play button appear frozen on slower phones. The chunk streamer
 * already generates and meshes the remainder over multiple animation frames.
 *
 * We need a 3×3 block-data neighborhood for safe collision / meshing and
 * only the central chunk's initial mesh to display a playable scene.
 */
export function primeWorldChunks(
  centerChunkX: number,
  centerChunkZ: number,
  generateChunk: (chunkX: number, chunkZ: number) => unknown,
  meshChunk: (chunkX: number, chunkZ: number) => unknown,
): void {
  for (let chunkZ = centerChunkZ - 1; chunkZ <= centerChunkZ + 1; chunkZ++) {
    for (let chunkX = centerChunkX - 1; chunkX <= centerChunkX + 1; chunkX++) {
      generateChunk(chunkX, chunkZ);
    }
  }
  meshChunk(centerChunkX, centerChunkZ);
}
