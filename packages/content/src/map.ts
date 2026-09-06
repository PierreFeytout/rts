import { MAX_PLAYERS, hashNumber, type TypeTable } from "@rts/sim";
import { parseMap, type RawMap } from "./map-schema.js";

/**
 * Turning validated map files into something a match can be built from.
 *
 * The same three jobs as `intern.ts` does for races -- resolve string ids to
 * numbers, and then check the things a field-level schema cannot. zod can prove
 * that `x` is a non-negative integer. It cannot prove that the ore patch at
 * that `x` is not underneath a cliff, or that a player who spawns there has
 * anything to mine. Those produce a map that loads cleanly and is unplayable,
 * which is the failure worth spending code on.
 */

/** A headquarters anchor tile, top-left, in slot order. */
export interface MapStart {
  readonly x: number;
  readonly y: number;
}

/** One piece of scenery, with its content id already interned. */
export interface MapResource {
  readonly typeId: number;
  readonly x: number;
  readonly y: number;
}

/** A blocked rectangle: x, y, width, height. */
export type MapBlock = readonly [number, number, number, number];

export interface MapInfo {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  /** Width and height in tiles; maps are always square. */
  readonly size: number;
  /** How many players this map seats. Always `starts.length`. */
  readonly maxPlayers: number;
  readonly starts: readonly MapStart[];
  readonly blocks: readonly MapBlock[];
  readonly resources: readonly MapResource[];
}

/**
 * Clearance around a start, as tile offsets from its anchor.
 *
 * Covers the headquarters footprint and the patch of ground the opening workers
 * are placed on. Terrain is not allowed in here: a map whose author dropped a
 * cliff on a spawn point walls that player in before the match begins, and the
 * symptom is five workers that will not move.
 */
const YARD_MIN = -1;
const YARD_MAX = 8;

/**
 * How far from its anchor a start may look for its own resources.
 *
 * Generous, because it is checking that a player has an economy at all rather
 * than dictating a layout. A base whose ore is 20 tiles away is a design
 * choice; a base with no ore is a bug.
 */
const START_RESOURCE_RADIUS = 20;

/**
 * Closest two starts may be.
 *
 * Two bases inside each other's opening is not a map, and the resulting match
 * is decided before anyone has built anything.
 */
const MIN_START_SEPARATION = 24;

/**
 * Build the map set.
 *
 * `hqFootprint` is the largest headquarters any race fields, so bounds and
 * clearance are checked against the worst case rather than against whichever
 * race happens to spawn there.
 */
export function buildMaps(
  rawMaps: readonly unknown[],
  table: TypeTable,
  idOf: (contentId: string, context: string) => number,
  hqFootprint: number,
): MapInfo[] {
  const maps = rawMaps.map(parseMap);
  const seen = new Set<string>();
  const built: MapInfo[] = [];

  for (const raw of maps) {
    if (seen.has(raw.id)) throw new Error(`content: duplicate map id '${raw.id}'`);
    seen.add(raw.id);
    built.push(checkMap(raw, table, idOf, hqFootprint));
  }

  if (built.length === 0) throw new Error("content: no maps defined");
  return built;
}

function checkMap(
  raw: RawMap,
  table: TypeTable,
  idOf: (contentId: string, context: string) => number,
  hqFootprint: number,
): MapInfo {
  const where = `map '${raw.id}'`;
  const size = raw.size;

  const inBounds = (x: number, y: number, w: number, h: number): boolean =>
    x >= 0 && y >= 0 && x + w <= size && y + h <= size;

  // -- starts --------------------------------------------------------------

  if (raw.starts.length > MAX_PLAYERS) {
    throw new Error(
      `content: ${where} has ${raw.starts.length} start positions, but a match seats ${MAX_PLAYERS}`,
    );
  }

  raw.starts.forEach((start, slot) => {
    if (!inBounds(start.x + YARD_MIN, start.y + YARD_MIN, YARD_MAX - YARD_MIN, YARD_MAX - YARD_MIN)) {
      throw new Error(
        `content: ${where} start ${slot} at ${start.x},${start.y} is too close to the edge ` +
          `(needs ${YARD_MAX - YARD_MIN} clear tiles around it on a ${size}-tile map)`,
      );
    }
    if (!inBounds(start.x, start.y, hqFootprint, hqFootprint)) {
      throw new Error(`content: ${where} start ${slot} has no room for a headquarters`);
    }
  });

  for (let a = 0; a < raw.starts.length; a++) {
    for (let b = a + 1; b < raw.starts.length; b++) {
      const dx = raw.starts[a].x - raw.starts[b].x;
      const dy = raw.starts[a].y - raw.starts[b].y;
      if (dx * dx + dy * dy < MIN_START_SEPARATION * MIN_START_SEPARATION) {
        throw new Error(
          `content: ${where} starts ${a} and ${b} are less than ${MIN_START_SEPARATION} tiles apart`,
        );
      }
    }
  }

  // -- terrain -------------------------------------------------------------

  raw.blocks.forEach(([x, y, w, h], i) => {
    if (!inBounds(x, y, w, h)) {
      throw new Error(`content: ${where} block ${i} (${x},${y} ${w}x${h}) falls outside the map`);
    }
    raw.starts.forEach((start, slot) => {
      if (overlaps(x, y, w, h, start.x + YARD_MIN, start.y + YARD_MIN, YARD_MAX - YARD_MIN, YARD_MAX - YARD_MIN)) {
        throw new Error(
          `content: ${where} block ${i} sits on start ${slot}, which would wall that player in`,
        );
      }
    });
  });

  // -- resources -----------------------------------------------------------

  const resources: MapResource[] = raw.resources.map((resource, i) => {
    const typeId = idOf(resource.type, `${where} resource ${i}`);
    const span = spanOf(table, typeId);
    if (!inBounds(resource.x, resource.y, span, span)) {
      throw new Error(
        `content: ${where} resource ${i} (${resource.type} at ${resource.x},${resource.y}) ` +
          `falls outside the map`,
      );
    }
    return { typeId, x: resource.x, y: resource.y };
  });

  for (let a = 0; a < resources.length; a++) {
    const sa = spanOf(table, resources[a].typeId);
    for (let b = a + 1; b < resources.length; b++) {
      const sb = spanOf(table, resources[b].typeId);
      if (overlaps(resources[a].x, resources[a].y, sa, sa, resources[b].x, resources[b].y, sb, sb)) {
        // The second `placeStructure` would silently fail and the map would be
        // one ore patch short of what its author drew.
        throw new Error(`content: ${where} resources ${a} and ${b} overlap`);
      }
    }
    for (const [bx, by, bw, bh] of raw.blocks) {
      if (overlaps(resources[a].x, resources[a].y, sa, sa, bx, by, bw, bh)) {
        throw new Error(`content: ${where} resource ${a} is buried under terrain`);
      }
    }
  }

  // Every player needs something to mine and somewhere to put an extractor.
  // Checked by proximity rather than by an explicit "belongs to slot 2" link,
  // so a map can share a patch between two starts if it wants to.
  raw.starts.forEach((start, slot) => {
    let harvestable = 0;
    let markers = 0;
    for (const resource of resources) {
      if (!nearStart(start, resource, START_RESOURCE_RADIUS)) continue;
      if (table.get(resource.typeId).resourceAmount > 0) harvestable++;
      else markers++;
    }
    if (harvestable === 0) {
      throw new Error(
        `content: ${where} start ${slot} has no harvestable resource within ` +
          `${START_RESOURCE_RADIUS} tiles`,
      );
    }
    if (markers === 0) {
      throw new Error(
        `content: ${where} start ${slot} has no vent within ${START_RESOURCE_RADIUS} tiles`,
      );
    }
  });

  return {
    id: raw.id,
    name: raw.name,
    blurb: raw.blurb,
    size,
    maxPlayers: raw.starts.length,
    starts: raw.starts.map((s) => ({ x: s.x, y: s.y })),
    blocks: raw.blocks.map(([x, y, w, h]) => [x, y, w, h] as MapBlock),
    resources,
  };
}

/** Footprint in tiles, with the same "0 means 1" rule as `placeStructure`. */
function spanOf(table: TypeTable, typeId: number): number {
  const footprint = table.get(typeId).footprint;
  return footprint > 0 ? footprint : 1;
}

function overlaps(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
}

/** Distance from a start's anchor to a resource's anchor, in tiles. */
function nearStart(start: MapStart, resource: MapResource, radius: number): boolean {
  const dx = start.x - resource.x;
  const dy = start.y - resource.y;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Fold the map set into the content fingerprint.
 *
 * Maps decide where every entity in the match begins, so two peers with
 * different map files build different worlds. The host ships its world as a
 * snapshot and would survive that, but the lobby shows a map *name* chosen by
 * id -- and picking "Rift Basin" and getting someone else's idea of it is worth
 * refusing at the door, exactly as a changed unit stat is.
 */
export function hashMaps(hash: number, maps: readonly MapInfo[]): number {
  let h = hash;
  for (const map of maps) {
    for (const ch of map.id) h = hashNumber(h, ch.charCodeAt(0));
    h = hashNumber(h, map.size);
    for (const start of map.starts) {
      h = hashNumber(h, start.x);
      h = hashNumber(h, start.y);
    }
    for (const [x, y, w, hh] of map.blocks) {
      h = hashNumber(h, x);
      h = hashNumber(h, y);
      h = hashNumber(h, w);
      h = hashNumber(h, hh);
    }
    for (const resource of map.resources) {
      h = hashNumber(h, resource.typeId);
      h = hashNumber(h, resource.x);
      h = hashNumber(h, resource.y);
    }
  }
  return h;
}
