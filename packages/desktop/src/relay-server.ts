import { createServer, type Server } from "node:http";
import { MatchRelay, type RelaySocket } from "@rts/transport";
import { WebSocketServer, type WebSocket } from "ws";

/**
 * The listening socket on the host player's machine.
 *
 * All the routing lives in `MatchRelay`, which knows nothing about sockets and
 * is tested in-process. This file is the thin part: accept connections, hand
 * bytes to the relay, and tell it when one goes away.
 *
 * There is no HTTP surface beyond the WebSocket upgrade. The desktop app ships
 * its own client, so unlike the old broker there is nothing to serve -- and a
 * player's home machine should expose exactly one thing to the internet, not a
 * file server as well.
 */

export interface RelayServerOptions {
  port: number;
  maxPlayers?: number;
  onRoster?: (players: number) => void;
}

export interface RunningRelay {
  port: number;
  relay: MatchRelay;
  close: () => Promise<void>;
}

export function startRelay(options: RelayServerOptions): Promise<RunningRelay> {
  const relay = new MatchRelay({
    maxPlayers: options.maxPlayers ?? 4,
    ...(options.onRoster ? { onRoster: options.onRoster } : {}),
  });

  const http = createServer((_req, res) => {
    // Anything that is not a WebSocket upgrade gets a flat refusal. Curious
    // scanners find a game lobby, not a web server.
    res.writeHead(426, { "content-type": "text/plain" });
    res.end("this port speaks the RTS lobby protocol only\n");
  });

  const wss = new WebSocketServer({ server: http, maxPayload: 4 * 1024 * 1024 });

  wss.on("connection", (ws: WebSocket) => {
    const socket: RelaySocket = {
      send: (data) => {
        // A socket that is closing throws on send; a disconnecting player must
        // not take the host's process down with them.
        if (ws.readyState === ws.OPEN) ws.send(data);
      },
      close: () => ws.close(),
    };

    if (relay.connect(socket) === null) return;

    ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      relay.receive(socket, toBytes(data));
    });
    ws.on("close", () => relay.disconnect(socket));
    ws.on("error", () => relay.disconnect(socket));
  });

  return new Promise((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.port, () => {
      http.removeListener("error", reject);
      const address = http.address();
      const port = typeof address === "object" && address ? address.port : options.port;
      resolve({ port, relay, close: () => shutdown(http, wss, relay) });
    });
  });
}

async function shutdown(http: Server, wss: WebSocketServer, relay: MatchRelay): Promise<void> {
  relay.closeAll();
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  await new Promise<void>((resolve) => http.close(() => resolve()));
}

/** `ws` hands over a Buffer, a fragment array, or an ArrayBuffer depending on how it arrived. */
function toBytes(data: Buffer | ArrayBuffer | Buffer[]): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
