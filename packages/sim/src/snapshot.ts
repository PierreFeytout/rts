import { MAX_ENTITIES } from "./entities.js";
import type { World } from "./world.js";

/**
 * Full world serialisation.
 *
 * Two jobs, both essential to the netcode:
 *
 *   1. Desync recovery. When a peer's state hash stops matching the arbiter's,
 *      it is handed an authoritative snapshot rather than being disconnected.
 *   2. Match start. Every peer begins from an identical snapshot, so nobody has
 *      to trust that independent world construction produced identical results.
 *
 * The format is a flat binary blob rather than JSON: the payload is almost
 * entirely typed arrays, so JSON would be several times larger and would need
 * every integer parsed back out one at a time.
 *
 * This is NOT a save-game format and carries no version negotiation. Peers
 * verify they are running the same build during the handshake, so a snapshot is
 * only ever exchanged between processes already known to agree.
 */

/** Bumped whenever the layout below changes, so a mismatch fails loudly. */
export const SNAPSHOT_VERSION = 1;

const MAGIC = 0x52545331; // "RTS1"

/**
 * Entity component arrays, in serialisation order.
 *
 * MUST match the order in `EntityStore.hashed`. Two peers that serialise the
 * same fields in different orders would restore garbage while reporting a
 * perfectly healthy handshake.
 */
function entityArrays(world: World): Array<Int32Array | Uint8Array | Uint16Array> {
  const e = world.entities;
  return [
    e.alive,
    e.generation,
    e.posX,
    e.posY,
    e.facing,
    e.radius,
    e.moveSpeed,
    e.turnRate,
    e.owner,
    e.typeId,
    e.health,
    e.orderKind,
    e.orderX,
    e.orderY,
    e.flowGoal,
    e.settled,
  ];
}

/** Serialise a world to a transferable buffer. */
export function encodeSnapshot(world: World): Uint8Array {
  const e = world.entities;
  const n = e.highWater;
  const gridBytes = world.grid.tiles.length;

  // Header: magic, version, tick, rng, highWater, count, gridVersion,
  // mapTiles, gridBytes.
  const headerInts = 9;
  const arrays = entityArrays(world);

  let bytes = headerInts * 4;
  for (const array of arrays) bytes += n * array.BYTES_PER_ELEMENT;
  bytes += gridBytes;
  // Pad to a 4-byte boundary so the Int32Array header view is always aligned.
  bytes = (bytes + 3) & ~3;

  const buffer = new ArrayBuffer(bytes);
  const header = new Int32Array(buffer, 0, headerInts);
  header[0] = MAGIC;
  header[1] = SNAPSHOT_VERSION;
  header[2] = world.tick;
  header[3] = world.rng.state;
  header[4] = n;
  header[5] = e.count;
  header[6] = world.grid.version;
  header[7] = world.mapTiles;
  header[8] = gridBytes;

  const out = new Uint8Array(buffer);
  let offset = headerInts * 4;

  for (const array of arrays) {
    const slice = new Uint8Array(array.buffer, array.byteOffset, n * array.BYTES_PER_ELEMENT);
    out.set(slice, offset);
    offset += slice.byteLength;
  }

  out.set(world.grid.tiles, offset);
  return out;
}

/**
 * Restore a world in place from a snapshot.
 *
 * Mutates rather than returning a fresh world, so existing references held by
 * the renderer and input layer stay valid across a resync. A resync that
 * silently swapped the world object would leave the UI pointing at a
 * detached copy.
 */
export function decodeSnapshot(world: World, data: Uint8Array): void {
  // A misaligned byteOffset would make the Int32Array view throw, and a copied
  // payload from the wire has no alignment guarantee.
  const aligned =
    data.byteOffset % 4 === 0 ? data : new Uint8Array(data.slice().buffer);

  const header = new Int32Array(aligned.buffer, aligned.byteOffset, 9);
  if (header[0] !== MAGIC) throw new Error("snapshot: bad magic");
  if (header[1] !== SNAPSHOT_VERSION) {
    throw new Error(`snapshot: version ${header[1]}, expected ${SNAPSHOT_VERSION}`);
  }

  const n = header[4];
  if (n < 0 || n > MAX_ENTITIES) throw new Error(`snapshot: bad highWater ${n}`);
  if (header[7] !== world.mapTiles) {
    throw new Error(`snapshot: map is ${header[7]} tiles, world is ${world.mapTiles}`);
  }
  const gridBytes = header[8];
  if (gridBytes !== world.grid.tiles.length) {
    throw new Error(`snapshot: grid is ${gridBytes} bytes, world expects ${world.grid.tiles.length}`);
  }

  const e = world.entities;
  e.clear();

  const arrays = entityArrays(world);
  let offset = 9 * 4;
  for (const array of arrays) {
    const byteLength = n * array.BYTES_PER_ELEMENT;
    const view = new Uint8Array(aligned.buffer, aligned.byteOffset + offset, byteLength);
    new Uint8Array(array.buffer, array.byteOffset, byteLength).set(view);
    offset += byteLength;
  }

  world.grid.tiles.set(
    new Uint8Array(aligned.buffer, aligned.byteOffset + offset, gridBytes),
  );

  world.tick = header[2];
  world.rng.state = header[3];
  e.highWater = n;
  e.count = header[5];
  world.grid.version = header[6];

  // Allocation takes the lowest free slot, so it is a pure function of the
  // restored `alive` bitmap and needs nothing serialised. Resetting the scan
  // hint is enough. (See the invariant on EntityStore.lowestFreeHint -- this is
  // exactly why an explicit free list was avoided.)
  e.resetAllocationHint();

  // Derived data must be discarded: cached flow fields belong to the old grid.
  world.flowFields.clear();
  world.spatial.rebuild(e);
}
