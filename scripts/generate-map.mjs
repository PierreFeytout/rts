import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { encodePaint } from "./lib/paint.mjs";
import { clamp01, fbm, smoothstep } from "./lib/noise.mjs";

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

/**
 * Roughly how many tiles across one region of the second surface is.
 *
 * About a screen and a half at playing zoom: large enough that crossing one
 * is a decision and not a step, small enough that a 256-tile map has several
 * rather than one.
 */
const REGION_TILES = 80;

/**
 * How much of a map that second surface covers.
 *
 * A quarter. Below about a sixth it reads as a stain rather than as country;
 * much above a third and the map's own ground stops being the thing the
 * regions are an exception to.
 */
const REGION_COVERAGE = 0.25;

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Paint the ground: which of the map's surfaces each tile is drawn in.
 *
 * The rules are the map's own history, in the order it happened, each one
 * painting over the last:
 *
 *   1. The world's ground everywhere. Most of a map is this.
 *   2. Regions where the ground is something else -- crust on Furnace Nine
 *      where the fires are close to the surface, frozen lakes on Cistern
 *      Four. Organic and broad, so a player reads them as country rather
 *      than as decoration, and placed by noise alone: nothing about them is
 *      worth making a fair map unfair for.
 *   3. Debris at the foot of the spoil heaps, because that is what a heap
 *      sheds, and it is how a heap stops looking pasted onto the floor.
 *   4. Hot ground immediately around every vent: a vent is a hole the fires
 *      come up through, and the ground around one has been cooking for nine
 *      hundred years.
 *   5. A laid pad under each start, because somebody is about to build a
 *      headquarters there and the Directorate pours rockcrete first.
 *
 * Purely presentation -- the simulation never reads it. But it is generated
 * from the same seed as the layout, so the same map always comes out the
 * same way, and it is stored in the file rather than recomputed at load so
 * that a later map editor can paint over any of it by hand.
 *
 * `roles` names which of the map's `layers` plays each part; a map that
 * leaves one out simply skips that rule.
 */
function paint({ size, layers, roles, starts, blocks, resources, seed }) {
  const out = new Uint8Array(size * size);
  const index = (role) => {
    const name = roles[role];
    if (name === undefined) return -1;
    const at = layers.indexOf(name);
    if (at < 0) throw new Error(`[rts] paint role '${role}' names '${name}', which is not in layers`);
    return at;
  };

  const region = index("region");
  const debris = index("debris");
  const hot = index("hot");
  const pad = index("pad");

  const put = (x, y, layer) => {
    if (layer < 0 || x < 0 || y < 0 || x >= size || y >= size) return;
    out[y * size + x] = layer;
  };

  // -- 2. regions ----------------------------------------------------------
  // Noise thresholded into large connected areas with ragged edges.
  //
  // Two things are fixed rather than left to the noise. The feature size is
  // in **tiles**, not in fractions of the map, so a region is the same size
  // to walk across on a 256-tile map as on a 1024-tile one -- scaled with
  // the map, the Sprawl's regions would be four times the size of anything
  // else on it. And the threshold is chosen to hit a **coverage**, not set
  // as a constant: a fixed cutoff is at the mercy of where the noise happens
  // to sit for a given seed, which is how one map came out with no crust on
  // it at all and another with half its ground replaced.
  if (region >= 0) {
    const field = new Float32Array(size * size);
    const cells = Math.max(2, Math.round(size / REGION_TILES));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        field[y * size + x] = fbm(x / size, y / size, cells, 4, seed & 0xffff);
      }
    }
    // The value with REGION_COVERAGE of the map above it. Sorting a copy is
    // a second of work on the largest map and needs no tuning per seed.
    const sorted = Float32Array.from(field).sort();
    const cut = sorted[Math.floor(sorted.length * (1 - REGION_COVERAGE))];
    for (let i = 0; i < field.length; i++) if (field[i] > cut) out[i] = region;
  }

  // -- 3. debris -------------------------------------------------------------
  // Around every blocked rectangle, out to a few tiles, with a noisy edge so
  // the apron is not a rounded rectangle.
  if (debris >= 0) {
    const REACH = 3;
    for (const [bx, by, bw, bh] of blocks) {
      for (let y = by - REACH; y < by + bh + REACH; y++) {
        for (let x = bx - REACH; x < bx + bw + REACH; x++) {
          // Distance outside the rectangle, per axis; zero inside it.
          const dx = Math.max(bx - x, 0, x - (bx + bw - 1));
          const dy = Math.max(by - y, 0, y - (by + bh - 1));
          const d = Math.hypot(dx, dy);
          const ragged = REACH * (0.45 + fbm(x / 24, y / 24, 4, 2, seed + 7) * 1.1);
          if (d <= ragged) put(x, y, debris);
        }
      }
    }
  }

  // -- 4. hot ground ---------------------------------------------------------
  if (hot >= 0) {
    const REACH = 6;
    for (const resource of resources) {
      if (resource.type !== "map.vent") continue;
      for (let y = resource.y - REACH; y <= resource.y + REACH + 1; y++) {
        for (let x = resource.x - REACH; x <= resource.x + REACH + 1; x++) {
          const dx = x - (resource.x + 0.5);
          const dy = y - (resource.y + 0.5);
          const d = Math.hypot(dx, dy);
          // Lobed rather than circular: what comes up through a fissure does
          // not spread evenly, and a ring of anything reads as a marker.
          const angle = Math.atan2(dy, dx);
          const lobe = REACH * (0.55 + fbm(Math.cos(angle) * 0.5 + 0.5, Math.sin(angle) * 0.5 + 0.5, 3, 2, seed + resource.x * 31 + resource.y) * 0.8);
          if (d <= lobe) put(x, y, hot);
        }
      }
    }
  }

  // -- 5. the pads -----------------------------------------------------------
  // Square, and deliberately so: this is the one laid surface on the map and
  // the only place a straight edge belongs. Big enough for the headquarters
  // and the yard around it, which is exactly the ground the map already
  // guarantees is clear.
  if (pad >= 0) {
    for (const start of starts) {
      const x0 = start.x + YARD_MIN;
      const y0 = start.y + YARD_MIN;
      const span = YARD_MAX - YARD_MIN;
      for (let y = y0; y < y0 + span; y++) {
        for (let x = x0; x < x0 + span; x++) {
          // The corners are worn off, so a pad is a poured slab that has been
          // there a while rather than a decal.
          const cx = (x - x0) / span - 0.5;
          const cy = (y - y0) / span - 0.5;
          const corner = smoothstep(0.34, 0.5, Math.max(Math.abs(cx), Math.abs(cy)));
          const wear = clamp01(fbm(x / 9, y / 9, 4, 2, seed + 13));
          if (corner > 0 && wear < corner) continue;
          put(x, y, pad);
        }
      }
    }
  }

  return encodePaint(out);
}

function generate({
  id,
  name,
  blurb,
  biome,
  layers,
  roles,
  size,
  seed,
  inset,
  blockCount,
  blockMin,
  blockMax,
  contested,
}) {
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

  return {
    format: 2,
    id,
    name,
    blurb,
    biome,
    layers,
    paint: paint({ size, layers, roles, starts, blocks, resources, seed }),
    size,
    starts,
    blocks,
    resources,
  };
}

/**
 * Furnace Nine's ground, and what plays each part of it.
 *
 * The order is the order `paint` reads them in, and the first is the ground
 * everywhere else. See scripts/generate-terrain.mjs for what each surface
 * is; a map may use fewer, and any it leaves out simply never appears.
 */
const ASHWORKS = {
  layers: ["ash", "cinder", "ember", "rockcrete", "rubble"],
  roles: { region: "cinder", hot: "ember", pad: "rockcrete", debris: "rubble" },
};

/** Cistern Four's, in the same roles. See UNIVERSE.md, "Other fronts". */
const DEEPFREEZE = {
  layers: ["rime", "ice", "meltrock", "rockcrete", "scree"],
  roles: { region: "ice", hot: "meltrock", pad: "rockcrete", debris: "scree" },
};

const MAPS = [
  generate({
    id: "rift-basin",
    name: "Cinder Reach",
    blurb: "Four holdings around a burnt-out middle. The standard four-player map.",
    biome: "ashworks",
    ...ASHWORKS,
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
    name: "The Long Sprawl",
    blurb: "Hours of spoil between one holding and the next. Scout, and do not overextend.",
    biome: "ashworks",
    ...ASHWORKS,
    size: 1024,
    seed: 0x5eed2,
    inset: 64,
    blockCount: 320,
    blockMin: 3,
    blockMax: 14,
    contested: 48,
  }),
  generate({
    id: "deepfreeze",
    name: "The Deepfreeze",
    blurb: "Cistern Four: a cracked cryo-reserve. The same fight, argued in ice instead of ash.",
    biome: "deepfreeze",
    ...DEEPFREEZE,
    size: 256,
    seed: 0x5eed3,
    inset: 24,
    blockCount: 60,
    blockMin: 2,
    blockMax: 8,
    contested: 14,
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
    `  "biome": ${JSON.stringify(map.biome)},`,
    `  "layers": ${JSON.stringify(map.layers)},`,
    // One long line. It is a million tiles on the largest map and there is
    // no shape in it worth wrapping to; see packages/content/src/paint.ts.
    `  "paint": ${JSON.stringify(map.paint)},`,
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
      `${map.blocks.length} blocks, ${map.resources.length} resources, ` +
      `paint ${(map.paint.length / 1024).toFixed(0)} kB`,
  );
}
