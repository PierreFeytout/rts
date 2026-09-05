import { defaultContent } from "@rts/content";
import { HostSession, decodeReplay } from "@rts/netcode";
import type { World } from "@rts/sim";
import { HOST_PEER, VirtualNetwork, type SocketTransport } from "@rts/transport";
import { joinMatch, openTransport, type GuestConnection } from "./connect.js";
import { desktop, type HostInfo } from "./desktop.js";
import type { MatchSession } from "./game.js";
import { playerToken } from "./identity.js";
import { RACE_IDS, createEmptyWorld, createMatchWorld, type FactionMode } from "./match.js";
import { ReplaySession } from "./replay-session.js";

/**
 * Pre-match lobby: play solo, host a game, join one by address, or watch a
 * recording.
 *
 * Hosting means this machine starts listening. There is nothing to deploy and
 * no third party involved -- the player who creates the game runs it, and it
 * ends when they close the window.
 *
 * There is no explicit "start" step for the host: the match begins immediately
 * and friends join a world already in progress. The welcome snapshot makes late
 * joining the natural case rather than a special one, so a waiting room would
 * be machinery for its own sake.
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
  /** How to reach this machine, for the host's share panel. */
  hostInfo?: HostInfo;
  /** Everything a guest needs to rebuild its connection after a drop. */
  reconnect?: {
    address: string;
    token: string;
    name: string;
    connection: GuestConnection;
  };
  /** Set when watching a recording rather than playing. */
  replay?: ReplaySession;
}

export function showLobby(): Promise<LobbyResult> {
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.id = "lobby";
    root.innerHTML = LOBBY_HTML;
    document.body.appendChild(root);

    const panel = root.querySelector<HTMLDivElement>("#lobby-panel")!;
    const status = root.querySelector<HTMLDivElement>("#lobby-status")!;
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

    const say = (message: string, tone: "info" | "error" = "info"): void => {
      status.textContent = message;
      status.style.color = tone === "error" ? "#ff8f8f" : "#8fe3ff";
    };

    const finish = (result: LobbyResult): void => {
      root.remove();
      resolve(result);
    };

    const busy = (on: boolean): void => {
      panel.classList.toggle("busy", on);
    };

    // --- solo ---------------------------------------------------------------

    root.querySelector<HTMLButtonElement>("#btn-solo")!.onclick = () => {
      const world = createMatchWorld(0xc0ffee, chosenFactions());
      // A one-peer virtual network, so solo play still runs the full lockstep
      // path rather than a special-cased direct-apply shortcut.
      const network = new VirtualNetwork();
      const session = new HostSession({
        world,
        transport: network.addPeer(HOST_PEER),
        contentHash: defaultContent.hash,
      });
      finish({ world, session, localPlayer: 0, isHost: true });
    };

    // --- host ---------------------------------------------------------------

    const hostButton = root.querySelector<HTMLButtonElement>("#btn-host")!;
    if (!desktop) {
      // A browser cannot accept incoming connections, which is the entire
      // reason this is a desktop application. Saying so is better than a button
      // that fails in a way nobody can act on.
      hostButton.disabled = true;
      hostButton.title = "hosting needs the desktop app";
      hostButton.textContent = "Host a game (desktop app only)";
    }

    hostButton.onclick = () => {
      if (!desktop) return;
      busy(true);
      say("opening a port on this machine...");

      void desktop
        .host()
        .then(async (info) => {
          const world = createMatchWorld((Math.random() * 0x7fffffff) | 0, chosenFactions());
          // The host connects to its own relay over loopback, exactly as a
          // guest connects across the internet. One transport implementation,
          // not a client one and a server one that have to agree.
          const transport: SocketTransport = await openTransport(info.localUrl);
          const session = new HostSession({
            world,
            transport,
            contentHash: defaultContent.hash,
          });
          finish({ world, session, localPlayer: 0, isHost: true, hostInfo: info });
        })
        .catch((error: unknown) => {
          busy(false);
          say(message(error), "error");
        });
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
          say(message(error), "error");
          replayInput.value = "";
        });
    };

    // --- join ---------------------------------------------------------------

    const addressInput = root.querySelector<HTMLInputElement>("#join-address")!;
    const joinButton = root.querySelector<HTMLButtonElement>("#btn-join")!;

    const doJoin = (): void => {
      const address = addressInput.value.trim();
      if (address.length < 3) {
        say("enter the address your friend gave you", "error");
        return;
      }

      busy(true);
      const world = createEmptyWorld();
      const token = playerToken();
      const name = `player ${token.slice(0, 4)}`;

      // Exactly the call the reconnector makes.
      joinMatch({ address, world, token, name, onStatus: (text) => say(text) })
        .then((connection) => {
          finish({
            world,
            session: connection.session,
            localPlayer: connection.playerId,
            isHost: false,
            reconnect: { address, token, name, connection },
          });
        })
        .catch((error: unknown) => {
          busy(false);
          say(message(error), "error");
        });
    };

    joinButton.onclick = doJoin;
    addressInput.onkeydown = (event) => {
      if (event.key === "Enter") doJoin();
    };

    // Deep link straight into a game: ?join=host:port
    const preset = new URLSearchParams(location.search).get("join");
    if (preset) {
      addressInput.value = preset;
      say("press Join to enter the game");
    }
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    width: min(460px, 92vw);
    padding: 28px;
    border: 1px solid #24384f;
    border-radius: 10px;
    background: rgba(10, 15, 24, 0.9);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55);
  }
  #lobby-panel.busy button, #lobby-panel.busy input, #lobby-panel.busy select {
    opacity: 0.5; pointer-events: none;
  }
  #lobby h1 { margin: 0 0 4px; font-size: 19px; letter-spacing: 0.06em; color: #8fe3ff; }
  #lobby p.sub { margin: 0 0 22px; color: #62809f; font-size: 12px; }
  #lobby button {
    width: 100%; padding: 11px 14px; margin-bottom: 10px;
    border: 1px solid #2f6f8f; border-radius: 6px;
    background: #14283a; color: #cfe4ff;
    font: inherit; cursor: pointer;
  }
  #lobby button:hover:not(:disabled) { background: #1b3a52; }
  #lobby button:disabled { opacity: 0.45; cursor: default; }
  #lobby .row { display: flex; gap: 8px; }
  #lobby .row input {
    flex: 1; padding: 11px 12px;
    border: 1px solid #2f6f8f; border-radius: 6px;
    background: #0c1520; color: #cfe4ff; font: inherit;
  }
  #lobby .row button { width: auto; padding-inline: 20px; margin-bottom: 0; }
  #lobby .field { display: block; margin-bottom: 14px; }
  #lobby .field span { display: block; margin-bottom: 5px; color: #62809f; font-size: 11px; }
  #lobby select {
    width: 100%; padding: 10px 12px;
    border: 1px solid #2f6f8f; border-radius: 6px;
    background: #0c1520; color: #cfe4ff; font: inherit; cursor: pointer;
  }
  #lobby hr { border: none; border-top: 1px solid #1d2c3d; margin: 20px 0; }
  #lobby-status { min-height: 20px; margin-top: 14px; font-size: 12px; color: #8fe3ff; }
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
    <input id="join-address" placeholder="friend's address, e.g. 92.0.2.15:47654"
           autocomplete="off" spellcheck="false" />
    <button id="btn-join">Join</button>
  </div>

  <div id="lobby-status"></div>
</div>
`;
