import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Resolve workspace packages to SOURCE, so tests run against the files
      // being edited rather than a stale `tsc --build` output.
      "@rts/sim": fileURLToPath(new URL("./packages/sim/src/index.ts", import.meta.url)),
      "@rts/transport": fileURLToPath(
        new URL("./packages/transport/src/index.ts", import.meta.url),
      ),
      "@rts/protocol": fileURLToPath(new URL("./packages/protocol/src/index.ts", import.meta.url)),
      "@rts/netcode": fileURLToPath(new URL("./packages/netcode/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts"],
  },
});
