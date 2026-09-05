import type { EntityStore } from "./entities.js";

/**
 * Uniform-grid spatial index for neighbour queries.
 *
 * Separation steering asks "which units are near me?" for every unit, every
 * tick. Done naively that is O(n^2) -- 160,000 checks at 400 units. A uniform
 * grid reduces it to the handful of entities in the surrounding cells.
 *
 * Built by counting sort into two flat typed arrays rather than an array of
 * arrays. Two reasons, and the second is the important one:
 *
 *   1. No per-tick allocation, so no GC pressure in the hot loop.
 *   2. Entities land in each bucket in ascending index order, deterministically.
 *      Separation forces are accumulated by summing over neighbours, and
 *      floating a different iteration order would change fixed-point rounding
 *      and desync peers. Bucket order is part of the determinism contract.
 *
 * Rebuilt from scratch every tick. At 400 entities that is cheaper and far
 * easier to reason about than incremental updates.
 */
export class SpatialHash {
  readonly cellSize: number;
  readonly cellShift: number;
  readonly width: number;
  readonly height: number;

  /** Start offset of each cell's slice in `entries`, length cells + 1. */
  private readonly cellStart: Int32Array;
  /** Scratch counter reused each rebuild. */
  private readonly cellCount: Int32Array;
  /** Entity slot indices, grouped by cell. */
  private readonly entries: Int32Array;
  private entryCount = 0;

  /**
   * `cellSizeTiles` must be a power of two so tile-to-cell maps to a shift.
   * Roughly twice the typical unit diameter is the sweet spot: smaller means
   * scanning many cells, larger means scanning many irrelevant entities.
   */
  constructor(mapTiles: number, cellSizeTiles: number, capacity: number) {
    this.cellSize = cellSizeTiles;
    // Derived by shifting rather than Math.log2: log2 is in the
    // implementation-defined set, and while it is surely exact for powers of
    // two, "surely" is not the standard this package holds itself to. The
    // integer loop is exact by construction.
    let shift = 0;
    while (1 << shift < cellSizeTiles) shift++;
    this.cellShift = shift;
    if (1 << shift !== cellSizeTiles) {
      throw new Error(`SpatialHash cellSizeTiles must be a power of two, got ${cellSizeTiles}`);
    }
    this.width = Math.ceil(mapTiles / cellSizeTiles);
    this.height = this.width;

    const cells = this.width * this.height;
    this.cellStart = new Int32Array(cells + 1);
    this.cellCount = new Int32Array(cells);
    this.entries = new Int32Array(capacity);
  }

  private cellOf(tx: number, ty: number): number {
    const cx = Math.min(this.width - 1, Math.max(0, tx >> this.cellShift));
    const cy = Math.min(this.height - 1, Math.max(0, ty >> this.cellShift));
    return cy * this.width + cx;
  }

  /** Rebuild the index over all live entities. */
  rebuild(store: EntityStore): void {
    this.cellCount.fill(0);
    this.entryCount = 0;

    // Pass 1: count entities per cell.
    for (let i = 0; i < store.highWater; i++) {
      if (store.alive[i] !== 1) continue;
      this.cellCount[this.cellOf(store.posX[i] >> 16, store.posY[i] >> 16)]++;
      this.entryCount++;
    }

    // Pass 2: prefix sum into slice offsets.
    let running = 0;
    for (let c = 0; c < this.cellCount.length; c++) {
      this.cellStart[c] = running;
      running += this.cellCount[c];
    }
    this.cellStart[this.cellCount.length] = running;

    // Pass 3: scatter. Reusing cellCount as a write cursor means entities are
    // placed in ascending slot order within each cell, which is the ordering
    // guarantee the class contract promises.
    this.cellCount.fill(0);
    for (let i = 0; i < store.highWater; i++) {
      if (store.alive[i] !== 1) continue;
      const c = this.cellOf(store.posX[i] >> 16, store.posY[i] >> 16);
      this.entries[this.cellStart[c] + this.cellCount[c]++] = i;
    }
  }

  /**
   * Call `visit` for every entity slot within `radiusTiles` cells of a world
   * position. Callers must still do an exact distance test: this returns
   * everything in the overlapping cells, not a precise disc.
   */
  forEachNear(posX: number, posY: number, radiusTiles: number, visit: (index: number) => void): void {
    const tx = posX >> 16;
    const ty = posY >> 16;
    const minCx = Math.max(0, (tx - radiusTiles) >> this.cellShift);
    const maxCx = Math.min(this.width - 1, (tx + radiusTiles) >> this.cellShift);
    const minCy = Math.max(0, (ty - radiusTiles) >> this.cellShift);
    const maxCy = Math.min(this.height - 1, (ty + radiusTiles) >> this.cellShift);

    for (let cy = minCy; cy <= maxCy; cy++) {
      const row = cy * this.width;
      for (let cx = minCx; cx <= maxCx; cx++) {
        const c = row + cx;
        const end = this.cellStart[c + 1];
        for (let k = this.cellStart[c]; k < end; k++) {
          visit(this.entries[k]);
        }
      }
    }
  }

  /**
   * Allocation-free variant of `forEachNear`: fills `out` with entity slot
   * indices and returns how many were written.
   *
   * Preferred in the movement loop. `forEachNear` allocates a closure per call,
   * which at 400 units times 20 ticks per second is 8000 short-lived closures
   * a second feeding straight into the GC.
   *
   * Results past `out.length` are dropped rather than growing the buffer, since
   * separation only needs nearby units and a pathologically dense clump does
   * not need every last neighbour to behave correctly.
   */
  queryInto(posX: number, posY: number, radiusTiles: number, out: Int32Array): number {
    // See `overflows`. Truncation here is a correctness hazard, not a
    // performance detail, so it is counted rather than passing unnoticed.
    const tx = posX >> 16;
    const ty = posY >> 16;
    const minCx = Math.max(0, (tx - radiusTiles) >> this.cellShift);
    const maxCx = Math.min(this.width - 1, (tx + radiusTiles) >> this.cellShift);
    const minCy = Math.max(0, (ty - radiusTiles) >> this.cellShift);
    const maxCy = Math.min(this.height - 1, (ty + radiusTiles) >> this.cellShift);

    let n = 0;
    for (let cy = minCy; cy <= maxCy; cy++) {
      const row = cy * this.width;
      for (let cx = minCx; cx <= maxCx; cx++) {
        const c = row + cx;
        const end = this.cellStart[c + 1];
        for (let k = this.cellStart[c]; k < end; k++) {
          if (n >= out.length) {
            this.overflows++;
            return n;
          }
          out[n++] = this.entries[k];
        }
      }
    }
    return n;
  }

  /**
   * Number of queries that ran out of output space and returned a partial
   * result.
   *
   * This must stay zero. Results are filled in cell-iteration order, so an
   * overflow drops whichever neighbours come last -- which can be the unit
   * standing on top of you while one two tiles away is kept. That produced a
   * pair of permanently fused units, and it was invisible until the unit count
   * was realistic. Tests assert this is zero; a non-zero value means the
   * neighbour buffer is undersized for the density in play.
   */
  overflows = 0;

  /** Number of entities in the index after the last rebuild. */
  get size(): number {
    return this.entryCount;
  }
}
