/**
 * Tileable noise, for texture generation.
 *
 * Everything here takes coordinates in **image space** — `x` and `y` in [0, 1)
 * across the texture — and a `cells` count saying how many lattice cells span
 * that range. Lattice indices are taken modulo `cells`, which is the whole
 * trick: the noise wraps exactly at the texture edge, so the result tiles
 * without a seam. A generator that forgets this produces a texture with a
 * visible grid across the entire map, and it is not obvious until it is on
 * screen at a thousand tiles.
 *
 * Integer hashing rather than a permutation table, so nothing has to be
 * allocated or shuffled and a seed is just another input.
 */

/** Deterministic hash of two lattice coordinates and a seed, in [0, 1). */
function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1274126177) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177) | 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** Hermite interpolation, which is what keeps value noise from looking boxy. */
function smooth(t) {
  return t * t * (3 - 2 * t);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function smoothstep(edge0, edge1, v) {
  return smooth(clamp01((v - edge0) / (edge1 - edge0)));
}

/** Value noise in [0, 1), tiling every `cells` units. */
export function noise2(x, y, cells, seed) {
  const fx = x * cells;
  const fy = y * cells;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = smooth(fx - ix);
  const ty = smooth(fy - iy);

  // Modulo on the lattice, not on the coordinate: this is what wraps.
  const x0 = ((ix % cells) + cells) % cells;
  const y0 = ((iy % cells) + cells) % cells;
  const x1 = (x0 + 1) % cells;
  const y1 = (y0 + 1) % cells;

  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);

  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

/** Sum of octaves. `cells` is the frequency of the first and coarsest one. */
export function fbm(x, y, cells, octaves, seed, gain = 0.5) {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let frequency = cells;

  for (let o = 0; o < octaves; o++) {
    sum += noise2(x, y, frequency, seed + o * 101) * amplitude;
    total += amplitude;
    amplitude *= gain;
    frequency *= 2;
  }
  return sum / total;
}

/**
 * Ridged noise: creases where plain noise would have a gentle midpoint.
 *
 * Folding the signal at 0.5 and inverting turns the smooth middle of each
 * octave into a sharp line, which is what a crack is. Squaring sharpens it
 * further and keeps the flat areas flat.
 */
export function ridged(x, y, cells, octaves, seed) {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let frequency = cells;

  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(noise2(x, y, frequency, seed + o * 311) * 2 - 1);
    sum += n * n * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / total;
}

/**
 * Cellular (Worley) noise: distance to the nearest scattered feature point.
 *
 * One point per lattice cell, jittered. Returns `{ f1, f2, id }` — the nearest
 * distance, the second nearest, and a stable per-cell value. `f2 - f1` is the
 * classic edge detector, which is how a field of fused clinker gets its seams,
 * and `id` is what gives each lump its own shade.
 */
export function worley(x, y, cells, seed) {
  const fx = x * cells;
  const fy = y * cells;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);

  let f1 = Infinity;
  let f2 = Infinity;
  let id = 0;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx;
      const cy = iy + dy;
      const wx = ((cx % cells) + cells) % cells;
      const wy = ((cy % cells) + cells) % cells;

      // The point's offset comes from the wrapped cell, its position from the
      // unwrapped one -- otherwise the distance is computed across the seam.
      const px = cx + hash2(wx, wy, seed);
      const py = cy + hash2(wx, wy, seed + 7919);
      const d = Math.hypot(px - fx, py - fy);

      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash2(wx, wy, seed + 104729);
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return { f1, f2, id };
}

/**
 * A seeded generator for one-off choices — where a stain goes, how many.
 *
 * xorshift32, the same one the simulation uses. Not for per-pixel work, which
 * must be a pure function of position so that it tiles.
 */
export function rng(seed) {
  let state = seed | 0;
  if (state === 0) state = 1;
  return () => {
    state ^= state << 13;
    state |= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state |= 0;
    return (state >>> 0) / 4294967296;
  };
}
