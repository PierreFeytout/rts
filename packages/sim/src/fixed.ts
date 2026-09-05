/**
 * Q16.16 fixed-point arithmetic -- the determinism foundation of the simulation.
 *
 * WHY THIS EXISTS
 * ---------------
 * Lockstep netcode requires every peer to compute bit-identical results from
 * identical inputs. Anything else desyncs. All simulation state is therefore
 * stored as 32-bit integers with 16 fractional bits (1.0 === 65536).
 *
 * WHAT IS AND IS NOT DETERMINISTIC IN JAVASCRIPT
 * ---------------------------------------------
 * IEEE-754 mandates *correctly rounded* results for `+ - * /` and `sqrt`, and
 * ECMA-262 specifies `Math.floor`, `Math.round`, `Math.abs` and `Math.sign`
 * exactly. Every conformant engine produces identical bits for these. They are
 * safe, and this file uses float64 freely to *compute* values.
 *
 * What is NOT specified, and differs between V8 versions and between V8 and
 * SpiderMonkey, is the transcendental library: `Math.sin`, `Math.cos`,
 * `Math.tan`, `Math.atan`, `Math.atan2`, `Math.exp`, `Math.pow`, `Math.log`.
 * Those are banned outright (see eslint.config.js) and are replaced here by
 * polynomial approximations built from `+ - * /` alone.
 *
 * THE MAGNITUDE BOUND -- READ THIS BEFORE ADDING MATH
 * --------------------------------------------------
 * `mul` computes `(a * b) / 65536` in float64. That product is exact only while
 * |a * b| < 2^53, so every operand must satisfy |x| < 2^26, i.e. 1024.0 in world
 * units. A 256-tile map at 1 tile = 1.0 sits at 2^24, leaving 64x headroom.
 * `enableDevChecks()` turns this into a hard runtime assertion; the client and
 * the test suite switch it on, so violations surface immediately in development
 * rather than as a mid-match desync.
 */

export type Fx = number;

/** Number of fractional bits. */
export const FX_BITS = 16;
/** Fixed-point 1.0. */
export const FX_ONE = 1 << FX_BITS; // 65536
/** Fixed-point 0.5. */
export const FX_HALF = FX_ONE >> 1;
/** Largest permitted operand magnitude; see "THE MAGNITUDE BOUND" above. */
export const FX_MAX_OPERAND = 1 << 26;

/**
 * Angles use 16-bit binary angle measurement (BAM): a full turn is 65536 units,
 * so wrapping is `& 0xffff` -- no modulo, no negative-remainder edge cases, and
 * every possible bit pattern is a valid angle.
 */
export const ANGLE_FULL = 0x10000;
export const ANGLE_MASK = 0xffff;
export const ANGLE_QUARTER = ANGLE_FULL >> 2; // 16384
export const ANGLE_HALF = ANGLE_FULL >> 1; // 32768

/** The double nearest to pi. Written as a literal so it cannot drift. */
const PI = 3.141592653589793;

let devChecks = false;

/**
 * Enable runtime assertions on operand magnitude and division by zero.
 * Off by default so release builds pay nothing; the client and tests enable it.
 */
export function enableDevChecks(enabled: boolean): void {
  devChecks = enabled;
}

/** Largest exactly-representable integer in float64. */
const EXACT_INT_LIMIT = Number.MAX_SAFE_INTEGER; // 2^53 - 1

/**
 * Assert the *actual* exactness invariant rather than a proxy for it.
 *
 * The thing that must hold is |a * b| <= 2^53 - 1; the "both operands under
 * 2^26" rule quoted in the header is just the symmetric worst case of that.
 * Checking the product directly permits the common asymmetric cases -- scaling
 * a large value by a small one, e.g. `fxMul(x, FX_ONE)` -- which the symmetric
 * rule would reject for no reason.
 */
function checkProduct(a: number, b: number, op: string): void {
  const p = a * b;
  if (p > EXACT_INT_LIMIT || p < -EXACT_INT_LIMIT) {
    throw new RangeError(
      `fx.${op}: product ${a} * ${b} exceeds 2^53 and is no longer exact in ` +
        `float64, which would desync peers. Keep spatial operands under 2^26 ` +
        `(1024.0 world units). See "THE MAGNITUDE BOUND" in fixed.ts.`,
    );
  }
}

/** Symmetric bound, for operations that square their inputs. */
function checkSquarable(x: Fx, y: Fx, op: string): void {
  if (x >= FX_MAX_OPERAND || x <= -FX_MAX_OPERAND || y >= FX_MAX_OPERAND || y <= -FX_MAX_OPERAND) {
    throw new RangeError(
      `fx.${op}: operand exceeds the 2^26 bound (x=${x}, y=${y}). ` +
        `This operation squares its inputs, so both must stay under 2^26 ` +
        `(1024.0 world units) for x*x + y*y to remain exact.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

/** Integer -> fixed. */
export function fxFromInt(n: number): Fx {
  return (n * FX_ONE) | 0;
}

/** Fixed -> integer, rounding toward negative infinity. */
export function fxToInt(a: Fx): number {
  return a >> FX_BITS;
}

/**
 * Float -> fixed. For content loading, map authoring and tests ONLY, never in
 * the tick loop: the point of this module is that the sim holds integers.
 * `Math.round` is exactly specified, so this is deterministic at load time.
 */
export function fxFromFloat(v: number): Fx {
  const r = Math.round(v * FX_ONE);
  if (devChecks && (r >= FX_MAX_OPERAND || r <= -FX_MAX_OPERAND)) {
    throw new RangeError(`fxFromFloat: ${v} exceeds the 2^26 fixed-point bound.`);
  }
  return r | 0;
}

/** Fixed -> float. For rendering and debug output only. Exact. */
export function fxToFloat(a: Fx): number {
  return a / FX_ONE;
}

// ---------------------------------------------------------------------------
// Core arithmetic
// ---------------------------------------------------------------------------

/**
 * Multiply. Exact given the 2^26 operand bound: `a * b` is an exact integer in
 * float64, and dividing by a power of two only adjusts the exponent, so the
 * only rounding is the final `floor`.
 *
 * Rounds toward negative infinity (not toward zero) so behaviour is uniform
 * across the sign boundary.
 */
export function fxMul(a: Fx, b: Fx): Fx {
  if (devChecks) checkProduct(a, b, "mul");
  return Math.floor((a * b) / FX_ONE);
}

/**
 * Divide, rounding toward negative infinity.
 *
 * Division by zero returns 0 rather than throwing. That is a deliberate,
 * documented choice: a defined value keeps every peer on the same path, whereas
 * an exception on one machine and not another is itself a desync. `devChecks`
 * makes it loud during development.
 */
export function fxDiv(a: Fx, b: Fx): Fx {
  if (b === 0) {
    if (devChecks) throw new RangeError("fx.div: division by zero");
    return 0;
  }
  if (devChecks) checkProduct(a, FX_ONE, "div");
  return Math.floor((a * FX_ONE) / b);
}

/** Square root. Negative input yields 0. */
export function fxSqrt(a: Fx): Fx {
  if (a <= 0) return 0;
  if (devChecks) checkProduct(a, FX_ONE, "sqrt");
  // sqrt(a / 2^16) * 2^16 === sqrt(a * 2^16). Computing it in the latter form
  // keeps the argument to sqrt exact, which maximises precision.
  return Math.floor(Math.sqrt(a * FX_ONE));
}

/**
 * Squared length of a fixed-point vector, as an EXACT raw integer.
 *
 * The result is NOT Q16.16 -- it is scaled by 2^32 -- so it is only meaningful
 * when compared against another value from this function, or against
 * `r * r` for a Q16.16 radius `r`. Use it for range checks to avoid a sqrt.
 */
export function fxLengthSq(x: Fx, y: Fx): number {
  if (devChecks) checkSquarable(x, y, "lengthSq");
  return x * x + y * y;
}

/**
 * Length of a fixed-point vector.
 *
 * Computed in one step rather than as `sqrt(mul(x,x) + mul(y,y))`, which would
 * truncate 16 bits twice before the root.
 */
export function fxLength(x: Fx, y: Fx): Fx {
  if (devChecks) checkSquarable(x, y, "length");
  const d2 = x * x + y * y;
  if (d2 <= 0) return 0;
  return Math.floor(Math.sqrt(d2));
}

/** Clamp to [lo, hi]. */
export function fxClamp(a: Fx, lo: Fx, hi: Fx): Fx {
  return a < lo ? lo : a > hi ? hi : a;
}

/** Linear interpolation; `t` is Q16.16 and is NOT clamped. */
export function fxLerp(a: Fx, b: Fx, t: Fx): Fx {
  return a + fxMul(b - a, t);
}

// ---------------------------------------------------------------------------
// Trigonometry
// ---------------------------------------------------------------------------

/**
 * Quarter-turn sine table, ANGLE_QUARTER + 1 entries of Q16.16, covering
 * [0, pi/2] inclusive so that SIN_LUT[ANGLE_QUARTER] === FX_ONE exactly.
 *
 * Built at module init from a Taylor series evaluated in float64. Crucially it
 * is NOT built with `Math.sin`: that would bake an implementation-defined table
 * into each peer and desync them, which is the exact bug this module exists to
 * prevent. Taylor uses only `+ - * /`, so every engine builds an identical table.
 */
const SIN_LUT = buildSinTable();

function buildSinTable(): Int32Array {
  const table = new Int32Array(ANGLE_QUARTER + 1);
  const step = PI / 2 / ANGLE_QUARTER;
  for (let i = 0; i <= ANGLE_QUARTER; i++) {
    table[i] = Math.round(sinPoly(i * step) * FX_ONE);
  }
  return table;
}

/**
 * Taylor series for sin on [0, pi/2], terms through x^15.
 *
 * The omitted x^17 term is below 1e-16 at x = pi/2, so this is accurate to the
 * last bit of a double across the whole interval -- far finer than the 1/65536
 * we quantise to. Coefficients are reciprocals of factorials, written as exact
 * integer divisions so they are reproducible by inspection.
 */
function sinPoly(x: number): number {
  const u = x * x;
  return (
    x *
    (1 +
      u *
        (-1 / 6 +
          u *
            (1 / 120 +
              u *
                (-1 / 5040 +
                  u * (1 / 362880 + u * (-1 / 39916800 + u * (1 / 6227020800 - u / 1307674368000)))))))
  );
}

/**
 * Sine of a BAM angle. Pure table lookup; the angle is masked, so any input is valid.
 *
 * The `| 0` on the negated branches is not cosmetic: `-SIN_LUT[0]` evaluates to
 * `-0`, which is a *different* IEEE-754 bit pattern from `+0`. A negative zero
 * that reaches a state hash makes two peers holding identical gameplay state
 * report different hashes and trigger a spurious resync. `| 0` canonicalises it.
 */
export function fxSin(angle: number): Fx {
  const a = angle & ANGLE_MASK;
  const idx = a & (ANGLE_QUARTER - 1);
  switch (a >> 14) {
    case 0:
      return SIN_LUT[idx];
    case 1:
      return SIN_LUT[ANGLE_QUARTER - idx];
    case 2:
      return -SIN_LUT[idx] | 0;
    default:
      return -SIN_LUT[ANGLE_QUARTER - idx] | 0;
  }
}

/** Cosine of a BAM angle. */
export function fxCos(angle: number): Fx {
  return fxSin(angle + ANGLE_QUARTER);
}

/** Radians -> BAM. Deterministic: only a division and an exactly-specified round. */
const RAD_TO_BAM = ANGLE_FULL / (2 * PI);

/**
 * Polynomial approximation of atan on [0, 1], in radians.
 * Maximum error is about 1e-5 rad, roughly 0.1 BAM units -- well below the
 * resolution of the angle representation itself.
 */
function atanPoly(t: number): number {
  const u = t * t;
  return (
    t *
    (0.9998660411 +
      u * (-0.3302995067 + u * (0.1801410586 + u * (-0.0851330053 + u * 0.0208351046))))
  );
}

/**
 * atan2 returning a BAM angle, measured counter-clockwise from +x.
 * Reduces to the [0, 1] ratio before applying the polynomial, then fixes up
 * the octant, so accuracy is uniform around the circle.
 */
export function fxAtan2(y: Fx, x: Fx): number {
  if (x === 0 && y === 0) return 0;

  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;

  let r: number;
  if (ax >= ay) {
    r = atanPoly(ay / ax);
  } else {
    r = PI / 2 - atanPoly(ax / ay);
  }

  if (x < 0) r = PI - r;
  if (y < 0) r = -r;

  return Math.round(r * RAD_TO_BAM) & ANGLE_MASK;
}

/**
 * Shortest signed delta from `from` to `to`, in [-32768, 32767].
 * Use this for turn-rate limiting so units rotate the short way around.
 */
export function fxAngleDelta(from: number, to: number): number {
  return (((to - from) & ANGLE_MASK) ^ ANGLE_HALF) - ANGLE_HALF;
}
