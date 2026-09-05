import { beforeAll, describe, expect, it } from "vitest";
import { entityIndex } from "./entities.js";
import { enableDevChecks } from "./fixed.js";
import { buildScenarioWorld, runDeterminismScenario, scenarioCommands } from "./scenario.js";
import { START_ALLOY } from "./players.js";
import { FX_DEPOT, FX_SOLDIER } from "./fixture-types.js";

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
    // pass on any two runtimes while proving nothing. This is the guard against
    // the fixture quietly decaying into a no-op as the simulation changes
    // around it -- which would leave the cross-runtime check still green and
    // still reported as passing, while testing almost nothing.
    const result = runDeterminismScenario();
    expect(result.ticks).toBe(600);
    expect(result.hashes.length).toBe(12);
    // Consecutive samples must differ, i.e. the world kept changing throughout.
    expect(new Set(result.hashes).size).toBe(result.hashes.length);
  });

  it("actually runs every system it claims to cover", () => {
    const { world, actors } = buildScenarioWorld(64);
    const startingUnits = actors.armies[0].length + actors.armies[1].length;

    for (let t = 0; t < 600; t++) world.step(scenarioCommands(actors, t, 64));

    const e = world.entities;
    let survivors = 0;
    let depotFinished = false;
    for (let i = 0; i < e.highWater; i++) {
      if (e.alive[i] !== 1) continue;
      if (e.typeId[i] === FX_SOLDIER) survivors++;
      if (e.typeId[i] === FX_DEPOT && e.buildRemaining[i] === 0) depotFinished = true;
    }

    // Combat resolved: units died, and not all of them.
    expect(survivors).toBeLessThan(startingUnits);
    expect(survivors).toBeGreaterThan(0);
    // The economy ran a full round trip.
    expect(world.players.alloy[0]).not.toBe(START_ALLOY);
    // Construction completed, which also means the grid mutated mid-run and the
    // flow-field cache was invalidated under load.
    expect(depotFinished).toBe(true);
    // Production delivered.
    expect(e.queueLen[entityIndex(actors.nexus)]).toBe(0);
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
    // browser AT THE SAME COMMIT; see scripts/determinism-trace.mjs.
    const result = runDeterminismScenario();
    const trace = result.hashes.map((h) => h.toString(16).padStart(8, "0")).join(" ");

    console.log(`[determinism] final=${result.finalHash.toString(16)} trace=${trace}`);
    expect(result.finalHash).toBeGreaterThan(0);
  });
});
