/**
 * Deterministic pseudo-random number generator.
 *
 * `Math.random` is banned in the simulation: it is seeded unpredictably and
 * differs per peer, so a single call would desync a match instantly. Every
 * random choice the sim makes -- scatter on projectile spread, tie-breaking,
 * map generation -- goes through here instead.
 *
 * The generator's `state` is part of the world state and is included in the
 * tick hash, so a peer that consumed a different number of random values than
 * its neighbours is detected within the next hash interval rather than drifting
 * silently.
 */

/** xorshift32. Period 2^32 - 1, one multiply-free step, ample for game use. */
export class Rng {
  /** Current generator state. Never 0 -- that is xorshift's fixed point. */
  state: number;

  constructor(seed: number) {
    // 0 would lock the generator at 0 forever, so remap it to an arbitrary
    // non-zero constant rather than silently producing a dead sequence.
    this.state = (seed | 0) === 0 ? 0x1a2b3c4d : seed | 0;
  }

  /** Next raw 32-bit signed value. */
  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x | 0;
    return this.state;
  }

  /** Next value as an unsigned 32-bit integer. */
  nextUint(): number {
    return this.next() >>> 0;
  }

  /**
   * Uniform integer in [0, bound).
   *
   * Uses rejection sampling rather than a modulo, because `% bound` biases
   * toward low values when `bound` does not divide 2^32. In lockstep that bias
   * would be identical on every peer -- so not a desync -- but it would still
   * be a real gameplay bug, e.g. skewed projectile spread.
   */
  nextBelow(bound: number): number {
    if (bound <= 1) return 0;
    const limit = Math.floor(0x100000000 / bound) * bound;
    let v = this.nextUint();
    while (v >= limit) v = this.nextUint();
    return v % bound;
  }

  /** Uniform integer in [min, max] inclusive. */
  nextRange(min: number, max: number): number {
    return min + this.nextBelow(max - min + 1);
  }

  /** Snapshot for save/replay. */
  clone(): Rng {
    return new Rng(this.state);
  }
}
