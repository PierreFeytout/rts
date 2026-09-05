import {
  ABILITY_FLAGS,
  ARMOUR_HEAVY,
  ARMOUR_LIGHT,
  ARMOUR_STRUCTURE,
  CAN_ATTACK,
  CAN_BUILD,
  CAN_GATHER,
  CAN_PRODUCE,
  DAMAGE_EXPLOSIVE,
  DAMAGE_KINETIC,
  DAMAGE_PLASMA,
  IS_DROPOFF,
  KIND_BUILDING,
  KIND_RESOURCE,
  KIND_UNIT,
  NEEDS_VENT,
  TypeTable,
  fxFromFloat,
  hashFinish,
  hashInit,
  hashNumber,
  type EntityType,
} from "@rts/sim";
import {
  TICKS_PER_SECOND,
  parseRace,
  parseResource,
  type RawBuilding,
  type RawRace,
  type RawResource,
  type RawUnit,
} from "./schema.js";

/**
 * Turning validated content into something the simulation can run.
 *
 * Three jobs happen here, and each exists to stop a specific failure:
 *
 *   1. **Interning.** Human-readable string ids become dense integers, because
 *      the simulation indexes a flat table every tick for every entity and
 *      stores the id in an `Int32Array`. Assignment is by *sorted string id*,
 *      so it is a pure function of the content set -- two peers that loaded the
 *      same content agree on the numbers without exchanging them.
 *   2. **Unit conversion.** Content is authored in tiles and seconds; the
 *      simulation runs on Q16.16 and ticks. Doing this once at load keeps the
 *      conversion out of the hot path and out of the content author's head.
 *   3. **Coherence checks.** zod proves each field is well-formed. It cannot
 *      prove a Foundry produces something that exists, or that a race has any
 *      way to deliver alloy. Those are checked here, because the failure mode
 *      is otherwise a race that loads cleanly and is unplayable.
 */

/** The engine's behaviour registry: content-facing name to ability flag. */
const BEHAVIOURS = new Map<string, number>(ABILITY_FLAGS.map(([name, flag]) => [name, flag]));

const ARMOUR = { light: ARMOUR_LIGHT, heavy: ARMOUR_HEAVY, structure: ARMOUR_STRUCTURE };
const DAMAGE = { kinetic: DAMAGE_KINETIC, plasma: DAMAGE_PLASMA, explosive: DAMAGE_EXPLOSIVE };

/** One playable faction, with its ids already interned. */
export interface RaceInfo {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  /** Type id of the headquarters a player starts with. */
  readonly startBuilding: number;
  /** Type id of the worker a player starts several of. */
  readonly startUnit: number;
  /** Every type id belonging to this race, ascending. */
  readonly typeIds: readonly number[];
}

export interface ContentSet {
  /** The table the simulation runs on. */
  readonly types: TypeTable;
  readonly races: readonly RaceInfo[];
  /** Shared map scenery: ore patches and vents, in definition order. */
  readonly resources: readonly number[];
  /**
   * Fingerprint of everything above.
   *
   * Exchanged in the lobby handshake. Two peers running different content
   * diverge on the first purchase, and the resulting desync report points at
   * the simulation rather than at the real cause; comparing this at the door
   * turns that into a clear refusal.
   */
  readonly hash: number;
  /** Numeric id for a content id. Throws on an unknown one. */
  id(contentId: string): number;
  /** The content id a numeric id came from, for diagnostics and save files. */
  contentIdOf(typeId: number): string;
  race(raceId: string): RaceInfo;
}

/** Seconds to whole ticks, never rounding a real duration down to nothing. */
function ticks(seconds: number): number {
  const t = Math.round(seconds * TICKS_PER_SECOND);
  return t < 1 ? 1 : t;
}

/** Tiles per second to Q16.16 per tick. */
function speed(tilesPerSecond: number): number {
  return fxFromFloat(tilesPerSecond / TICKS_PER_SECOND);
}

/** Full turns per second to BAM per tick. */
function turn(turnsPerSecond: number): number {
  return Math.round((65536 * turnsPerSecond) / TICKS_PER_SECOND);
}

function abilities(names: readonly string[], what: string): number {
  let mask = 0;
  for (const name of names) {
    const flag = BEHAVIOURS.get(name);
    // Unreachable through the schema, which closes the enum -- but this is the
    // seam where a new engine behaviour and its registry entry can drift apart,
    // and the failure would otherwise be an ability that silently does nothing.
    if (flag === undefined) throw new Error(`content: ${what} has unknown behaviour '${name}'`);
    mask |= flag;
  }
  return mask;
}

/**
 * Build a content set from validated race and resource definitions.
 *
 * Takes `unknown` and validates, rather than taking already-parsed data: the
 * shipped races and a hypothetical mod folder must go through the same door,
 * or the schema is only ever checking things that were already correct.
 */
export function buildContent(rawRaces: readonly unknown[], rawResources: readonly unknown[]): ContentSet {
  const races = rawRaces.map(parseRace);
  const resources = rawResources.map(parseResource);

  // -- intern -------------------------------------------------------------
  // Every content id, sorted, then numbered from 1. Sorting is what makes the
  // assignment reproducible: definition order is an authoring accident, and two
  // peers whose content files were concatenated differently would otherwise
  // disagree about which integer means "drone".
  const allIds: string[] = [];
  for (const race of races) {
    for (const unit of race.units) allIds.push(unit.id);
    for (const building of race.buildings) allIds.push(building.id);
  }
  for (const resource of resources) allIds.push(resource.id);

  const sorted = [...allIds].sort();
  const numeric = new Map<string, number>();
  const byNumber: string[] = [];
  for (const id of sorted) {
    if (numeric.has(id)) throw new Error(`content: duplicate id '${id}'`);
    // Ids start at 1: zero is what a cleared entity slot reads back as.
    const n = numeric.size + 1;
    numeric.set(id, n);
    byNumber[n] = id;
  }

  const idOf = (contentId: string, context: string): number => {
    const n = numeric.get(contentId);
    if (n === undefined) throw new Error(`content: ${context} references unknown id '${contentId}'`);
    return n;
  };

  // -- convert ------------------------------------------------------------
  const types: EntityType[] = [];
  for (const race of races) {
    for (const unit of race.units) types.push(buildUnit(unit, idOf));
    for (const building of race.buildings) types.push(buildBuilding(building, idOf));
  }
  for (const resource of resources) types.push(buildResource(resource, idOf));

  const table = new TypeTable(types);

  // -- check ---------------------------------------------------------------
  const raceInfos = races.map((race) => checkRace(race, table, idOf));
  checkResources(table, resources.map((r) => idOf(r.id, "resources")));

  const resourceIds = resources.map((r) => idOf(r.id, "resources"));

  return {
    types: table,
    races: raceInfos,
    resources: resourceIds,
    hash: hashContent(table, raceInfos, byNumber),
    id(contentId: string): number {
      return idOf(contentId, "lookup");
    },
    contentIdOf(typeId: number): string {
      const id = byNumber[typeId];
      if (id === undefined) throw new Error(`content: no content id for type ${typeId}`);
      return id;
    },
    race(raceId: string): RaceInfo {
      const found = raceInfos.find((r) => r.id === raceId);
      if (found === undefined) throw new Error(`content: unknown race '${raceId}'`);
      return found;
    },
  };
}

type IdLookup = (contentId: string, context: string) => number;

function buildUnit(unit: RawUnit, idOf: IdLookup): EntityType {
  const mask = abilities(unit.behaviours, unit.id);
  return {
    id: idOf(unit.id, unit.id),
    name: unit.name,
    kind: KIND_UNIT,
    abilities: mask,
    maxHealth: unit.maxHealth,
    armour: ARMOUR[unit.armour],
    radius: fxFromFloat(unit.radius),
    footprint: 0,
    moveSpeed: speed(unit.moveSpeed),
    turnRate: turn(unit.turnRate),
    damage: unit.weapon?.damage ?? 0,
    damageType: unit.weapon ? DAMAGE[unit.weapon.damageType] : DAMAGE_KINETIC,
    range: fxFromFloat(unit.weapon?.range ?? 0),
    cooldown: unit.weapon ? ticks(unit.weapon.cooldown) : 20,
    costAlloy: unit.costAlloy,
    costPlasma: unit.costPlasma,
    buildTime: ticks(unit.buildTime),
    supplyCost: unit.supplyCost,
    supplyProvided: 0,
    produces: [],
    builds: unit.builds.map((b) => idOf(b, `${unit.id}.builds`)),
    cargoCapacity: unit.cargoCapacity,
    gatherTime: unit.gatherTime > 0 ? ticks(unit.gatherTime) : 0,
    resourceAmount: 0,
    plasmaPerSecond: 0,
  };
}

function buildBuilding(building: RawBuilding, idOf: IdLookup): EntityType {
  const mask = abilities(building.behaviours, building.id);
  return {
    id: idOf(building.id, building.id),
    name: building.name,
    kind: KIND_BUILDING,
    abilities: mask,
    maxHealth: building.maxHealth,
    armour: ARMOUR[building.armour],
    radius: fxFromFloat(building.radius),
    footprint: building.footprint,
    moveSpeed: 0,
    turnRate: 0,
    damage: building.weapon?.damage ?? 0,
    damageType: building.weapon ? DAMAGE[building.weapon.damageType] : DAMAGE_KINETIC,
    range: fxFromFloat(building.weapon?.range ?? 0),
    cooldown: building.weapon ? ticks(building.weapon.cooldown) : 20,
    costAlloy: building.costAlloy,
    costPlasma: building.costPlasma,
    buildTime: ticks(building.buildTime),
    supplyCost: 0,
    supplyProvided: building.supplyProvided,
    produces: building.produces.map((p) => idOf(p, `${building.id}.produces`)),
    builds: [],
    cargoCapacity: 0,
    gatherTime: 0,
    resourceAmount: 0,
    plasmaPerSecond: building.plasmaPerSecond,
  };
}

function buildResource(resource: RawResource, idOf: IdLookup): EntityType {
  return {
    id: idOf(resource.id, resource.id),
    name: resource.name,
    kind: KIND_RESOURCE,
    abilities: 0,
    maxHealth: 1,
    armour: ARMOUR_STRUCTURE,
    radius: fxFromFloat(resource.radius),
    footprint: resource.footprint,
    moveSpeed: 0,
    turnRate: 0,
    damage: 0,
    damageType: DAMAGE_KINETIC,
    range: 0,
    cooldown: 0,
    costAlloy: 0,
    costPlasma: 0,
    buildTime: 1,
    supplyCost: 0,
    supplyProvided: 0,
    produces: [],
    builds: [],
    cargoCapacity: 0,
    gatherTime: 0,
    resourceAmount: resource.resourceAmount,
    plasmaPerSecond: 0,
  };
}

// ---------------------------------------------------------------------------
// Coherence
// ---------------------------------------------------------------------------

/**
 * Checks that a race is actually playable.
 *
 * Every one of these corresponds to a way a race can pass field-level
 * validation and still be broken in a way that looks like a bug in the engine.
 */
function checkRace(race: RawRace, table: TypeTable, idOf: IdLookup): RaceInfo {
  const where = `race '${race.id}'`;
  const typeIds: number[] = [];

  for (const unit of race.units) {
    const id = idOf(unit.id, where);
    typeIds.push(id);
    const type = table.get(id);

    if ((type.abilities & CAN_ATTACK) !== 0 && unit.weapon === undefined) {
      throw new Error(`content: ${unit.id} has the 'attack' behaviour but no weapon`);
    }
    if (unit.weapon !== undefined && (type.abilities & CAN_ATTACK) === 0) {
      // A weapon with no behaviour to fire it is a unit that stands there being
      // shot, which reads as a combat bug rather than a content mistake.
      throw new Error(`content: ${unit.id} defines a weapon but lacks the 'attack' behaviour`);
    }
    if ((type.abilities & CAN_GATHER) !== 0 && (type.cargoCapacity === 0 || type.gatherTime === 0)) {
      throw new Error(`content: ${unit.id} can gather but has no cargoCapacity or gatherTime`);
    }
    if ((type.abilities & CAN_BUILD) !== 0 && type.builds.length === 0) {
      throw new Error(`content: ${unit.id} can build but lists nothing to build`);
    }
  }

  let hasDropoff = false;
  for (const building of race.buildings) {
    const id = idOf(building.id, where);
    typeIds.push(id);
    const type = table.get(id);

    if ((type.abilities & CAN_PRODUCE) !== 0 && type.produces.length === 0) {
      throw new Error(`content: ${building.id} can produce but lists nothing to produce`);
    }
    if ((type.abilities & CAN_ATTACK) !== 0 && building.weapon === undefined) {
      throw new Error(`content: ${building.id} has the 'attack' behaviour but no weapon`);
    }
    if (building.weapon !== undefined && (type.abilities & CAN_ATTACK) === 0) {
      throw new Error(`content: ${building.id} defines a weapon but lacks the 'attack' behaviour`);
    }
    if ((type.abilities & IS_DROPOFF) !== 0) hasDropoff = true;
  }

  // Without a drop-off, alloy can be mined but never banked: the drones walk
  // home forever and the player watches an economy that produces nothing.
  if (!hasDropoff) {
    throw new Error(`content: ${where} has no building with the 'dropoff' behaviour`);
  }

  const startBuilding = idOf(race.startBuilding, `${where}.startBuilding`);
  const startUnit = idOf(race.startUnit, `${where}.startUnit`);
  if (!typeIds.includes(startBuilding)) {
    throw new Error(`content: ${where} starts with '${race.startBuilding}', which is not its own`);
  }
  if (!typeIds.includes(startUnit)) {
    throw new Error(`content: ${where} starts with '${race.startUnit}', which is not its own`);
  }
  // A race whose starting worker cannot build is a race that can never leave
  // its opening position.
  if ((table.get(startUnit).abilities & CAN_BUILD) === 0) {
    throw new Error(`content: ${where} start unit '${race.startUnit}' cannot build`);
  }

  return {
    id: race.id,
    name: race.name,
    blurb: race.blurb,
    startBuilding,
    startUnit,
    typeIds: [...typeIds].sort((a, b) => a - b),
  };
}

/** Any race needing a vent implies the map must be able to provide one. */
function checkResources(table: TypeTable, resourceIds: readonly number[]): void {
  let needsVent = false;
  for (const type of table.all) {
    if ((type.abilities & NEEDS_VENT) !== 0) needsVent = true;
  }
  if (!needsVent) return;

  const hasMarker = resourceIds.some((id) => table.get(id).resourceAmount === 0);
  if (!hasMarker) {
    throw new Error(
      "content: a building requires a vent, but no marker resource (resourceAmount 0) is defined",
    );
  }
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * Fingerprint the resolved content.
 *
 * Hashes the *converted* numbers rather than the source text, because those are
 * what the simulation actually runs on -- reformatting a definition file must
 * not change the hash, and changing a stat by one must. String ids are folded
 * in as well, so a rename is caught even though it cannot change behaviour: two
 * peers disagreeing about what a unit is called will disagree in their UI, and
 * that is worth refusing at the door too.
 */
function hashContent(
  table: TypeTable,
  races: readonly RaceInfo[],
  byNumber: readonly string[],
): number {
  let h = hashInit();

  for (const type of table.all) {
    h = hashNumber(h, type.id);
    for (const ch of byNumber[type.id] ?? "") h = hashNumber(h, ch.charCodeAt(0));
    h = hashNumber(h, type.kind);
    h = hashNumber(h, type.abilities);
    h = hashNumber(h, type.maxHealth);
    h = hashNumber(h, type.armour);
    h = hashNumber(h, type.radius);
    h = hashNumber(h, type.footprint);
    h = hashNumber(h, type.moveSpeed);
    h = hashNumber(h, type.turnRate);
    h = hashNumber(h, type.damage);
    h = hashNumber(h, type.damageType);
    h = hashNumber(h, type.range);
    h = hashNumber(h, type.cooldown);
    h = hashNumber(h, type.costAlloy);
    h = hashNumber(h, type.costPlasma);
    h = hashNumber(h, type.buildTime);
    h = hashNumber(h, type.supplyCost);
    h = hashNumber(h, type.supplyProvided);
    h = hashNumber(h, type.cargoCapacity);
    h = hashNumber(h, type.gatherTime);
    h = hashNumber(h, type.resourceAmount);
    h = hashNumber(h, type.plasmaPerSecond);
    for (const p of type.produces) h = hashNumber(h, p);
    for (const b of type.builds) h = hashNumber(h, b);
  }

  for (const race of races) {
    for (const ch of race.id) h = hashNumber(h, ch.charCodeAt(0));
    h = hashNumber(h, race.startBuilding);
    h = hashNumber(h, race.startUnit);
  }

  return hashFinish(h);
}
