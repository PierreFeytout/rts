import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { sfxApi } from "./server/sfx-api.js";

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/**
 * The project's tools: development pages for working on the game's content,
 * served beside the game rather than inside it. Each tool is a page here, and
 * whatever it needs to read or write on disk is a small API on this server.
 *
 *   npm run tools   ->   http://localhost:5174
 */
export default defineConfig({
  plugins: [
    sfxApi({
      library: here("../../art/sfx-library"),
      assets: here("../client/assets/sfx"),
    }),
  ],
  resolve: {
    alias: {
      "@rts/sim": here("../sim/src/index.ts"),
      "@rts/content": here("../content/src/index.ts"),
      "@client": here("../client/src"),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
});
