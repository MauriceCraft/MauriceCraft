import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createPortalSystem, type WorldDimension } from '../../src/game/portals/portal-system';
import type { PortalFrame } from '../../src/game/portals/frame';

function fixture() {
  const scene = new THREE.Scene();
  const portals: PortalFrame[] = [];
  const chunks = new Map<number, { cx: number; cz: number; edited: boolean; data: Uint8Array }>();
  const savedChunks = new Map<number, Uint8Array>();
  const player = { x: 0.5, y: 15, z: 0.5, vx: 1, vy: 0, vz: 0, fallStart: null };
  let dimension: WorldDimension = 'overworld';
  const blocks: Array<[number, number, number, number]> = [];
  const saveWorld = vi.fn();
  const portalSystem = createPortalSystem({
    scene, portals, chunks, savedChunks, obsidian: 12, worldHeight: 48,
    getDimension: () => dimension, setDimension: next => { dimension = next; },
    getPlayer: () => player, isPlaying: () => true,
    ensureAround: () => undefined, getOrGenerate: () => undefined,
    setBlock: (x, y, z, id) => { blocks.push([x, y, z, id]); },
    topBlockY: () => 13, rebuildRegion: () => undefined,
    disposeMesh: () => undefined, resetChunkCache: () => undefined,
    clearStructures: () => undefined, clearMobs: () => undefined,
    collides: () => false, saveWorld, showHint: () => undefined,
  });
  return { scene, portals, chunks, savedChunks, player, blocks,
    saveWorld, portalSystem, getDimension: () => dimension };
}
describe('portal lifecycle and dimension transitions', () => {
  it('builds frame blocks, shows the purple plane and disposes visuals on unload', () => {
    const { scene, portals, blocks, portalSystem } = fixture();
    const portal = portalSystem.buildPortalFrame('overworld', 0, 12, 0);
    expect(blocks).toHaveLength(20);
    expect(blocks.filter(entry => entry[3] === 12)).toHaveLength(14);
    expect(portal.width).toBe(2);
    expect(portals).toHaveLength(1);
    expect(scene.children).toHaveLength(1);
    portalSystem.clearPortalVisuals();
    expect(scene.children).toHaveLength(0);
  });
  it('preserves edited Overworld chunks when moving to another dimension', () => {
    const { chunks, savedChunks, portalSystem, getDimension, player } = fixture();
    chunks.set(4, { cx: 4, cz: 0, edited: true, data: new Uint8Array([1, 2]) });
    portalSystem.changeDimension('nether', 8, 16);
    expect(savedChunks.size).toBe(1);
    expect([...savedChunks.values()][0]).toEqual(new Uint8Array([1, 2]));
    expect(chunks.size).toBe(0);
    expect(getDimension()).toBe('nether');
    expect(player.y).toBe(15);
    expect(player.vx).toBe(0);
  });
  it('travels through a portal and respects the return cooldown', () => {
    const { player, portalSystem, portals, getDimension, saveWorld } = fixture();
    const portal = portalSystem.buildPortalFrame('overworld', 0, 12, 0);
    player.x = portal.x + 0.5;
    player.y = portal.y + 1;
    player.z = portal.z + 0.5;
    portalSystem.checkPortal(0.016);
    expect(getDimension()).toBe('nether');
    expect(portals).toHaveLength(2);
    const saveCount = saveWorld.mock.calls.length;
    portalSystem.checkPortal(0.016);
    expect(saveWorld).toHaveBeenCalledTimes(saveCount);
  });
});
