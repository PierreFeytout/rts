import { deflateSync } from "node:zlib";

/**
 * A minimal PNG encoder.
 *
 * Eight-bit RGB or RGBA, no interlacing, no palette — which is the whole of
 * what a texture generator needs. Written out rather than pulled in because the job is
 * a zlib stream inside four length-prefixed chunks, `node:zlib` is built in,
 * and the alternative is a dependency in the build path of a game that
 * deliberately has almost none.
 *
 * Deterministic: the same pixels always produce the same file, so regenerating
 * a texture that has not changed leaves the repository untouched.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, body, crc]);
}

/**
 * Choose a per-scanline filter, then apply it.
 *
 * PNG lets every row pick its own predictor, and picking well is most of the
 * compression on noisy image data — the difference between a 700 kB texture and
 * a 300 kB one. The heuristic is the one the PNG specification itself suggests:
 * try each filter and keep whichever produces the smallest sum of absolute
 * signed values, on the grounds that small residuals deflate better.
 */
function filterRow(row, previous, bpp, out) {
  const n = row.length;
  const candidates = [];

  // 0 — None.
  const none = Buffer.alloc(n);
  row.copy(none);
  candidates.push([0, none]);

  // 1 — Sub: difference from the pixel to the left.
  const sub = Buffer.alloc(n);
  for (let i = 0; i < n; i++) sub[i] = (row[i] - (i >= bpp ? row[i - bpp] : 0)) & 0xff;
  candidates.push([1, sub]);

  // 2 — Up: difference from the pixel above.
  const up = Buffer.alloc(n);
  for (let i = 0; i < n; i++) up[i] = (row[i] - previous[i]) & 0xff;
  candidates.push([2, up]);

  // 4 — Paeth: difference from whichever neighbour predicts best.
  const paeth = Buffer.alloc(n);
  for (let i = 0; i < n; i++) {
    const a = i >= bpp ? row[i - bpp] : 0;
    const b = previous[i];
    const c = i >= bpp ? previous[i - bpp] : 0;
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    paeth[i] = (row[i] - predictor) & 0xff;
  }
  candidates.push([4, paeth]);

  let best = candidates[0];
  let bestScore = Infinity;
  for (const candidate of candidates) {
    let score = 0;
    const bytes = candidate[1];
    // Signed magnitude: a byte of 255 is a residual of -1, which compresses as
    // well as +1 and must not be scored as though it were large.
    for (let i = 0; i < n; i++) score += bytes[i] < 128 ? bytes[i] : 256 - bytes[i];
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  out.push(Buffer.from([best[0]]), best[1]);
}

/**
 * Encode an RGB or RGBA image.
 *
 * `pixels` is `width * height * channels` bytes, row-major from the top left.
 * Four channels is for data, not transparency: the terrain generator packs a
 * height into a normal map's alpha and a glow mask into an ORM's, where a
 * viewer showing them as see-through costs nothing and a fourth file would.
 */
export function encodePng(pixels, width, height, channels = 3) {
  const bpp = channels;
  const stride = width * bpp;

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 4 ? 6 : 2; // colour type: truecolour, with alpha or without
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const rows = [];
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const row = Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride);
    filterRow(row, previous, bpp, rows);
    previous = row;
  }

  // Level 9: this runs once at build time and the output is committed, so the
  // only thing worth optimising for is the size of the file in the repository.
  const idat = deflateSync(Buffer.concat(rows), { level: 9 });

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
