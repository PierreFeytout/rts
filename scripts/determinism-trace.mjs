/**
 * Print the determinism fixture's hash trace.
 *
 * Run this in Node and compare against the same fixture executed in a browser
 * (see README, "Cross-runtime determinism check"). Matching traces mean the
 * simulation produces bit-identical results on both engines, which is the
 * property lockstep depends on and the one that unit tests inside a single
 * process cannot demonstrate.
 *
 * Requires a build first: `npm run build`.
 */
import { runDeterminismScenario } from "../packages/sim/dist/index.js";

const result = runDeterminismScenario();

console.log(
  JSON.stringify(
    {
      runtime: `node ${process.version}`,
      ticks: result.ticks,
      units: result.unitCount,
      finalHash: result.finalHash.toString(16).padStart(8, "0"),
      trace: result.hashes.map((h) => h.toString(16).padStart(8, "0")),
    },
    null,
    2,
  ),
);
