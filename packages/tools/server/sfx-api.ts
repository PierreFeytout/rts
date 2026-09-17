import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";

/**
 * The disk side of the sound effects tool.
 *
 * Two folders: the **library**, every sound the project has to choose from
 * (art/sfx-library, never shipped), and the game's **assets** (packages/client/
 * assets/sfx), which holds exactly the sounds sfx.json uses. A sound has the
 * same path relative to either, so saving a configuration is: copy each file it
 * uses from the library into the assets, write sfx.json, and delete any sound
 * in the assets nothing uses any more.
 *
 *   GET  /api/sfx/state                    library and asset files, and sfx.json
 *   GET  /api/sfx/file?from=library&path=  one sound's bytes
 *   POST /api/sfx/save                     { config } -- write it, as above
 *
 * Every path is checked to stay inside its folder: this server writes files.
 */

const AUDIO: Record<string, string> = {
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
};

export interface SfxPaths {
  library: string;
  assets: string;
}

export function sfxApi(paths: SfxPaths): Plugin {
  return {
    name: "rts-sfx-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/sfx", (req, res) => {
        void handle(paths, req, res).catch((error: unknown) => {
          send(res, 500, { error: error instanceof Error ? error.message : String(error) });
        });
      });
    },
  };
}

async function handle(paths: SfxPaths, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://tools");

  if (req.method === "GET" && url.pathname === "/state") {
    send(res, 200, state(paths));
    return;
  }

  if (req.method === "GET" && url.pathname === "/file") {
    const root = url.searchParams.get("from") === "assets" ? paths.assets : paths.library;
    const file = inside(root, url.searchParams.get("path") ?? "");
    const type = AUDIO[extname(file).toLowerCase()];
    if (!type || !existsSync(file)) {
      send(res, 404, { error: "no such sound" });
      return;
    }
    res.setHeader("content-type", type);
    res.setHeader("content-length", statSync(file).size);
    createReadStream(file).pipe(res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/save") {
    const body = JSON.parse(await read(req)) as { config?: { sounds?: Record<string, { files?: string[] }> } };
    const config = body.config;
    if (!config || typeof config.sounds !== "object" || config.sounds === null) {
      send(res, 400, { error: "expected { config: { sounds: {...} } }" });
      return;
    }

    const used = new Set<string>();
    const missing: string[] = [];
    for (const sound of Object.values(config.sounds)) {
      for (const path of sound.files ?? []) {
        const fromLibrary = inside(paths.library, path);
        const inAssets = inside(paths.assets, path);
        if (existsSync(fromLibrary)) {
          if (!existsSync(inAssets) || statSync(inAssets).size !== statSync(fromLibrary).size) {
            mkdirSync(dirname(inAssets), { recursive: true });
            copyFileSync(fromLibrary, inAssets);
          }
        } else if (!existsSync(inAssets)) {
          missing.push(path);
        }
        used.add(normalise(path));
      }
    }
    if (missing.length > 0) {
      send(res, 400, { error: `not in the library or the game: ${missing.join(", ")}` });
      return;
    }

    writeFileSync(join(paths.assets, "sfx.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");

    // The game ships whatever is in its folder, so nothing unused stays there.
    for (const path of audioFiles(paths.assets)) {
      if (!used.has(path)) rmSync(inside(paths.assets, path));
    }
    removeEmptyFolders(paths.assets);

    send(res, 200, state(paths));
    return;
  }

  send(res, 404, { error: "no such endpoint" });
}

function state(paths: SfxPaths): { library: string[]; assets: string[]; config: unknown } {
  const configFile = join(paths.assets, "sfx.json");
  return {
    library: existsSync(paths.library) ? audioFiles(paths.library) : [],
    assets: existsSync(paths.assets) ? audioFiles(paths.assets) : [],
    config: existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")) : null,
  };
}

/** Every sound under `root`, as forward-slash paths relative to it, sorted. */
function audioFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (AUDIO[extname(entry.name).toLowerCase()]) out.push(normalise(relative(root, full)));
    }
  };
  walk(root);
  return out.sort();
}

function removeEmptyFolders(root: string): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    removeEmptyFolders(dir);
    if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true });
  }
}

/** `path` resolved under `root`, refusing anything that would leave it. */
function inside(root: string, path: string): string {
  const full = resolve(root, path);
  if (!full.startsWith(resolve(root) + sep)) throw new Error(`path outside its folder: ${path}`);
  return full;
}

function normalise(path: string): string {
  return path.split(/[\\/]+/).filter(Boolean).join("/");
}

function read(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk;
      if (body.length > 4 * 1024 * 1024) req.destroy(new Error("request too large"));
    });
    req.on("end", () => ok(body));
    req.on("error", fail);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
