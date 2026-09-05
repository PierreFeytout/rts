import { FX_ONE, type Fx } from "./fixed.js";

/**
 * Passability grid.
 *
 * One byte per tile: 0 is walkable, anything else is impassable. Terrain height
 * is deliberately absent -- the simulation is 2D, and cliffs are represented as
 * blocked tiles that the renderer happens to draw tall. Keeping elevation out of the sim means
 * pathfinding, ranges and collision stay 2D problems.
 *
 * `version` increments on every mutation. Derived structures (flow fields) carry
 * the version they were built from and are discarded when it moves, which is
 * what keeps cached paths from going stale after a building is placed.
 */

export const TILE_WALKABLE = 0;
/** Impassable terrain: cliffs and rock. Drawn by the renderer as raised blocks. */
export const TILE_BLOCKED = 1;
/**
 * Occupied by a building or resource node's footprint.
 *
 * Pathing treats this exactly like TILE_BLOCKED -- `isBlocked` tests against
 * TILE_WALKABLE, not against a specific value -- but the two must stay
 * distinguishable, because the renderer derives its terrain blocks from this
 * same grid. Without the distinction every Nexus and ore patch was drawn as a
 * cliff with the actual building buried inside it.
 */
export const TILE_STRUCTURE = 2;

export class CostGrid {
  readonly width: number;
  readonly height: number;
  readonly tiles: Uint8Array;
  /** Bumped on mutation; invalidates anything derived from this grid. */
  version = 1;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.tiles = new Uint8Array(width * height);
  }

  index(tx: number, ty: number): number {
    return ty * this.width + tx;
  }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height;
  }

  isBlocked(tx: number, ty: number): boolean {
    // Out of bounds counts as blocked so pathing never walks off the map and
    // callers do not each have to bounds-check.
    if (!this.inBounds(tx, ty)) return true;
    return this.tiles[ty * this.width + tx] !== TILE_WALKABLE;
  }

  set(tx: number, ty: number, value: number): void {
    if (!this.inBounds(tx, ty)) return;
    const i = ty * this.width + tx;
    if (this.tiles[i] === value) return;
    this.tiles[i] = value;
    this.version++;
  }

  /** Block a rectangle, e.g. a building footprint. */
  fillRect(tx: number, ty: number, w: number, h: number, value: number): void {
    let changed = false;
    for (let y = ty; y < ty + h; y++) {
      for (let x = tx; x < tx + w; x++) {
        if (!this.inBounds(x, y)) continue;
        const i = y * this.width + x;
        if (this.tiles[i] !== value) {
          this.tiles[i] = value;
          changed = true;
        }
      }
    }
    if (changed) this.version++;
  }

  clear(): void {
    this.tiles.fill(TILE_WALKABLE);
    this.version++;
  }
}

/** World position (Q16.16) to tile coordinate. */
export function worldToTile(v: Fx): number {
  // Arithmetic shift, so negatives floor toward -infinity rather than toward
  // zero. Truncation would map -0.5 and +0.5 into tiles an inconsistent
  // distance apart, putting a unit one tile off near the map origin.
  return v >> 16;
}

/** Centre of a tile, in world coordinates. */
export function tileCentre(t: number): Fx {
  return (t << 16) + (FX_ONE >> 1);
}
