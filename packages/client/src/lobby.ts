import { defaultContent } from "@rts/content";
import { HostSession, decodeReplay } from "@rts/netcode";
import type { World } from "@rts/sim";
import { SignalingClient, VirtualNetwork, WebRtcTransport, type PeerDiagnostic } from "@rts/transport";
import { joinMatch, type GuestConnection } from "./connect.js";
import type { MatchSession } from "./game.js";
import { playerToken } from "./identity.js";
import { iceServers } from "./ice.js";
import { ReplaySession } from "./replay-session.js";
import { RACE_IDS, createEmptyWorld, createMatchWorld, type FactionMode } from "./match.js";

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
  /**
   * Whatever will drive ticks. A live session when playing, a `ReplaySession`
   * when watching -- the match screen treats all three identically.
   */
  session: MatchSession;
  localPlayer: number;
  isHost: boolean;
  joinCode?: string;
  /** Kept alive for the whole match: the host needs it to accept more players. */
  signaling?: SignalingClient;
  /**
   * Everything a guest needs to rebuild its connection after a drop.
   *
   * Absent for the host and for solo play, which is the honest shape: the host
   * has nobody to reconnect *to*, and a lost host ends the match. Host
   * migration is tractable -- under lockstep every peer already holds identical
   * state, so it is a matter of re-electing the clock owner rather than
   * transferring a world -- but it is not built.
   */
  reconnect?: {
    brokerUrl: string;
    code: string;
    token: string;
    name: string;
    connection: GuestConnection;
  };
  /** Set when watching a recording rather than playing. */
  replay?: ReplaySession;
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
    const factions = root.querySelector<HTMLSelectElement>("#factions")!;

    // Populated from the loaded content rather than hardcoded, so a new race
    // appears in the picker the moment its definition exists.
    for (const raceId of RACE_IDS) {
      const race = defaultContent.race(raceId);
      const option = document.createElement("option");
      option.value = raceId;
      option.textContent = `all ${race.name}`;
      option.title = race.blurb;
      factions.appendChild(option);
    }
    const chosenFactions = (): FactionMode => factions.value as FactionMode;
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
      const world = createMatchWorld(0xc0ffee, chosenFactions());
      // A one-peer virtual network, so solo play still runs the full lockstep
      // path rather than a special-cased direct-apply shortcut.
      const network = new VirtualNetwork();
      const session = new HostSession({
        world,
        transport: network.addPeer(0),
        contentHash: defaultContent.hash,
      });
      finish({ world, session, localPlayer: 0, isHost: true });
    };

    // --- host ---------------------------------------------------------------

    root.querySelector<HTMLButtonElement>("#btn-host")!.onclick = async () => {
      panel.classList.add("busy");
      say("contacting the lobby server...");

      const world = createMatchWorld((Math.random() * 0x7fffffff) | 0, chosenFactions());
      let transport: WebRtcTransport | null = null;
      let session: HostSession | null = null;
      // Fetched before the room is created, so every peer connection the host
      // makes from here on already has the relay configured.
      const ice = await iceServers(brokerUrl());

      const signaling: SignalingClient = new SignalingClient({
        url: brokerUrl(),
        onCreated: (code) => {
          transport = new WebRtcTransport({
            signaling,
            localPeer: 0,
            isHost: true,
            iceServers: ice,
            onDiagnostic: () => showDiagnostics(transport?.diagnostics ?? []),
          });
          session = new HostSession({ world, transport, contentHash: defaultContent.hash });
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

    // --- watch a replay -----------------------------------------------------

    const replayInput = root.querySelector<HTMLInputElement>("#replay-file")!;
    root.querySelector<HTMLButtonElement>("#btn-replay")!.onclick = () => replayInput.click();

    replayInput.onchange = () => {
      const file = replayInput.files?.[0];
      if (!file) return;
      say(`reading ${file.name}...`);

      void file
        .arrayBuffer()
        .then((buffer) => {
          const replay = decodeReplay(new Uint8Array(buffer), defaultContent.hash);
          const world = createEmptyWorld();
          const session = new ReplaySession(world, replay);
          finish({ world, session, localPlayer: 0, isHost: false, replay: session });
        })
        .catch((error: unknown) => {
          // Refusing loudly matters here: a replay that loaded but diverged
          // would look exactly like a simulation bug.
          say(error instanceof Error ? error.message : "could not read that file", "error");
          replayInput.value = "";
        });
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

      // Exactly the call the reconnector makes. Joining and rejoining being one
      // code path is what stops reconnect from being a subtly different, less
      // tested version of joining.
      const world = createEmptyWorld();
      const token = playerToken();
      const name = `player ${token.slice(0, 4)}`;
      const url = brokerUrl();

      joinMatch({
        brokerUrl: url,
        code,
        world,
        token,
        name,
        onStatus: (message) => say(message),
        onDiagnostics: showDiagnostics,
      })
        .then((connection) => {
          finish({
            world,
            session: connection.session,
            localPlayer: connection.playerId,
            isHost: false,
            joinCode: code,
            signaling: connection.signaling,
            reconnect: { brokerUrl: url, code, token, name, connection },
          });
        })
        .catch((error: unknown) => {
          panel.classList.remove("busy");
          const message = error instanceof Error ? error.message : String(error);
          // `joinMatch` reports broker errors as "code: reason", so the
          // actionable explanations still apply.
          const [head, ...rest] = message.split(": ");
          say(rest.length > 0 ? explain(head, rest.join(": ")) : message, "error");
        });
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
  #lobby .field { display: block; margin-bottom: 14px; }
  #lobby .field span { display: block; margin-bottom: 5px; color: #62809f; font-size: 11px; }
  #lobby select {
    width: 100%; padding: 10px 12px;
    border: 1px solid #2f6f8f; border-radius: 6px;
    background: #0c1520; color: #cfe4ff; font: inherit; cursor: pointer;
  }
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

  <label class="field">
    <span>factions</span>
    <select id="factions">
      <option value="mixed">mixed — one race per slot</option>
    </select>
  </label>

  <button id="btn-solo">Play solo</button>
  <button id="btn-host">Host a game</button>
  <button id="btn-replay">Watch a replay</button>
  <input id="replay-file" type="file" accept=".rtsreplay" hidden />

  <hr />

  <div class="row">
    <input id="join-code" placeholder="join code" maxlength="12" autocomplete="off" spellcheck="false" />
    <button id="btn-join">Join</button>
  </div>

  <div id="lobby-status"></div>
  <pre id="lobby-diagnostics"></pre>
</div>
`;
