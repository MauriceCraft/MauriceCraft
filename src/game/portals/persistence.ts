import type { PortalFrame, PortalDimension } from './frame';

/** Retain axis and dimensions; earlier releases omitted axis when saving. */
export function snapshotPortals(portals: readonly PortalFrame[]): PortalFrame[] {
  return portals.map(({ dimension, x, y, z, axis, width, height }) => ({
    dimension, x, y, z, axis, width, height,
  }));
}

/** Accept both legacy metadata and newer portal records, without resetting saves. */
export function restorePortals(value: unknown): PortalFrame[] {
  if (!Array.isArray(value)) return [];
  const restored: PortalFrame[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const p = entry as Record<string, unknown>;
    if (p.dimension !== 'overworld' && p.dimension !== 'nether') continue;
    if ([p.x, p.y, p.z].some(n => typeof n !== 'number' || !Number.isFinite(n))) continue;
    const dimension = p.dimension as PortalDimension;
    restored.push({
      dimension,
      x: p.x as number, y: p.y as number, z: p.z as number,
      axis: p.axis === 'z' ? 'z' : 'x',
      width: typeof p.width === 'number' && p.width >= 2 && p.width <= 5 ? p.width : 2,
      height: typeof p.height === 'number' && p.height >= 3 && p.height <= 6 ? p.height : 3,
    });
  }
  return restored;
}
