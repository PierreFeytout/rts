import { build } from "esbuild";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * Bundle the Electron main process and its preload.
 *
 * Not an optimisation. `tsc` emits `import { MatchRelay } from "@rts/transport"`
 * verbatim, and inside a packaged `app.asar` there is no `node_modules` for
 * Node to resolve that against -- npm workspaces link local packages by symlink
 * during development, and a symlink is not something that survives into an
 * archive. The app installed fine and then died on launch with
 * ERR_MODULE_NOT_FOUND.
 *
 * Bundling resolves every workspace and npm import at build time, so the
 * shipped main process imports nothing but `electron` and Node built-ins. That
 * also removes any question of which `node_modules` electron-builder decided to
 * copy.
 *
 * `tsc` still runs -- it is what typechecks this package and produces its
 * declarations. esbuild does no typechecking at all, and is not asked to.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const src = `${root}packages/desktop/src`;
const out = `${root}packages/desktop/dist`;

// Wipe the directory first: `tsc` used to emit here, and a stale `main.js`
// alongside the bundled one is the kind of thing that works locally and ships
// broken.
await rm(out, { recursive: true, force: true });

const shared = {
  bundle: true,
  platform: "node",
  // Electron 44 ships Node 22. Targeting it keeps the output readable and
  // avoids transpiling things the runtime supports natively.
  target: "node22",
  sourcemap: true,
  logLevel: "info",
  external: [
    // Provided by the runtime, never bundled.
    "electron",
    // `ws` requires these lazily inside a try/catch for a small speedup and
    // works without them. They are native modules, so bundling is not an
    // option; marking them external leaves the try/catch to fail as designed.
    "bufferutil",
    "utf-8-validate",
  ],
};

await build({
  ...shared,
  entryPoints: [`${src}/main.ts`, `${src}/port-forward.ts`],
  outdir: out,
  format: "esm",
  // Electron's main process is ESM here, and esbuild needs to be told how to
  // spell `__dirname` and friends for any dependency that still uses them.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
});

await build({
  ...shared,
  entryPoints: [`${src}/preload.cts`],
  outfile: `${out}/preload.cjs`,
  // The preload runs before ESM is available in the renderer, so it is the one
  // file in the project that must be CommonJS.
  format: "cjs",
});

console.log("[rts] bundled the desktop shell");
