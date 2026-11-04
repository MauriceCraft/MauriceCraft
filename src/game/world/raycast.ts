/** A grid raycast with no DOM or rendering dependency. */
export interface Point3 { x: number; y: number; z: number }
export interface BlockRayHit extends Point3 {
  nx: number;
  ny: number;
  nz: number;
  t: number;
}
export type BlockReader = (x: number, y: number, z: number) => number;

/** Travel voxel boundaries in order; return the entered face normal. */
export function raycastBlocks(
  origin: Point3,
  dir: Point3,
  maxD: number,
  get: BlockReader,
  solid: (block: number) => boolean,
  H: number,
): BlockRayHit | null {
  const o = origin;
  let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
  if (solid(get(x, y, z))) return null;
  const sx = dir.x > 0 ? 1 : -1, sy = dir.y > 0 ? 1 : -1, sz = dir.z > 0 ? 1 : -1;
  const tdx = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tdy = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tdz = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
  let tmx = dir.x !== 0 ? (dir.x > 0 ? x + 1 - o.x : o.x - x) * tdx : Infinity;
  let tmy = dir.y !== 0 ? (dir.y > 0 ? y + 1 - o.y : o.y - y) * tdy : Infinity;
  let tmz = dir.z !== 0 ? (dir.z > 0 ? z + 1 - o.z : o.z - z) * tdz : Infinity;
  let fx = 0, fy = 0, fz = 0, t = 0;
  while (t <= maxD) {
    if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; fx = -sx; fy = 0; fz = 0; }
    else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; fx = 0; fy = -sy; fz = 0; }
    else { z += sz; t = tmz; tmz += tdz; fx = 0; fy = 0; fz = -sz; }
    if (t > maxD) break;
    if (y < 0) return null;
    if (y >= H) { if (sy > 0) return null; continue; }
    if (get(x, y, z)) return { x, y, z, nx: fx, ny: fy, nz: fz, t };
  }
  return null;
}
