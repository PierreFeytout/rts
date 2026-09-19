import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { encodePng } from "./lib/png.mjs";
import {
  cellRandom,
  clamp01,
  derive,
  fbm,
  lerp,
  noise2,
  ridged,
  scatter,
  scatterSum,
  smoothstep,
  warp,
  worley,
} from "./lib/noise.mjs";

/**
 * Generate the terrain surfaces, for every biome a map can ask for.
 *
 * A biome is a world (UNIVERSE.md: "The world" for Furnace Nine, "Other
 * fronts" for the rest), and a world has several *surfaces*: the ground
 * that covers most of it, and what that ground turns into where something
 * happened to it -- cooled crust where the fires came up, poured slabs where
 * the Directorate built, rubble where something was knocked down. A map
 * paints up to five of its world's surfaces across its tiles (see
 * `paint` in packages/content/src/map-schema.ts and the painter in
 * scripts/generate-map.mjs); the ground material blends them by height, so
 * ash fills in between plates of crust rather than fading across them.
 *
 * Every surface writes three files, read by packages/client/src/materials.ts:
 *
 *   <biome>_<surface>_albedo.png   colour, sRGB
 *   <biome>_<surface>_normal.png   tangent-space normals; alpha is HEIGHT,
 *                                  which is what the blend between two
 *                                  painted surfaces follows
 *   <biome>_<surface>_orm.png      occlusion, roughness, metalness; alpha is
 *                                  GLOW, what the albedo emits by itself
 *
 * plus one manifest, terrain.json, listing every surface with the numbers the
 * client cannot read off a PNG: how many tiles one repeat covers, how bright
 * its glow is, and its average colour for the minimap.
 *
 * Generated rather than painted, and the generator committed alongside its
 * output, so a surface can be re-tuned by changing a number instead of by
 * repainting. The output is ordinary PNG, so an artist can replace any one
 * file without touching a line of code.
 *
 * WHY A HEIGHT FIELD FIRST
 * -----------------------
 * Every surface is built as a height field, and the colour, the normals, the
 * occlusion and the blend height are all derived from it. That is what makes
 * the maps agree: hand-authoring an albedo and a normal map separately
 * produces a surface where the lighting and the staining are describing
 * different rock. Derive them and the ash is *in* the crack it is drawn in.
 *
 * WHY THE COLOUR CARRIES ITS OWN SHADING
 * -------------------------------------
 * The camera sits far enough away that a normal map alone cannot sell relief:
 * at twenty screen pixels per tile a crack is a two-pixel line, and the light
 * across two pixels is not readable as a groove. So every surface bakes a
 * cavity term into its colour -- crevices darker, convex edges lighter --
 * which is exactly what a painter does and exactly why painted terrain reads
 * as more detailed than lit terrain at the same resolution. The normals still
 * matter: they are what makes the same texture look different under Furnace
 * Nine's low warm key and Cistern Four's pale overhead one.
 *
 *   node scripts/generate-terrain.mjs                 everything
 *   node scripts/generate-terrain.mjs deepfreeze      one biome
 *   node scripts/generate-terrain.mjs ashworks:ember  one surface
 */

const OUT = fileURLToPath(new URL("../packages/client/assets/terrain/", import.meta.url));
const MANIFEST = `${OUT}terrain.json`;

/**
 * Texture resolution.
 *
 * The camera shows roughly 20 screen pixels per world tile, and a surface
 * repeats every 8 to 12 tiles, so 512 is 40 to 64 texture pixels per tile --
 * two to three times the density the screen can show. Occlusion, roughness,
 * metalness and glow vary slowly enough to live at half that.
 */
const SIZE = 512;
const ORM_SIZE = 256;

// ---------------------------------------------------------------------------
// Palettes -- UNIVERSE.md, "Palette" and "Other fronts"
//
// The same roles on every world, so a generator can be pointed at either:
// `ash` is whatever settles into a crevice, `rockcrete` is the ground under
// it, `dust` is what a raised surface catches, `slab` is poured rockcrete as
// the Directorate lays it, `deep` is the darkest thing a surface can show
// through to. `rust`, `ember`, `flame`, `bone` and `warning` are what they
// are on Furnace Nine, everywhere: unlit metal is unlit metal, and a breached
// reactor is not supposed to look like it belongs.
// ---------------------------------------------------------------------------

const FURNACE_NINE = {
  void: "#0a0806",
  ash: "#14100d",
  iron: "#221b15",
  rockcrete: "#3a2a1c",
  dust: "#5a483a",
  rust: "#7a4a22",
  ember: "#c46a28",
  flame: "#e8a04a",
  bone: "#b8a894",
  warning: "#c4443a",
  slab: "#2e2924",
  deep: "#06050a",
};

const CISTERN_FOUR = {
  void: "#0a0806",
  ash: "#7a8a94", // rime
  iron: "#221b15",
  rockcrete: "#2a343c", // meltrock
  dust: "#a8b8bc", // frost-bloom
  rust: "#7a4a22",
  ember: "#c46a28",
  flame: "#e8a04a",
  bone: "#b8a894",
  warning: "#c4443a",
  slab: "#2c3238",
  deep: "#1c2e3c", // coolant, frozen a long way down
};

/**
 * The biomes, and the surfaces each one has.
 *
 * Order matters in one place: the first surface is the one a map with no
 * paint of its own is drawn in, and the one the painter starts from.
 *
 * Each biome's seed offsets every surface again, so no two worlds' cracks or
 * plates land in the same places under their different colours; ashworks
 * keeps seed 0 so Furnace Nine's ground is the ground it always was.
 */
const BIOMES = {
  ashworks: {
    // Furnace Nine. See UNIVERSE.md, "The world" and "Surfaces".
    seed: 0,
    palette: FURNACE_NINE,
    surfaces: {
      ash: (seed, P) => ashfield(seed, P, { frost: false }),
      cinder: (seed, P) => crust(seed, P, { molten: false }),
      ember: (seed, P) => crust(seed, P, { molten: true }),
      rockcrete: (seed, P) => slabs(seed, P, { frost: false }),
      rubble: (seed, P) => rubble(seed, P, { frost: false }),
    },
    cliff: (seed, P) => slag(seed, P),
  },
  deepfreeze: {
    // Cistern Four. See UNIVERSE.md, "Other fronts".
    seed: 90210,
    palette: CISTERN_FOUR,
    surfaces: {
      rime: (seed, P) => ashfield(seed, P, { frost: true }),
      ice: (seed, P) => ice(seed, P),
      meltrock: (seed, P) => meltrock(seed, P),
      rockcrete: (seed, P) => slabs(seed, P, { frost: true }),
      scree: (seed, P) => rubble(seed, P, { frost: true }),
    },
    cliff: (seed, P) => slag(seed, P),
  },
};

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/**
 * A palette entry as **linear** RGB.
 *
 * The hex values above are sRGB, because that is what a colour picker shows.
 * Mixing has to happen in linear light or every blend is wrong, and writing
 * the result back out without undoing the transfer brightens the whole
 * palette by roughly a stop -- which is how the first pass at these turned a
 * soot-stained floor into tan leather.
 */
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((byte) => {
    const c = byte / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
}

function mix(a, b, t) {
  const k = clamp01(t);
  return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
}

function scale(c, k) {
  return [c[0] * k, c[1] * k, c[2] * k];
}

/** Convert a linear value to an sRGB byte, which is what albedo PNGs hold. */
function toSrgbByte(v) {
  const c = clamp01(v);
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

function toHex(linear) {
  return "#" + linear.map((v) => toSrgbByte(v).toString(16).padStart(2, "0")).join("");
}

/**
 * The painter's half of the look: crevices darker, convex edges lighter.
 *
 * `fine` is a tight cavity term and `cav` a broader one; see `bake`. The
 * range is deliberately wide -- a crack that is only 20% darker than the
 * plate beside it vanishes at playing zoom, and the reference for these
 * surfaces is painted terrain, where a crack is black.
 */
function relief(c, f, dark, light) {
  return scale(c, lerp(dark, light, f.fine) * lerp(0.86, 1.06, f.cav));
}

/** A dome: a pebble, a rivet, a bubble. Radius in cell units. */
function dome(radius) {
  return (dx, dy) => {
    const d = Math.hypot(dx, dy) / radius;
    return d < 1 ? Math.sqrt(1 - d * d) : 0;
  };
}

// ---------------------------------------------------------------------------
// Height-field machinery
// ---------------------------------------------------------------------------

/** Sample a field with wraparound, so every derived map tiles too. */
function at(field, size, x, y) {
  const wx = ((x % size) + size) % size;
  const wy = ((y % size) + size) % size;
  return field[wy * size + wx];
}

function buildHeight(size, fn) {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      out[y * size + x] = fn(x / size, y / size);
    }
  }
  // Normalised to [0, 1], so the blend between two surfaces compares like
  // with like, and so a normal-map strength means the same on every surface.
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of out) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || 1;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / span;
  return out;
}

/**
 * Occlusion, as the difference between a point and its neighbourhood.
 *
 * A real ambient-occlusion bake would trace rays against the height field.
 * This compares each texel to a blurred copy, which is the same answer for
 * surfaces whose features are small relative to the blur radius -- and every
 * one of these is. Anything sitting below its surroundings is in shadow,
 * which is exactly where ash ends up; anything above them is an edge that
 * catches light.
 */
function occlusion(height, size, radius, gain) {
  const blurred = boxBlur(height, size, radius);
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) {
    out[i] = clamp01(0.5 + (height[i] - blurred[i]) * gain);
  }
  return out;
}

/** Separable box blur with wraparound. */
function boxBlur(field, size, radius) {
  const pass = new Float32Array(size * size);
  const out = new Float32Array(size * size);
  const width = radius * 2 + 1;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let d = -radius; d <= radius; d++) sum += at(field, size, x + d, y);
      pass[y * size + x] = sum / width;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let d = -radius; d <= radius; d++) sum += at(pass, size, x, y + d);
      out[y * size + x] = sum / width;
    }
  }
  return out;
}

/**
 * Tangent-space normals from the height field, by central difference, with
 * the height itself in the alpha channel.
 *
 * Green points **up** in texture space (OpenGL convention), which is what
 * three.js expects. Getting this inverted is the classic normal-map bug: the
 * surface lights as though every bump were a dent, and it reads as "the light
 * is in the wrong place" rather than as a texture problem.
 */
function normalMap(height, size, strength) {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = at(height, size, x + 1, y) - at(height, size, x - 1, y);
      const dy = at(height, size, x, y + 1) - at(height, size, x, y - 1);

      let nx = -dx * strength;
      let ny = -dy * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;

      const i = (y * size + x) * 4;
      out[i] = Math.round((nx * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((nz / len) * 0.5 * 255 + 127.5);
      out[i + 3] = Math.round(clamp01(height[y * size + x]) * 255);
    }
  }
  return out;
}

function save(name, pixels, size, channels) {
  const file = `${OUT}${name}.png`;
  const png = encodePng(pixels, size, size, channels);
  writeFileSync(file, png);
  console.log(`[rts]   ${name}.png  ${size}x${size}  ${(png.length / 1024).toFixed(0)} kB`);
}

/**
 * Build one surface's three files from its description.
 *
 * A description is a height function and a colour function, a material
 * function for the ORM, an optional glow mask, and the numbers the manifest
 * carries. The colour and material functions get the derived fields at their
 * texel: `h` the normalised height, `fine` and `cav` two cavity terms at
 * different radii, and `rel` the height relative to a broad blur -- which is
 * the "raised or sunken" question a drift or a pool needs to answer.
 */
function bake(name, spec) {
  const started = Date.now();
  const height = buildHeight(SIZE, spec.height);
  const fine = occlusion(height, SIZE, 3, 5);
  const cav = occlusion(height, SIZE, 10, 3.5);
  const broad = boxBlur(height, SIZE, 28);

  // The fields a surface is made of, as images, when something in the output
  // looks wrong and the question is which layer put it there. Stipple in an
  // albedo is nearly always a height field with too much energy at texel
  // scale, and that is invisible in the albedo and obvious here.
  //
  //   RTS_TERRAIN_DEBUG=1 node scripts/generate-terrain.mjs deepfreeze:ice
  if (process.env.RTS_TERRAIN_DEBUG) {
    for (const [field, data] of [
      ["height", height],
      ["fine", fine],
      ["cav", cav],
    ]) {
      const grey = new Uint8Array(SIZE * SIZE * 3);
      for (let i = 0; i < data.length; i++) {
        const v = Math.round(clamp01(data[i]) * 255);
        grey[i * 3] = v;
        grey[i * 3 + 1] = v;
        grey[i * 3 + 2] = v;
      }
      save(`debug_${name}_${field}`, grey, SIZE, 3);
    }
  }

  const f = { h: 0, fine: 0, cav: 0, rel: 0 };
  const fieldsAt = (i) => {
    f.h = height[i];
    f.fine = fine[i];
    f.cav = cav[i];
    f.rel = height[i] - broad[i];
    return f;
  };

  const sum = [0, 0, 0];
  const albedo = new Uint8Array(SIZE * SIZE * 3);
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const i = py * SIZE + px;
      const c = spec.shade(px / SIZE, py / SIZE, fieldsAt(i));
      sum[0] += clamp01(c[0]);
      sum[1] += clamp01(c[1]);
      sum[2] += clamp01(c[2]);
      albedo[i * 3] = toSrgbByte(c[0]);
      albedo[i * 3 + 1] = toSrgbByte(c[1]);
      albedo[i * 3 + 2] = toSrgbByte(c[2]);
    }
  }
  save(`${name}_albedo`, albedo, SIZE, 3);
  save(`${name}_normal`, normalMap(height, SIZE, spec.normal), SIZE, 4);

  // Occlusion, roughness, metalness, glow: the glTF channel order, which is
  // what three.js reads `aoMap`, `roughnessMap` and `metalnessMap` from, so
  // the cliff material can use the file untouched. Linear data, no transfer.
  const orm = new Uint8Array(ORM_SIZE * ORM_SIZE * 4);
  const step = SIZE / ORM_SIZE;
  for (let py = 0; py < ORM_SIZE; py++) {
    for (let px = 0; px < ORM_SIZE; px++) {
      const i = Math.floor(py * step) * SIZE + Math.floor(px * step);
      const fields = fieldsAt(i);
      const x = px / ORM_SIZE;
      const y = py / ORM_SIZE;
      const [ao, roughness, metalness] = spec.material(x, y, fields);
      const glow = spec.glow ? spec.glow(x, y, fields) : 0;
      const o = (py * ORM_SIZE + px) * 4;
      orm[o] = Math.round(clamp01(ao) * 255);
      orm[o + 1] = Math.round(clamp01(roughness) * 255);
      orm[o + 2] = Math.round(clamp01(metalness) * 255);
      orm[o + 3] = Math.round(clamp01(glow) * 255);
    }
  }
  save(`${name}_orm`, orm, ORM_SIZE, 4);

  const n = SIZE * SIZE;
  const colour = toHex([sum[0] / n, sum[1] / n, sum[2] / n]);
  console.log(`[rts]   ${name}: ${colour}, ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return { repeat: spec.repeat, glow: spec.glowStrength ?? 0, colour };
}

// ---------------------------------------------------------------------------
// Shared features
//
// Everything that keeps a surface from reading as a pattern. Worley cells
// are the natural way to draw plates, and their natural failure is that
// every plate comes out the same size with the same six neighbours -- a
// honeycomb, which no cooled crust, ice sheet or shattered floor has ever
// been. These three fixes are what every plate surface below is built on.
// ---------------------------------------------------------------------------

function frac(v) {
  return v - Math.floor(v);
}

/** Two octaves of warp: a broad bend and a fine wobble on top of it. */
function warp2(x, y, seed, amount) {
  const [x1, y1] = warp(x, y, 2, amount, seed + 5);
  return warp(x1, y1, 7, amount * 0.35, seed + 9);
}

/**
 * Shards: plates at two scales, warped, so no two are alike.
 *
 * Large cells everywhere, subdivided by smaller ones only where a broad mask
 * says so -- which gives a field of big plates with regions that have
 * shattered finer, instead of one size of plate. `seam` is the distance to
 * the nearest boundary in texture units (0 on a seam), so a seam width means
 * the same thing at either scale; `id` is stable across a plate and changes
 * at every seam, for one tone per plate.
 *
 * WHY `id` SWITCHES RATHER THAN BLENDS
 * ------------------------------------
 * It has to be piecewise constant. Callers feed it to `derive`, which is a
 * sine hash: a smoothly varying input comes back as white noise, and the
 * symptom is a fine stipple over the entire surface that looks like sensor
 * grain and survives every attempt to tune it out of the noise terms. So the
 * two scales' ids are chosen between, never mixed.
 */
function shards(x, y, seed, { big, small, amount = 0.22, subdivide = 0.5 }) {
  const [wx, wy] = warp2(x, y, seed, amount);
  const B = worley(wx, wy, big, seed);
  const S = worley(wx, wy, small, seed + 17);
  const sub = smoothstep(subdivide - 0.18, subdivide + 0.18, fbm(x, y, 3, 3, seed + 23));
  const seamB = (B.f2 - B.f1) / big;
  const seamS = (S.f2 - S.f1) / small;
  const seam = Math.min(seamB, lerp(1, seamS, sub));
  // Offset, so a small plate and the large one it sits in are not the same
  // shade on the rare occasions their hashes agree.
  const id = sub > 0.5 ? frac(S.id + 0.3178) : B.id;
  return { seam, id, wx, wy, sub };
}

/**
 * Stones: angular pieces scattered at one scale, gathered into clusters.
 *
 * Rotated rectangles with a bevelled edge, each its own size and height,
 * present in only `density` of the cells -- and, if `cluster` is set, only
 * where a broad mask puts them, because stones lie in drifts and piles and
 * not evenly across a floor. Returns the tallest piece here and its id.
 */
function stones(x, y, cells, seed, { size, density, cluster = 0 }) {
  const gate = cluster > 0 ? smoothstep(0.5 - cluster, 0.5 + cluster, fbm(x, y, 3, 3, seed + 61)) : 1;
  if (gate <= 0.001) return { v: 0, id: 0 };
  const s = scatter(x, y, cells, seed, (dx, dy, id) => {
    if (derive(id, 6) > density) return 0;
    const a = derive(id, 1) * Math.PI;
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    const u = dx * cs - dy * sn;
    const v = dx * sn + dy * cs;
    const w = size * (0.5 + derive(id, 2) * 0.5);
    const h = w * (0.55 + derive(id, 3) * 0.45);
    const e = Math.max(Math.abs(u) / w, Math.abs(v) / h);
    if (e >= 1) return 0;
    return smoothstep(1, 0.7, e) * (0.6 + derive(id, 5) * 0.4);
  });
  return { v: s.v * gate, id: s.id };
}

// ---------------------------------------------------------------------------
// Ashfield -- the ground
//
// Not a floor. The original surface of Furnace Nine is four hundred metres
// down; what you walk on is compacted ash and slag fines, drifted and trodden
// and cracked by the heat still coming up through it, with clinker fragments
// and grit pressed into the top. On Cistern Four it is rime: the same shape
// of surface made of frost instead of soot, grown thickest where the wind
// has had centuries to work, cracked over the ice it grew on.
//
// WHY THERE ARE NO STRAIGHT LINES IN HERE
// ---------------------------------------
// This surface covers most of every map, and a texture that tiles a hundred
// times across a map cannot contain a regular grid: at any zoom the joints
// line up into a lattice stretching to the horizon, and no amount of macro
// variation hides it. Organic noise has no such failure mode -- it tiles
// invisibly because there is no pattern to line up. The one gridded surface,
// rockcrete, is painted in patches of a few tiles, where the grid is an
// asset rather than a liability.
// ---------------------------------------------------------------------------

function ashfield(seed, P, { frost }) {
  const ASH = rgb(P.ash);
  const VOID = rgb(P.void);
  const IRON = rgb(P.iron);
  const ROCK = rgb(P.rockcrete);
  const DUST = rgb(P.dust);
  const RUST = rgb(P.rust);
  const DEEP = rgb(P.deep);

  /**
   * Crack scale, shared by the height field and the albedo.
   *
   * They have to agree or the dark line and the groove are in different
   * places. Eight rather than four: at four the cracks were large and
   * individually memorable, and a memorable shape is exactly what makes a
   * repeat visible -- you recognise the same crack every twelve tiles.
   */
  const cracks = (x, y) => {
    const [wx, wy] = warp(x, y, 3, 0.07, seed + 5);
    return ridged(wx, wy, 8, 4, seed + 11);
  };

  /** Grit: stones the size of a fist, in drifts where they were dumped. */
  const grit = (x, y) => stones(x, y, 40, seed + 51, { size: 0.42, density: 0.5, cluster: 0.25 });
  /**
   * Broken crust: plates of the surface itself, lifted and lying flat.
   *
   * Rare, and barely lighter than what they are lying on. At a third of the
   * cells and a strong tint they read as pale tiles dropped on the floor --
   * this is compacted ash that has come up in a sheet, not paving.
   */
  const crustPlates = (x, y) => stones(x, y, 11, seed + 57, { size: 0.42, density: 0.16, cluster: 0.35 });

  const fragment = (x, y) => {
    const frag = worley(x, y, 20, seed + 31);
    return smoothstep(0.3, 0.05, frag.f1) * smoothstep(0.45, 0.85, frag.id);
  };

  /** Drift mounds, where the wind piles it. */
  const mounds = (x, y) => smoothstep(0.5, 0.85, fbm(x, y, 12, 3, seed + 47));

  return {
    repeat: 12,
    // Gentle. This is a soft, powdery surface, and a strong normal map turns
    // it into gravel -- which is a different material and reads as a
    // rendering error rather than as a choice.
    normal: 28,

    height(x, y) {
      // Drifts. Particulate falls continuously here and piles the way snow
      // does -- and on Cistern Four it is snow.
      const drift = fbm(x, y, 3, 5, seed) * 0.3 + mounds(x, y) * 0.1;
      // Wind: everything lies the way it was blown, in streaks along x.
      const streak = fbm(x, y * 8, 2, 3, seed + 91) * 0.035;
      // Desiccation cracking, from whatever is driving the moisture out from
      // below. Deliberately coarse and branching rather than fine and even.
      const crack = smoothstep(0.6, 0.9, cracks(x, y)) * 0.22;
      // Fragments trodden into the surface, and the pits they leave.
      const frag = worley(x, y, 20, seed + 31);
      const lumps = smoothstep(0.34, 0.06, frag.f1) * 0.1 * smoothstep(0.45, 0.8, frag.id);
      const pit = smoothstep(0.86, 1.0, 1 - worley(x, y, 30, seed + 43).f1) * 0.07;
      const pieces = grit(x, y).v * 0.07 + crustPlates(x, y).v * 0.05;
      // Grain, so the surface is never flat anywhere.
      const grain = fbm(x, y, 56, 3, seed + 23) * 0.04;
      return drift + streak + lumps + pieces + grain - crack - pit;
    },

    shade(x, y, f) {
      // The base is the settled particulate, with the colour of the ground it
      // buried showing through where the drift is thin. Weighted toward it:
      // this is a surface made of what fell out of the sky, not a floor with
      // dust on it.
      const tone = fbm(x, y, 5, 4, seed + 41);
      let c = mix(ASH, ROCK, 0.08 + tone * 0.5);

      // Mid-scale mottling, between the drifts and the grain. Without
      // something at this scale the surface reads as clean ground with cracks
      // drawn on it.
      const mottle = fbm(x, y, 13, 3, seed + 137);
      c = mix(c, mix(ROCK, DUST, 0.5), smoothstep(0.45, 0.85, mottle) * 0.3);

      // Raised drifts and mounds catch what light there is and read paler.
      // Rime more so: fresh frost is the palest thing on that world.
      const raised = Math.max(smoothstep(-0.03, 0.1, f.rel), mounds(x, y) * 0.8);
      c = mix(c, DUST, raised * (frost ? 0.6 : 0.42));

      // Fragments: darker, glassier, and the only hard edges here.
      c = mix(c, mix(VOID, IRON, 0.4), fragment(x, y) * 0.8);

      // Broken crust, lying on top: the surface's own colour, lifted, so it
      // catches light on its top and casts none of its own.
      const plate = crustPlates(x, y);
      if (plate.v > 0.02) {
        const top = frost ? mix(ASH, DUST, 0.3 + derive(plate.id, 3) * 0.3) : mix(ASH, ROCK, derive(plate.id, 3));
        c = mix(c, top, smoothstep(0.02, 0.2, plate.v) * 0.45);
      }

      // Grit, each stone one tone. On Cistern Four the tops are rimed.
      const s = grit(x, y);
      if (s.v > 0.02) {
        const stone = frost
          ? mix(IRON, DUST, 0.25 + derive(s.id, 3) * 0.5)
          : mix(IRON, ROCK, derive(s.id, 3) * 0.8);
        c = mix(c, stone, smoothstep(0.02, 0.2, s.v) * 0.85);
      }

      // Cracks, dark all the way down -- to the ice, on Cistern Four.
      c = mix(c, frost ? DEEP : mix(ASH, VOID, 0.6), smoothstep(0.6, 0.92, cracks(x, y)) * 0.85);

      // Broad drifts, trodden in. Low frequency and high contrast, because
      // this is the surface's own answer to being tiled a hundred times.
      c = mix(c, ASH, smoothstep(0.26, 0.74, fbm(x, y, 2, 5, seed + 71)) * 0.6);

      // Runoff dried to a crust in the hollows; refrozen, on the ice world.
      const pool = smoothstep(0.01, -0.05, f.rel);
      const stain = smoothstep(0.52, 0.88, fbm(x, y, 6, 3, seed + 83)) * pool;
      c = mix(c, frost ? DEEP : mix(RUST, IRON, 0.5), stain * 0.45);

      return relief(c, f, 0.5, 1.22);
    },

    material(x, y, f) {
      const glassy = Math.max(fragment(x, y), smoothstep(0.05, 0.2, grit(x, y).v) * 0.6);
      // Ice grit catches the light where soot never does: a scatter of
      // specular points is half of what makes frost read as frost.
      const sparkle = frost ? smoothstep(0.82, 0.95, noise2(x, y, 96, seed + 99)) * 0.5 : 0;
      // This is as matte as a surface gets. The fragments in it are not, and
      // that contrast is the only specular event on the open ground.
      const roughness = clamp01(lerp(0.97, 0.42, glassy) - sparkle);
      return [lerp(0.6, 1, f.fine), roughness, fragment(x, y) * 0.3];
    },
  };
}

// ---------------------------------------------------------------------------
// Crust -- cinder, and ember
//
// Where the fires below come closest to the surface, the ashfield has baked
// into a crust of cooled clinker plates, split along seams as it shrank.
// `cinder` is that crust cold: dark plates, black seams packed with fines,
// the odd deep crack still showing a red line. `ember` is the same crust
// where the seams are still molten -- rivers of it between the plates, lakes
// of it where the plates have gone under -- the one place on Furnace Nine
// the ground itself gives light. Painted around the vents, because that is
// where it would be.
// ---------------------------------------------------------------------------

function crust(seed, P, { molten }) {
  const VOID = rgb(P.void);
  const ASH = rgb(P.ash);
  const IRON = rgb(P.iron);
  const ROCK = rgb(P.rockcrete);
  const DUST = rgb(P.dust);
  const RUST = rgb(P.rust);
  const EMBER = rgb(P.ember);
  const FLAME = rgb(P.flame);
  // Hotter than flame: what a molten core actually is. Not a palette colour,
  // because nothing but this may use it -- it is the light, not a surface.
  const WHITE_HOT = [1.0, 0.82, 0.5];

  const plates = (x, y) => shards(x, y, seed, { big: 5, small: 11, amount: 0.24, subdivide: 0.5 });

  /** Seam width in texture units, varying along the seam: a river is not a line. */
  const seamWidth = (x, y) => (molten ? 0.019 : 0.014) * (0.45 + fbm(x, y, 6, 2, seed + 31) * 1.1);

  /** Where the crust has foundered entirely. Molten only, and not often. */
  const lake = (x, y) => (molten ? smoothstep(0.66, 0.78, fbm(x, y, 3, 3, seed + 83)) : 0);

  /**
   * What is left of the crust inside a lake: small rafts, with lava between.
   *
   * A lake is not a pool of paint. Anything molten skins over within minutes
   * of being exposed and then breaks up as it moves, so what is actually
   * visible is mostly dark rock -- rafts of it, far smaller than the plates
   * outside, with the bright stuff showing in the channels between them.
   * Drawn with the same shard field at a finer scale rather than with a
   * noise mask, because a lake with no edges in it reads as a smear of sand
   * and was doing exactly that.
   */
  const rafts = (x, y) => shards(x, y, seed + 211, { big: 13, small: 24, amount: 0.3, subdivide: 0.5 });

  /**
   * How much solid ground is at this point: 1 on a plate, 0 in open lava.
   *
   * Outside a lake that is the plate field; inside one it is the rafts. The
   * two are the same question asked at two scales, so one blends into the
   * other along the lake's own edge.
   */
  const solid = (x, y, p) => {
    const onPlate = smoothstep(0, seamWidth(x, y), p.seam);
    if (!molten) return onPlate;
    const onRaft = smoothstep(0, 0.012, rafts(x, y).seam);
    return lerp(onPlate, onRaft, lake(x, y));
  };

  /** Secondary cracks across the plates, following the same warp. */
  const subcracks = (p) => smoothstep(0.76, 0.95, ridged(p.wx, p.wy, 16, 3, seed + 29));

  /** Clinker: the plate tops are rough, blistered, not flat. */
  const clinker = (x, y) => ridged(x, y, 18, 4, seed + 17);

  /** Loose lumps sitting on the plates. */
  const chunks = (x, y) => stones(x, y, 24, seed + 41, { size: 0.45, density: 0.5, cluster: 0.3 });

  /** Which cold seams still have heat in them. */
  const heatVein = (x, y) => smoothstep(0.4, 0.8, fbm(x, y, 5, 3, seed + 61));

  return {
    repeat: 12,
    normal: molten ? 55 : 50,
    /**
     * How much of the albedo the surface emits on its own.
     *
     * Molten crust lights the ground around it; cold crust barely does. Not
     * higher than this on either: the emissive is *added* to the lit result,
     * so a seam painted in `flame` at full strength comes out at nearly
     * twice white, and the engine has no tone mapping to pull that back --
     * it clips, the texture inside it disappears, and molten rock reads as a
     * neon tube laid on the floor.
     */
    glowStrength: molten ? 0.42 : 0.25,

    height(x, y) {
      const p = plates(x, y);
      const mask = solid(x, y, p);
      const top = 0.55 + p.id * 0.2 + clinker(x, y) * 0.22 - subcracks(p) * 0.14;
      const floor = molten ? 0.05 : 0.14;
      const lumps = chunks(x, y).v * 0.1 * mask;
      const grain = fbm(x, y, 64, 2, seed + 23) * 0.03;
      return lerp(floor, top, mask) + lumps + grain;
    },

    shade(x, y, f) {
      const p = plates(x, y);
      const mask = solid(x, y, p);
      const seamT = 1 - mask;

      // Each plate its own darkness, from near-black glass to grey clinker.
      //
      // Molten crust is lit from within, so its plates have to hold a
      // surface next to something bright, and sitting at the bottom of the
      // palette would make them holes rather than rock. Cold crust has the
      // opposite job: it is painted in regions across a world whose ground
      // is already dark brown, and if it lands near the same lightness the
      // regions are invisible from playing height -- which is the whole
      // point of painting them. So it goes well below the ash.
      let c = mix(VOID, IRON, molten ? 0.35 + p.id * 0.75 : 0.02 + p.id * 0.45);
      // The blistered top: lighter on the ridges, where it has weathered.
      const blister = smoothstep(0.4, 0.85, clinker(x, y));
      c = mix(c, mix(IRON, DUST, 0.5), blister * (molten ? 0.7 : 0.3));
      // Ash settled on the flat tops. Little of it: this is a hot surface,
      // and what falls on it does not stay.
      c = mix(c, mix(ASH, ROCK, 0.5), smoothstep(0.5, 0.9, fbm(x, y, 7, 3, seed + 67)) * (molten ? 0.35 : 0.18));

      // Heat at the rock's edges: it is scorched where it meets the seam.
      // Narrow. Widened, this is a broad band of `rust` on every plate edge,
      // and under a warm key light a broad band of rust is tan -- which is
      // how a field of lava came out looking like dried mud.
      const edge = 1 - smoothstep(0, seamWidth(x, y) * 1.6, p.seam);
      c = mix(c, RUST, edge * (molten ? 0.4 : 0.35));

      // The seam.
      if (molten) {
        // Rock meets lava at an EDGE, not over a gradient. `seamT` ramps
        // across the whole half-width of a channel, and colouring straight
        // from it makes every channel a soft tube with no rock margin --
        // which is why the first pass at this read as glowing roots rather
        // than as ground that has split open. Most of a channel is simply
        // hot; only its outermost fraction is a transition.
        const hot = smoothstep(0.08, 0.34, seamT);
        // How hot this stretch of channel is running. Lava is not one
        // temperature along its length, and a channel of constant colour is
        // the other half of the tube problem.
        const running = smoothstep(0.35, 0.8, fbm(x, y, 7, 3, seed + 131));

        // Saturated, and dark before it is bright: the key light on this
        // world is itself warm, so a pale seam colour comes back tan rather
        // than hot. What makes lava read as lava is the emissive channel
        // and the saturation, not lightness in the albedo.
        c = mix(c, EMBER, hot);
        c = mix(c, FLAME, hot * running * smoothstep(0.3, 0.75, seamT));
        // White is the core of a channel, where it is moving fastest and
        // nothing has had time to cool. Never wide: this is the brightest
        // thing in the game and it has to be the smallest as well, or
        // everything else in the frame is a silhouette against it.
        c = mix(c, WHITE_HOT, smoothstep(0.8, 1, seamT) * running * 0.5);
      } else {
        c = mix(c, VOID, seamT * 0.75);
        c = mix(c, EMBER, smoothstep(0.55, 1, seamT) * 0.55 * heatVein(x, y));
      }

      // Secondary cracks: lit from below when molten and the heat is there,
      // black otherwise.
      const sub = subcracks(p) * mask;
      c = mix(c, molten ? mix(VOID, EMBER, heatVein(x, y)) : VOID, sub * 0.8);

      // Lumps on the plates.
      const s = chunks(x, y);
      if (s.v > 0.02) {
        c = mix(c, mix(VOID, DUST, derive(s.id, 3) * 0.5), smoothstep(0.02, 0.25, s.v) * 0.8 * mask);
      }

      // Relief -- but not in a glowing seam. Light does not have shadows.
      const shaded = relief(c, f, 0.42, 1.28);
      return molten ? mix(shaded, c, smoothstep(0.3, 0.8, seamT)) : shaded;
    },

    glow(x, y) {
      const p = plates(x, y);
      const mask = solid(x, y, p);
      const seamT = 1 - mask;
      const sub = subcracks(p) * mask;
      if (!molten) return smoothstep(0.55, 1, seamT) * heatVein(x, y) + sub * 0.2;
      // The same edge the colour uses, so what emits and what looks hot are
      // the same shape -- a glow wider than its channel is a halo.
      return clamp01(smoothstep(0.08, 0.34, seamT) + sub * 0.7 * heatVein(x, y));
    },

    material(x, y, f) {
      const p = plates(x, y);
      const seamT = 1 - solid(x, y, p);
      // Clinker is matte. A molten seam floor is glass.
      const roughness = molten ? lerp(0.9, 0.35, seamT) : 0.92;
      return [lerp(0.5, 1, f.fine), roughness, 0.05];
    },
  };
}

// ---------------------------------------------------------------------------
// Slabs -- rockcrete
//
// Poured rockcrete, the way the Directorate lays a pad: in slabs, with
// expansion joints between them, rivets at the corners where the formwork
// was tied down, the odd slab split in two or poured double, a corner
// bitten off here and a drainage grate let into one there. Some slabs carry
// a hazard band along one edge and some a painted line, both half scuffed
// away. Ash packs the joints on Furnace Nine and snow does on Cistern Four,
// and either world's particulate collects on the flat tops. Everything is
// stained: nothing poured here has been clean since it set.
//
// This is the one gridded surface, and it is painted in patches of a few
// tiles -- a base pad, a landing apron -- exactly so the grid is an asset:
// four slabs to a repeat, two tiles to a slab, which reads as laid rather
// than as wallpaper. Painted across a whole map it would fail the way the
// original ashfield did; see the note on that surface.
// ---------------------------------------------------------------------------

function slabs(seed, P, { frost }) {
  const VOID = rgb(P.void);
  const ASH = rgb(P.ash);
  const IRON = rgb(P.iron);
  const DUST = rgb(P.dust);
  const RUST = rgb(P.rust);
  const EMBER = rgb(P.ember);
  const BONE = rgb(P.bone);
  const SLAB = rgb(P.slab);
  const ROCK = rgb(P.rockcrete);

  /** Slabs to a repeat, on each axis. Even, so paired slabs pair across the seam. */
  const N = 4;

  /**
   * Which slab this point is in, and where in it.
   *
   * A regular grid of cells: some split in half across one axis or the
   * other, some poured as a pair with the cell to the right. Each decision
   * is the cell's own hash -- and, for a pair, the hash of the left-hand
   * cell, read from both sides -- so the layout tiles with the grid and every
   * slab still has one identity.
   */
  function cell(x, y) {
    const fx = x * N;
    const fy = y * N;
    let ix = Math.floor(fx);
    let iy = Math.floor(fy);
    let u = fx - ix;
    let v = fy - iy;
    ix = ((ix % N) + N) % N;
    iy = ((iy % N) + N) % N;
    let id = cellRandom(ix, iy, seed);
    let sw = 1;
    let sh = 1;

    // A pair: the even cell decides, and its odd neighbour agrees.
    const left = ix - (ix % 2);
    const paired = cellRandom(left, iy, seed + 11) > 0.72;
    if (paired) {
      sw = 2;
      u = (u + (ix % 2)) * 0.5;
      id = cellRandom(left, iy + 53, seed + 13);
    } else if (id < 0.22) {
      sw = 0.5;
      const half = u < 0.5 ? 0 : 1;
      u = (u - half * 0.5) * 2;
      id = cellRandom(ix * 2 + half, iy + 97, seed + 3);
    } else if (id < 0.42) {
      sh = 0.5;
      const half = v < 0.5 ? 0 : 1;
      v = (v - half * 0.5) * 2;
      id = cellRandom(ix + 97, iy * 2 + half, seed + 5);
    }
    // Distance to the nearest joint, in cell units, so a joint is the same
    // width whatever the size of the slab beside it.
    const edge = Math.min(Math.min(u, 1 - u) * sw, Math.min(v, 1 - v) * sh);
    return { u, v, sw, sh, id, edge };
  }

  const RIVETS = [
    [0.1, 0.1],
    [0.9, 0.1],
    [0.1, 0.9],
    [0.9, 0.9],
  ];

  /** Rivet height at this point in its slab, 0 away from the corners. */
  function rivet(c) {
    let best = 0;
    for (const [cu, cv] of RIVETS) {
      const d = Math.hypot((c.u - cu) * c.sw, (c.v - cv) * c.sh) / 0.03;
      if (d < 1) best = Math.max(best, Math.sqrt(1 - d * d));
    }
    return best;
  }

  /** A corner broken off, on a fifth of the slabs. */
  function bite(c) {
    if (derive(c.id, 4) < 0.8) return 0;
    const cu = derive(c.id, 5) < 0.5 ? 0 : 1;
    const cv = derive(c.id, 6) < 0.5 ? 0 : 1;
    const d = Math.hypot((c.u - cu) * c.sw, (c.v - cv) * c.sh);
    return smoothstep(0.22, 0.12, d);
  }

  /** A drainage grate let into the middle of a few slabs: a recess, with bars. */
  function grate(c) {
    if (derive(c.id, 13) < 0.9) return { recess: 0, bar: 0 };
    const gu = Math.abs(c.u - 0.5) * c.sw;
    const gv = Math.abs(c.v - 0.5) * c.sh;
    const recess = smoothstep(0.22, 0.2, gu) * smoothstep(0.14, 0.12, gv);
    const bar = recess * (frac(c.v * c.sh * 12) < 0.45 ? 1 : 0);
    return { recess, bar };
  }

  /** The hazard band along one edge of a few slabs. */
  function hazard(c) {
    if (derive(c.id, 11) < 0.86) return 0;
    return smoothstep(0.17, 0.14, c.v);
  }

  /** A painted line just inside the joint, on a quarter of the slabs. */
  function marking(c) {
    if (derive(c.id, 12) < 0.75) return 0;
    return smoothstep(0.075, 0.065, c.edge) * smoothstep(0.04, 0.05, c.edge);
  }

  /** Traffic: scuffed along x, the way a pad is driven over. */
  const scuff = (x, y) => smoothstep(0.5, 0.85, fbm(x, y * 6, 3, 3, seed + 91));
  /** Spills and soot, in broad patches. Everything poured here is filthy. */
  const grime = (x, y) => smoothstep(0.4, 0.8, fbm(x, y, 4, 4, seed + 87));
  /** Rust running down from the rivets, on the slabs with iron in them. */
  const run = (x, y) => smoothstep(0.55, 0.9, fbm(x * 4, y, 2, 3, seed + 83));
  /** Cracks right across a slab. */
  const crack = (x, y, c) => (derive(c.id, 7) > 0.65 ? smoothstep(0.8, 0.95, ridged(x, y, 6, 3, seed + 29)) : 0);

  return {
    repeat: 8,
    normal: 48,

    height(x, y) {
      const c = cell(x, y);
      const onSlab = smoothstep(0.0, 0.03, c.edge);
      const lip = smoothstep(0.03, 0.06, c.edge) * 0.08;
      // Every slab has settled a little differently.
      const tilt = ((c.u - 0.5) * (derive(c.id, 1) - 0.5) + (c.v - 0.5) * (derive(c.id, 2) - 0.5)) * 0.08;
      const top = 0.6 + derive(c.id, 3) * 0.06 + tilt;
      const g = grate(c);
      // Spalling: the surface has come away in small pits.
      const pits = smoothstep(0.9, 1.0, 1 - worley(x, y, 40, seed + 43).f1) * 0.05;
      const grain = fbm(x, y, 48, 3, seed + 23) * 0.025;
      // The joint floor: what has packed into it.
      const joint = 0.38 + fbm(x, y, 12, 2, seed + 31) * 0.05;
      const slab = top + lip + rivet(c) * 0.05 - bite(c) * 0.5 - crack(x, y, c) * 0.12 - pits - g.recess * 0.18 + g.bar * 0.1;
      return lerp(joint, slab, onSlab) + grain;
    },

    shade(x, y, f) {
      const c = cell(x, y);
      const onSlab = smoothstep(0.0, 0.03, c.edge);

      // Each slab its own pour.
      let col = mix(SLAB, mix(SLAB, DUST, 0.4), derive(c.id, 8) * 0.8);
      col = mix(col, IRON, derive(c.id, 9) * 0.35);
      // Aggregate showing through the surface.
      col = mix(col, mix(col, DUST, 0.5), smoothstep(0.6, 0.9, fbm(x, y, 40, 3, seed + 51)) * 0.25);
      // Scuffs.
      const worn = scuff(x, y);
      col = mix(col, mix(col, DUST, 0.5), worn * 0.35);
      // Grime.
      col = mix(col, mix(VOID, IRON, 0.5), grime(x, y) * 0.5);
      // Rust.
      col = mix(col, RUST, run(x, y) * 0.45 * smoothstep(0.3, 0.6, derive(c.id, 10)));

      // Hazard band: the one place the pad has colour on it. Half worn off.
      const band = hazard(c);
      if (band > 0) {
        const stripe = frac((c.u * c.sw + c.v * c.sh) * 14) < 0.5 ? EMBER : IRON;
        col = mix(col, stripe, band * 0.75 * (1 - worn * 0.6));
      }
      // Painted lines, faded.
      col = mix(col, BONE, marking(c) * 0.4 * (1 - worn * 0.7));
      // Cracks: dark lines, with the particulate in them.
      col = mix(col, mix(ASH, VOID, 0.5), crack(x, y, c) * 0.8);
      // The grate: black under the bars, iron on them.
      const g = grate(c);
      col = mix(col, VOID, g.recess * 0.9);
      col = mix(col, mix(IRON, RUST, derive(c.id, 14) * 0.5), g.bar * 0.9);
      // Rivets.
      col = mix(col, IRON, smoothstep(0.2, 0.5, rivet(c)));
      // A broken corner exposes the fill under it.
      col = mix(col, mix(ASH, ROCK, 0.5), smoothstep(0.3, 0.6, bite(c)) * 0.8);

      // The joints: packed with ash, or with snow.
      col = mix(mix(ASH, VOID, frost ? 0.1 : 0.45), col, onSlab);

      // Particulate on the flat tops.
      if (frost) {
        const rime = smoothstep(0.45, 0.8, fbm(x, y, 6, 3, seed + 61)) * smoothstep(-0.02, 0.05, f.rel);
        col = mix(col, DUST, rime * 0.6);
      } else {
        col = mix(col, ASH, smoothstep(0.5, 0.85, fbm(x, y, 4, 3, seed + 61)) * 0.4);
      }

      return relief(col, f, 0.45, 1.25);
    },

    material(x, y, f) {
      const c = cell(x, y);
      const onSlab = smoothstep(0.0, 0.03, c.edge);
      const paint = Math.max(hazard(c), marking(c));
      const bolt = Math.max(smoothstep(0.2, 0.5, rivet(c)), grate(c).bar);
      let roughness = lerp(0.97, 0.85, onSlab);
      roughness = lerp(roughness, 0.55, paint);
      roughness = lerp(roughness, 0.45, bolt);
      roughness = lerp(roughness, 0.7, grime(x, y) * 0.5);
      return [lerp(0.55, 1, f.fine), roughness, bolt * 0.8];
    },
  };
}

// ---------------------------------------------------------------------------
// Rubble -- and scree
//
// Where something stood and does not any more: broken masonry, cut plate
// and beam lying where it fell, in heaps -- because collapse piles, it does
// not scatter -- with shell craters and bare ground between. Every piece is
// angular, because nothing here eroded; it was knocked down. Painted against
// the spoil heaps, whose foot it is, and in patches where a map wants a
// fight to have happened.
//
// On Cistern Four the same ground is scree: the same broken storage
// structure, rimed white on every upward face, with no craters -- nothing
// has been shelled there, the ice just gave way.
// ---------------------------------------------------------------------------

function rubble(seed, P, { frost }) {
  const VOID = rgb(P.void);
  const ASH = rgb(P.ash);
  const IRON = rgb(P.iron);
  const ROCK = rgb(P.rockcrete);
  const DUST = rgb(P.dust);
  const RUST = rgb(P.rust);
  const SLAB = rgb(P.slab);

  /**
   * A broken block: a rotated rectangle with a bevelled edge and a tilt, or
   * a beam, long and thin. Dimensions in cell units.
   */
  const block = (rx, ry, hmin, hspan) => (dx, dy, id) => {
    const a = derive(id, 1) * Math.PI;
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    const u = dx * cs - dy * sn;
    const v = dx * sn + dy * cs;
    const beam = derive(id, 9) > 0.78;
    const w = beam ? rx * 1.6 : rx * (0.4 + derive(id, 2) * 0.9);
    const h = beam ? ry * 0.3 : ry * (0.5 + derive(id, 3) * 0.6);
    const e = Math.max(Math.abs(u) / w, Math.abs(v) / h);
    if (e >= 1) return 0;
    const lip = smoothstep(1, 0.72, e);
    const tilt = (u / w) * (derive(id, 4) - 0.5) * 0.5;
    return (hmin + derive(id, 5) * hspan) * lip * (1 + tilt);
  };

  /**
   * Where the heaps are. Collapse piles; between the piles is bare ground.
   *
   * Tight, because the failure this exists to prevent is debris spread
   * evenly across the whole surface like confetti: what falls down lands in
   * a heap, and the bare ground between the heaps is what makes them read as
   * heaps at all.
   */
  const pile = (x, y) => smoothstep(0.38, 0.62, fbm(x, y, 3, 3, seed + 61));

  const big = (x, y) => {
    const g = pile(x, y);
    if (g <= 0.001) return { v: 0, id: 0 };
    const s = scatter(x, y, 7, seed + 7, (dx, dy, id) =>
      derive(id, 6) > 0.3 ? block(0.34, 0.24, 0.6, 0.4)(dx, dy, id) : 0,
    );
    return { v: s.v * g, id: s.id };
  };
  const mid = (x, y) => {
    const g = 0.2 + pile(x, y) * 0.8;
    const s = scatter(x, y, 15, seed + 17, (dx, dy, id) =>
      derive(id, 6) > 0.5 ? block(0.32, 0.22, 0.35, 0.3)(dx, dy, id) : 0,
    );
    return { v: s.v * g, id: s.id };
  };
  const small = (x, y) => {
    const s = stones(x, y, 38, seed + 27, { size: 0.4, density: 0.42, cluster: 0.3 });
    return { v: s.v * 0.25, id: s.id };
  };

  /** Shell craters: a raised rim and a bowl. They add, where two overlap. */
  const craters = (x, y) =>
    frost
      ? 0
      : scatterSum(x, y, 3, seed + 37, (dx, dy, id) => {
          if (derive(id, 1) < 0.45) return 0;
          const R = 0.3 + derive(id, 2) * 0.2;
          const d = Math.hypot(dx, dy) / R;
          const rim = Math.exp(-(((d - 1) / 0.16) ** 2)) * 0.22;
          const bowl = d < 1 ? -(1 - d * d) * 0.45 : 0;
          return rim + bowl;
        });

  /** The tallest thing here, and which it is. */
  function pieces(x, y) {
    const b = big(x, y);
    const m = mid(x, y);
    const s = small(x, y);
    if (b.v >= m.v && b.v >= s.v) return { v: b.v, id: b.id, kind: 2 };
    if (m.v >= s.v) return { v: m.v, id: m.id, kind: 1 };
    return { v: s.v, id: s.id, kind: 0 };
  }

  const cracks = (x, y) => smoothstep(0.7, 0.92, ridged(x, y, 7, 3, seed + 11));

  return {
    repeat: 12,
    normal: 60,

    height(x, y) {
      const ground = fbm(x, y, 4, 4, seed) * 0.18 + fbm(x, y, 40, 3, seed + 23) * 0.04 - cracks(x, y) * 0.08;
      return ground + craters(x, y) + pieces(x, y).v;
    },

    shade(x, y, f) {
      // The ground between: the buried surface, mostly, rather than ash.
      //
      // Lighter than the open ashfield on purpose, and the reason is the
      // same as the one that sends cold crust the other way: this is
      // painted in patches against that ashfield, and two surfaces that
      // land on the same lightness are one surface as far as the player at
      // playing height is concerned. What justifies it is that this ground
      // has been turned over -- shelled, or collapsed onto -- so what shows
      // is what was under the ash rather than the ash.
      let c = mix(ROCK, mix(ROCK, DUST, 0.45), fbm(x, y, 5, 3, seed + 41));
      c = mix(c, ASH, smoothstep(0.45, 0.85, fbm(x, y, 9, 3, seed + 47)) * 0.45);
      c = mix(c, VOID, cracks(x, y) * 0.6);

      // Craters: scorched in the bowl, thrown-out spoil on the rim, lighter
      // where the blast stripped the ash off.
      const cr = craters(x, y);
      c = mix(c, VOID, smoothstep(-0.02, -0.3, cr) * 0.7);
      c = mix(c, mix(ROCK, DUST, 0.5), smoothstep(0.03, 0.15, cr) * 0.45);

      // The pieces. Masonry is rockcrete-coloured; a third of the larger ones
      // are cut plate, iron and rust. Rimed on top, on the ice world.
      const p = pieces(x, y);
      if (p.v > 0.01) {
        const plate = p.kind > 0 && derive(p.id, 7) > 0.66;
        let stone = plate
          ? mix(IRON, RUST, derive(p.id, 8) * 0.7)
          : mix(ROCK, mix(SLAB, DUST, 0.5), derive(p.id, 8));
        // Broken faces are lighter than weathered ones.
        stone = mix(stone, DUST, smoothstep(0.55, 0.85, fbm(x, y, 30, 2, seed + 93)) * 0.25);
        // Rime on the upward faces only: a piece lying in shadow under
        // another keeps its own colour, which is what stops a frozen scree
        // from flattening into one sheet of white.
        if (frost) stone = mix(stone, DUST, (0.2 + derive(p.id, 9) * 0.3) * lerp(0.3, 1, f.cav));
        c = mix(c, stone, smoothstep(0.01, 0.08, p.v));
      }

      // Drifts against everything, in the hollows.
      const soot = smoothstep(0.3, 0.7, fbm(x, y, 3, 4, seed + 71)) * smoothstep(0.05, -0.05, f.rel);
      c = mix(c, ASH, soot * 0.5);

      return relief(c, f, 0.38, 1.3);
    },

    material(x, y, f) {
      const p = pieces(x, y);
      const on = smoothstep(0.01, 0.08, p.v);
      const plate = p.kind > 0 && derive(p.id, 7) > 0.66 ? on : 0;
      const roughness = lerp(0.97, plate > 0 ? 0.5 : 0.88, on);
      return [lerp(0.45, 1, f.fine), roughness, plate * 0.6];
    },
  };
}

// ---------------------------------------------------------------------------
// Ice -- Cistern Four only
//
// The reserve's coolant lakes, frozen a long way down. Plates of clear ice
// over deep blue, split by dark cracks that the frost has filled in white
// along some of their length, buckled into ridges where the sheet has been
// pushed against itself, with snow blown across in streaks and the odd stone
// frozen in. The one glossy ground surface in the game: where a unit stands
// on it, the pale key light stands on it too.
// ---------------------------------------------------------------------------

function ice(seed, P) {
  const VOID = rgb(P.void);
  const RIME = rgb(P.ash);
  const IRON = rgb(P.iron);
  const ROCK = rgb(P.rockcrete);
  const DUST = rgb(P.dust);
  const DEEP = rgb(P.deep);

  const plates = (x, y) => shards(x, y, seed, { big: 4, small: 9, amount: 0.2, subdivide: 0.55 });

  /** Fine cracks across the plates, following the same warp. */
  const cracks = (p) => smoothstep(0.78, 0.95, ridged(p.wx, p.wy, 14, 3, seed + 29));
  /** Where the frost has filled a crack, in white. Patchy, along its length. */
  const frostFill = (x, y) => smoothstep(0.38, 0.7, fbm(x, y, 8, 3, seed + 77));
  /** Where the sheet has buckled into a ridge. Some seams, not all. */
  const ridgeMask = (x, y) => smoothstep(0.5, 0.72, fbm(x, y, 4, 2, seed + 79));
  /** Old snow and trapped bubbles clouding the ice. */
  const cloud = (x, y) => smoothstep(0.52, 0.88, fbm(x, y, 7, 3, seed + 41));
  /** Snow blown across in streaks. */
  const blown = (x, y) => smoothstep(0.6, 0.88, fbm(x, y * 8, 2, 3, seed + 91));
  const grit = (x, y) => stones(x, y, 30, seed + 51, { size: 0.35, density: 0.18, cluster: 0.3 });

  /** The crack width, in texture units. Thin. */
  const SEAM = 0.006;

  const ridge = (x, y, p) => (1 - smoothstep(SEAM, 0.028, p.seam)) * smoothstep(0, SEAM, p.seam) * ridgeMask(x, y);

  return {
    repeat: 12,
    normal: 34,

    height(x, y) {
      const p = plates(x, y);
      const onPlate = smoothstep(0.0, SEAM, p.seam);
      const top = 0.6 + derive(p.id, 2) * 0.08 + (derive(p.id, 1) - 0.5) * 0.06;
      // Ice is smooth. The only fine relief on it is what has blown across
      // and settled, and a little swell in the sheet itself.
      const surface = fbm(x, y, 10, 2, seed + 23) * 0.03 + blown(x, y) * 0.03;
      return (
        lerp(0.3, top, onPlate) + surface + ridge(x, y, p) * 0.18 - cracks(p) * 0.05 + grit(x, y).v * 0.06
      );
    },

    shade(x, y, f) {
      const p = plates(x, y);
      const onPlate = smoothstep(0.0, SEAM, p.seam);

      // Rime at the rim of each plate, deep coolant blue in the middle where
      // the ice is thick and clear. How deep varies by plate.
      const inner = smoothstep(0.01, 0.055, p.seam);
      let c = mix(RIME, DEEP, inner * (0.75 + derive(p.id, 3) * 0.25));
      // Clouded, in patches. Light: this is the one surface in the game whose
      // whole point is depth, and anything mixed over it is depth removed.
      c = mix(c, mix(RIME, DUST, 0.5), cloud(x, y) * 0.28);
      // Snow blown across it, in streaks rather than as a film.
      c = mix(c, DUST, blown(x, y) * 0.5);
      // The frost filling the cracks: white along part of every seam.
      const nearSeam = 1 - smoothstep(SEAM, 0.02, p.seam);
      c = mix(c, DUST, nearSeam * frostFill(x, y) * 0.85);
      // Pressure ridges: crushed, white.
      c = mix(c, DUST, ridge(x, y, p) * 0.85);
      // The crack itself: dark, down to the water.
      c = mix(mix(DEEP, VOID, 0.6), c, onPlate);
      // Fine cracks: white where the frost got into them, dark where not.
      c = mix(c, mix(mix(DEEP, VOID, 0.4), DUST, frostFill(x, y)), cracks(p) * 0.85);
      // Grit frozen in, frost on its top.
      const s = grit(x, y);
      if (s.v > 0.02) c = mix(c, mix(IRON, DUST, 0.2 + derive(s.id, 3) * 0.4), smoothstep(0.02, 0.2, s.v) * 0.85);

      return relief(c, f, 0.55, 1.2);
    },

    material(x, y, f) {
      const p = plates(x, y);
      const onPlate = smoothstep(0.0, SEAM, p.seam);
      // Clear ice is glass; everything that is not clear ice is frost.
      const frosted = Math.max(cloud(x, y) * 0.5, blown(x, y), ridge(x, y, p), cracks(p) * frostFill(x, y));
      const roughness = clamp01(lerp(0.75, 0.2, onPlate) + frosted * 0.6);
      return [lerp(0.6, 1, f.fine), roughness, 0];
    },
  };
}

// ---------------------------------------------------------------------------
// Meltrock -- Cistern Four only
//
// The ground under the ice, where a breached reactor has melted the ice
// back: dark slate, fractured into angular plates, wet everywhere and
// standing in meltwater in the hollows. Rime survives on the highest flat
// tops. The reactor's own heat shows faintly in the deepest cracks. Painted
// around the vents, which on this world are exactly that.
// ---------------------------------------------------------------------------

function meltrock(seed, P) {
  const VOID = rgb(P.void);
  const RIME = rgb(P.ash);
  const IRON = rgb(P.iron);
  const MELT = rgb(P.rockcrete);
  const DUST = rgb(P.dust);
  const EMBER = rgb(P.ember);
  const DEEP = rgb(P.deep);

  /** Where the meltwater stands. */
  const WATER = 0.3;
  const SEAM = 0.008;

  const plates = (x, y) => shards(x, y, seed, { big: 7, small: 15, amount: 0.16, subdivide: 0.45 });
  const grain = (x, y) => ridged(x, y, 14, 2, seed + 17);
  const pools = (x, y) => smoothstep(0.42, 0.3, fbm(x, y, 3, 4, seed + 61));
  const chunks = (x, y) => stones(x, y, 22, seed + 41, { size: 0.4, density: 0.4, cluster: 0.3 });
  const heat = (x, y, p) => {
    const seamT = 1 - smoothstep(0, SEAM, p.seam);
    return smoothstep(0.5, 1, seamT) * smoothstep(0.45, 0.8, fbm(x, y, 4, 3, seed + 71));
  };

  return {
    repeat: 12,
    normal: 55,
    glowStrength: 0.4,

    height(x, y) {
      const p = plates(x, y);
      const onPlate = smoothstep(0, SEAM, p.seam);
      const top = 0.45 + derive(p.id, 1) * 0.4 + grain(x, y) * 0.1;
      const cracks = smoothstep(0.8, 0.95, ridged(p.wx, p.wy, 20, 3, seed + 29)) * 0.1;
      // Wet rock is smooth at the small scale -- the grain is in the plates,
      // not in a per-texel wobble, which at this resolution is only noise.
      const h = lerp(0.1, top - cracks, onPlate) + chunks(x, y).v * 0.08 + fbm(x, y, 20, 2, seed + 23) * 0.015;
      // Standing water is flat, at its own level, wherever the rock is below it.
      return lerp(h, Math.min(h, WATER), pools(x, y));
    },

    shade(x, y, f) {
      const p = plates(x, y);
      const onPlate = smoothstep(0, SEAM, p.seam);

      let c = mix(MELT, IRON, derive(p.id, 2) * 0.7);
      c = mix(c, mix(MELT, DUST, 0.35), smoothstep(0.5, 0.9, grain(x, y)) * 0.22);
      // Wet: darker everywhere, darkest in the seams.
      c = mix(mix(VOID, DEEP, 0.4), c, onPlate);
      // Loose pieces on the plates.
      const s = chunks(x, y);
      if (s.v > 0.02) c = mix(c, mix(IRON, RIME, derive(s.id, 3) * 0.5), smoothstep(0.02, 0.2, s.v) * 0.8);
      // Rime surviving on the high flat tops.
      const rime = smoothstep(0.03, 0.1, f.rel) * smoothstep(0.45, 0.8, fbm(x, y, 7, 3, seed + 41));
      c = mix(c, RIME, rime * 0.55);
      // The reactor's heat, deep in the cracks.
      c = mix(c, EMBER, heat(x, y, p) * 0.5);
      // Pools: near-black water with the deep blue in it.
      const water = pools(x, y) * smoothstep(WATER + 0.01, WATER - 0.01, f.h);
      c = mix(c, mix(DEEP, VOID, 0.5), water * 0.85);

      // Water is flat; it has no relief to shade.
      return mix(relief(c, f, 0.45, 1.2), c, water);
    },

    glow(x, y) {
      return heat(x, y, plates(x, y));
    },

    material(x, y, f) {
      const water = pools(x, y) * smoothstep(WATER + 0.01, WATER - 0.01, f.h);
      const rime = smoothstep(0.03, 0.1, f.rel) * smoothstep(0.45, 0.8, fbm(x, y, 7, 3, seed + 41));
      // Wet rock, frost on it, and still water: three roughnesses.
      let roughness = 0.4;
      roughness = lerp(roughness, 0.85, rime);
      roughness = lerp(roughness, 0.08, water);
      return [lerp(0.5, 1, f.fine), roughness, 0];
    },
  };
}


// ---------------------------------------------------------------------------
// Slag -- the cliffs
//
// Vitrified furnace waste, cooled into clinker and glassy froth. Spoil heaps,
// not geology: sharp-edged, poured, and shot through with rust bleed where
// the iron content weathered out. On Cistern Four it is whatever that world's
// own hard ground turned out to be underneath its ice -- fused, fractured
// along its seams the same way, coloured for what it actually is.
//
// Not a painted surface: this is the material of the instanced heaps, which
// stand on the ground rather than being part of it.
// ---------------------------------------------------------------------------

function slag(seed, P) {
  const VOID = rgb(P.void);
  const ASH = rgb(P.ash);
  const IRON = rgb(P.iron);
  const RUST = rgb(P.rust);
  const EMBER = rgb(P.ember);
  const DUST = rgb(P.dust);

  const glass = (x, y) => smoothstep(0.5, 0.82, fbm(x, y, 11, 3, seed + 43));
  // Rust bleed runs downward, so the streaks are stretched along y -- the one
  // direction-dependent feature here, and the reason the cliff geometry must
  // not rotate this texture off the vertical.
  const bleed = (x, y) => smoothstep(0.66, 0.92, fbm(x, y * 0.25, 9, 4, seed + 59));

  return {
    repeat: 1,
    normal: 70,

    height(x, y) {
      // Fused lumps. `f2 - f1` is the seam between two of them. Twelve across
      // rather than seven: at seven they read as cobblestones, and a paved
      // road is the one thing this must not look like.
      const lump = worley(x, y, 12, seed);
      const body = (1 - lump.f1) * 0.5 + lump.id * 0.18;
      const seam = smoothstep(0.0, 0.2, lump.f2 - lump.f1);
      // Froth: gas bubbles trapped when it set.
      const bubbles = smoothstep(0.26, 0.0, worley(x, y, 22, seed + 13).f1) * 0.14;
      // Fracture planes, because it cooled too fast and split.
      const fracture = smoothstep(0.72, 0.95, ridged(x, y, 6, 3, seed + 29)) * 0.16;
      const grain = fbm(x, y, 40, 3, seed + 37) * 0.05;
      return body * seam + grain - bubbles - fracture * 0.6;
    },

    shade(x, y, f) {
      const lump = worley(x, y, 12, seed);

      // Each lump its own shade, from near-black glass to grey clinker.
      let colour = mix(VOID, IRON, 0.15 + lump.id * 0.7);
      // The seams between lumps are packed with fines and are darker still.
      colour = mix(VOID, colour, smoothstep(0.0, 0.14, lump.f2 - lump.f1));
      // Glassy faces where it cooled smooth. Darker and, in the ORM, shinier.
      colour = mix(colour, VOID, glass(x, y) * 0.7);
      // Rust bleed. Occasional, and only on lumps with the iron in them to
      // bleed: at the first pass this covered half the surface and the cliffs
      // came out tan.
      colour = mix(colour, RUST, bleed(x, y) * smoothstep(0.55, 0.9, lump.id) * 0.45);
      // Heat still in it, deep in the cracks. Sparing: `ember` is the key
      // light's own colour, and a surface that emits it everywhere stops
      // reading as rock.
      const heat = smoothstep(0.35, 0.0, f.fine) * smoothstep(0.55, 0.9, fbm(x, y, 5, 3, seed + 61));
      colour = mix(colour, EMBER, heat * 0.32);
      // And the world's own particulate on every ledge, as everywhere else.
      const ledge = smoothstep(0.62, 0.95, f.fine) * fbm(x, y, 17, 3, seed + 73);
      colour = mix(colour, mix(DUST, ASH, 0.4), ledge * 0.4);

      return relief(colour, f, 0.55, 1.1);
    },

    material(x, y, f) {
      // Vitrified faces are glassy; weathered clinker and rust are not.
      const roughness = clamp01(lerp(0.88, 0.22, glass(x, y)) + bleed(x, y) * 0.3);
      // Mostly silicate, but the bleed is iron that never left.
      return [lerp(0.35, 1, f.fine), roughness, bleed(x, y) * 0.45];
    },
  };
}

// ---------------------------------------------------------------------------

/**
 * Which surfaces to build: all of them, or the ones named on the command
 * line as `biome` or `biome:surface`. The manifest is merged rather than
 * rewritten, so building one surface does not forget the others.
 */
const wanted = process.argv.slice(2);
const isWanted = (biome, surface) =>
  wanted.length === 0 || wanted.includes(biome) || wanted.includes(`${biome}:${surface}`);

mkdirSync(OUT, { recursive: true });
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};

for (const [biome, def] of Object.entries(BIOMES)) {
  const entry = (manifest[biome] ??= { surfaces: {}, cliff: {} });
  // Rebuilt in definition order, so a surface renamed or removed here does
  // not linger in the manifest, and the first surface stays first.
  const surfaces = {};
  let index = 0;
  for (const [name, make] of Object.entries(def.surfaces)) {
    index++;
    if (isWanted(biome, name)) {
      console.log(`[rts] ${biome}:${name}`);
      // Each surface its own seed, spaced far enough apart that two surfaces'
      // own offsets never land on the same lattice.
      surfaces[name] = bake(`${biome}_${name}`, make(1337 + def.seed + index * 1000, def.palette));
    } else if (entry.surfaces[name]) {
      surfaces[name] = entry.surfaces[name];
    } else {
      throw new Error(`[rts] ${biome}:${name} has never been generated; build the whole biome first`);
    }
  }
  entry.surfaces = surfaces;
  if (isWanted(biome, "slag")) {
    console.log(`[rts] ${biome}:slag`);
    entry.cliff = bake(`${biome}_slag`, def.cliff(4242 + def.seed, def.palette));
  }
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
console.log("[rts] terrain written to packages/client/assets/terrain/");
