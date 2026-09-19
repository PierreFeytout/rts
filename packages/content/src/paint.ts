/**
 * The paint layer: which of a map's terrain surfaces each tile is drawn in.
 *
 * Purely presentation -- nothing in the simulation reads it -- but it is map
 * content all the same, so it lives in the map file and is folded into the
 * content hash like everything else there: two peers who picked the same map
 * and see different ground have different maps, whatever the pathfinder
 * thinks.
 *
 * WHY RUNS OF LETTERS
 * -------------------
 * One entry per tile is unavoidable here, unlike for blocked terrain (see
 * map-schema.ts): paint is the freeform tile layer the editor writes, and a
 * rectangle list cannot hold a ragged patch of crust. As a JSON array a
 * 1024-tile map would be two million characters of mostly repeated digits.
 * Run-length encoded it is a fraction of that, still a diff a person can
 * read ("312a4c" is 312 tiles of the first surface then 4 of the third), and
 * decodes in one pass with no dependency.
 *
 * A run is an optional decimal count -- omitted when it is one -- followed
 * by a letter naming the layer, `a` for the first of the map's `layers`.
 * Runs are written row by row from the top-left, with no separator between
 * rows: the tile count is the map's size squared and nothing else, so a row
 * boundary carries no information the length does not.
 */

/**
 * The most surfaces one map can paint.
 *
 * The ground shader blends the first surface with up to four others, whose
 * weights are the four channels of one control texture -- see
 * packages/client/src/splat-material.ts. Five is what that costs nothing
 * extra to support; a sixth would need a second texture and a second set of
 * lookups for every fragment of ground on screen.
 */
export const MAX_PAINT_LAYERS = 5;

const FIRST_LETTER = 97; // 'a'

/** What a well-formed paint string looks like: runs of a count and a letter. */
export const PAINT_PATTERN = /^(?:(?:[1-9]\d*)?[a-z])+$/;

/** Encode one layer index per tile, row-major, into the run-length form. */
export function encodePaint(paint: Uint8Array): string {
  let out = "";
  let i = 0;
  while (i < paint.length) {
    const layer = paint[i];
    let n = 1;
    while (i + n < paint.length && paint[i + n] === layer) n++;
    out += (n > 1 ? String(n) : "") + String.fromCharCode(FIRST_LETTER + layer);
    i += n;
  }
  return out;
}

/**
 * Decode a paint string for a map of `tiles` tiles with `layers` surfaces.
 *
 * Exact: a string that covers too few tiles, too many, or names a layer the
 * map does not have is an error naming the map, not a map with a hole in it.
 */
export function decodePaint(text: string, tiles: number, layers: number, where: string): Uint8Array {
  const out = new Uint8Array(tiles);
  let at = 0;
  let count = 0;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 48 && code <= 57) {
      count = count * 10 + (code - 48);
      continue;
    }
    const layer = code - FIRST_LETTER;
    if (layer < 0 || layer >= layers) {
      throw new Error(
        `content: ${where} paint names layer '${String.fromCharCode(code)}' but the map has ${layers}`,
      );
    }
    const n = count === 0 ? 1 : count;
    count = 0;
    if (at + n > tiles) {
      throw new Error(`content: ${where} paint covers more than its ${tiles} tiles`);
    }
    out.fill(layer, at, at + n);
    at += n;
  }

  if (count !== 0) throw new Error(`content: ${where} paint ends in a count with no layer`);
  if (at !== tiles) throw new Error(`content: ${where} paint covers ${at} tiles, not ${tiles}`);
  return out;
}
