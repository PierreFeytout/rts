import { fxFromFloat, type Fx } from "./fixed.js";

/**
 * Entity type definitions -- what a Drone is, what a Foundry costs.
 *
 * This is deliberately *data* rather than code, and it is reached through
 * `World.types` rather than imported directly by the systems that use it. The
 * simulation only ever asks the table questions ("how much damage does type 3
 * do?"); it never hardcodes an answer. That is the whole extensibility
 * requirement in one sentence: adding a race means adding rows here, and later
 * loading those rows from content files, without any system below caring.
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
 * These are the hooks the engine knows about. A content file picks from this
 * set; anything genuinely new becomes a new flag plus one system, reusable by
 * every race thereafter. This is the "engine knows behaviours, content knows
 * everything else" split the plan calls for, in its simplest useful form.
 */
export const CAN_ATTACK = 1 << 0;
export const CAN_GATHER = 1 << 1;
export const CAN_BUILD = 1 << 2;
export const CAN_PRODUCE = 1 << 3;
/** Harvesters return cargo here. */
export const IS_DROPOFF = 1 << 4;
/** Must be placed on top of a geothermal vent, and consumes it. */
export const NEEDS_VENT = 1 << 5;

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

// ---------------------------------------------------------------------------
// The Vanguard Directive -- race #1
// ---------------------------------------------------------------------------

export const T_NONE = 0;
export const T_DRONE = 1;
export const T_TROOPER = 2;
export const T_HOVERTANK = 3;
export const T_SCOUT = 4;

export const T_NEXUS = 10;
export const T_EXTRACTOR = 11;
export const T_FOUNDRY = 12;
export const T_PYLON = 13;
export const T_TURRET = 14;

export const T_ALLOY_NODE = 20;
export const T_VENT = 21;

/** Owner id for unowned entities: ore patches, vents, wreckage. */
export const NEUTRAL_PLAYER = -1;

/** Hard ceiling on supply, regardless of how many pylons are standing. */
export const MAX_SUPPLY = 200;

const DEFAULTS = {
  kind: KIND_UNIT,
  abilities: 0,
  maxHealth: 100,
  armour: ARMOUR_LIGHT,
  radius: fxFromFloat(0.32),
  footprint: 0,
  moveSpeed: 0,
  turnRate: 3600,
  damage: 0,
  damageType: DAMAGE_KINETIC,
  range: 0,
  cooldown: 20,
  costAlloy: 0,
  costPlasma: 0,
  buildTime: 20,
  supplyCost: 0,
  supplyProvided: 0,
  produces: [] as readonly number[],
  builds: [] as readonly number[],
  cargoCapacity: 0,
  gatherTime: 0,
  resourceAmount: 0,
  plasmaPerSecond: 0,
};

function def(id: number, name: string, overrides: Partial<EntityType>): EntityType {
  return { ...DEFAULTS, ...overrides, id, name };
}

const VANGUARD: readonly EntityType[] = [
  def(T_DRONE, "Drone", {
    abilities: CAN_GATHER | CAN_BUILD | CAN_ATTACK,
    maxHealth: 60,
    moveSpeed: fxFromFloat(0.13),
    damage: 4,
    range: fxFromFloat(1.2),
    cooldown: 22,
    costAlloy: 50,
    buildTime: 24,
    supplyCost: 1,
    cargoCapacity: 10,
    gatherTime: 20,
    builds: [T_NEXUS, T_EXTRACTOR, T_FOUNDRY, T_PYLON, T_TURRET],
  }),

  def(T_TROOPER, "Trooper", {
    abilities: CAN_ATTACK,
    maxHealth: 90,
    moveSpeed: fxFromFloat(0.12),
    damage: 9,
    damageType: DAMAGE_KINETIC,
    range: fxFromFloat(5),
    cooldown: 12,
    costAlloy: 60,
    buildTime: 30,
    supplyCost: 2,
  }),

  def(T_HOVERTANK, "Hovertank", {
    abilities: CAN_ATTACK,
    maxHealth: 260,
    armour: ARMOUR_HEAVY,
    radius: fxFromFloat(0.45),
    moveSpeed: fxFromFloat(0.095),
    turnRate: 2400,
    damage: 22,
    damageType: DAMAGE_EXPLOSIVE,
    range: fxFromFloat(6),
    cooldown: 26,
    costAlloy: 120,
    costPlasma: 40,
    buildTime: 70,
    supplyCost: 4,
  }),

  def(T_SCOUT, "Scout", {
    abilities: CAN_ATTACK,
    maxHealth: 70,
    radius: fxFromFloat(0.28),
    moveSpeed: fxFromFloat(0.2),
    turnRate: 5200,
    damage: 5,
    range: fxFromFloat(4),
    cooldown: 14,
    costAlloy: 45,
    costPlasma: 10,
    buildTime: 24,
    supplyCost: 1,
  }),

  def(T_NEXUS, "Command Nexus", {
    kind: KIND_BUILDING,
    abilities: CAN_PRODUCE | IS_DROPOFF,
    maxHealth: 1500,
    armour: ARMOUR_STRUCTURE,
    radius: fxFromFloat(2),
    footprint: 4,
    costAlloy: 400,
    buildTime: 200,
    supplyProvided: 10,
    produces: [T_DRONE],
  }),

  def(T_EXTRACTOR, "Extractor", {
    kind: KIND_BUILDING,
    abilities: NEEDS_VENT,
    maxHealth: 500,
    armour: ARMOUR_STRUCTURE,
    radius: fxFromFloat(1),
    footprint: 2,
    costAlloy: 100,
    buildTime: 100,
    plasmaPerSecond: 3,
  }),

  def(T_FOUNDRY, "Foundry", {
    kind: KIND_BUILDING,
    abilities: CAN_PRODUCE,
    maxHealth: 900,
    armour: ARMOUR_STRUCTURE,
    radius: fxFromFloat(1.5),
    footprint: 3,
    costAlloy: 200,
    buildTime: 140,
    produces: [T_TROOPER, T_SCOUT, T_HOVERTANK],
  }),

  def(T_PYLON, "Supply Pylon", {
    kind: KIND_BUILDING,
    maxHealth: 400,
    armour: ARMOUR_STRUCTURE,
    radius: fxFromFloat(1),
    footprint: 2,
    costAlloy: 80,
    buildTime: 60,
    supplyProvided: 8,
  }),

  def(T_TURRET, "Turret", {
    kind: KIND_BUILDING,
    abilities: CAN_ATTACK,
    maxHealth: 550,
    armour: ARMOUR_STRUCTURE,
    radius: fxFromFloat(1),
    footprint: 2,
    damage: 16,
    damageType: DAMAGE_PLASMA,
    range: fxFromFloat(7),
    cooldown: 16,
    costAlloy: 120,
    costPlasma: 25,
    buildTime: 80,
  }),

  def(T_ALLOY_NODE, "Alloy Node", {
    kind: KIND_RESOURCE,
    maxHealth: 1,
    armour: ARMOUR_STRUCTURE,
    radius: fxFromFloat(1),
    footprint: 2,
    resourceAmount: 1500,
  }),

  def(T_VENT, "Geothermal Vent", {
    kind: KIND_RESOURCE,
    maxHealth: 1,
    armour: ARMOUR_STRUCTURE,
    radius: fxFromFloat(1),
    footprint: 2,
  }),
];

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

/** The default content set: race #1, the Vanguard Directive. */
export const defaultTypes = new TypeTable(VANGUARD);
