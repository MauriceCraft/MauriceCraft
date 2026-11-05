import * as THREE from 'three';
import { ckey } from '../world/chunk-key';
import { portalContains, type PortalDimension, type PortalFrame } from './frame';

export type WorldDimension = PortalDimension | 'end';
export interface PortalChunk {
  cx: number;
  cz: number;
  edited?: boolean;
  data: Uint8Array;
}
export interface PortalPlayer {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  fallStart: number | null;
}
export interface PortalSystemDependencies<Chunk extends PortalChunk> {
  scene: THREE.Scene;
  portals: PortalFrame[];
  chunks: Map<number, Chunk>;
  savedChunks: Map<number, Uint8Array>;
  obsidian: number;
  worldHeight: number;
  getDimension: () => WorldDimension;
  setDimension: (dimension: WorldDimension) => void;
  getPlayer: () => PortalPlayer;
  isPlaying: () => boolean;
  ensureAround: (x: number, z: number) => void;
  getOrGenerate: (cx: number, cz: number) => unknown;
  setBlock: (x: number, y: number, z: number, id: number) => void;
  topBlockY: (x: number, z: number) => number;
  rebuildRegion: (x1: number, z1: number, x2: number, z2: number) => void;
  disposeMesh: (chunk: Chunk) => void;
  resetChunkCache: () => void;
  clearStructures: () => void;
  clearMobs: () => void;
  collides: (x: number, y: number, z: number) => boolean;
  saveWorld: () => void;
  showHint: (message: string, milliseconds: number) => void;
}

/** Owns portal meshes and safe dimension transitions; does not own saved world metadata. */
export function createPortalSystem<Chunk extends PortalChunk>(
  deps: PortalSystemDependencies<Chunk>,
) {
  const { scene, portals, chunks, savedChunks, obsidian, worldHeight, getDimension,
    setDimension, getPlayer, isPlaying, ensureAround, getOrGenerate,
    setBlock, topBlockY, rebuildRegion, disposeMesh, resetChunkCache,
    clearStructures, clearMobs, collides, saveWorld, showHint } = deps;
  const portalVisuals: THREE.Mesh[] = [];
  let portalCooldown = 0;

  function clearPortalVisuals(): void {
    for (const mesh of portalVisuals) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) mesh.material.forEach(material => material.dispose());
      else mesh.material.dispose();
    }
    portalVisuals.length = 0;
  }

  function showPortalVisual(portal: PortalFrame): void {
    if (portal.dimension !== getDimension()) return;
    const geometry = new THREE.PlaneGeometry(portal.width + 0.85, portal.height - 0.15);
    const material = new THREE.MeshBasicMaterial({
      color: 0x9a42ff, transparent: true, opacity: 0.62,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(portal.x + 0.5, portal.y + 1 + portal.height / 2, portal.z + 0.5);
    if (portal.axis === 'z') mesh.rotation.y = Math.PI / 2;
    scene.add(mesh);
    portalVisuals.push(mesh);
  }

  function buildPortalFrame(
    dimension: PortalDimension, centerX: number, baseY: number, centerZ: number,
  ): PortalFrame {
    const chunkX = Math.round(centerX);
    const chunkZ = Math.round(centerZ);
    const bottomY = Math.max(1, Math.min(worldHeight - 6, Math.floor(baseY)));
    ensureAround(chunkX, chunkZ);
    const portal: PortalFrame = {
      dimension, x: chunkX - 0.5, y: bottomY, z: chunkZ,
      width: 2, height: 3, axis: 'x',
    };
    for (let dx = -2; dx <= 1; dx++) {
      for (let dy = 0; dy <= 4; dy++) {
        const isBorder = dx === -2 || dx === 1 || dy === 0 || dy === 4;
        setBlock(chunkX + dx, bottomY + dy, chunkZ, isBorder ? obsidian : 0);
      }
    }
    portals.push(portal);
    showPortalVisual(portal);
    rebuildRegion(chunkX - 2, chunkZ, chunkX + 2, chunkZ);
    saveWorld();
    showHint('Portal activated! Walk through the purple opening.', 3000);
    return portal;
  }

  function changeDimension(
    destination: WorldDimension, x?: number, z?: number, y?: number,
  ): void {
    clearPortalVisuals();
    if (getDimension() === 'overworld') {
      for (const chunk of chunks.values()) {
        if (chunk.edited) savedChunks.set(ckey(chunk.cx, chunk.cz), chunk.data.slice());
      }
    }
    for (const chunk of chunks.values()) disposeMesh(chunk);
    chunks.clear();
    resetChunkCache();
    clearStructures();
    clearMobs();
    setDimension(destination);
    portals.forEach(showPortalVisual);

    const targetX = x ?? 0.5;
    const targetZ = z ?? 0.5;
    ensureAround(targetX, targetZ);
    const player = getPlayer();
    player.x = targetX;
    player.z = targetZ;
    player.y = y ?? (destination === 'nether' ? 15 :
      (destination === 'end' ? 22 : topBlockY(Math.floor(targetX), Math.floor(targetZ)) + 1.01));
    for (let tries = 0; tries < 12 && collides(player.x, player.y, player.z); tries++) {
      player.y += 1;
    }
    player.vx = player.vy = player.vz = 0;
    player.fallStart = null;
    saveWorld();
    showHint(destination === 'nether'
      ? 'Welcome to the Nether! Watch your step in the red-hot caverns.'
      : destination === 'end'
        ? 'Welcome to the End! Stay on the floating islands.'
        : 'Back to the Overworld.', 5000);
  }

  function checkPortal(deltaSeconds: number): void {
    portalCooldown = Math.max(0, portalCooldown - deltaSeconds);
    const dimension = getDimension();
    if (portalCooldown > 0 || !isPlaying() || dimension === 'end') return;
    const player = getPlayer();
    const entered = portals.find(portal => portalContains(portal, dimension, player));
    if (!entered) return;

    const destinationDimension: PortalDimension = dimension === 'overworld' ? 'nether' : 'overworld';
    const scale = dimension === 'overworld' ? 1 / 8 : 8;
    const destinationX = Math.round(entered.x * scale);
    const destinationZ = Math.round(entered.z * scale);
    let destination = portals.find(portal =>
      portal.dimension === destinationDimension &&
      Math.abs(portal.x - destinationX) < 3 && Math.abs(portal.z - destinationZ) < 3,
    );
    changeDimension(destinationDimension, destinationX, destinationZ,
      destinationDimension === 'nether' ? 15 : undefined);
    if (!destination) {
      getOrGenerate(destinationX >> 4, destinationZ >> 4);
      const floorY = destinationDimension === 'nether' ? 13 :
        topBlockY(destinationX, destinationZ) + 1;
      destination = buildPortalFrame(destinationDimension, destinationX, floorY, destinationZ);
    }
    player.x = destination.x + (destination.axis === 'z' ? 2.1 : 0);
    player.z = destination.z + (destination.axis === 'z' ? 0 : 2.1);
    player.y = destination.y + 1.05;
    for (let tries = 0; tries < 12 && collides(player.x, player.y, player.z); tries++) {
      player.y += 1;
    }
    portalCooldown = 2.5;
    showHint('Portal travel: ' +
      (destinationDimension === 'nether' ? 'Overworld → Nether' : 'Nether → Overworld'), 3000);
  }

  return { clearPortalVisuals, showPortalVisual, buildPortalFrame,
    changeDimension, checkPortal };
}
