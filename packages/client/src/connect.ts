import { defaultContent } from "@rts/content";
import { GuestSession } from "@rts/netcode";
import type { World } from "@rts/sim";
import { HOST_PEER, SocketTransport, type PeerId } from "@rts/transport";

/**
 * Opening a connection to a host, in one reusable piece.
 *
 * Used for the initial join and for every reconnect after a drop. Those two
 * being the same code is what stops reconnect from becoming a subtly different,
 * less-tested version of joining.
 *
 * There is no signalling step any more. The host's machine is listening on a
 * port and the address is the address -- which is the whole point of the
 * desktop build: nothing is deployed anywhere, and the player who creates the
 * game is the one running it.
 */

/** How long to wait for the whole handshake before calling an attempt failed. */
const ATTEMPT_TIMEOUT_MS = 15000;

export interface JoinOptions {
  /** `ws://host:port`, or a bare `host:port` which is normalised. */
  address: string;
  /**
   * The world to restore into.
   *
   * The same object across reconnects, deliberately: the renderer, the
   * selection and the HUD all hold a reference to it, and swapping it would
   * leave every one of them pointing at a detached copy.
   */
  world: World;
  /** Stable player identity, so the host returns this player to their own slot. */
  token: string;
  name: string;
  onStatus?: (message: string) => void;
}

export interface GuestConnection {
  transport: SocketTransport;
  session: GuestSession;
  playerId: number;
}

/**
 * Turn whatever the player typed into a URL.
 *
 * People type `192.168.1.7`, `192.168.1.7:47654`, or paste the whole thing.
 * Refusing any of those on principle would be pedantry, since every one of them
 * says exactly what was meant.
 */
export function normaliseAddress(input: string, defaultPort = 47654): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) return "";
  const withScheme = /^wss?:\/\//i.test(trimmed) ? trimmed : `ws://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!url.port) url.port = String(defaultPort);
    // Path and query mean nothing here and are almost always a paste accident.
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

/**
 * Open a socket and wait for the relay to assign a peer id.
 *
 * The id has to arrive before anything is built on top: a session constructed
 * against a transport that does not yet know whether it is the host would route
 * every message to nobody.
 */
export function openTransport(address: string): Promise<SocketTransport> {
  return new Promise((resolve, reject) => {
    const url = normaliseAddress(address);
    if (!url) {
      reject(new Error("that does not look like an address"));
      return;
    }

    let settled = false;
    const socket = new WebSocket(url);
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.close();
      reject(new Error(`no answer from ${url.replace(/^ws:\/\//, "")}`));
    }, ATTEMPT_TIMEOUT_MS);

    const transport = new SocketTransport({
      socket: socket as unknown as ConstructorParameters<typeof SocketTransport>[0]["socket"],
      onReady: () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(transport);
      },
      onRejected: (reason) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(new Error(reason));
      },
    });

    socket.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      // The browser deliberately withholds the reason for a failed WebSocket
      // connection, so this is as specific as it can honestly be.
      reject(new Error(`could not reach ${url.replace(/^ws:\/\//, "")}`));
    };
  });
}

/**
 * Join a match and wait for the host's welcome.
 *
 * Rejects on refusal or timeout, tearing down everything it created first, so a
 * caller retrying in a loop cannot leak a socket per attempt.
 */
export async function joinMatch(options: JoinOptions): Promise<GuestConnection> {
  const say = (message: string): void => options.onStatus?.(message);
  say("connecting...");

  const transport = await openTransport(options.address);
  if (transport.localPeer === HOST_PEER) {
    // Peer 0 means the relay had no host yet: this player arrived at a machine
    // that is listening but not playing. Joining as the arbiter of an empty
    // match would be worse than saying so.
    transport.close();
    throw new Error("that address is listening but no game is running there");
  }

  return new Promise<GuestConnection>((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => fail("the host did not answer"), ATTEMPT_TIMEOUT_MS);

    const fail = (reason: string): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      session.close();
      transport.close();
      reject(new Error(reason));
    };

    const session = new GuestSession({
      world: options.world,
      transport,
      name: options.name,
      token: options.token,
      contentHash: defaultContent.hash,
      onWelcome: (playerId: PeerId) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve({ transport, session, playerId });
      },
      onReject: (reason) => fail(`host refused the connection: ${reason}`),
    });

    say("joining the match...");
    session.connect();
  });
}
