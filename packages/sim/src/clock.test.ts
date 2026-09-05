import { describe, expect, it } from "vitest";
import { TICK_MS, TickClock } from "./clock.js";

describe("TickClock", () => {
  it("runs one tick per tickMs of elapsed time", () => {
    const c = new TickClock();
    expect(c.advance(TICK_MS)).toBe(1);
    expect(c.advance(TICK_MS)).toBe(1);
    expect(c.tick).toBe(2);
  });

  it("accumulates partial time instead of losing it", () => {
    const c = new TickClock();
    // Three 20 ms frames add up to 60 ms, which is one 50 ms tick plus a remainder.
    expect(c.advance(20)).toBe(0);
    expect(c.advance(20)).toBe(0);
    expect(c.advance(20)).toBe(1);
    expect(c.tick).toBe(1);
    expect(c.alpha).toBeCloseTo(10 / TICK_MS, 10);
  });

  it("runs multiple ticks for a long frame", () => {
    const c = new TickClock();
    expect(c.advance(TICK_MS * 3)).toBe(3);
    expect(c.tick).toBe(3);
  });

  it("does not accumulate drift at an awkward frame rate", () => {
    // 144 Hz against a 20 Hz sim: the frame time never divides the tick evenly,
    // and 1000/144 is not exactly representable in float64, so each addition
    // carries a tiny error. What matters is that the error stays BOUNDED rather
    // than compounding -- the accumulator is kept in [0, tickMs), so it does.
    // A tick that lands a hair late simply fires on the following frame.
    const frameMs = 1000 / 144;
    const run = (seconds: number): number => {
      const c = new TickClock();
      const frames = Math.round(seconds * 144);
      let total = 0;
      for (let i = 0; i < frames; i++) total += c.advance(frameMs);
      return total;
    };

    // Error must not scale with duration. Ten seconds and a thousand seconds
    // should both land within a tick of the ideal count.
    expect(Math.abs(run(10) - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(run(100) - 2000)).toBeLessThanOrEqual(1);
    expect(Math.abs(run(1000) - 20000)).toBeLessThanOrEqual(1);
  });

  it("caps runaway frames to break the spiral of death", () => {
    const c = new TickClock();
    // A 10 second stall would otherwise demand 200 ticks in one frame.
    expect(c.advance(10000)).toBe(5);
    expect(c.dropped).toBe(195);
  });

  it("clears the backlog when capping, rather than deferring it", () => {
    // If the accumulator kept the excess, the very next frame would cap again
    // and the sim would never catch up.
    const c = new TickClock();
    c.advance(10000);
    expect(c.advance(TICK_MS)).toBe(1);
    expect(c.advance(TICK_MS)).toBe(1);
  });

  it("ignores zero, negative and non-finite deltas", () => {
    // Clock adjustments and the first frame after a tab restore can produce these.
    const c = new TickClock();
    expect(c.advance(0)).toBe(0);
    expect(c.advance(-100)).toBe(0);
    expect(c.advance(NaN)).toBe(0);
    expect(c.tick).toBe(0);
    expect(c.alpha).toBe(0);
  });

  it("keeps alpha in [0, 1)", () => {
    const c = new TickClock();
    for (let i = 0; i < 500; i++) {
      c.advance(7.3);
      expect(c.alpha).toBeGreaterThanOrEqual(0);
      expect(c.alpha).toBeLessThan(1);
    }
  });

  it("resets", () => {
    const c = new TickClock();
    c.advance(1000);
    c.reset();
    expect(c.tick).toBe(0);
    expect(c.alpha).toBe(0);
    expect(c.dropped).toBe(0);
  });
});
