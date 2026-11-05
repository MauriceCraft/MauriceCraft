import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ckey } from '../../src/game/world/chunk-key';
import { createChunkMesher, type MeshChunk } from '../../src/game/rendering/chunk-mesher';

interface TestChunk extends MeshChunk { edited?: boolean }
function fixture(blockId: number) {
  const scene = new THREE.Scene();
  const chunks = new Map<number, TestChunk>();
  const data = new Uint8Array(16 * 16 * 48);
  data[(1 * 16 + 1) * 16 + 1] = blockId;
  const chunk: TestChunk = { cx: 0, cz: 0, data, meshed: false, mesh: null };
  chunks.set(ckey(0, 0), chunk);
  const mesher = createChunkMesher({
    scene, mat: new THREE.MeshBasicMaterial(),
    torchMat: new THREE.MeshBasicMaterial(), glowMat: new THREE.PointsMaterial(),
    chunks, chunkAt: (cx, cz) => chunks.get(ckey(cx, cz)) ?? null,
    getBlock: (x, y, z) => x >= 0 && x < 16 && z >= 0 && z < 16 && y >= 0 && y < 48
      ? data[(y * 16 + z) * 16 + x] : 0,
    opq: b => b !== 0 && b !== 17 && b !== 34 && b !== 35, isBed: b => b >= 19 && b <= 26,
    tiles: { 3: [3, 3, 3], 34: [96, 96, 96], 35: [97, 97, 97] }, height: 48, chunkSize: 16,
    atlasTiles: 128, bedHeight: 0.5625, torchId: 17,
    waterId: 34, lavaId: 35,
  });
  return { scene, chunk, mesher };
}
describe('typed chunk meshing', () => {
  it('creates all six faces for an isolated block and frees GPU geometry', () => {
    const { scene, chunk, mesher } = fixture(3);
    mesher.buildChunk(0, 0);
    expect(chunk.meshed).toBe(true);
    expect(chunk.mesh).toBeInstanceOf(THREE.Mesh);
    expect((chunk.mesh?.geometry as THREE.BufferGeometry).getIndex()?.count).toBe(36);
    expect(scene.children).toContain(chunk.mesh);
    mesher.disposeMesh(chunk);
    expect(chunk.meshed).toBe(false);
    expect(scene.children).toHaveLength(0);
  });
  it('does not render the six faces between neighboring water blocks', () => {
    const { chunk, mesher } = fixture(34);
    chunk.data[(1 * 16 + 1) * 16 + 2] = 34;
    // Fixture's visibility treats liquids as transparent.
    mesher.buildChunk(0, 0);
    expect(chunk.mesh).toBeInstanceOf(THREE.Mesh);
    expect((chunk.mesh!.geometry as THREE.BufferGeometry).getIndex()!.count).toBeLessThan(72);
  });
  it('creates a separate, always-bright torch mesh and glow', () => {
    const { scene, chunk, mesher } = fixture(17);
    mesher.buildChunk(0, 0);
    expect(chunk.mesh).toBeNull();
    expect(chunk.mesh2).toBeInstanceOf(THREE.Mesh);
    expect(chunk.glow).toBeInstanceOf(THREE.Points);
    expect(scene.children).toHaveLength(2);
    mesher.disposeMesh(chunk);
    expect(scene.children).toHaveLength(0);
  });
  it('shares canonical six-face geometry with explosive block entities', () => {
    const { mesher } = fixture(3);
    const geometry = mesher.blockGeo(3);
    expect(geometry.getIndex()?.count).toBe(36);
    expect(geometry.getAttribute('position').count).toBe(24);
    geometry.dispose();
    expect(() => mesher.blockGeo(999)).toThrow('unknown block ID');
  });
});
