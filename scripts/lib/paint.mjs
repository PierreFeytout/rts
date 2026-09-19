/**
 * The paint layer's run-length form, for the map generator.
 *
 * The same encoding as packages/content/src/paint.ts, which is the one the
 * game reads with and the one that documents it; this copy exists because the
 * generator runs before the workspace is built. Keep them in step.
 */
export function encodePaint(paint) {
  let out = "";
  let i = 0;
  while (i < paint.length) {
    const layer = paint[i];
    let n = 1;
    while (i + n < paint.length && paint[i + n] === layer) n++;
    out += (n > 1 ? String(n) : "") + String.fromCharCode(97 + layer);
    i += n;
  }
  return out;
}
