/**
 * Deterministic state hashing.
 *
 * This is the desync detector. Each peer hashes its whole world every N ticks
 * and sends the result to the arbiter; a mismatch means two players are playing
 * different games and the divergence is caught within a second or so rather
 * than compounding silently until the match is unrecoverable.
 *
 * FNV-1a over 32-bit words. Not cryptographic and not meant to be -- it only
 * has to catch accidental divergence, be fast enough to run every tick over a
 * few hundred kilobytes of typed arrays, and produce identical output on every
 * engine. `Math.imul` is exactly specified by ECMA-262, so it qualifies.
 */

const FNV_OFFSET = 0x811c9dc5 | 0;
const FNV_PRIME = 0x01000193;

/** Start a hash. */
export function hashInit(): number {
  return FNV_OFFSET;
}

/**
 * Mix one 32-bit value into a hash.
 *
 * `| 0` on the input canonicalises -0 to +0. Without it a stray negative zero
 * would hash differently from positive zero despite representing the same
 * gameplay state, producing a phantom desync between peers that actually agree.
 */
export function hashNumber(h: number, value: number): number {
  return Math.imul(h ^ (value | 0), FNV_PRIME);
}

/** Mix an entire typed array into a hash, in index order. */
export function hashArray(
  h: number,
  array: Int32Array | Uint8Array | Uint16Array | Uint32Array | Int8Array | Int16Array,
): number {
  let acc = h;
  for (let i = 0; i < array.length; i++) {
    acc = Math.imul(acc ^ (array[i] | 0), FNV_PRIME);
  }
  return acc;
}

/**
 * Mix the first `length` entries of a typed array.
 *
 * Prefer this over `hashArray` when a store is allocated at full capacity but
 * only partly used -- hashing unused tail slots is wasted work, though it is
 * harmless as long as they are deterministically zeroed.
 */
export function hashArrayPrefix(
  h: number,
  array: Int32Array | Uint8Array | Uint16Array | Uint32Array | Int8Array | Int16Array,
  length: number,
): number {
  let acc = h;
  const n = Math.min(length, array.length);
  for (let i = 0; i < n; i++) {
    acc = Math.imul(acc ^ (array[i] | 0), FNV_PRIME);
  }
  return acc;
}

/** Finalise a hash to an unsigned 32-bit value, for display and comparison. */
export function hashFinish(h: number): number {
  return h >>> 0;
}

/** Render a hash as fixed-width hex, for logs and desync reports. */
export function hashToString(h: number): string {
  return (h >>> 0).toString(16).padStart(8, "0");
}
