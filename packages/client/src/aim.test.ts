import { describe, expect, it } from "vitest";
import { aimFrame, aimYaw, angleBetween, turnToward } from "./aim.js";

const aim = { name: "aim", start: 100, frames: 48, duration: 1.6, loop: true };

describe("aimYaw", () => {
  it("counts anticlockwise from +X, with the simulation's +Y as Blender's -Y", () => {
    expect(aimYaw(1, 0)).toBeCloseTo(0);
    // Simulation -Y is Blender +Y: a quarter turn anticlockwise.
    expect(aimYaw(0, -1)).toBeCloseTo(Math.PI / 2);
    expect(aimYaw(0, 1)).toBeCloseTo(-Math.PI / 2);
    expect(Math.abs(aimYaw(-1, 0))).toBeCloseTo(Math.PI);
  });
});

describe("turnToward", () => {
  it("turns the short way round, and never overshoots", () => {
    expect(turnToward(0, 0.1, 0.5)).toBeCloseTo(0.1);
    expect(turnToward(0, 1, 0.25)).toBeCloseTo(0.25);
    // From just short of a full turn to just past zero is a small step forward.
    expect(turnToward(3.0, -3.0, 0.1)).toBeCloseTo(3.1);
    expect(angleBetween(3.0, -3.0)).toBeCloseTo(2 * Math.PI - 6);
  });
});

describe("aimFrame", () => {
  it("maps a full turn onto the clip, and wraps", () => {
    expect(aimFrame(aim, 0)).toBe(100);
    expect(aimFrame(aim, Math.PI / 2)).toBeCloseTo(112);
    expect(aimFrame(aim, -Math.PI / 2)).toBeCloseTo(136);
    expect(aimFrame(aim, Math.PI * 4 + 0.001)).toBeGreaterThanOrEqual(100);
    expect(aimFrame(aim, -0.0001)).toBeLessThan(148);
  });
});
