import { describe, expect, it } from "vitest";
import { DEFAULTS, RANGES, parseSettings } from "./settings.js";

describe("parseSettings", () => {
  it("gives defaults for nothing stored", () => {
    expect(parseSettings(null)).toEqual(DEFAULTS);
    expect(parseSettings("not settings")).toEqual(DEFAULTS);
    expect(parseSettings([])).toEqual(DEFAULTS);
  });

  it("keeps what is stored", () => {
    const stored = { ...DEFAULTS, edgeScroll: true, panSpeed: 1.6, showStats: true };
    expect(parseSettings(stored)).toEqual(stored);
  });

  it("keeps the good half of a half-wrong file", () => {
    const settings = parseSettings({ edgeScroll: "yes", panSpeed: 1.5 });
    expect(settings.edgeScroll).toBe(DEFAULTS.edgeScroll);
    expect(settings.panSpeed).toBe(1.5);
  });

  it("clamps numbers to what the sliders offer", () => {
    const [min, max] = RANGES.renderScale;
    expect(parseSettings({ renderScale: 99 }).renderScale).toBe(max);
    expect(parseSettings({ renderScale: 0 }).renderScale).toBe(min);
    // A NaN would otherwise reach three.js and blank the canvas.
    expect(parseSettings({ panSpeed: Number.NaN }).panSpeed).toBe(DEFAULTS.panSpeed);
  });

  it("ignores settings it does not know", () => {
    expect(parseSettings({ ...DEFAULTS, shadows: "ultra" })).toEqual(DEFAULTS);
  });
});
