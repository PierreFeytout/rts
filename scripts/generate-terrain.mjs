import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { encodePng } from "./lib/png.mjs";
import { clamp01, fbm, lerp, noise2, ridged, smoothstep, worley } from "./lib/noise.mjs";

/**
 * Generate the terrain textures.
 *
 * See UNIVERSE.md for what these surfaces are meant to be. In short: a
 * forge-world buried under its own slag, lit by furnaces nobody turned off, with
 * ash settling into every horizontal crevice.
 *
 * Generated rather than painted, and the generator committed alongside its
 * output, so a surface can be re-tuned by changing a number instead of by
 * repainting. The output is ordinary PNG, so an artist can replace any one file
 * without touching a line of code.
 *
 * WHY A HEIGHT FIELD FIRST
 * -----------------------
 * Every surface is built as a height field, and the colour, the normals and the
 * occlusion are all derived from it. That is what makes the three maps agree:
 * hand-authoring an albedo and a normal map separately produces a surface where
 * the lighting and the staining are describing different rock. Derive them and
 * the ash is *in* the crack it is drawn in.
 *
 *   node scripts/generate-terrain.mjs
 */

const OUT = fileURLToPath(new URL("../packages/client/assets/terrain/", import.meta.url));

/**
 * Texture resolution.
 *
 * The camera shows roughly 20 screen pixels per world tile, and a surface tiles
 * every `TILES_PER_TILE` tiles, so 512 is about 64 texture pixels per tile —
 * three times the density the screen can show. Occlusion, roughness and
 * metalness vary slowly enough to live at half that.
 */
const SIZE = 512;
const ORM_SIZE = 256;

// ---------------------------------------------------------------------------
// Palette — UNIVERSE.md
// ---------------------------------------------------------------------------

const PALETTE = {
  void: "#0a0806",
  ash: "#14100d",
  iron: "#221b15",
  rockcrete: "#3a2a1c",
  dust: "#5a483a",
  rust: "#7a4a22",
  ember: "#c46a28",
  flame: "#e8a04a",
  bone: "#b8a894",
};

/**
 * A palette entry as **linear** RGB.
 *
 * The hex values in UNIVERSE.md are sRGB, because that is what a colour picker
 * shows. Mixing has to happen in linear light or every blend is wrong, and
 * writing the result back out without undoing the transfer brightens the whole
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
  return out;
}

/**
 * Occlusion, as the difference between a point and its neighbourhood.
 *
 * A real ambient-occlusion bake would trace rays against the height field. This
 * compares each texel to a blurred copy, which is the same answer for surfaces
 * whose features are small relative to the blur radius — and every one of these
 * is. Anything sitting below its surroundings is in shadow, which is exactly
 * where ash ends up.
 */
function occlusion(height, size, radius) {
  const blurred = boxBlur(height, size, radius);
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) {
    out[i] = clamp01(0.5 + (height[i] - blurred[i]) * 6);
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
 * Tangent-space normals from the height field, by central difference.
 *
 * Green points **up** in texture space (OpenGL convention), which is what
 * three.js expects. Getting this inverted is the classic normal-map bug: the
 * surface lights as though every bump were a dent, and it reads as "the light
 * is in the wrong place" rather than as a texture problem.
 */
function normalMap(height, size, strength) {
  const out = new Uint8Array(size * size * 3);
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

      const i = (y * size + x) * 3;
      out[i] = Math.round((nx * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((nz / len) * 0.5 * 255 + 127.5);
    }
  }
  return out;
}

/** Convert a linear colour to an sRGB byte, which is what albedo PNGs hold. */
function toSrgbByte(v) {
  const c = clamp01(v);
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

function writeAlbedo(name, size, shade) {
  const out = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const colour = shade(x, y);
      const i = (y * size + x) * 3;
      out[i] = toSrgbByte(colour[0]);
      out[i + 1] = toSrgbByte(colour[1]);
      out[i + 2] = toSrgbByte(colour[2]);
    }
  }
  save(`${name}_albedo`, out, size);
}

/**
 * Occlusion, roughness and metalness in one image.
 *
 * The glTF convention, and not merely a size trick: three.js reads `aoMap` from
 * red, `roughnessMap` from green and `metalnessMap` from blue, so one file and
 * one texture unit serves all three. These are linear data, not colour — no
 * sRGB transfer on the way in or out.
 */
function writeOrm(name, size, sample) {
  const out = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [ao, roughness, metalness] = sample(x, y);
      const i = (y * size + x) * 3;
      out[i] = Math.round(clamp01(ao) * 255);
      out[i + 1] = Math.round(clamp01(roughness) * 255);
      out[i + 2] = Math.round(clamp01(metalness) * 255);
    }
  }
  save(`${name}_orm`, out, size);
}

function save(name, pixels, size) {
  const file = `${OUT}${name}.png`;
  const png = encodePng(pixels, size, size);
  writeFileSync(file, png);
  console.log(`[rts] ${name}.png  ${size}x${size}  ${(png.length / 1024).toFixed(0)} kB`);
}

// ---------------------------------------------------------------------------
// Ashfield — the ground
//
// Not a floor. The original surface of this world is four hundred metres down;
// what you walk on is compacted ash and slag fines, drifted and trodden and
// cracked by the heat still coming up through it.
//
// WHY THERE ARE NO STRAIGHT LINES IN HERE
// ---------------------------------------
// The first version of this surface was poured rockcrete slabs with expansion
// joints, which is a perfectly good industrial floor and was completely wrong
// for the job. A texture that tiles a hundred times across a map cannot contain
// a regular grid: at any zoom the joints line up into a lattice stretching to
// the horizon, and no amount of macro variation hides it. Organic noise has no
// such failure mode -- it tiles invisibly because there is no pattern to line
// up. Rockcrete comes back later as a building apron, where it covers a few
// tiles and the grid is an asset rather than a liability.
// ---------------------------------------------------------------------------

function ashfield() {
  const seed = 1337;

  /**
   * Crack scale, shared by the height field and the albedo.
   *
   * They have to agree or the dark line and the groove are in different places.
   * Eight rather than four: at four the cracks were large and individually
   * memorable, and a memorable shape is exactly what makes a repeat visible --
   * you recognise the same crack every twelve tiles across the whole map.
   */
  const CRACK_CELLS = 8;

  const height = buildHeight(SIZE, (x, y) => {
    // Drifts. Ash falls continuously here and piles the way snow does.
    const drift = fbm(x, y, 3, 5, seed) * 0.3;

    // Desiccation cracking, from the heat below driving the moisture out.
    // Deliberately coarse and branching rather than fine and even.
    const crackField = ridged(x, y, CRACK_CELLS, 4, seed + 11);
    const crack = smoothstep(0.6, 0.9, crackField) * 0.26;

    // Clinker fragments trodden into the surface, and the pits they leave.
    const frag = worley(x, y, 20, seed + 31);
    const lumps = smoothstep(0.34, 0.06, frag.f1) * 0.1 * smoothstep(0.45, 0.8, frag.id);
    const pit = smoothstep(0.86, 1.0, 1 - worley(x, y, 30, seed + 43).f1) * 0.07;

    // Grain, so the surface is never flat anywhere.
    const grain = fbm(x, y, 56, 3, seed + 23) * 0.04;

    return drift + lumps + grain - crack - pit;
  });

  const ao = occlusion(height, SIZE, 5);
  const broad = boxBlur(height, SIZE, 24);

  const ASH = rgb(PALETTE.ash);
  const VOID_C = rgb(PALETTE.void);
  const ROCKCRETE = rgb(PALETTE.rockcrete);
  const DUST = rgb(PALETTE.dust);
  const RUST = rgb(PALETTE.rust);
  const IRON = rgb(PALETTE.iron);

  writeAlbedo("ashfield", SIZE, (px, py) => {
    const x = px / SIZE;
    const y = py / SIZE;
    const i = py * SIZE + px;
    const h = height[i];
    const cavity = ao[i];

    // The base is ash, with the colour of the ground it buried showing through
    // where the drift is thin. Weighted toward the ash: this is a surface made
    // of what fell out of the sky, not a floor with dust on it.
    const tone = fbm(x, y, 5, 4, seed + 41);
    let colour = mix(ASH, ROCKCRETE, 0.08 + tone * 0.5);

    // Mid-scale mottling, between the drifts and the grain. Without something
    // at this scale the surface reads as clean ground with cracks drawn on it.
    const mottle = fbm(x, y, 13, 3, seed + 137);
    colour = mix(colour, mix(ROCKCRETE, DUST, 0.5), smoothstep(0.45, 0.85, mottle) * 0.3);

    // Raised drifts catch what light there is and read paler.
    const raised = smoothstep(-0.02, 0.09, h - broad[i]);
    colour = mix(colour, DUST, raised * 0.4);

    // Clinker fragments: darker, glassier, and the only hard edges here.
    const frag = worley(x, y, 20, seed + 31);
    const fragment = smoothstep(0.3, 0.05, frag.f1) * smoothstep(0.45, 0.85, frag.id);
    colour = mix(colour, mix(VOID_C, IRON, 0.4), fragment * 0.8);

    // Cracks, dark all the way down.
    const crack = smoothstep(0.6, 0.92, ridged(x, y, CRACK_CELLS, 4, seed + 11));
    colour = mix(colour, mix(ASH, VOID_C, 0.6), crack * 0.8);

    // Soot: large trodden-in drifts. Low frequency and high contrast, because
    // this is the surface's own answer to being tiled a hundred times.
    const soot = smoothstep(0.26, 0.74, fbm(x, y, 2, 5, seed + 71));
    colour = mix(colour, ASH, soot * 0.75);

    // Chemical runoff dried to a crust in the hollows.
    const pool = smoothstep(0.01, -0.05, h - broad[i]);
    const stain = smoothstep(0.52, 0.88, fbm(x, y, 6, 3, seed + 83)) * pool;
    colour = mix(colour, mix(RUST, IRON, 0.5), stain * 0.45);

    return colour;
  });

  // Gentle. This is a soft, powdery surface, and a strong normal map turns ash
  // into gravel -- which is a different material and reads as a rendering error
  // rather than as a choice.
  save("ashfield_normal", normalMap(height, SIZE, 45), SIZE);

  writeOrm("ashfield", ORM_SIZE, (px, py) => {
    const x = px / ORM_SIZE;
    const y = py / ORM_SIZE;
    const i = Math.floor(py * (SIZE / ORM_SIZE)) * SIZE + Math.floor(px * (SIZE / ORM_SIZE));
    const cavity = ao[i];

    const frag = worley(x, y, 20, seed + 31);
    const fragment = smoothstep(0.3, 0.05, frag.f1) * smoothstep(0.45, 0.85, frag.id);

    // Ash is as matte as a surface gets. The vitrified fragments in it are not,
    // and that contrast is the only specular event on the whole ground plane.
    const roughness = lerp(0.97, 0.42, fragment);
    const metalness = fragment * 0.3;

    return [lerp(0.6, 1, cavity), roughness, metalness];
  });
}

// ---------------------------------------------------------------------------
// Slag — the cliffs
//
// Vitrified furnace waste, cooled into clinker and glassy froth. Spoil heaps,
// not geology: sharp-edged, poured, and shot through with rust bleed where the
// iron content weathered out.
// ---------------------------------------------------------------------------

function slag() {
  const seed = 4242;

  const height = buildHeight(SIZE, (x, y) => {
    // Fused lumps of clinker. `f2 - f1` is the seam between two of them.
    // Twelve across rather than seven: at seven they read as cobblestones, and
    // a paved road is the one thing this must not look like.
    const lump = worley(x, y, 12, seed);
    const body = (1 - lump.f1) * 0.5 + lump.id * 0.18;
    const seam = smoothstep(0.0, 0.2, lump.f2 - lump.f1);

    // Froth: the gas bubbles that were in it when it set.
    const froth = worley(x, y, 22, seed + 13);
    const bubbles = smoothstep(0.26, 0.0, froth.f1) * 0.14;

    // Fracture planes, because it cooled too fast and split.
    const fracture = smoothstep(0.72, 0.95, ridged(x, y, 6, 3, seed + 29)) * 0.16;

    const grain = fbm(x, y, 40, 3, seed + 37) * 0.05;

    return body * seam + grain - bubbles - fracture * 0.6;
  });

  const ao = occlusion(height, SIZE, 6);

  const VOID = rgb(PALETTE.void);
  const ASH = rgb(PALETTE.ash);
  const IRON = rgb(PALETTE.iron);
  const RUST = rgb(PALETTE.rust);
  const EMBER = rgb(PALETTE.ember);
  const DUST = rgb(PALETTE.dust);

  writeAlbedo("slag", SIZE, (px, py) => {
    const x = px / SIZE;
    const y = py / SIZE;
    const i = py * SIZE + px;
    const cavity = ao[i];

    const lump = worley(x, y, 12, seed);

    // Each lump its own shade, from near-black glass to grey clinker.
    let colour = mix(VOID, IRON, 0.15 + lump.id * 0.7);

    // The seams between lumps are packed with fines and are darker still.
    colour = mix(VOID, colour, smoothstep(0.0, 0.14, lump.f2 - lump.f1));

    // Glassy faces where it cooled smooth. Darker and, in the ORM, shinier.
    const glass = smoothstep(0.5, 0.82, fbm(x, y, 11, 3, seed + 43));
    colour = mix(colour, VOID, glass * 0.7);

    // Rust bleed. It runs downward, so the streaks are stretched along y -- the
    // one direction-dependent feature in either surface, and the reason the
    // cliff geometry must not rotate this texture off the vertical.
    // Occasional, and only on lumps with the iron in them to bleed. At the
    // first pass this covered half the surface and the cliffs came out tan.
    const bleed = smoothstep(0.66, 0.92, fbm(x, y * 0.25, 9, 4, seed + 59));
    const bleedMask = bleed * smoothstep(0.55, 0.9, lump.id);
    colour = mix(colour, RUST, bleedMask * 0.45);

    // Heat still in it, deep in the cracks. Sparing: `ember` is the key light's
    // own colour, and a surface that emits it everywhere stops reading as rock.
    const heat = smoothstep(0.35, 0.0, cavity) * smoothstep(0.55, 0.9, fbm(x, y, 5, 3, seed + 61));
    colour = mix(colour, EMBER, heat * 0.32);

    // And ash on every ledge, as everywhere else.
    const ledge = smoothstep(0.62, 0.95, cavity) * fbm(x, y, 17, 3, seed + 73);
    colour = mix(colour, mix(DUST, ASH, 0.4), ledge * 0.4);

    return colour;
  });

  save("slag_normal", normalMap(height, SIZE, 130), SIZE);

  writeOrm("slag", ORM_SIZE, (px, py) => {
    const x = px / ORM_SIZE;
    const y = py / ORM_SIZE;
    const i = Math.floor(py * (SIZE / ORM_SIZE)) * SIZE + Math.floor(px * (SIZE / ORM_SIZE));
    const cavity = ao[i];

    const glass = smoothstep(0.5, 0.82, fbm(x, y, 11, 3, seed + 43));
    const bleed = smoothstep(0.66, 0.92, fbm(x, y * 0.25, 9, 4, seed + 59));

    // Vitrified faces are glassy; weathered clinker and rust are not.
    const roughness = clamp01(lerp(0.88, 0.22, glass) + bleed * 0.3);
    // Slag is mostly silicate, but the bleed is iron that never left.
    const metalness = bleed * 0.45;

    return [lerp(0.35, 1, cavity), roughness, metalness];
  });
}

// ---------------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });
ashfield();
slag();
console.log("[rts] terrain textures written to packages/client/assets/terrain/");
