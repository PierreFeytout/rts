import { z } from "zod";

/**
 * The content schema.
 *
 * Everything a race is made of, described once, validated at load. Content is
 * the one part of the system that is *meant* to be edited by people who are not
 * reading the engine source -- and later, potentially, loaded from files that
 * did not ship with the build. That makes a strict schema at the boundary worth
 * far more than it costs: a typo in a stat becomes a message naming the field,
 * rather than a unit that quietly has zero health.
 *
 * Two conventions run through all of it:
 *
 *   1. **Human units in, fixed-point out.** Content is written in tiles and
 *      tiles-per-second, because that is what a designer can reason about. The
 *      loader converts to Q16.16 and ticks. Nobody hand-writes 20972.
 *   2. **String ids everywhere.** `"vanguard.drone"`, never a number. Numeric
 *      ids are assigned at load by sorting the strings, so they are stable for
 *      a given content set but never written down by a human -- see intern.ts.
 */

/** Simulation rate, needed to convert seconds in content into ticks. */
export const TICKS_PER_SECOND = 20;

/**
 * Content ids are namespaced by race, which makes collisions between two
 * independently authored races structurally impossible rather than merely
 * unlikely.
 */
const contentId = z
  .string()
  .regex(
    /^[a-z][a-z0-9]*\.[a-z][a-z0-9-]*$/,
    "content id must look like 'race.thing' (lowercase, dot-separated)",
  );

const armour = z.enum(["light", "heavy", "structure"]);
const damageType = z.enum(["kinetic", "plasma", "explosive"]);

/**
 * Behaviours, by name.
 *
 * The list is closed on purpose: these are the behaviours the engine actually
 * implements. Accepting an arbitrary string would let a race declare an ability
 * that no system reads, which does nothing at all and looks like a balance
 * problem rather than a typo.
 */
const behaviour = z.enum(["attack", "gather", "build", "produce", "dropoff", "needsVent"]);

/** Non-negative integer, the shape most content numbers take. */
const count = z.number().int().min(0);
/** A positive distance or size in tiles, converted to Q16.16 by the loader. */
const tiles = z.number().min(0).max(64);

const weapon = z
  .object({
    damage: z.number().int().min(1),
    damageType,
    /** Maximum firing distance, in tiles. */
    range: tiles,
    /** Seconds between shots. */
    cooldown: z.number().min(0.05).max(60),
  })
  .strict();

const common = {
  id: contentId,
  name: z.string().min(1).max(40),
  maxHealth: z.number().int().min(1),
  armour,
  /** Collision radius in tiles. */
  radius: tiles,
  /**
   * Sight radius in whole tiles. Omit to let the loader derive one.
   *
   * The derived value is always larger than weapon range, because a unit that
   * cannot see as far as it can shoot never engages -- it stands inside its own
   * firing envelope waiting for a target it is structurally unable to acquire.
   */
  visionRange: z.number().int().min(1).max(40).optional(),
  costAlloy: count.default(0),
  costPlasma: count.default(0),
  /** Seconds to train or construct. */
  buildTime: z.number().min(0.05).max(600),
  behaviours: z.array(behaviour).default([]),
  weapon: weapon.optional(),
};

export const unitSchema = z
  .object({
    ...common,
    /** Tiles travelled per second. */
    moveSpeed: z.number().min(0.1).max(20),
    /** Full turns per second. Converted to BAM per tick by the loader. */
    turnRate: z.number().min(0.05).max(20).default(1),
    supplyCost: count.default(0),
    /** Alloy carried per trip. Required by anything with the `gather` behaviour. */
    cargoCapacity: count.default(0),
    /** Seconds spent mining before the load is full. */
    gatherTime: z.number().min(0).max(60).default(0),
    /** Ids this unit can construct, in menu order. */
    builds: z.array(contentId).default([]),
  })
  .strict();

export const buildingSchema = z
  .object({
    ...common,
    /** Side length in tiles. Buildings are square. */
    footprint: z.number().int().min(1).max(16),
    supplyProvided: count.default(0),
    /** Ids this building can train, in menu order. */
    produces: z.array(contentId).default([]),
    /** Passive plasma income, per second. */
    plasmaPerSecond: count.default(0),
  })
  .strict();

/**
 * Resource nodes are shared scenery, not race content -- an ore patch belongs
 * to the map, and every race mines the same ones. They live in their own
 * top-level list so a race cannot accidentally define an economy only it can
 * use.
 */
export const resourceSchema = z
  .object({
    id: contentId,
    name: z.string().min(1).max(40),
    footprint: z.number().int().min(1).max(16),
    radius: tiles,
    /** Starting ore. Zero marks a marker node, such as a geothermal vent. */
    resourceAmount: count.default(0),
  })
  .strict();

export const raceSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9]*$/, "race id must be lowercase alphanumeric"),
    name: z.string().min(1).max(40),
    /** One-line flavour, shown in the lobby. */
    blurb: z.string().max(120).default(""),
    /** The building a player starts with. Must be in `buildings`. */
    startBuilding: contentId,
    /** The unit a player starts with, several of. Must be in `units`. */
    startUnit: contentId,
    units: z.array(unitSchema).min(1),
    buildings: z.array(buildingSchema).min(1),
  })
  .strict();

export type RawWeapon = z.infer<typeof weapon>;
export type RawUnit = z.infer<typeof unitSchema>;
export type RawBuilding = z.infer<typeof buildingSchema>;
export type RawResource = z.infer<typeof resourceSchema>;
export type RawRace = z.infer<typeof raceSchema>;

/**
 * Validate one race definition from unknown input.
 *
 * This is the public loading entry point, and it takes `unknown` deliberately:
 * the shipped races are TypeScript literals today and could be JSON from disk
 * or a mod folder tomorrow, and both must go through exactly the same door. A
 * schema that only ever saw already-typed data would prove nothing.
 */
export function parseRace(input: unknown): RawRace {
  const result = raceSchema.safeParse(input);
  if (!result.success) throw new Error(`content: invalid race -- ${describe(result.error)}`);
  return result.data;
}

export function parseResource(input: unknown): RawResource {
  const result = resourceSchema.safeParse(input);
  if (!result.success) throw new Error(`content: invalid resource -- ${describe(result.error)}`);
  return result.data;
}

/**
 * A readable one-line summary of a validation failure.
 *
 * zod's own formatting is thorough but verbose, and content errors are read by
 * whoever is editing the content -- often at a terminal, often not the person
 * who wrote the schema. Path plus message is what they need.
 */
function describe(error: z.ZodError): string {
  return error.issues
    .slice(0, 4)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}
