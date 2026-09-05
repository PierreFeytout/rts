import { GuestSession, HostSession } from "@rts/netcode";
import type { World } from "@rts/sim";
import { SignalingClient, VirtualNetwork, WebRtcTransport, type PeerDiagnostic } from "@rts/transport";
import { createEmptyWorld, createMatchWorld } from "./match.js";

/**
 * Pre-match lobby: choose to play solo, host a game, or join one by code.
 *
 * Resolves once there is a world and a session ready to run. There is no
 * explicit "start" step for the host: the match begins immediately and friends
 * join a world already in progress. The welcome snapshot makes late joining the
 * natural case rather than a special one, so a waiting-room state would be
 * machinery for its own sake.
 */

export interface LobbyResult {
  world: World;
  session: HostSession | GuestSession;
  localPlayer: number;
  isHost: boolean;
  joinCode?: string;
  /** Kept alive for the whole match: the host needs it to accept more players. */
  signaling?: SignalingClient;
}

/**
 * Where the signaling broker lives.
 *
 * `?broker=` wins, so a dev client on Vite's port can point at a broker running
 * elsewhere. Otherwise same origin, which is the deployed case where one
 * process serves both the page and the WebSocket.
 */
function brokerUrl(): string {
  const override = new URLSearchParams(location.search).get("broker");
  if (override) return override;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  // Vite's dev server does not host the broker, so default to the port the
  // signaling server uses by default rather than failing confusingly.
  if (location.port === "5173") return `${protocol}//${location.hostname}:8080/signal`;
  return `${protocol}//${location.host}/signal`;
}

export function showLobby(): Promise<LobbyResult> {
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.id = "lobby";
    root.innerHTML = LOBBY_HTML;
    document.body.appendChild(root);

    const panel = root.querySelector<HTMLDivElement>("#lobby-panel")!;
    const status = root.querySelector<HTMLDivElement>("#lobby-status")!;
    const diagnostics = root.querySelector<HTMLPreElement>("#lobby-diagnostics")!;

    const say = (message: string, tone: "info" | "error" = "info"): void => {
      status.textContent = message;
      status.style.color = tone === "error" ? "#ff8f8f" : "#8fe3ff";
    };

    const showDiagnostics = (list: PeerDiagnostic[]): void => {
      if (list.length === 0) {
        diagnostics.textContent = "";
        return;
      }
      diagnostics.textContent = list
        .map((d) => {
          const route = d.candidateTypes.length ? d.candidateTypes.join("+") : "gathering";
          return `peer ${d.peer}: ${d.phase} (${d.connectionState}/${d.iceConnectionState}) via ${route}${
            d.detail ? `\n  ${d.detail}` : ""
          }`;
        })
        .join("\n");
    };

    const finish = (result: LobbyResult): void => {
      root.remove();
      resolve(result);
    };

    // --- solo ---------------------------------------------------------------

    root.querySelector<HTMLButtonElement>("#btn-solo")!.onclick = () => {
      const world = createMatchWorld(0xc0ffee);
      // A one-peer virtual network, so solo play still runs the full lockstep
      // path rather than a special-cased direct-apply shortcut.
      const network = new VirtualNetwork();
      const session = new HostSession({ world, transport: network.addPeer(0) });
      finish({ world, session, localPlayer: 0, isHost: true });
    };

    // --- host ---------------------------------------------------------------

    root.querySelector<HTMLButtonElement>("#btn-host")!.onclick = () => {
      panel.classList.add("busy");
      say("contacting the lobby server...");

      const world = createMatchWorld((Math.random() * 0x7fffffff) | 0);
      let transport: WebRtcTransport | null = null;
      let session: HostSession | null = null;

      const signaling: SignalingClient = new SignalingClient({
        url: brokerUrl(),
        onCreated: (code) => {
          transport = new WebRtcTransport({
            signaling,
            localPeer: 0,
            isHost: true,
            onDiagnostic: () => showDiagnostics(transport?.diagnostics ?? []),
          });
          session = new HostSession({ world, transport });
          finish({ world, session, localPlayer: 0, isHost: true, joinCode: code, signaling });
        },
        onPeerJoined: (peerId) => transport?.connectTo(peerId),
        onPeerLeft: (peerId) => transport?.disconnect(peerId, "left the lobby"),
        onSignal: (from, payload) => transport?.handleSignal(from, payload),
        onError: (code, reason) => {
          panel.classList.remove("busy");
          say(explain(code, reason), "error");
        },
      });

      signaling.connect();
      signaling.create();
    };

    // --- join ---------------------------------------------------------------

    const codeInput = root.querySelector<HTMLInputElement>("#join-code")!;
    const joinButton = root.querySelector<HTMLButtonElement>("#btn-join")!;

    const doJoin = (): void => {
      const code = codeInput.value.trim();
      if (code.length < 4) {
        say("enter the code your friend gave you", "error");
        return;
      }

      panel.classList.add("busy");
      say("contacting the lobby server...");

      const world = createEmptyWorld();
      let transport: WebRtcTransport | null = null;
      let guest: GuestSession | null = null;

      const signaling: SignalingClient = new SignalingClient({
        url: brokerUrl(),
        onJoined: (_code, peerId) => {
          say(`connecting to the host directly...`);
          transport = new WebRtcTransport({
            signaling,
            localPeer: peerId,
            isHost: false,
            onDiagnostic: () => showDiagnostics(transport?.diagnostics ?? []),
          });

          guest = new GuestSession({
            world,
            transport,
            name: `player ${peerId}`,
            onWelcome: (playerId) => {
              finish({
                world,
                session: guest!,
                localPlayer: playerId,
                isHost: false,
                joinCode: code,
                signaling,
              });
            },
            onReject: (reason) => {
              panel.classList.remove("busy");
              say(`host refused the connection: ${reason}`, "error");
            },
          });

          // The handshake can only start once the data channel is actually
          // usable; the peer connection reaching "connected" is not enough.
          transport.on("peerJoin", () => {
            say("connected, joining the match...");
            guest?.connect();
          });
        },
        onSignal: (from, payload) => transport?.handleSignal(from, payload),
        onError: (code, reason) => {
          panel.classList.remove("busy");
          say(explain(code, reason), "error");
        },
      });

      signaling.connect();
      signaling.join(code);
    };

    joinButton.onclick = doJoin;
    codeInput.onkeydown = (event) => {
      if (event.key === "Enter") doJoin();
    };
    // Deep link straight into a game: ?join=CODE
    const preset = new URLSearchParams(location.search).get("join");
    if (preset) {
      codeInput.value = preset;
      say("press Join to enter the game");
    }
  });
}

/**
 * Turn a broker error code into something a player can act on.
 *
 * The distinction that matters most is signaling versus peer connectivity:
 * "cannot reach the lobby server" and "cannot reach your friend" look identical
 * to a player but need completely different fixes.
 */
function explain(code: string, reason: string): string {
  switch (code) {
    case "signaling-unreachable":
      return `Cannot reach the lobby server. Is it running? (${reason})`;
    case "no-such-room":
      return "No game with that code. Check the code, or ask your friend to host again.";
    case "room-full":
      return "That game is full.";
    case "host-left":
      return "The host disconnected.";
    case "bad-version":
      return `Version mismatch — one of you is running an older build. (${reason})`;
    case "rate-limited":
      return "Too many requests. Wait a moment and try again.";
    default:
      return reason || code;
  }
}

const LOBBY_HTML = `
<style>
  #lobby {
    position: fixed; inset: 0; z-index: 20;
    display: grid; place-items: center;
    background: radial-gradient(circle at 50% 30%, #131c2b, #070a10 70%);
    font: 14px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: #cfe4ff;
  }
  #lobby-panel {
    width: min(440px, 92vw);
    padding: 28px;
    border: 1px solid #24384f;
    border-radius: 10px;
    background: rgba(10, 15, 24, 0.9);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55);
  }
  #lobby-panel.busy button, #lobby-panel.busy input { opacity: 0.5; pointer-events: none; }
  #lobby h1 { margin: 0 0 4px; font-size: 19px; letter-spacing: 0.06em; color: #8fe3ff; }
  #lobby p.sub { margin: 0 0 22px; color: #62809f; font-size: 12px; }
  #lobby button {
    width: 100%; padding: 11px 14px; margin-bottom: 10px;
    border: 1px solid #2f6f8f; border-radius: 6px;
    background: #14283a; color: #cfe4ff;
    font: inherit; cursor: pointer;
  }
  #lobby button:hover { background: #1b3a52; }
  #lobby .row { display: flex; gap: 8px; }
  #lobby .row input {
    flex: 1; padding: 11px 12px;
    border: 1px solid #2f6f8f; border-radius: 6px;
    background: #0c1520; color: #cfe4ff;
    font: inherit; text-transform: uppercase; letter-spacing: 0.22em;
  }
  #lobby .row button { width: auto; padding-inline: 20px; }
  #lobby hr { border: none; border-top: 1px solid #1d2c3d; margin: 20px 0; }
  #lobby-status { min-height: 20px; margin-top: 14px; font-size: 12px; color: #8fe3ff; }
  #lobby-diagnostics {
    margin: 10px 0 0; max-height: 140px; overflow: auto;
    color: #55708c; font-size: 11px; white-space: pre-wrap;
  }
</style>
<div id="lobby-panel">
  <h1>RTS</h1>
  <p class="sub">peer-to-peer · deterministic lockstep</p>

  <button id="btn-solo">Play solo</button>
  <button id="btn-host">Host a game</button>

  <hr />

  <div class="row">
    <input id="join-code" placeholder="join code" maxlength="12" autocomplete="off" spellcheck="false" />
    <button id="btn-join">Join</button>
  </div>

  <div id="lobby-status"></div>
  <pre id="lobby-diagnostics"></pre>
</div>
`;
