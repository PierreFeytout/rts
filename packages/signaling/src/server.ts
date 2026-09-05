import { randomInt } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { Broker, type BrokerSocket } from "./broker.js";

/**
 * The one always-on process.
 *
 * Serves the built client over HTTP and brokers WebRTC signaling over
 * WebSocket, in a single deployment. Gameplay never touches it: once two
 * browsers have exchanged offers and candidates through here, they talk
 * directly and this process is irrelevant to them until someone starts a new
 * game.
 *
 * Configuration is by environment variable so it can run unchanged on a free
 * tier, a Raspberry Pi, or behind a reverse proxy:
 *
 *   PORT        listen port (default 8080)
 *   HOST        bind address (default 0.0.0.0)
 *   CLIENT_DIR  directory of built client files (default ../client/dist)
 */

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";
const CLIENT_DIR = resolve(
  process.env.CLIENT_DIR ?? new URL("../../client/dist", import.meta.url).pathname.replace(/^\//, ""),
);

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Crypto-backed code generator.
 *
 * `Math.random` is fine for the broker's own tests but not here: a predictable
 * generator would let someone enumerate live join codes and drop into
 * strangers' games.
 */
function generateCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

const broker = new Broker({
  generateCode,
  log: (message) => console.log(`[broker] ${message}`),
});

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith("/")) pathname += "index.html";

  // Contain the path inside CLIENT_DIR. Without this, a request for
  // "/../../etc/passwd" would escape the directory -- the classic path
  // traversal, and this process is reachable from the internet.
  const requested = normalize(join(CLIENT_DIR, pathname));
  if (!requested.startsWith(CLIENT_DIR + sep) && requested !== CLIENT_DIR) {
    res.writeHead(403).end("forbidden");
    return;
  }

  let file = requested;
  if (!existsSync(file) || !statSync(file).isFile()) {
    // Single-page app fallback, so a deep link still loads the client.
    file = join(CLIENT_DIR, "index.html");
    if (!existsSync(file)) {
      res
        .writeHead(404, { "content-type": "text/plain" })
        .end(`client not built. Run "npm run build --workspace @rts/client".`);
      return;
    }
  }

  res.writeHead(200, {
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
    // Hashed asset filenames may be cached hard; index.html must not be, or
    // players keep running an old client after a deploy and desync instantly.
    "cache-control": file.endsWith("index.html") ? "no-cache" : "public, max-age=31536000",
  });
  createReadStream(file).pipe(res);
}

const httpServer = createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, ...broker.stats() }));
    return;
  }
  serveStatic(req, res);
});

// ---------------------------------------------------------------------------
// WebSocket signaling
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ server: httpServer, path: "/signal", maxPayload: 64 * 1024 });

let nextSocketId = 1;

wss.on("connection", (ws: WebSocket) => {
  const socket: BrokerSocket = {
    id: nextSocketId++,
    send: (data) => {
      if (ws.readyState === ws.OPEN) ws.send(data);
    },
    close: (code, reason) => ws.close(code, reason),
  };

  // A connection that never joins a room still consumes a socket, so drop
  // anything idle. Peers that have finished signaling do not need us.
  let alive = true;
  ws.on("pong", () => {
    alive = true;
  });
  const heartbeat = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    ws.ping();
  }, 30_000);

  ws.on("message", (data) => broker.handleMessage(socket, data.toString()));

  ws.on("close", () => {
    clearInterval(heartbeat);
    broker.handleDisconnect(socket);
  });

  ws.on("error", () => {
    clearInterval(heartbeat);
    broker.handleDisconnect(socket);
  });
});

setInterval(() => {
  const swept = broker.sweep();
  if (swept > 0) console.log(`[broker] swept ${swept} abandoned room(s)`);
}, 30_000);

httpServer.listen(PORT, HOST, () => {
  console.log(`[rts] http://${HOST}:${PORT}  (signaling on /signal)`);
  console.log(`[rts] serving client from ${CLIENT_DIR}`);
  if (!existsSync(CLIENT_DIR)) {
    console.warn(`[rts] WARNING: ${CLIENT_DIR} does not exist -- build the client first`);
  }
});
