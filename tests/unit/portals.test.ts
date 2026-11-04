import { describe, expect, it } from 'vitest';
import { findPortalFrame, portalContains, type PortalAxis, type PortalFrame } from '../../src/game/portals/frame';
import { snapshotPortals, restorePortals } from '../../src/game/portals/persistence';

const OBSIDIAN = 36;
function makeWorld(axis: PortalAxis, outerWidth = 4, outerHeight = 5, base = 4) {
  const blocks = new Map<string, number>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const get = (x: number, y: number, z: number) => blocks.get(key(x, y, z)) ?? 0;
  const put = (x: number, y: number, z: number, value: number) => blocks.set(key(x, y, z), value);
  for (let u = 0; u < outerWidth; u++) for (let v = 0; v < outerHeight; v++) {
    const border = u === 0 || u === outerWidth - 1 || v === 0 || v === outerHeight - 1;
    put(axis === 'x' ? 10 + u : 10, base + v, axis === 'z' ? 10 + u : 10, border ? OBSIDIAN : 0);
  }
  return { get, put, key, base, outerWidth, outerHeight };
}

describe('Nether portal lighting regression', () => {
  it.each(['x', 'z'] as const)('lights a standard 4x5 obsidian frame along %s', axis => {
    const world = makeWorld(axis);
    const clicked = { x: 10, y: world.base + 2, z: 10 };
    const portal = findPortalFrame(world.get, clicked, 'overworld', OBSIDIAN, 48);
    expect(portal).toMatchObject({
      dimension: 'overworld', axis, y: world.base,
      width: 2, height: 3,
    });
    expect(portal).not.toBeNull();
    expect(portalContains(portal!, 'overworld', {
      x: axis === 'x' ? 12 : 10.5,
      y: world.base + 1.05,
      z: axis === 'z' ? 12 : 10.5,
    })).toBe(true);
    expect(portalContains(portal!, 'nether', { x: 12, y: 6, z: 10.5 })).toBe(false);
  });
  it('accepts the original 5x5 frame for compatibility', () => {
    const world = makeWorld('x', 5, 5);
    expect(findPortalFrame(world.get, { x: 12, y: 8, z: 10 }, 'nether', OBSIDIAN, 48))
      .toMatchObject({ width: 3, height: 3, axis: 'x' });
  });
  it('does not light if obsidian is missing', () => {
    const world = makeWorld('z');
    world.put(10, 6, 10, 0);
    expect(findPortalFrame(world.get, { x: 10, y: 6, z: 10 }, 'overworld', OBSIDIAN, 48)).toBeNull();
  });
  it('does not light a blocked interior', () => {
    const world = makeWorld('x');
    world.put(11, 5, 10, 3);
    expect(findPortalFrame(world.get, { x: 10, y: 6, z: 10 }, 'overworld', OBSIDIAN, 48)).toBeNull();
  });
  it('rejects an incomplete opening at the world height limit', () => {
    const world = makeWorld('x', 4, 5, 44);
    expect(findPortalFrame(world.get, { x: 10, y: 46, z: 10 }, 'overworld', OBSIDIAN, 48)).toBeNull();
  });
  it('recognizes a taller complete portal without false positives', () => {
    const world = makeWorld('z', 4, 6);
    expect(findPortalFrame(world.get, { x: 10, y: 5, z: 13 }, 'overworld', OBSIDIAN, 48))
      .toMatchObject({ height: 4, width: 2 });
  });
});

describe('portal collision and persistent world compatibility', () => {
  const portal: PortalFrame = { dimension: 'overworld', axis: 'z', x: 10, y: 4, z: 11.5, width: 2, height: 3 };
  it('finds the doorway and excludes off-plane and outside players', () => {
    expect(portalContains(portal, 'overworld', { x: 10.5, y: 5.1, z: 12 })).toBe(true);
    expect(portalContains(portal, 'overworld', { x: 14, y: 5.1, z: 12 })).toBe(false);
    expect(portalContains(portal, 'overworld', { x: 10.5, y: 10, z: 12 })).toBe(false);
  });
  it('round-trips portal axis and fractional center coordinates', () => {
    expect(restorePortals(snapshotPortals([portal]))).toEqual([portal]);
  });
  it('loads portal metadata written before axis preservation', () => {
    const legacy = { dimension: 'overworld', x: 10, y: 4, z: 12, width: 2, height: 3 };
    expect(restorePortals([legacy])).toMatchObject([{ ...legacy, axis: 'x' }]);
    expect(restorePortals(null)).toEqual([]);
  });
  it('rejects invalid metadata without compromising valid portals', () => {
    expect(restorePortals([null, { dimension: 'end', x: 1, y: 2, z: 3 }, { dimension: 'overworld', x: NaN, y: 2, z: 3 }, portal])).toEqual([portal]);
  });
});
