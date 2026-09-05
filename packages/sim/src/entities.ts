import { hashArrayPrefix, hashNumber } from "./hash.js";
import type { Fx } from "./fixed.js";

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
 */

/** Maximum simultaneous entities. Well above the 400-unit target. */
export const MAX_ENTITIES = 2048;

/** Order kinds. Plain integer constants -- `erasableSyntaxOnly` forbids enums. */
export const ORDER_NONE = 0;
export const ORDER_MOVE = 1;

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

  /** Highest slot index ever used, plus one. Bounds every iteration. */
  highWater = 0;
  /** Number of live entities. */
  count = 0;

  /**
   * Recycled slots, used as a stack.
   *
   * Determinism does not require any particular reuse policy, only that every
   * peer applies the same sequence of spawns and despawns -- which lockstep
   * guarantees. A stack is chosen because it keeps `highWater` low, which
   * directly reduces per-tick hashing and iteration cost.
   */
  private readonly freeList: number[] = [];

  /** Component arrays in a fixed order. The hash depends on this order. */
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
  ];

  /** Allocate a slot. Returns NULL_ENTITY when the store is full. */
  spawn(): EntityId {
    let index: number;
    const recycled = this.freeList.pop();
    if (recycled !== undefined) {
      index = recycled;
    } else {
      if (this.highWater >= MAX_ENTITIES) return NULL_ENTITY;
      index = this.highWater++;
    }

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
    this.freeList.push(index);

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

  /** Reset to an empty store. */
  clear(): void {
    for (let i = 0; i < this.highWater; i++) this.clearSlot(i);
    this.alive.fill(0);
    this.generation.fill(0);
    this.freeList.length = 0;
    this.highWater = 0;
    this.count = 0;
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
    return acc;
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
  return id;
}
