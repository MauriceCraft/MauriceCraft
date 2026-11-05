import * as THREE from 'three';

export interface ItemDropRecord {
  id: number;
  count: number;
  x: number;
  y: number;
  z: number;
  dimension: string;
  age: number;
}

export interface ItemDropDependencies {
  scene: THREE.Scene;
  atlas: THREE.Texture;
  atlasTiles: number;
  tileOf: (id: number) => number | undefined;
  getBlock: (x: number, y: number, z: number) => number;
  solid: (id: number) => boolean;
  player: { x: number; y: number; z: number };
  getDimension: () => string;
  giveItem: (id: number, count: number) => void;
  playPickup?: () => void;
}

type ActiveDrop = ItemDropRecord & { mesh: THREE.Mesh; vy: number };
const MAX_DROPS = 256;
const PICKUP_DELAY = 0.6;
const EXPIRE_AFTER = 300;

/** Small textured blocks physically drop, bob, then attract to a nearby player. */
export function createItemDropSystem(deps: ItemDropDependencies) {
  const drops: ActiveDrop[] = [];
  const geometryCache = new Map<number, THREE.BoxGeometry>();
  const material = new THREE.MeshBasicMaterial({ map: deps.atlas });
  function geometryFor(id: number): THREE.BoxGeometry {
    const tile = deps.tileOf(id) ?? 0;
    const cached = geometryCache.get(tile);
    if (cached) return cached;
    const geometry = new THREE.BoxGeometry(0.28, 0.28, 0.28);
    const uv = geometry.getAttribute('uv');
    // The block atlas is a single row of 16x16 tiles.
    for (let vertex = 0; vertex < uv.count; vertex++) {
      uv.setXY(vertex, (tile + 0.015 + uv.getX(vertex) * 0.97) / deps.atlasTiles,
        0.015 + uv.getY(vertex) * 0.97);
    }
    geometryCache.set(tile, geometry);
    return geometry;
  }
  function remove(index: number): void {
    deps.scene.remove(drops[index].mesh);
    drops.splice(index, 1);
  }
  function spawn(id: number, count: number, x: number, y: number, z: number): void {
    if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(x + y + z) || count <= 0) return;
    if (drops.length >= MAX_DROPS) remove(0);
    const mesh = new THREE.Mesh(geometryFor(id), material);
    const record: ActiveDrop = {
      id, count: Math.min(64, Math.floor(count)), x, y, z,
      dimension: deps.getDimension(), age: 0, vy: 0, mesh,
    };
    mesh.position.set(x, y, z);
    deps.scene.add(mesh);
    drops.push(record);
  }
  function update(dt: number): void {
    const seconds = Math.max(0, Math.min(dt, 0.05));
    const dimension = deps.getDimension();
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.mesh.visible = d.dimension === dimension;
      if (d.dimension !== dimension) continue;
      d.age += seconds;
      if (d.age >= EXPIRE_AFTER) { remove(i); continue; }
      d.vy = Math.max(-16, d.vy - 19 * seconds);
      const nextY = d.y + d.vy * seconds;
      const under = Math.floor(nextY - 0.15);
      if (deps.solid(deps.getBlock(Math.floor(d.x), under, Math.floor(d.z)))) {
        d.y = under + 1.15;
        d.vy = 0;
      } else d.y = nextY;
      if (d.age >= PICKUP_DELAY) {
        const tx = deps.player.x, ty = deps.player.y + 0.9, tz = deps.player.z;
        const dx = tx - d.x, dy = ty - d.y, dz = tz - d.z;
        const distance = Math.hypot(dx, dy, dz);
        if (distance < 0.65) {
          deps.giveItem(d.id, d.count);
          deps.playPickup?.();
          remove(i);
          continue;
        }
        if (distance < 2.6) {
          const pull = Math.min(0.4, seconds * 4);
          d.x += dx * pull;
          d.y += dy * pull;
          d.z += dz * pull;
        }
      }
      d.mesh.position.set(d.x, d.y + Math.sin(d.age * 4) * 0.045, d.z);
      d.mesh.rotation.y += seconds * 1.6;
      d.mesh.rotation.z = Math.sin(d.age * 2.3) * 0.08;
    }
  }
  function snapshot(): ItemDropRecord[] {
    return drops.map(({ id, count, x, y, z, dimension, age }) =>
      ({ id, count, x, y, z, dimension, age }));
  }
  function restore(records: readonly ItemDropRecord[]): void {
    clear();
    for (const d of records.slice(0, MAX_DROPS)) {
      if (!d || !Number.isInteger(d.id) || d.id <= 0 ||
        !Number.isFinite(d.x) || !Number.isFinite(d.y) || !Number.isFinite(d.z) ||
        !Number.isInteger(d.count) || d.count <= 0 ||
        !['overworld', 'nether', 'end'].includes(d.dimension)) continue;
      spawn(d.id, d.count, d.x, d.y, d.z);
      drops[drops.length - 1].dimension = d.dimension;
      drops[drops.length - 1].age = Math.max(0, Math.min(EXPIRE_AFTER - 1, d.age || 0));
    }
  }
  function clear(): void {
    while (drops.length) remove(drops.length - 1);
  }
  return { spawn, update, snapshot, restore, clear, count: () => drops.length };
}
