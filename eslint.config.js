import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * The rules in the `packages/sim` block below are the mechanical half of the
 * determinism guarantee. The other half is fixed.ts. Neither works alone: a
 * single `Math.random()` or `Date.now()` reaching the simulation desyncs every
 * peer, and that is precisely the kind of call that slips in during a late-night
 * bug fix. Better a lint error than a mid-match desync nobody can reproduce.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-types/**",
      "**/node_modules/**",
      ".captures/**",
      "**/*.tsbuildinfo",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-var": "error",
      "prefer-const": "error",
    },
  },

  // -------------------------------------------------------------------------
  // Determinism enforcement -- simulation source, and the content that feeds it.
  //
  // Content is included because its *output* is simulation input: a stat
  // derived from Math.random or the current date would desync a match just as
  // surely as one computed inside the sim. Content loading must be a pure
  // function of its definitions.
  // -------------------------------------------------------------------------
  {
    files: ["packages/sim/src/**/*.ts", "packages/content/src/**/*.ts"],
    ignores: ["packages/sim/src/**/*.test.ts", "packages/content/src/**/*.test.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "Date",
          message:
            "Wall-clock time differs per peer and would desync the simulation. " +
            "Use the tick counter from world state instead.",
        },
        {
          name: "performance",
          message: "Timing APIs are non-deterministic. Drive the sim from tick counts.",
        },
      ],

      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message:
            "Math.random is seeded differently on every peer. Use the seeded Rng " +
            "from rng.ts, whose state is part of the hashed world state.",
        },
        // ECMA-262 leaves the transcendental library implementation-defined, so
        // these differ across V8 versions and between V8 and SpiderMonkey.
        // fixed.ts provides deterministic polynomial replacements.
        { object: "Math", property: "sin", message: "Use fxSin from fixed.ts." },
        { object: "Math", property: "cos", message: "Use fxCos from fixed.ts." },
        { object: "Math", property: "tan", message: "No deterministic tan; derive from fxSin/fxCos." },
        { object: "Math", property: "asin", message: "Not deterministic across engines." },
        { object: "Math", property: "acos", message: "Not deterministic across engines." },
        { object: "Math", property: "atan", message: "Use fxAtan2 from fixed.ts." },
        { object: "Math", property: "atan2", message: "Use fxAtan2 from fixed.ts." },
        { object: "Math", property: "exp", message: "Not deterministic across engines." },
        { object: "Math", property: "log", message: "Not deterministic across engines." },
        { object: "Math", property: "log2", message: "Not deterministic across engines." },
        { object: "Math", property: "log10", message: "Not deterministic across engines." },
        {
          object: "Math",
          property: "pow",
          message: "Not deterministic across engines. Use repeated fxMul for integer exponents.",
        },
        { object: "Math", property: "cbrt", message: "Not deterministic across engines." },
        {
          object: "Math",
          property: "hypot",
          message: "Not deterministic across engines. Use fxLength from fixed.ts.",
        },
        { object: "Math", property: "sinh", message: "Not deterministic across engines." },
        { object: "Math", property: "cosh", message: "Not deterministic across engines." },
        { object: "Math", property: "tanh", message: "Not deterministic across engines." },
        { object: "Math", property: "expm1", message: "Not deterministic across engines." },
        { object: "Math", property: "log1p", message: "Not deterministic across engines." },
        { object: "Math", property: "fround", message: "Float32 rounding has no place in integer state." },
      ],

      "no-restricted-syntax": [
        "error",
        {
          // `**` compiles to exponentiation with the same portability problems
          // as Math.pow for non-integer exponents.
          selector: "BinaryExpression[operator='**']",
          message:
            "Exponentiation is not reliably portable. Use repeated fxMul, or a " +
            "shift for powers of two.",
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: "Wall-clock time desyncs peers. Use the world's tick counter.",
        },
        {
          selector: "CallExpression[callee.object.name='Object'][callee.property.name='keys']",
          message:
            "Object.keys ordering depends on key insertion and numeric-key rules. " +
            "Iterate dense arrays by index so every peer visits entities in the same order.",
        },
        {
          selector: "ForOfStatement > .right[type='CallExpression'][callee.property.name='values'][callee.object.type='Identifier']",
          message:
            "Iterating a Map/Set yields insertion order, which can differ per peer. " +
            "Iterate a dense index-ordered array instead.",
        },
      ],
    },
  },

  // Tests may use the real Math library as an oracle to validate the
  // deterministic replacements -- that is the entire point of those tests.
  {
    files: ["**/*.test.ts"],
    rules: {
      "no-restricted-properties": "off",
      "no-restricted-globals": "off",
      "no-restricted-syntax": "off",
    },
  },
);
