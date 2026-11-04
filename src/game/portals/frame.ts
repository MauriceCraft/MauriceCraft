/**
 * Deterministic, DOM-free portal rules.
 *
 * A minimum Nether portal is four blocks wide by five tall, with a 2x3
 * opening. Also recognize larger complete rectangles (including old 5x5
 * frames), in either horizontal direction. A portal must be unlit (air).
 */
export type PortalAxis = 'x' | 'z';
export type PortalDimension = 'overworld' | 'nether';
export interface BlockPos { x: number; y: number; z: number }
export interface PortalFrame extends BlockPos {
  dimension: PortalDimension;
  axis: PortalAxis;
  /** Interior width in blocks. */
  width: number;
  /** Interior height in blocks. */
  height: number;
}
type BlockReader = (x: number, y: number, z: number) => number;

export function findPortalFrame(
  get: BlockReader,
  hit: BlockPos,
  dimension: PortalDimension,
  obsidian: number,
  maxY: number,
): PortalFrame | null {
  for (const axis of ['x', 'z'] as const) {
    for (let outerWidth = 4; outerWidth <= 6; outerWidth++) {
      for (let outerHeight = 5; outerHeight <= 7; outerHeight++) {
        for (let horizontalOffset = 0; horizontalOffset < outerWidth; horizontalOffset++) {
          const start = (axis === 'x' ? hit.x : hit.z) - horizontalOffset;
          for (let verticalOffset = 0; verticalOffset < outerHeight; verticalOffset++) {
            const bottom = hit.y - verticalOffset;
            if (bottom < 1 || bottom + outerHeight > maxY) continue;

            let valid = true;
            for (let u = 0; u < outerWidth && valid; u++) {
              for (let v = 0; v < outerHeight; v++) {
                const x = axis === 'x' ? start + u : hit.x;
                const z = axis === 'z' ? start + u : hit.z;
                const border = u === 0 || u === outerWidth - 1 || v === 0 || v === outerHeight - 1;
                const actual = get(x, bottom + v, z);
                if (border ? actual !== obsidian : actual !== 0) {
                  valid = false;
                  break;
                }
              }
            }

            if (valid) {
              const center = start + (outerWidth - 1) / 2;
              return {
                dimension,
                axis,
                x: axis === 'x' ? center : hit.x,
                y: bottom,
                z: axis === 'z' ? center : hit.z,
                width: outerWidth - 2,
                height: outerHeight - 2,
              };
            }
          }
        }
      }
    }
  }
  return null;
}

/** Collision region is aligned with the actual portal plane and opening. */
export function portalContains(
  portal: PortalFrame,
  dimension: string,
  position: BlockPos,
): boolean {
  if (portal.dimension !== dimension) return false;
  const along = portal.axis === 'x' ? Math.abs(position.x - (portal.x + 0.5)) : Math.abs(position.z - (portal.z + 0.5));
  const across = portal.axis === 'x' ? Math.abs(position.z - (portal.z + 0.5)) : Math.abs(position.x - (portal.x + 0.5));
  return along <= portal.width / 2 + 0.1 &&
    across <= 0.95 &&
    position.y >= portal.y + 0.1 &&
    position.y <= portal.y + portal.height + 1;
}
