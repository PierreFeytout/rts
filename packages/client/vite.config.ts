import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { capturePlugin } from "./vite-plugin-capture.js";

const captureDir = fileURLToPath(new URL("../../.captures", import.meta.url));

export default defineConfig({
  plugins: [capturePlugin(captureDir)],
  resolve: {
    alias: {
      // Point at sim SOURCE rather than its build output, so editing the
      // simulation hot-reloads without a separate `tsc --build` step.
      // Typechecking still happens through project references via `npm run typecheck`.
      "@rts/sim": fileURLToPath(new URL("../sim/src/index.ts", import.meta.url)),
      "@rts/transport": fileURLToPath(new URL("../transport/src/index.ts", import.meta.url)),
      "@rts/protocol": fileURLToPath(new URL("../protocol/src/index.ts", import.meta.url)),
      "@rts/netcode": fileURLToPath(new URL("../netcode/src/index.ts", import.meta.url)),
      "@rts/content": fileURLToPath(new URL("../content/src/index.ts", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Bind all interfaces so a second device on the LAN can join during
    // multiplayer testing in M3.
    host: true,
  },
});
