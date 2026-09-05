import { beforeAll, describe, expect, it } from "vitest";
import {
  ANGLE_FULL,
  ANGLE_HALF,
  ANGLE_QUARTER,
  FX_MAX_OPERAND,
  FX_ONE,
  enableDevChecks,
  fxAngleDelta,
  fxAtan2,
  fxClamp,
  fxCos,
  fxDiv,
  fxFromFloat,
  fxFromInt,
  fxLength,
  fxLengthSq,
  fxLerp,
  fxMul,
  fxSin,
  fxSqrt,
  fxToFloat,
  fxToInt,
} from "./fixed.js";

beforeAll(() => {
  enableDevChecks(true);
});

/** Tolerance in Q16.16 units. 1 == the smallest representable step. */
function expectClose(actual: number, expected: number, tolerance: number, label: string): void {
  const diff = Math.abs(actual - expected);
  expect(diff, `${label}: got ${actual}, expected ~${expected} (diff ${diff})`).toBeLessThanOrEqual(
    tolerance,
  );
}

describe("conversions", () => {
  it("round-trips integers", () => {
    for (const n of [0, 1, -1, 42, -42, 1000, -1000]) {
      expect(fxToInt(fxFromInt(n))).toBe(n);
    }
  });

  it("round-trips floats within one LSB", () => {
    for (const v of [0, 0.5, -0.5, 1.25, -1.25, 3.14159, -100.001, 255.5]) {
      expectClose(fxToFloat(fxFromFloat(v)) * FX_ONE, v * FX_ONE, 1, `round-trip ${v}`);
    }
  });

  it("fxToInt floors toward negative infinity", () => {
    // Uniform behaviour across zero matters: truncation-toward-zero would make
    // a unit at x=-0.5 and one at x=+0.5 land in tiles an inconsistent distance apart.
    expect(fxToInt(fxFromFloat(1.75))).toBe(1);
    expect(fxToInt(fxFromFloat(-1.75))).toBe(-2);
  });
});

describe("fxMul", () => {
  it("computes known products", () => {
    expect(fxMul(fxFromInt(3), fxFromInt(4))).toBe(fxFromInt(12));
    expect(fxMul(fxFromFloat(0.5), fxFromFloat(0.5))).toBe(fxFromFloat(0.25));
    expect(fxMul(fxFromInt(-3), fxFromInt(4))).toBe(fxFromInt(-12));
    expect(fxMul(fxFromInt(0), fxFromInt(9999))).toBe(0);
  });

  it("is exact at the identity", () => {
    for (const v of [1, -1, 7, -7, 1234, -1234]) {
      expect(fxMul(fxFromInt(v), FX_ONE)).toBe(fxFromInt(v));
    }
  });

  it("throws once the product would exceed 2^53", () => {
    // This is the guard rail for the exactness argument in fixed.ts. If it ever
    // stops throwing, products can exceed 2^53 and silently lose bits.
    const big = 1 << 27; // 2^27; 2^27 * 2^27 === 2^54, past the exact range
    expect(() => fxMul(big, big)).toThrow(RangeError);
    expect(() => fxMul(-big, big)).toThrow(RangeError);
  });

  it("permits asymmetric operands whose product is still exact", () => {
    // Scaling a large value by a small one is safe and must not be rejected:
    // the invariant is on the product, not on either operand alone.
    const big = FX_MAX_OPERAND * 16; // 2^30, far past the symmetric bound
    expect(() => fxMul(big, FX_ONE)).not.toThrow();
    expect(fxMul(big, FX_ONE)).toBe(big);
  });

  it("stays exact at the symmetric bound", () => {
    const a = FX_MAX_OPERAND - 1;
    expect(fxMul(a, FX_ONE)).toBe(a);
  });
});

describe("fxDiv", () => {
  it("computes known quotients", () => {
    expect(fxDiv(fxFromInt(12), fxFromInt(4))).toBe(fxFromInt(3));
    expect(fxDiv(fxFromInt(1), fxFromInt(2))).toBe(fxFromFloat(0.5));
    expect(fxDiv(fxFromInt(-12), fxFromInt(4))).toBe(fxFromInt(-3));
  });

  it("inverts fxMul within rounding error", () => {
    for (const [a, b] of [
      [7, 3],
      [100, 7],
      [-55, 6],
    ] as const) {
      const fa = fxFromInt(a);
      const fb = fxFromInt(b);
      expectClose(fxMul(fxDiv(fa, fb), fb), fa, 4, `${a}/${b}*${b}`);
    }
  });

  it("throws on divide by zero when dev checks are on", () => {
    expect(() => fxDiv(FX_ONE, 0)).toThrow(RangeError);
  });

  it("returns 0 on divide by zero when dev checks are off", () => {
    // Release builds must return a defined value rather than throwing, so that
    // one peer cannot take a different code path from another.
    enableDevChecks(false);
    try {
      expect(fxDiv(FX_ONE, 0)).toBe(0);
    } finally {
      enableDevChecks(true);
    }
  });
});

describe("fxSqrt / fxLength", () => {
  it("computes known roots", () => {
    expect(fxSqrt(fxFromInt(4))).toBe(fxFromInt(2));
    expect(fxSqrt(fxFromInt(9))).toBe(fxFromInt(3));
    expect(fxSqrt(fxFromInt(0))).toBe(0);
    expect(fxSqrt(FX_ONE)).toBe(FX_ONE);
  });

  it("returns 0 for negative input", () => {
    expect(fxSqrt(fxFromInt(-5))).toBe(0);
  });

  it("approximates irrational roots", () => {
    expectClose(fxToFloat(fxSqrt(fxFromInt(2))) * 1e6, 1.41421356 * 1e6, 20, "sqrt(2)");
  });

  it("computes 3-4-5 triangles exactly", () => {
    expect(fxLength(fxFromInt(3), fxFromInt(4))).toBe(fxFromInt(5));
    expect(fxLength(fxFromInt(-3), fxFromInt(-4))).toBe(fxFromInt(5));
  });

  it("beats naive sqrt(mul+mul) on precision", () => {
    // fxLength avoids two 16-bit truncations before the root. Verify it really
    // is at least as close to the true value as the naive composition.
    const x = fxFromFloat(0.001);
    const y = fxFromFloat(0.001);
    const naive = fxSqrt(fxMul(x, x) + fxMul(y, y));
    const direct = fxLength(x, y);
    const truth = Math.sqrt(2) * 0.001 * FX_ONE;
    expect(Math.abs(direct - truth)).toBeLessThanOrEqual(Math.abs(naive - truth));
  });

  it("fxLengthSq is exact and comparable against a squared radius", () => {
    const dx = fxFromInt(3);
    const dy = fxFromInt(4);
    const radius = fxFromInt(5);
    expect(fxLengthSq(dx, dy)).toBe(radius * radius);
    expect(fxLengthSq(dx, dy) < fxFromInt(6) * fxFromInt(6)).toBe(true);
  });
});

describe("trigonometry", () => {
  it("hits exact values at the cardinal angles", () => {
    expect(fxSin(0)).toBe(0);
    expect(fxSin(ANGLE_QUARTER)).toBe(FX_ONE);
    expect(fxSin(ANGLE_HALF)).toBe(0);
    expect(fxSin(ANGLE_QUARTER * 3)).toBe(-FX_ONE);
    expect(fxCos(0)).toBe(FX_ONE);
    expect(fxCos(ANGLE_QUARTER)).toBe(0);
    expect(fxCos(ANGLE_HALF)).toBe(-FX_ONE);
  });

  it("never returns negative zero", () => {
    // -0 and +0 are distinct bit patterns. If one leaks into the state hash,
    // two peers with identical gameplay state report different hashes and the
    // arbiter forces a pointless resync. `toBe` uses Object.is, so it catches this.
    expect(fxSin(ANGLE_HALF)).toBe(0);
    expect(fxCos(ANGLE_QUARTER)).toBe(0);
    for (let a = 0; a < ANGLE_FULL; a += 1) {
      if (fxSin(a) === 0) expect(Object.is(fxSin(a), -0)).toBe(false);
      if (fxCos(a) === 0) expect(Object.is(fxCos(a), -0)).toBe(false);
    }
  });

  it("matches Math.sin across the full circle", () => {
    // Math.sin is banned inside the sim but is the right oracle in a test.
    let worst = 0;
    for (let a = 0; a < ANGLE_FULL; a += 7) {
      const expected = Math.sin((a / ANGLE_FULL) * 2 * Math.PI) * FX_ONE;
      worst = Math.max(worst, Math.abs(fxSin(a) - expected));
    }
    expect(worst, `worst sin error ${worst} LSB`).toBeLessThanOrEqual(2);
  });

  it("matches Math.cos across the full circle", () => {
    let worst = 0;
    for (let a = 0; a < ANGLE_FULL; a += 7) {
      const expected = Math.cos((a / ANGLE_FULL) * 2 * Math.PI) * FX_ONE;
      worst = Math.max(worst, Math.abs(fxCos(a) - expected));
    }
    expect(worst, `worst cos error ${worst} LSB`).toBeLessThanOrEqual(2);
  });

  it("wraps angles rather than rejecting them", () => {
    expect(fxSin(ANGLE_FULL)).toBe(fxSin(0));
    expect(fxSin(-ANGLE_QUARTER)).toBe(fxSin(ANGLE_QUARTER * 3));
    expect(fxSin(ANGLE_FULL * 5 + 123)).toBe(fxSin(123));
  });

  it("satisfies the Pythagorean identity", () => {
    for (let a = 0; a < ANGLE_FULL; a += 337) {
      const s = fxSin(a);
      const c = fxCos(a);
      expectClose(fxMul(s, s) + fxMul(c, c), FX_ONE, 4, `sin^2+cos^2 at ${a}`);
    }
  });
});

describe("fxAtan2", () => {
  it("returns the cardinal directions", () => {
    expect(fxAtan2(0, FX_ONE)).toBe(0);
    expect(fxAtan2(FX_ONE, 0)).toBe(ANGLE_QUARTER);
    expect(fxAtan2(0, -FX_ONE)).toBe(ANGLE_HALF);
    expect(fxAtan2(-FX_ONE, 0)).toBe((ANGLE_QUARTER * 3) & 0xffff);
  });

  it("returns 0 at the origin instead of NaN", () => {
    expect(fxAtan2(0, 0)).toBe(0);
  });

  it("matches Math.atan2 in every octant", () => {
    let worst = 0;
    for (let a = 0; a < ANGLE_FULL; a += 11) {
      const x = fxCos(a);
      const y = fxSin(a);
      if (x === 0 && y === 0) continue;
      const got = fxAtan2(y, x);
      // Compare as a wrapped signed delta so 65535 vs 0 is a distance of 1.
      worst = Math.max(worst, Math.abs(fxAngleDelta(a, got)));
    }
    expect(worst, `worst atan2 error ${worst} BAM units`).toBeLessThanOrEqual(8);
  });

  it("round-trips through sin/cos", () => {
    for (let a = 0; a < ANGLE_FULL; a += 1013) {
      const back = fxAtan2(fxSin(a), fxCos(a));
      expect(Math.abs(fxAngleDelta(a, back))).toBeLessThanOrEqual(8);
    }
  });
});

describe("fxAngleDelta", () => {
  it("takes the short way around", () => {
    expect(fxAngleDelta(0, 0)).toBe(0);
    expect(fxAngleDelta(0, 1)).toBe(1);
    expect(fxAngleDelta(1, 0)).toBe(-1);
    // Crossing the wrap point must be a small delta, not a near-full turn.
    expect(fxAngleDelta(ANGLE_FULL - 10, 10)).toBe(20);
    expect(fxAngleDelta(10, ANGLE_FULL - 10)).toBe(-20);
  });

  it("stays within a half turn", () => {
    for (let a = 0; a < ANGLE_FULL; a += 97) {
      for (let b = 0; b < ANGLE_FULL; b += 1013) {
        const d = fxAngleDelta(a, b);
        expect(d).toBeGreaterThanOrEqual(-ANGLE_HALF);
        expect(d).toBeLessThan(ANGLE_HALF);
      }
    }
  });
});

describe("helpers", () => {
  it("clamps", () => {
    expect(fxClamp(fxFromInt(5), fxFromInt(0), fxFromInt(10))).toBe(fxFromInt(5));
    expect(fxClamp(fxFromInt(-5), fxFromInt(0), fxFromInt(10))).toBe(fxFromInt(0));
    expect(fxClamp(fxFromInt(15), fxFromInt(0), fxFromInt(10))).toBe(fxFromInt(10));
  });

  it("lerps", () => {
    const a = fxFromInt(10);
    const b = fxFromInt(20);
    expect(fxLerp(a, b, 0)).toBe(a);
    expect(fxLerp(a, b, FX_ONE)).toBe(b);
    expect(fxLerp(a, b, FX_ONE >> 1)).toBe(fxFromInt(15));
  });
});

describe("determinism properties", () => {
  it("produces identical results on repeated evaluation", () => {
    // A weak but cheap smoke test: the same sequence of operations must give
    // byte-identical output. The real cross-engine check is the Node-vs-browser
    // replay test added in M2.
    const run = (): number[] => {
      const out: number[] = [];
      let acc = fxFromFloat(1.234);
      for (let i = 0; i < 500; i++) {
        acc = fxMul(acc, fxFromFloat(1.01));
        acc = fxDiv(acc, fxFromFloat(1.005));
        acc = (acc + fxSin(i * 37) + fxCos(i * 91)) | 0;
        acc = fxClamp(acc, -FX_MAX_OPERAND + 1, FX_MAX_OPERAND - 1);
        out.push(acc);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it("keeps every sim-facing operation in integer space", () => {
    // If any of these ever returns a non-integer, fixed-point state has leaked
    // into float space and the hash will differ between peers.
    const vals = [
      fxMul(fxFromFloat(3.7), fxFromFloat(-2.1)),
      fxDiv(fxFromFloat(3.7), fxFromFloat(-2.1)),
      fxSqrt(fxFromFloat(7.3)),
      fxLength(fxFromFloat(3.3), fxFromFloat(-4.8)),
      fxSin(12345),
      fxCos(12345),
      fxAtan2(fxFromFloat(-1.5), fxFromFloat(2.5)),
      fxLerp(fxFromInt(3), fxFromInt(9), fxFromFloat(0.37)),
    ];
    for (const v of vals) {
      expect(Number.isInteger(v), `${v} is not an integer`).toBe(true);
    }
  });
});
