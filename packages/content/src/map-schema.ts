import { z } from "zod";

/**
 * The map schema.
 *
 * A map is content, exactly like a race: validated data with no engine
 * knowledge in it. That is what lets the lobby offer a list of maps, and what
 * lets the content-hash handshake refuse a peer whose map set differs before it
 * can produce a desync nobody can read.
 *
 * WHY RECTANGLES AND NOT A TILE ARRAY
 * -----------------------------------
 * Terrain is a list of blocked rectangles rather than one entry per tile. A
 * 1024-tile map is a million tiles; as JSON that is tens of megabytes of mostly
 * zeroes, and it would be unreadable and unmergeable in a diff. Rectangles are
 * compact, human-editable, and map one-to-one onto `CostGrid.fillRect`, which
 * is the call the loader already makes.
 *
 * The format is versioned so the map editor -- which comes later -- can add a
 * freeform tile layer without invalidating maps written today.
 */

/** Bumped when a change would make an older file load incorrectly. */
export const MAP_FORMAT = 1;

/**
 * The largest map the simulation can represent.
 *
 * Not an arbitrary round number: Q16.16 world coordinates must stay under
 * `FX_MAX_OPERAND` (2^26), which is 1024.0 world units, and one tile is one
 * world unit. See "THE MAGNITUDE BOUND" in packages/sim/src/fixed.ts. A map
 * larger than this produces coordinates whose products are no longer exact in
 * float64, which is a desync rather than a glitch.
 */
export const MAX_MAP_TILES = 1024;

/**
 * The smallest map worth shipping.
 *
 * Four bases need room to not be in each other's opening. Below this the map is
 * a corridor, and the value exists mostly so a typo like `size: 12` is a
 * message rather than a match where everyone spawns on top of each other.
 */
export const MIN_MAP_TILES = 64;

const tileCoord = z.number().int().min(0).max(MAX_MAP_TILES);

/**
 * Content ids are namespaced, same rule as races. Map scenery lives under
 * `map.` by convention but the schema does not insist, so a race could ship its
 * own scenery without a special case here.
 */
const contentId = z
  .string()
  .regex(
    /^[a-z][a-z0-9]*\.[a-z][a-z0-9-]*$/,
    "content id must look like 'race.thing' (lowercase, dot-separated)",
  );

/**
 * A start position is the anchor tile of the headquarters, top-left.
 *
 * The same convention as `World.placeStructure`, deliberately: a start position
 * that meant "centre" would need a footprint to resolve, and the footprint
 * differs per race.
 */
const startPosition = z
  .object({
    x: tileCoord,
    y: tileCoord,
  })
  .strict();

/** `[x, y, width, height]`, in tiles. Terse because there are hundreds. */
const block = z.tuple([
  tileCoord,
  tileCoord,
  z.number().int().min(1).max(MAX_MAP_TILES),
  z.number().int().min(1).max(MAX_MAP_TILES),
]);

const mapResource = z
  .object({
    /** Which scenery type, by content id: `map.alloy-node`, `map.vent`. */
    type: contentId,
    x: tileCoord,
    y: tileCoord,
  })
  .strict();

export const mapSchema = z
  .object({
    format: z.literal(MAP_FORMAT),
    id: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/, "map id must be lowercase, dash-separated"),
    name: z.string().min(1),
    blurb: z.string().min(1),
    size: z.number().int().min(MIN_MAP_TILES).max(MAX_MAP_TILES),
    /**
     * Start positions in slot order. Their count *is* the map's player limit:
     * a separate `maxPlayers` field would be a second source of truth that can
     * disagree with the thing it describes.
     */
    starts: z.array(startPosition).min(2),
    blocks: z.array(block),
    resources: z.array(mapResource),
  })
  .strict();

export type RawMap = z.infer<typeof mapSchema>;

/**
 * Validate one map definition.
 *
 * Names the offending map in the message. A map set is loaded as an array, and
 * "invalid map" with no id sends whoever is editing them to check all of them.
 */
export function parseMap(raw: unknown): RawMap {
  const result = mapSchema.safeParse(raw);
  if (result.success) return result.data;

  const named =
    raw !== null && typeof raw === "object" && "id" in raw
      ? String((raw as { id: unknown }).id)
      : "(unnamed)";
  const issues = result.error.issues
    .slice(0, 4)
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`)
    .join("; ");
  throw new Error(`content: map '${named}' is invalid -- ${issues}`);
}
