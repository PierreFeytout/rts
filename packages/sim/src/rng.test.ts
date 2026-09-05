import { describe, expect, it } from "vitest";
import { Rng } from "./rng.js";

describe("Rng", () => {
  it("produces the same sequence from the same seed", () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    for (let i = 0; i < 1000; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it("produces different sequences from different seeds", () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it("never gets stuck on the zero fixed point", () => {
    // 0 is xorshift's absorbing state; seeding with it would yield an endless
    // run of zeros, which would look like "randomness stopped working" mid-match.
    const r = new Rng(0);
    expect(r.state).not.toBe(0);
    for (let i = 0; i < 100; i++) {
      expect(r.next()).not.toBe(0);
    }
  });

  it("stays in int32 range", () => {
    const r = new Rng(0xdeadbeef);
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(-2147483648);
      expect(v).toBeLessThanOrEqual(2147483647);
    }
  });

  it("nextBelow respects its bound", () => {
    const r = new Rng(99);
    for (const bound of [1, 2, 3, 7, 100, 1000]) {
      for (let i = 0; i < 500; i++) {
        const v = r.nextBelow(bound);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(bound);
      }
    }
  });

  it("nextBelow(0) and nextBelow(1) are always 0 and consume nothing", () => {
    const r = new Rng(7);
    const before = r.state;
    expect(r.nextBelow(0)).toBe(0);
    expect(r.nextBelow(1)).toBe(0);
    // Consuming a value here would desync peers that took a different branch.
    expect(r.state).toBe(before);
  });

  it("nextBelow is close to uniform", () => {
    // Rejection sampling exists to avoid modulo bias; check it actually worked.
    const r = new Rng(2024);
    const buckets = new Array<number>(7).fill(0);
    const n = 70000;
    for (let i = 0; i < n; i++) buckets[r.nextBelow(7)]++;
    const expected = n / 7;
    for (const count of buckets) {
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.05);
    }
  });

  it("nextRange is inclusive at both ends", () => {
    const r = new Rng(5);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(r.nextRange(-2, 2));
    expect([...seen].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2]);
  });

  it("clone resumes the identical sequence", () => {
    const r = new Rng(777);
    for (let i = 0; i < 50; i++) r.next();
    const c = r.clone();
    expect(Array.from({ length: 50 }, () => r.next())).toEqual(
      Array.from({ length: 50 }, () => c.next()),
    );
  });
});
