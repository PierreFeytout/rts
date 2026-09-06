import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Generate the shipped map files.
 *
 * The maps are committed data, not generated at runtime -- a match's layout has
 * to be identical for everyone, and the host shipping a snapshot is what
 * guarantees that. But hand-typing two hundred rectangles is not authoring, it
 * is data entry, so the *files* are produced here and the generator is
 * committed alongside them. Re-running it reproduces them byte for byte.
 *
 * This is the direct descendant of the inline layout loop that used to live in
 * packages/client/src/match.ts, which built a world from `world.rng` at match
 * start. A real map editor replaces this later; until then, editing a map means
 * editing this file and re-running it, or editing the JSON by hand.
 *
 *   node scripts/generate-map.mjs
 */

const OUT = fileURLToPath(new URL("../packages/content/src/maps/", import.meta.url));

/** The same xorshift32 the simulation uses, so layouts are reproducible here. */
function rng(seed) {
  let state = seed | 0;
  if (state === 0) state = 1;
  return {
    next() {
      state ^= state << 13;
      state |= 0;
      state ^= state >>> 17;
      state ^= state << 5;
      state |= 0;
      return state >>> 0;
    },
    range(min, max) {
      // Inclusive of min, exclusive of max.
      return min + (this.next() % (max - min));
    },
  };
}

/**
 * Ground each player must have to themselves.
 *
 * Matches YARD_MIN/YARD_MAX in packages/content/src/map.ts. Kept in step by
 * hand rather than imported, because this script runs before the workspace is
 * built and the loader's check is what actually enforces it -- this is only the
 * generator being polite so it does not emit a map its own loader rejects.
 */
const YARD_MIN = -1;
const YARD_MAX = 8;

/** Per-start scenery, as tile offsets from the anchor. */
const ORE_OFFSETS = [
  [7, 0],
  [0, 7],
  [7, 7],
];
const VENT_OFFSET = [-4, 3];

/** Footprint of both scenery types, from packages/content/src/races/map-resources.ts. */
const RESOURCE_SPAN = 2;

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function generate({ id, name, blurb, size, seed, inset, blockCount, blockMin, blockMax, contested }) {
  const random = rng(seed);
  const far = size - inset - 8;

  // Corners, in the same slot order the old client used: the two diagonal
  // players are slots 0 and 1, so a two-player match is played across the long
  // diagonal rather than along one edge.
  const starts = [
    { x: inset, y: inset },
    { x: far, y: far },
    { x: far, y: inset },
    { x: inset, y: far },
  ];

  const yards = starts.map((s) => ({
    x: s.x + YARD_MIN,
    y: s.y + YARD_MIN,
    w: YARD_MAX - YARD_MIN,
    h: YARD_MAX - YARD_MIN,
  }));

  // -- resources, placed first so terrain can avoid them -------------------
  const resources = [];
  const taken = [];

  const addResource = (type, x, y) => {
    const box = { x, y, w: RESOURCE_SPAN, h: RESOURCE_SPAN };
    if (taken.some((t) => overlaps(box, t))) return false;
    resources.push({ type, x, y });
    taken.push(box);
    return true;
  };

  for (const start of starts) {
    for (const [dx, dy] of ORE_OFFSETS) {
      addResource("map.alloy-node", start.x + dx, start.y + dy);
    }
    addResource("map.vent", start.x + VENT_OFFSET[0], start.y + VENT_OFFSET[1]);
  }

  // Contested expansions, worth fighting over precisely because they are not
  // inside anybody's base. Confined to the middle so they cannot land in a
  // starting yard.
  const margin = inset + 16;
  for (let i = 0; i < contested; i++) {
    const x = random.range(margin, size - margin - RESOURCE_SPAN);
    const y = random.range(margin, size - margin - RESOURCE_SPAN);
    const box = { x, y, w: RESOURCE_SPAN, h: RESOURCE_SPAN };
    if (yards.some((yard) => overlaps(box, yard))) continue;
    addResource("map.alloy-node", x, y);
  }

  // -- terrain --------------------------------------------------------------
  const blocks = [];
  for (let i = 0; i < blockCount; i++) {
    const w = random.range(blockMin, blockMax);
    const h = random.range(blockMin, blockMax);
    const x = random.range(margin, size - margin - w);
    const y = random.range(margin, size - margin - h);
    const box = { x, y, w, h };
    if (yards.some((yard) => overlaps(box, yard))) continue;
    if (taken.some((t) => overlaps(box, t))) continue;
    blocks.push([x, y, w, h]);
    // Not added to `taken`: obstacles may touch each other, and forbidding it
    // would produce a map of evenly spaced identical rocks.
  }

  return { format: 1, id, name, blurb, size, starts, blocks, resources };
}

const MAPS = [
  generate({
    id: "rift-basin",
    name: "Rift Basin",
    blurb: "Four corners around a broken middle. The standard four-player map.",
    size: 256,
    seed: 0x5eed1,
    inset: 24,
    blockCount: 60,
    blockMin: 2,
    blockMax: 8,
    contested: 14,
  }),
  generate({
    id: "sprawl",
    name: "Sprawl",
    blurb: "A very long walk between bases. Scouting matters; so does not overextending.",
    size: 1024,
    seed: 0x5eed2,
    inset: 64,
    blockCount: 320,
    blockMin: 3,
    blockMax: 14,
    contested: 48,
  }),
];

/**
 * One record per line.
 *
 * `JSON.stringify(map, null, 2)` puts every coordinate on its own line, which
 * turns a 300-rectangle map into 1500 lines and makes any diff useless. These
 * are tables of numbers, and they should read like tables of numbers.
 */
function serialise(map) {
  const rows = (items) =>
    items.length === 0
      ? "[]"
      : ["[", items.map((item) => `    ${item}`).join(",\n"), "  ]"].join("\n");

  return [
    "{",
    `  "format": ${map.format},`,
    `  "id": ${JSON.stringify(map.id)},`,
    `  "name": ${JSON.stringify(map.name)},`,
    `  "blurb": ${JSON.stringify(map.blurb)},`,
    `  "size": ${map.size},`,
    `  "starts": ${rows(map.starts.map((s) => JSON.stringify(s)))},`,
    `  "blocks": ${rows(map.blocks.map((b) => JSON.stringify(b)))},`,
    `  "resources": ${rows(map.resources.map((r) => JSON.stringify(r)))}`,
    "}",
    "",
  ].join("\n");
}

for (const map of MAPS) {
  writeFileSync(`${OUT}${map.id}.json`, serialise(map), "utf8");
  console.log(
    `[rts] ${map.id}: ${map.size}x${map.size}, ${map.starts.length} starts, ` +
      `${map.blocks.length} blocks, ${map.resources.length} resources`,
  );
}
