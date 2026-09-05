import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { Plugin } from "vite";

/**
 * Dev-only endpoint that writes a canvas capture to disk.
 *
 * Exists because verifying "does the isometric view actually look right" is
 * inherently visual, and a browser cannot write files. The client POSTs a data
 * URL here and the dev server saves it, so renders can be inspected and diffed
 * without a screenshot harness.
 *
 * Also useful when the page runs in a hidden or offscreen tab, where the
 * compositor never produces frames and ordinary screenshot tooling captures
 * nothing -- WebGL still renders fine, so a readback works when a screenshot
 * does not.
 *
 * Never registered in a production build (`apply: "serve"`), and writes are
 * confined to the capture directory.
 */
export function capturePlugin(outDir: string): Plugin {
  const root = isAbsolute(outDir) ? outDir : resolve(process.cwd(), outDir);

  return {
    name: "rts-capture",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__capture", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("POST only");
          return;
        }

        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
          // A stray huge upload should not exhaust dev-server memory.
          if (body.length > 64 * 1024 * 1024) req.destroy();
        });

        req.on("end", () => {
          try {
            const { name, dataUrl } = JSON.parse(body) as { name?: string; dataUrl?: string };
            if (!dataUrl) throw new Error("missing dataUrl");

            const match = /^data:image\/(png|jpeg);base64,/.exec(dataUrl);
            if (!match) throw new Error("expected a png or jpeg data URL");

            // Reject path separators so a caller cannot escape the output dir.
            const safe = (name ?? "capture").replace(/[^a-zA-Z0-9._-]/g, "_");
            const file = resolve(root, `${safe}.${match[1] === "jpeg" ? "jpg" : "png"}`);

            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, Buffer.from(dataUrl.slice(match[0].length), "base64"));

            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, file }));
          } catch (err) {
            res.statusCode = 400;
            res.end(String(err));
          }
        });
      });
    },
  };
}
