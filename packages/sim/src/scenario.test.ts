import { beforeAll, describe, expect, it } from "vitest";
import { enableDevChecks } from "./fixed.js";
import { runDeterminismScenario } from "./scenario.js";

beforeAll(() => {
  enableDevChecks(true);
});

describe("determinism scenario", () => {
  it("is reproducible within a single runtime", () => {
    const a = runDeterminismScenario();
    const b = runDeterminismScenario();
    expect(b.hashes).toEqual(a.hashes);
    expect(b.finalHash).toBe(a.finalHash);
  });

  it("exercises enough of the simulation to be worth comparing", () => {
    // A fixture that finishes with every unit parked in its spawn corner would
    // pass on any two runtimes while proving nothing. Check it actually moved
    // units, built paths, and put them under crowd pressure.
    const result = runDeterminismScenario();
    expect(result.unitCount).toBeGreaterThan(100);
    expect(result.ticks).toBe(600);
    expect(result.hashes.length).toBe(12);
    // Consecutive samples must differ, i.e. the world kept changing throughout.
    expect(new Set(result.hashes).size).toBe(result.hashes.length);
  });

  it("is sensitive to a one-LSB perturbation", () => {
    const baseline = runDeterminismScenario();
    const shifted = runDeterminismScenario({ seed: 0x5ca1ab1f });
    expect(shifted.finalHash).not.toBe(baseline.finalHash);
  });

  it("prints its trace for cross-runtime comparison", () => {
    // Deliberately not asserted against a committed constant. Baked-in hashes
    // would have to be updated on every intentional balance change, and would
    // then be updated reflexively -- which is exactly how a real regression
    // gets waved through. The comparison that matters is Node against a
    // browser AT THE SAME COMMIT; see scripts/cross-runtime-check.
    const result = runDeterminismScenario();
    const trace = result.hashes.map((h) => h.toString(16).padStart(8, "0")).join(" ");
     
    console.log(`[determinism] final=${result.finalHash.toString(16)} trace=${trace}`);
    expect(result.finalHash).toBeGreaterThan(0);
  });
});
