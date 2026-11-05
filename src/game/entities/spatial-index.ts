/** Spatial buckets for nearby entity interactions.
 *
 * Populating the index costs O(n). Queries visit only nearby occupied cells
 * instead of scanning every mob for every golem, villager or raider.
 * Each coordinate uses Math.floor so negative world positions work correctly.
 */
export interface SpatialPosition { x: number; z: number }

export class SpatialIndex<Actor extends SpatialPosition & object> {
  private readonly rows = new Map<number, Map<number, Set<Actor>>>();
  private readonly positions = new Map<Actor, readonly [number, number]>();

  constructor(private readonly cellSize = 16) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new RangeError('Cell size must be positive and finite');
    }
  }

  /** Add an actor or update its position after movement. */
  upsert(actor: Actor): void {
    const cellX = Math.floor(actor.x / this.cellSize);
    const cellZ = Math.floor(actor.z / this.cellSize);
    const current = this.positions.get(actor);
    if (current?.[0] === cellX && current[1] === cellZ) return;
    if (current) this.delete(actor);

    let column = this.rows.get(cellX);
    if (!column) {
      column = new Map();
      this.rows.set(cellX, column);
    }
    let occupants = column.get(cellZ);
    if (!occupants) {
      occupants = new Set();
      column.set(cellZ, occupants);
    }
    occupants.add(actor);
    this.positions.set(actor, [cellX, cellZ]);
  }

  delete(actor: Actor): void {
    const cell = this.positions.get(actor);
    if (!cell) return;
    const column = this.rows.get(cell[0]);
    const occupants = column?.get(cell[1]);
    occupants?.delete(actor);
    if (occupants?.size === 0) column?.delete(cell[1]);
    if (column?.size === 0) this.rows.delete(cell[0]);
    this.positions.delete(actor);
  }

  clear(): void {
    this.rows.clear();
    this.positions.clear();
  }

  /**
   * Visits actors in nearby grid cells. The caller performs the final
   * circular distance test, preserving each interaction's own radius.
   * Complexity: O(cells overlapped + candidates), not O(all actors).
   */
  *near(x: number, z: number, radius: number): IterableIterator<Actor> {
    if (!Number.isFinite(radius) || radius < 0) return;
    const minCellX = Math.floor((x - radius) / this.cellSize);
    const maxCellX = Math.floor((x + radius) / this.cellSize);
    const minCellZ = Math.floor((z - radius) / this.cellSize);
    const maxCellZ = Math.floor((z + radius) / this.cellSize);
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      const column = this.rows.get(cellX);
      if (!column) continue;
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
        const occupants = column.get(cellZ);
        if (!occupants) continue;
        yield* occupants;
      }
    }
  }

  get size(): number {
    return this.positions.size;
  }
}
