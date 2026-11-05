import { hash2 } from './noise';

export interface CaveCarverDependencies {
  getSeed: () => number;
  heightAt: (x: number, z: number) => number;
  inStructureZone: (x: number, z: number) => boolean;
  worldHeight: number;
}

/** Seeded tunnel paths are defined in world coordinates, never chunk coordinates. */
export function createCaveCarver(deps: CaveCarverDependencies) {
  const CELL = 72;
  function carve(cx: number, cz: number, data: Uint8Array): void {
    const x0 = cx * 16, z0 = cz * 16, seed = deps.getSeed();
    const rx0 = Math.floor((x0 - 64) / CELL), rx1 = Math.floor((x0 + 16 + 64) / CELL);
    const rz0 = Math.floor((z0 - 64) / CELL), rz1 = Math.floor((z0 + 16 + 64) / CELL);
    for (let rz = rz0; rz <= rz1; rz++) for (let rx = rx0; rx <= rx1; rx++) {
      if (hash2(rx, rz, seed + 3010) > 0.77) continue;
      const originX = rx * CELL + 13 + hash2(rx, rz, seed + 3011) * 46;
      const originZ = rz * CELL + 13 + hash2(rx, rz, seed + 3012) * 46;
      const angle = hash2(rx, rz, seed + 3013) * Math.PI * 2;
      const steps = 26 + Math.floor(hash2(rx, rz, seed + 3014) * 20);
      const baseY = 7 + hash2(rx, rz, seed + 3015) * 11;
      const entrance = hash2(rx, rz, seed + 3016) < 0.46;
      const ravine = hash2(rx, rz, seed + 3017) < 0.12;
      for (let step = 0; step < steps; step++) {
        const wx = Math.round(originX + Math.cos(angle) * step +
          Math.sin(step / 9 + angle) * 3);
        const wz = Math.round(originZ + Math.sin(angle) * step +
          Math.cos(step / 11 + angle) * 3);
        if (wx < x0 - 5 || wx > x0 + 20 || wz < z0 - 5 || wz > z0 + 20) continue;
        const surface = deps.heightAt(wx, wz);
        const tunnelY = Math.round(baseY + Math.sin(step / 6) * 2);
        const mouth = entrance && step < 9 ? (9 - step) / 9 : 0;
        const cy = Math.round(tunnelY + mouth * Math.max(0, surface - tunnelY - 1));
        const rad = 2 + hash2(rx, rz, seed + 3018) * 1.2 +
          Math.sin(step / 7) * 0.35;
        for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
          const x = wx + dx, z = wz + dz;
          if (x < x0 || x >= x0 + 16 || z < z0 || z >= z0 + 16) continue;
          if (deps.inStructureZone(x, z)) continue;
          const horizontal = Math.hypot(dx, dz);
          if (horizontal > rad) continue;
          const top = Math.min(deps.worldHeight - 2, deps.heightAt(x, z) -
            (mouth > 0 || ravine ? 0 : 2));
          const extension = ravine ? 8 : 0;
          for (let dy = -3; dy <= 3 + extension; dy++) {
            const y = cy + dy;
            if (y < 2 || y > top) continue;
            if (!ravine && horizontal * horizontal + dy * dy > rad * rad) continue;
            if (ravine && horizontal > 1.8 && dy > 0) continue;
            const idx = (y * 16 + z - z0) * 16 + x - x0;
            const b = data[idx];
            if (b !== 0 && b !== 34 && b !== 35) data[idx] = 0;
          }
        }
      }
    }
  }
  return { carve };
}
