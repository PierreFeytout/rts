import { fxFromFloat } from "./fixed.js";
import {
  ARMOUR_HEAVY,
  ARMOUR_LIGHT,
  ARMOUR_STRUCTURE,
  CAN_ATTACK,
  CAN_BUILD,
  CAN_GATHER,
  CAN_PRODUCE,
  DAMAGE_EXPLOSIVE,
  DAMAGE_KINETIC,
  IS_DROPOFF,
  KIND_BUILDING,
  KIND_RESOURCE,
  KIND_UNIT,
  NEEDS_VENT,
  TypeTable,
  type EntityType,
} from "./types.js";

/**
 * A minimal content set for engine tests and the determinism fixture.
 *
 * Round numbers, and deliberately NOT the shipped race. Two reasons, and the
 * second is the one that made this a file rather than a few lines in a test:
 *
 *   1. Engine tests assert on exact numbers -- "the depot cost 100 alloy". Run
 *      against real content, every one of them breaks on a balance change,
 *      which teaches people to update assertions reflexively.
 *   2. The determinism fixture's hashes are compared between runtimes at the
 *      same commit. Tying them to shipped balance means every tuning pass
 *      churns the trace for no reason, and the churn hides a real change.
 *
 * It is also a working demonstration that the simulation is not specialised to
 * the Vanguard Directive: everything the engine does, it does against this
 * table just as happily. Between them, these eight entries exercise every
 * ability flag the engine implements.
 *
 * Ids are sparse and unordered on purpose, to catch anything that assumes type
 * ids are 1..N or that index equals id.
 */

export const FX_SOLDIER = 1;
export const FX_RUNNER = 5;
export const FX_WORKER = 3;
export const FX_BRUTE = 7;
export const FX_HQ = 12;
export const FX_FACTORY = 13;
export const FX_ORE = 21;
export const FX_VENT = 22;
export const FX_DEPOT = 30;
export const FX_TAP = 40;

const defaults = {
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
  visionRange: 8,
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

function type(id: number, name: string, overrides: Partial<EntityType>): EntityType {
  return { ...defaults, ...overrides, id, name };
}

export const fixtureTypes = new TypeTable([
  type(FX_WORKER, "Worker", {
    abilities: CAN_GATHER | CAN_BUILD | CAN_ATTACK,
    maxHealth: 60,
    moveSpeed: fxFromFloat(0.13),
    damage: 4,
    range: fxFromFloat(1.2),
    cooldown: 20,
    costAlloy: 50,
    buildTime: 20,
    supplyCost: 1,
    cargoCapacity: 10,
    gatherTime: 20,
    builds: [FX_DEPOT, FX_FACTORY, FX_TAP, FX_HQ],
  }),

  // Unarmed and mobile. Movement, pathing and netcode tests use this so they
  // stay about movement, pathing and netcode -- give two owners a shooting unit
  // and the fixture quietly turns into a combat test that kills its own
  // subjects halfway through.
  type(FX_RUNNER, "Runner", {
    maxHealth: 100,
    moveSpeed: fxFromFloat(0.18),
    costAlloy: 40,
    buildTime: 20,
    supplyCost: 1,
  }),

  type(FX_SOLDIER, "Soldier", {
    abilities: CAN_ATTACK,
    maxHealth: 100,
    moveSpeed: fxFromFloat(0.12),
    damage: 8,
    damageType: DAMAGE_KINETIC,
    range: fxFromFloat(5),
    cooldown: 30,
    visionRange: 9,
    costAlloy: 100,
    buildTime: 30,
    supplyCost: 2,
  }),

  type(FX_BRUTE, "Brute", {
    abilities: CAN_ATTACK,
    maxHealth: 300,
    armour: ARMOUR_HEAVY,
    radius: fxFromFloat(0.45),
    moveSpeed: fxFromFloat(0.09),
    turnRate: 2400,
    damage: 20,
    damageType: DAMAGE_EXPLOSIVE,
    range: fxFromFloat(6),
    cooldown: 25,
    visionRange: 10,
    costAlloy: 200,
    costPlasma: 50,
    buildTime: 60,
    supplyCost: 4,
  }),

  type(FX_HQ, "Headquarters", {
    kind: KIND_BUILDING,
    abilities: CAN_PRODUCE | IS_DROPOFF,
    maxHealth: 1000,
    armour: ARMOUR_STRUCTURE,
    radius: fxFromFloat(2),
    footprint: 4,
    visionRange: 10,
    costAlloy: 400,
    buildTime: 200,
    supplyProvided: 10,
    produces: [FX_WORKER],
  }),

  type(FX_FACTORY, "Factory", {
    kind: KIND_BUILDING,
    abilities: CAN_PRODUCE,
    maxHealth: 900,
    armour: ARMOUR_STRUCTURE,
    radius: fxFromFloat(1.5),
    footprint: 3,
    costAlloy: 200,
    buildTime: 140,
    produces: [FX_SOLDIER, FX_BRUTE],
  }),

  type(FX_DEPOT, "Depot", {
    kind: KIND_BUILDING,
    maxHealth: 400,
    armour: ARMOUR_STRUCTURE,
    radius: fxFromFloat(1),
    footprint: 2,
    costAlloy: 100,
    buildTime: 60,
    supplyProvided: 8,
  }),

  type(FX_TAP, "Tap", {
    kind: KIND_BUILDING,
    abilities: NEEDS_VENT,
    maxHealth: 500,
    armour: ARMOUR_STRUCTURE,
    radius: fxFromFloat(1),
    footprint: 2,
    costAlloy: 120,
    buildTime: 100,
    plasmaPerSecond: 3,
  }),

  type(FX_ORE, "Ore", {
    kind: KIND_RESOURCE,
    maxHealth: 1,
    armour: ARMOUR_STRUCTURE,
    radius: fxFromFloat(1),
    footprint: 2,
    resourceAmount: 1500,
  }),

  type(FX_VENT, "Vent", {
    kind: KIND_RESOURCE,
    maxHealth: 1,
    armour: ARMOUR_STRUCTURE,
    radius: fxFromFloat(1),
    footprint: 2,
  }),
]);
