import { worldToTile } from "./grid.js";
import { MAX_PLAYERS } from "./players.js";
import type { EntityStore } from "./entities.js";
import type { TypeTable } from "./types.js";

/**
 * Fog of war.
 *
 * Fog affects the simulation, not just what is drawn: a unit cannot acquire a
 * target it cannot see, so scouting is a real decision rather than a cosmetic
 * one. That means every peer must agree on exactly who can see what, on every
 * tick.
 *
 * Two grids per player, and the distinction matters more than it first looks:
 *
 *   - `visible` is recomputed from scratch every tick and is what the
 *     simulation reads. It is a pure function of unit positions, so it is not
 *     hashed either: two peers whose entities already match cannot disagree
 *     about it, and hashing a quarter-megabyte of derived data on every desync
 *     check would be pure cost.
 *   - `explored` only ever gains bits, and **nothing in the simulation reads
 *     it**. It exists so the renderer can draw terrain you have seen before.
 *     That makes it presentation state, not world state: it is not hashed, not
 *     snapshotted, and two peers are *expected* to differ. A peer that resyncs
 *     keeps its own map memory, which is exactly right -- being handed the
 *     host's would show you ground you never scouted.
 *
 * Shipping it would have cost 256 kB per resync on a 256-tile map, five times
 * the rest of the snapshot combined, to transmit something the receiver has a
 * better version of.
 *
 * Recomputed wholesale rather than incrementally. An incremental scheme has to
 * subtract a unit's old circle before adding its new one, and the failure mode
 * of getting that wrong is permanent phantom vision that nothing ever clears.
 * A memset plus a few hundred stamped circles costs microseconds.
 */

/** Never seen. Terrain unknown, nothing drawn. */
export const VIS_HIDDEN = 0;
/** Seen before, not currently. Terrain remembered, units not shown. */
export const VIS_EXPLORED = 1;
/** In sight right now. */
export const VIS_VISIBLE = 2;

/**
 * Precomputed tile offsets for a circular stamp, one entry per radius.
 *
 * Built lazily and cached, because every unit of the same type stamps the same
 * shape and rebuilding it per unit per tick is the whole cost of the system.
 * Pure integer arithmetic, so the cache cannot be a source of divergence -- a
 * peer that built it in a different order still gets the same set of tiles.
 */
const stamps: Array<Int32Array | undefined> = [];

function stampFor(radiusTiles: number): Int32Array {
  const cached = stamps[radiusTiles];
  if (cached !== undefined) return cached;

  const offsets: number[] = [];
  const r2 = radiusTiles * radiusTiles;
  for (let dy = -radiusTiles; dy <= radiusTiles; dy++) {
    for (let dx = -radiusTiles; dx <= radiusTiles; dx++) {
      if (dx * dx + dy * dy <= r2) {
        offsets.push(dx, dy);
      }
    }
  }
  const packed = Int32Array.from(offsets);
  stamps[radiusTiles] = packed;
  return packed;
}

export class VisionGrid {
  readonly width: number;
  readonly height: number;
  private readonly cells: number;

  /** Current visibility, one byte per tile per player. */
  readonly visible: Uint8Array;
  /** Sticky "has been seen", one byte per tile per player. */
  readonly explored: Uint8Array;

  /**
   * Set false to give every player sight of the whole map.
   *
   * A debugging aid, exposed through the client's `__rts` handle -- watching
   * what an opponent is doing is by far the fastest way to work out why the
   * simulation did something surprising. It is part of world behaviour, so
   * flipping it mid-match on one peer only would desync; it is meant for
   * single-player inspection.
   */
  enabled = true;

  constructor(mapTiles: number) {
    this.width = mapTiles;
    this.height = mapTiles;
    this.cells = mapTiles * mapTiles;
    this.visible = new Uint8Array(this.cells * MAX_PLAYERS);
    this.explored = new Uint8Array(this.cells * MAX_PLAYERS);
  }

  /** Start of a player's slice. */
  private base(player: number): number {
    return player * this.cells;
  }

  /** Recompute current visibility, and fold it into the explored history. */
  update(store: EntityStore, types: TypeTable): void {
    if (!this.enabled) {
      this.visible.fill(1);
      this.explored.fill(1);
      return;
    }

    this.visible.fill(0);

    for (let i = 0; i < store.highWater; i++) {
      if (store.alive[i] !== 1) continue;
      const player = store.owner[i];
      if (player < 0 || player >= MAX_PLAYERS) continue;

      const type = types.get(store.typeId[i]);
      const radius = type.visionRange;
      if (radius <= 0) continue;

      // A half-built structure sees as far as a finished one. It is a real
      // object on the field, and a blind foundation would let an enemy walk
      // past a watchtower under construction.
      const tx = worldToTile(store.posX[i]);
      const ty = worldToTile(store.posY[i]);
      const offsets = stampFor(radius);
      const base = this.base(player);

      for (let k = 0; k < offsets.length; k += 2) {
        const x = tx + offsets[k];
        const y = ty + offsets[k + 1];
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
        const cell = base + y * this.width + x;
        this.visible[cell] = 1;
        this.explored[cell] = 1;
      }
    }
  }

  isVisible(player: number, tx: number, ty: number): boolean {
    if (player < 0 || player >= MAX_PLAYERS) return false;
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return false;
    return this.visible[this.base(player) + ty * this.width + tx] === 1;
  }

  isExplored(player: number, tx: number, ty: number): boolean {
    if (player < 0 || player >= MAX_PLAYERS) return false;
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return false;
    return this.explored[this.base(player) + ty * this.width + tx] === 1;
  }

  /** Combined state of one tile for one player, for the renderer. */
  levelAt(player: number, tx: number, ty: number): number {
    if (this.isVisible(player, tx, ty)) return VIS_VISIBLE;
    if (this.isExplored(player, tx, ty)) return VIS_EXPLORED;
    return VIS_HIDDEN;
  }

  /**
   * Whether one player can see another player's entity.
   *
   * Takes the entity's tile rather than a radius: a four-tile Nexus whose
   * centre sits in fog while a corner is lit would otherwise flicker. Close
   * enough at this scale, and cheap enough to call per unit per tick.
   */
  canSee(player: number, store: EntityStore, index: number): boolean {
    if (!this.enabled) return true;
    if (store.owner[index] === player) return true;
    return this.isVisible(player, worldToTile(store.posX[index]), worldToTile(store.posY[index]));
  }

  clear(): void {
    this.visible.fill(0);
    this.explored.fill(0);
  }
}
