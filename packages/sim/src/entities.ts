import { hashArrayPrefix, hashNumber } from "./hash.js";
import type { Fx } from "./fixed.js";
import { tileCentre } from "./grid.js";
import type { TypeTable } from "./types.js";

/**
 * Structure-of-arrays entity store.
 *
 * Every component lives in its own `Int32Array`, indexed by a dense slot. This
 * layout is chosen for three reasons, in order of importance:
 *
 *   1. Hashing the whole world is a linear pass over a handful of typed arrays,
 *      which is what makes per-tick desync detection affordable.
 *   2. Iteration is by ascending index, so every peer visits entities in the
 *      same order without any sorting. Order-dependent logic -- separation
 *      steering, target selection -- is therefore deterministic for free.
 *   3. It is cache-friendly, which matters at 400+ units updating 20 times a
 *      second.
 *
 * A hand-rolled store is used rather than an ECS library because the ordering
 * and allocation guarantees above ARE the determinism guarantee, and they need
 * to be verifiable by reading this file rather than a dependency's internals.
 *
 * Note what is NOT stored here: anything derivable from `typeId`. Maximum
 * health, damage, cost and range all live in the type table. Copying them per
 * entity would double the hash cost and, worse, allow a unit's stats to drift
 * out of agreement with its own type.
 */

/** Maximum simultaneous entities. Well above the 400-unit target. */
export const MAX_ENTITIES = 2048;

/**
 * Production queue depth per building.
 *
 * Fixed rather than growable: a variable-length queue would either need
 * per-entity allocation in the hot path or a side table whose iteration order
 * becomes a determinism question. Five is the depth players actually use.
 */
export const PRODUCTION_QUEUE_CAP = 5;

/** Order kinds. Plain integer constants -- `erasableSyntaxOnly` forbids enums. */
export const ORDER_NONE = 0;
export const ORDER_MOVE = 1;
/** Chase and shoot one specific entity until it dies. */
export const ORDER_ATTACK = 2;
/** Advance toward a point, engaging anything hostile encountered on the way. */
export const ORDER_ATTACK_MOVE = 3;
/** Harvest a specific ore node. */
export const ORDER_GATHER = 4;
/** Carrying a full load, walking it back to a drop-off. */
export const ORDER_RETURN = 5;
/** Walk to a construction site and work on it. */
export const ORDER_BUILD = 6;
/** Stand still, but shoot anything that comes into range. */
export const ORDER_HOLD = 7;

/**
 * An entity handle: slot index in the low 16 bits, generation in the high 16.
 *
 * The generation is what makes stale references safe. A unit ordered to attack
 * another unit stores a handle; if the target dies and its slot is recycled,
 * the handle's generation no longer matches and the reference resolves to
 * "gone" instead of silently retargeting whatever new unit took the slot.
 */
export type EntityId = number;

export const NULL_ENTITY: EntityId = -1;

export function entityIndex(id: EntityId): number {
  return id & 0xffff;
}

export function entityGeneration(id: EntityId): number {
  return (id >>> 16) & 0xffff;
}

function makeId(index: number, generation: number): EntityId {
  return ((generation & 0xffff) << 16) | (index & 0xffff);
}

export class EntityStore {
  /** 1 if the slot holds a live entity. */
  readonly alive = new Uint8Array(MAX_ENTITIES);
  /** Bumped every time a slot is recycled, so stale handles can be detected. */
  readonly generation = new Uint16Array(MAX_ENTITIES);

  readonly posX = new Int32Array(MAX_ENTITIES);
  readonly posY = new Int32Array(MAX_ENTITIES);
  readonly facing = new Int32Array(MAX_ENTITIES);
  readonly radius = new Int32Array(MAX_ENTITIES);
  readonly moveSpeed = new Int32Array(MAX_ENTITIES);
  readonly turnRate = new Int32Array(MAX_ENTITIES);
  readonly owner = new Int32Array(MAX_ENTITIES);
  readonly typeId = new Int32Array(MAX_ENTITIES);
  readonly health = new Int32Array(MAX_ENTITIES);

  readonly orderKind = new Uint8Array(MAX_ENTITIES);
  readonly orderX = new Int32Array(MAX_ENTITIES);
  readonly orderY = new Int32Array(MAX_ENTITIES);
  /** Destination cell of the flow field this entity follows, or -1. */
  readonly flowGoal = new Int32Array(MAX_ENTITIES);
  /** 1 once the entity has reached its destination and should stop shoving. */
  readonly settled = new Uint8Array(MAX_ENTITIES);

  // -- combat ---------------------------------------------------------------

  /** Entity this one is shooting or working on. NULL_ENTITY when none. */
  readonly targetId = new Int32Array(MAX_ENTITIES);
  /** Ticks until the weapon may fire again. */
  readonly cooldown = new Int32Array(MAX_ENTITIES);

  // -- economy --------------------------------------------------------------

  /** Alloy currently carried by a harvester. */
  readonly cargo = new Int32Array(MAX_ENTITIES);
  /** Ticks of mining still owed before the load is full. */
  readonly gatherTimer = new Int32Array(MAX_ENTITIES);
  /** Ore left in a resource node. */
  readonly resource = new Int32Array(MAX_ENTITIES);

  // -- construction and production -----------------------------------------

  /**
   * Ticks of construction still owed. Non-zero means the building is a site:
   * it blocks terrain and can be shot, but does not yet function.
   */
  readonly buildRemaining = new Int32Array(MAX_ENTITIES);
  /** Ticks left on the item at the head of the production queue. */
  readonly produceRemaining = new Int32Array(MAX_ENTITIES);
  /** Number of valid entries in this entity's queue slice. */
  readonly queueLen = new Uint8Array(MAX_ENTITIES);
  /** Flat production queues: entity `i` owns `[i * CAP, i * CAP + CAP)`. */
  readonly queue = new Int32Array(MAX_ENTITIES * PRODUCTION_QUEUE_CAP);
  /** Where newly produced units walk to. */
  readonly rallyX = new Int32Array(MAX_ENTITIES);
  readonly rallyY = new Int32Array(MAX_ENTITIES);

  /** Highest slot index ever used, plus one. Bounds every iteration. */
  highWater = 0;
  /** Number of live entities. */
  count = 0;

  /**
   * Scan hint for the next free slot.
   *
   * Allocation always takes the LOWEST free slot, which makes it a pure
   * function of the `alive` bitmap. That matters more than it looks: an
   * explicit free list would carry allocation order as hidden state, so a peer
   * that resynced from a snapshot (and rebuilt its list from liveness bits)
   * would allocate differently from a peer whose list came from its own
   * despawn history -- and the two would desync on the very next spawn, making
   * the resync appear not to have taken.
   *
   * INVARIANT: every slot below `lowestFreeHint` is alive. The hint is
   * therefore only ever an optimisation -- scanning from 0 finds the same slot
   * -- so it cannot itself be a source of divergence and needs no serialising.
   */
  private lowestFreeHint = 0;

  /**
   * Component arrays in a fixed order. The hash depends on this order, and so
   * does the snapshot format -- see `entityArrays` in snapshot.ts, which MUST
   * stay in step with this list.
   */
  private readonly hashed = [
    this.alive,
    this.generation,
    this.posX,
    this.posY,
    this.facing,
    this.radius,
    this.moveSpeed,
    this.turnRate,
    this.owner,
    this.typeId,
    this.health,
    this.orderKind,
    this.orderX,
    this.orderY,
    this.flowGoal,
    this.settled,
    this.targetId,
    this.cooldown,
    this.cargo,
    this.gatherTimer,
    this.resource,
    this.buildRemaining,
    this.produceRemaining,
    this.queueLen,
    this.rallyX,
    this.rallyY,
  ];

  /** Allocate the lowest free slot. Returns NULL_ENTITY when the store is full. */
  spawn(): EntityId {
    let index = -1;
    for (let i = this.lowestFreeHint; i < this.highWater; i++) {
      if (this.alive[i] === 0) {
        index = i;
        break;
      }
    }

    if (index === -1) {
      if (this.highWater >= MAX_ENTITIES) return NULL_ENTITY;
      index = this.highWater++;
    }

    // Everything below index is now known occupied, which re-establishes the
    // invariant documented on lowestFreeHint.
    this.lowestFreeHint = index + 1;
    this.alive[index] = 1;
    this.count++;
    return makeId(index, this.generation[index]);
  }

  /** Free a slot. Safe to call with a stale handle, which is a no-op. */
  despawn(id: EntityId): boolean {
    const index = entityIndex(id);
    if (!this.isAlive(id)) return false;

    this.alive[index] = 0;
    // Wrapping is fine: a handle would have to survive 65536 recycles of the
    // same slot to collide, which cannot happen within a match.
    this.generation[index] = (this.generation[index] + 1) & 0xffff;
    this.count--;
    if (index < this.lowestFreeHint) this.lowestFreeHint = index;

    // Zero every component. Dead slots are still covered by the state hash, so
    // leaving stale values behind would make the hash depend on an entity's
    // history rather than on the current world -- two peers that reached the
    // same state by different routes would disagree.
    this.clearSlot(index);
    return true;
  }

  isAlive(id: EntityId): boolean {
    if (id < 0) return false;
    const index = entityIndex(id);
    return (
      index < MAX_ENTITIES &&
      this.alive[index] === 1 &&
      this.generation[index] === entityGeneration(id)
    );
  }

  /** Handle for a slot index, or NULL_ENTITY if the slot is empty. */
  idAt(index: number): EntityId {
    if (index < 0 || index >= MAX_ENTITIES || this.alive[index] !== 1) return NULL_ENTITY;
    return makeId(index, this.generation[index]);
  }

  /**
   * Slot index for a live handle, or -1 if it is stale.
   *
   * The pairing of `isAlive` then `entityIndex` is by far the most repeated
   * two-line idiom in the systems; folding it into one call removes a class of
   * bug where the liveness check is forgotten and a dead slot's zeroed
   * components are read as if they were real.
   */
  indexOfLive(id: EntityId): number {
    return this.isAlive(id) ? entityIndex(id) : -1;
  }

  // -- production queue -----------------------------------------------------

  /** Append a type id to a building's queue. False if the queue is full. */
  enqueue(index: number, typeId: number): boolean {
    const len = this.queueLen[index];
    if (len >= PRODUCTION_QUEUE_CAP) return false;
    this.queue[index * PRODUCTION_QUEUE_CAP + len] = typeId;
    this.queueLen[index] = len + 1;
    return true;
  }

  /** Queue entry at a position, or T_NONE (0) if out of range. */
  queueAt(index: number, position: number): number {
    if (position < 0 || position >= this.queueLen[index]) return 0;
    return this.queue[index * PRODUCTION_QUEUE_CAP + position];
  }

  /**
   * Remove one queue entry, shifting the rest down.
   *
   * Compaction rather than a ring buffer: the queue is at most five entries, so
   * the shift is free, and a dense array means the hash covers exactly the
   * entries that exist rather than a head/tail pair that can describe the same
   * queue two different ways.
   */
  dequeueAt(index: number, position: number): number {
    const len = this.queueLen[index];
    if (position < 0 || position >= len) return 0;
    const base = index * PRODUCTION_QUEUE_CAP;
    const removed = this.queue[base + position];
    for (let k = position; k < len - 1; k++) {
      this.queue[base + k] = this.queue[base + k + 1];
    }
    this.queue[base + len - 1] = 0;
    this.queueLen[index] = len - 1;
    return removed;
  }

  /** Reset to an empty store. */
  clear(): void {
    for (let i = 0; i < this.highWater; i++) this.clearSlot(i);
    this.alive.fill(0);
    this.generation.fill(0);
    this.lowestFreeHint = 0;
    this.highWater = 0;
    this.count = 0;
  }

  /**
   * Re-establish the allocation hint after a snapshot restore.
   *
   * Safe to reset to 0 unconditionally: the hint's only invariant is that
   * nothing below it is free, and scanning from 0 always finds the correct
   * lowest free slot regardless.
   */
  resetAllocationHint(): void {
    this.lowestFreeHint = 0;
  }

  /**
   * Mix the store into a hash.
   *
   * Only the first `highWater` slots are covered, since everything past that
   * has never been touched and is uniformly zero on every peer.
   */
  hash(h: number): number {
    let acc = hashNumber(h, this.highWater);
    acc = hashNumber(acc, this.count);
    for (const array of this.hashed) {
      acc = hashArrayPrefix(acc, array, this.highWater);
    }
    // Queues are strided, so they need their own prefix length rather than
    // riding along with the per-slot arrays above.
    return hashArrayPrefix(acc, this.queue, this.highWater * PRODUCTION_QUEUE_CAP);
  }

  private clearSlot(index: number): void {
    this.posX[index] = 0;
    this.posY[index] = 0;
    this.facing[index] = 0;
    this.radius[index] = 0;
    this.moveSpeed[index] = 0;
    this.turnRate[index] = 0;
    this.owner[index] = 0;
    this.typeId[index] = 0;
    this.health[index] = 0;
    this.orderKind[index] = ORDER_NONE;
    this.orderX[index] = 0;
    this.orderY[index] = 0;
    this.flowGoal[index] = -1;
    this.settled[index] = 0;
    this.targetId[index] = NULL_ENTITY;
    this.cooldown[index] = 0;
    this.cargo[index] = 0;
    this.gatherTimer[index] = 0;
    this.resource[index] = 0;
    this.buildRemaining[index] = 0;
    this.produceRemaining[index] = 0;
    this.queueLen[index] = 0;
    this.rallyX[index] = 0;
    this.rallyY[index] = 0;
    const base = index * PRODUCTION_QUEUE_CAP;
    for (let k = 0; k < PRODUCTION_QUEUE_CAP; k++) this.queue[base + k] = 0;
  }
}

/** Convenience initialiser for the common spawn-then-populate pattern. */
export interface SpawnSpec {
  x: Fx;
  y: Fx;
  facing?: number;
  radius: Fx;
  moveSpeed: Fx;
  turnRate?: number;
  owner: number;
  typeId: number;
  health: number;
}

export function spawnUnit(store: EntityStore, spec: SpawnSpec): EntityId {
  const id = store.spawn();
  if (id === NULL_ENTITY) return id;
  const i = entityIndex(id);
  store.posX[i] = spec.x;
  store.posY[i] = spec.y;
  store.facing[i] = spec.facing ?? 0;
  store.radius[i] = spec.radius;
  store.moveSpeed[i] = spec.moveSpeed;
  store.turnRate[i] = spec.turnRate ?? 2048;
  store.owner[i] = spec.owner;
  store.typeId[i] = spec.typeId;
  store.health[i] = spec.health;
  store.orderKind[i] = ORDER_NONE;
  store.orderX[i] = 0;
  store.orderY[i] = 0;
  store.flowGoal[i] = -1;
  store.settled[i] = 0;
  store.targetId[i] = NULL_ENTITY;
  store.cooldown[i] = 0;
  store.cargo[i] = 0;
  store.gatherTimer[i] = 0;
  store.resource[i] = 0;
  store.buildRemaining[i] = 0;
  store.produceRemaining[i] = 0;
  store.queueLen[i] = 0;
  store.rallyX[i] = 0;
  store.rallyY[i] = 0;
  return id;
}

/**
 * Spawn an entity of a given type, taking every stat from the type table.
 *
 * This is the only spawn path gameplay should use. `spawnUnit` remains for
 * tests and the determinism fixture, which want arbitrary stats without
 * inventing a content entry for them.
 */
export function spawnTyped(
  store: EntityStore,
  types: TypeTable,
  typeId: number,
  x: Fx,
  y: Fx,
  owner: number,
  facing = 0,
): EntityId {
  const type = types.get(typeId);
  const id = spawnUnit(store, {
    x,
    y,
    facing,
    radius: type.radius,
    moveSpeed: type.moveSpeed,
    turnRate: type.turnRate,
    owner,
    typeId,
    health: type.maxHealth,
  });
  if (id === NULL_ENTITY) return id;

  const i = entityIndex(id);
  store.resource[i] = type.resourceAmount;
  // Buildings default their rally point to their own centre; the first rally
  // command replaces it. Zero would send every new unit to the map corner.
  store.rallyX[i] = x;
  store.rallyY[i] = y;
  // Buildings and resource nodes never move, so they are settled from birth --
  // otherwise separation steering would try to shove a Nexus.
  if (type.footprint > 0) store.settled[i] = 1;
  return id;
}

/**
 * Centre of a building's footprint, given its anchor tile.
 *
 * Buildings are anchored by their top-left tile so the placement grid is
 * unambiguous, but positioned by their centre so range and collision maths do
 * not have to special-case them against units.
 */
export function footprintCentre(anchorTile: number, footprint: number): Fx {
  return tileCentre(anchorTile) + (((footprint - 1) << 16) >> 1);
}
