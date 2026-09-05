import type { Fx } from "./fixed.js";

/**
 * The *shape* of entity type definitions -- what questions the simulation is
 * allowed to ask about a unit.
 *
 * Deliberately contains no actual units. The Vanguard Directive, and every race
 * after it, lives in `@rts/content`; this package never imports that one. The
 * dependency points one way on purpose: content knows about the engine, the
 * engine knows nothing about content, so it is structurally impossible for the
 * simulation to become specialised to a particular race.
 *
 * The simulation only ever asks the table questions ("how much damage does type
 * 3 do?"); it never hardcodes an answer. That is the whole extensibility
 * requirement in one sentence.
 *
 * Everything is integer or fixed-point. Costs, damage and durations are plain
 * integers; distances and speeds are Q16.16. Nothing here may be a float at
 * simulation time.
 */

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/** Broad category. Decides which systems consider an entity at all. */
export const KIND_UNIT = 0;
export const KIND_BUILDING = 1;
/** Ore patches and geothermal vents: never move, never fight, never owned. */
export const KIND_RESOURCE = 2;

/**
 * Armour classes and damage types.
 *
 * Kept as two small integer spaces indexing a multiplier matrix, rather than
 * per-unit "strong against" lists. A matrix is the only form that stays
 * comprehensible once a second race exists -- a new unit picks an existing
 * damage type and immediately has sensible interactions with everything that
 * already exists, including units its author never saw.
 */
export const ARMOUR_LIGHT = 0;
export const ARMOUR_HEAVY = 1;
export const ARMOUR_STRUCTURE = 2;
export const ARMOUR_COUNT = 3;

export const DAMAGE_KINETIC = 0;
export const DAMAGE_PLASMA = 1;
export const DAMAGE_EXPLOSIVE = 2;
export const DAMAGE_COUNT = 3;

/**
 * Damage multipliers as integer percentages, indexed
 * `[damageType * ARMOUR_COUNT + armourClass]`.
 *
 * Percentages rather than fixed-point fractions because damage must land on an
 * exact integer: `base * pct / 100` with an integer divide is unambiguous on
 * every engine, whereas a Q16.16 multiply would introduce rounding that has to
 * be reasoned about every time someone rebalances a number.
 *
 * This matrix is engine-level rather than content-level. Races pick from the
 * existing damage types; a race that could invent its own multipliers could
 * quietly make itself immune to everything, and cross-race balance would stop
 * being a property anyone could reason about.
 *
 *              vs LIGHT   vs HEAVY   vs STRUCTURE
 *   KINETIC       100         65          70
 *   PLASMA         85        135          60
 *   EXPLOSIVE      65        115         160
 */
export const DAMAGE_TABLE = Int32Array.from([
  100, 65, 70,
  85, 135, 60,
  65, 115, 160,
]);

/** Damage after the armour matrix. At least 1, so nothing is fully immune. */
export function applyDamageTable(base: number, damageType: number, armour: number): number {
  const pct = DAMAGE_TABLE[damageType * ARMOUR_COUNT + armour];
  const scaled = Math.floor((base * pct) / 100);
  return scaled < 1 ? 1 : scaled;
}

// ---------------------------------------------------------------------------
// Ability flags
// ---------------------------------------------------------------------------

/**
 * What an entity can *do*, as a bitmask.
 *
 * These are the behaviours the engine implements. Content picks from this set
 * by name -- see the behaviour registry in `@rts/content` -- and a genuinely
 * novel mechanic becomes a new flag plus one system here, reusable by every
 * race thereafter. Content cannot invent a behaviour, which is the point: an
 * ability that no system implements would silently do nothing.
 */
export const CAN_ATTACK = 1 << 0;
export const CAN_GATHER = 1 << 1;
export const CAN_BUILD = 1 << 2;
export const CAN_PRODUCE = 1 << 3;
/** Harvesters return cargo here. */
export const IS_DROPOFF = 1 << 4;
/** Must be placed on top of a geothermal vent, and consumes it. */
export const NEEDS_VENT = 1 << 5;

/** Every ability flag the engine implements, with its content-facing name. */
export const ABILITY_FLAGS: ReadonlyArray<readonly [string, number]> = [
  ["attack", CAN_ATTACK],
  ["gather", CAN_GATHER],
  ["build", CAN_BUILD],
  ["produce", CAN_PRODUCE],
  ["dropoff", IS_DROPOFF],
  ["needsVent", NEEDS_VENT],
];

export interface EntityType {
  readonly id: number;
  readonly name: string;
  readonly kind: number;
  readonly abilities: number;

  readonly maxHealth: number;
  readonly armour: number;
  readonly radius: Fx;
  /** Side length in tiles. Buildings occupy a square footprint; units use 0. */
  readonly footprint: number;

  readonly moveSpeed: Fx;
  readonly turnRate: number;

  readonly damage: number;
  readonly damageType: number;
  readonly range: Fx;
  /** Ticks between shots. */
  readonly cooldown: number;
  /**
   * Sight radius in whole tiles.
   *
   * Tiles rather than fixed-point because vision stamps a grid, and a
   * sub-tile radius would be a precision nobody can act on. Must exceed
   * weapon range for anything that shoots, or the unit is blind inside its
   * own firing envelope and simply never engages.
   */
  readonly visionRange: number;

  readonly costAlloy: number;
  readonly costPlasma: number;
  /** Ticks to train or construct. */
  readonly buildTime: number;
  readonly supplyCost: number;
  readonly supplyProvided: number;

  /** Type ids this entity can train, in menu order. */
  readonly produces: readonly number[];
  /** Type ids this entity can construct, in menu order. */
  readonly builds: readonly number[];

  /** Alloy carried per harvesting trip. */
  readonly cargoCapacity: number;
  /** Ticks spent mining before the load is full. */
  readonly gatherTime: number;
  /** Starting ore in a resource node. */
  readonly resourceAmount: number;
  /**
   * Plasma produced per 20 ticks (one second). Extractors trickle rather than
   * requiring a round trip, so the two economies feel genuinely different
   * instead of being the same loop with a different colour.
   */
  readonly plasmaPerSecond: number;
}

/** Owner id for unowned entities: ore patches, vents, wreckage. */
export const NEUTRAL_PLAYER = -1;

/** Hard ceiling on supply, regardless of how many pylons are standing. */
export const MAX_SUPPLY = 200;

/**
 * Lookup table indexed directly by type id.
 *
 * A dense array rather than a Map, because the hot loops index it every tick
 * for every entity, and because iterating a Map is exactly the kind of
 * order-dependent operation this package bans.
 */
export class TypeTable {
  private readonly byId: Array<EntityType | undefined> = [];
  /** All defined types, in ascending id order. Safe to iterate. */
  readonly all: readonly EntityType[];

  constructor(types: readonly EntityType[]) {
    const sorted = [...types].sort((a, b) => a.id - b.id);
    this.all = sorted;
    for (const type of sorted) {
      if (type.id <= 0) {
        // Zero is reserved: cleared entity slots read back as type 0, and a
        // real type there would make a dead slot look like a live entity.
        throw new Error(`TypeTable: type id must be positive, got ${type.id} (${type.name})`);
      }
      if (this.byId[type.id] !== undefined) {
        throw new Error(`TypeTable: duplicate type id ${type.id} (${type.name})`);
      }
      this.byId[type.id] = type;
    }
  }

  /** Definition for a type id. Throws rather than returning a silent default. */
  get(id: number): EntityType {
    const type = this.byId[id];
    // A missing type means a spawn with a bad id, which would otherwise become
    // a unit with zero health and no behaviour -- a bug that presents as
    // "sometimes units just vanish" hours later.
    if (type === undefined) throw new Error(`TypeTable: unknown type id ${id}`);
    return type;
  }

  has(id: number): boolean {
    return this.byId[id] !== undefined;
  }

  /** Ability test, the form nearly every caller actually wants. */
  can(id: number, ability: number): boolean {
    return (this.get(id).abilities & ability) !== 0;
  }
}
