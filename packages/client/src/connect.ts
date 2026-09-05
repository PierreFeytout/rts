import { defaultContent } from "@rts/content";
import { GuestSession } from "@rts/netcode";
import type { World } from "@rts/sim";
import { SignalingClient, WebRtcTransport, type PeerDiagnostic } from "@rts/transport";
import { iceServers } from "./ice.js";

/**
 * Joining a match as a guest, in one reusable piece.
 *
 * Extracted from the lobby because it has to happen twice: once when the player
 * types the code, and again every time the connection drops. Those two paths
 * being the same code is what stops reconnect from being a subtly different,
 * less-tested version of joining.
 *
 * Each attempt builds a **fresh** signaling client. Reusing the old one looks
 * tempting and is wrong twice over: the broker assigns a room per socket and
 * refuses a second join on the same one, and the reason the connection dropped
 * may well be that the broker itself went away.
 */

/** How long to wait for the whole handshake before calling an attempt failed. */
const ATTEMPT_TIMEOUT_MS = 20000;

export interface JoinOptions {
  brokerUrl: string;
  code: string;
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
  onDiagnostics?: (list: PeerDiagnostic[]) => void;
}

export interface GuestConnection {
  signaling: SignalingClient;
  transport: WebRtcTransport;
  session: GuestSession;
  playerId: number;
}

/**
 * Run one join attempt to completion.
 *
 * Resolves once the host's welcome has arrived and the world has been restored;
 * rejects on refusal, on a signaling error, or on timeout. Everything it
 * created is torn down before it rejects, so a caller retrying in a loop cannot
 * leak a socket per attempt.
 */
export async function joinMatch(options: JoinOptions): Promise<GuestConnection> {
  // Resolved before the socket opens, so the peer connection is created with
  // the relay already configured. Adding ICE servers after negotiation has
  // started does not apply to it.
  const ice = await iceServers(options.brokerUrl);

  return new Promise<GuestConnection>((resolve, reject) => {
    const say = (message: string): void => options.onStatus?.(message);
    let transport: WebRtcTransport | null = null;
    let session: GuestSession | null = null;
    let settled = false;

    const cleanup = (): void => {
      window.clearTimeout(timer);
      session?.close();
      transport?.close();
      signaling.close();
    };

    const fail = (reason: string): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(reason));
    };

    const timer = window.setTimeout(
      () => fail("timed out waiting for the host"),
      ATTEMPT_TIMEOUT_MS,
    );

    const signaling: SignalingClient = new SignalingClient({
      url: options.brokerUrl,
      onJoined: (_code, peerId) => {
        say("connecting to the host directly...");
        transport = new WebRtcTransport({
          signaling,
          localPeer: peerId,
          isHost: false,
          iceServers: ice,
          onDiagnostic: () => options.onDiagnostics?.(transport?.diagnostics ?? []),
        });

        session = new GuestSession({
          world: options.world,
          transport,
          name: options.name,
          token: options.token,
          contentHash: defaultContent.hash,
          onWelcome: (playerId) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            // The signaling client stays open on success: the host needs it to
            // relay ICE for any *other* player who joins later.
            resolve({ signaling, transport: transport!, session: session!, playerId });
          },
          onReject: (reason) => fail(`host refused the connection: ${reason}`),
        });

        // The handshake can only start once the data channel is actually
        // usable; the peer connection reaching "connected" is not enough.
        transport.on("peerJoin", () => {
          say("connected, joining the match...");
          session?.connect();
        });
      },
      onSignal: (from, payload) => transport?.handleSignal(from, payload),
      onError: (code, reason) => fail(`${code}: ${reason}`),
      onClosed: () => {
        // Only meaningful before the data channel is up. Afterwards the broker
        // is out of the loop entirely and its socket closing is expected.
        if (!settled) fail("lost the lobby server before the match started");
      },
    });

    say("contacting the lobby server...");
    signaling.connect();
    signaling.join(options.code);
  });
}
