import { defaultContent } from "@rts/content";
import { HostSession, decodeReplay } from "@rts/netcode";
import { snapshotMapTiles, type World } from "@rts/sim";
import { HOST_PEER, VirtualNetwork, type SocketTransport } from "@rts/transport";
import { idleAi, type AiDriver } from "../ai/driver.js";
import { openTransport, joinMatch, type GuestConnection } from "../connect.js";
import { desktop, type HostInfo } from "../desktop.js";
import type { MatchSession } from "../game.js";
import { playerName, playerToken } from "../identity.js";
import { LobbyGuest, type LobbyView } from "../lobby-guest.js";
import { LobbyHost } from "../lobby-host.js";
import {
  createEmptyWorld,
  createMatchWorld,
  defaultConfig,
  emptySlots,
  type MatchConfig,
  type SlotKind,
} from "../match.js";
import { music } from "../audio/music.js";
import { ReplaySession } from "../replay-session.js";
import { showMenu, showMultiplayerMenu } from "./menu.js";
import { showSettings } from "./settings.js";
import { showJoin } from "./join.js";
import { SetupScreen } from "./setup.js";

/**
 * Screen navigation.
 *
 * Replaces a single `await showLobby()` that had no way back: the match screen
 * was the last thing that ever happened, and starting a second game meant
 * reloading the page. Everything here is a loop around one question -- what
 * match should run next -- so a match can end and the menu can come back.
 */

export interface Launch {
  world: World;
  /** Whatever drives ticks: a live session, or a replay. */
  session: MatchSession;
  localPlayer: number;
  isHost: boolean;
  /**
   * Which map this is, for its terrain biome (see materials.ts). Absent for a
   * replay: nothing it stores lets this be recovered, so the ashen default
   * plays back on any world -- a wrong ground texture, never a wrong match.
   */
  mapId?: string;
  /** Everything a guest needs to rebuild its connection after a drop. */
  reconnect?: {
    address: string;
    token: string;
    name: string;
    connection: GuestConnection;
  };
  /** Set when watching a recording rather than playing. */
  replay?: ReplaySession;
  /** Computer players, by slot. Empty for a guest -- the host runs them all. */
  ai: Map<number, AiDriver>;
  /** Tear down whatever the launch opened. Called when the match ends. */
  release: () => void | Promise<void>;
}

/** Walk the menus until there is a match to run. */
export async function chooseMatch(): Promise<Launch> {
  for (;;) {
    music.play("menu.main");
    switch (await showMenu()) {
      case "skirmish": {
        const launch = await skirmish();
        if (launch) return launch;
        break;
      }
      case "multiplayer": {
        const launch = await multiplayer();
        if (launch) return launch;
        break;
      }
      case "replay": {
        const launch = await watchReplay();
        if (launch) return launch;
        break;
      }
      case "settings":
        music.play("menu.settings");
        // Nothing to hand back: every page writes as it goes, and the main
        // menu is rebuilt when this returns -- which is what picks up a new
        // name without the settings screen having to say it changed.
        await showSettings();
        break;
      case "quit":
        // Only offered in the desktop build, where a page cannot close itself.
        await desktop?.quit();
        break;
    }
  }
}

async function multiplayer(): Promise<Launch | null> {
  for (;;) {
    music.play("menu.multiplayer");
    switch (await showMultiplayerMenu()) {
      case "host": {
        const launch = await hostGame();
        if (launch) return launch;
        break;
      }
      case "join": {
        const launch = await joinGame();
        if (launch) return launch;
        break;
      }
      case "back":
        return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Skirmish
// ---------------------------------------------------------------------------

function skirmish(): Promise<Launch | null> {
  music.play("menu.skirmish");
  return new Promise((resolve) => {
    let config = defaultConfig(playerName());

    const setup: SetupScreen = new SetupScreen({
      mode: "skirmish",
      config,
      localSlot: 0,
      onConfigChange: (next) => {
        config = next;
      },
      onPickRace: () => {
        // Applied by the screen through onConfigChange; nothing to negotiate
        // when there is nobody to negotiate with.
      },
      onStart: () => {
        if (!hasOpponent(config)) {
          setup.say("add an opponent, or there is nothing to win", "error");
          return;
        }
        const world = createMatchWorld(config);
        // A one-peer virtual network, so solo play still runs the full lockstep
        // path rather than a special-cased direct-apply shortcut. It is what
        // makes a bug in scheduling show up in a skirmish rather than waiting
        // for a real match against a friend.
        const network = new VirtualNetwork();
        const session = new HostSession({
          world,
          transport: network.addPeer(HOST_PEER),
          contentHash: defaultContent.hash,
        });
        setup.close();
        resolve({
          world,
          session,
          localPlayer: 0,
          isHost: true,
          mapId: config.mapId,
          ai: computerPlayers(config),
          release: () => {},
        });
      },
      onBack: () => {
        setup.close();
        resolve(null);
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Hosting
// ---------------------------------------------------------------------------

function hostGame(): Promise<Launch | null> {
  music.play("menu.lobby");
  return new Promise((resolve) => {
    // Captured once: a browser has no bridge at all, and the menu does not
    // offer this there. Narrowing here keeps every use below honest.
    const bridge = desktop;
    if (!bridge) {
      resolve(null);
      return;
    }

    const token = playerToken();
    const name = playerName();
    // The lobby opens with every other slot free rather than filled with
    // computers: someone who chose "Host a game" is expecting friends.
    const config: MatchConfig = {
      ...defaultConfig(name),
      slots: emptySlots().map((slot, player) =>
        player === 0 ? { ...slot, kind: "human" as SlotKind, name } : slot,
      ),
    };

    let lobby: LobbyHost | null = null;
    let transport: SocketTransport | null = null;
    let started = false;

    const release = async (): Promise<void> => {
      lobby?.detach();
      transport?.close();
      await bridge.stopHosting();
    };

    const setup: SetupScreen = new SetupScreen({
      mode: "host",
      config,
      localSlot: 0,
      onConfigChange: (next) => lobby?.update(next),
      onPickRace: () => {
        // The host is the authority, so its own pick is already applied by the
        // time onConfigChange runs. Nothing to send.
      },
      onStart: () => {
        if (!lobby) return;
        if (!hasOpponent(lobby.config)) {
          setup.say("add an opponent, or wait for a friend to join", "error");
          return;
        }
        started = true;
        const roster = lobby.start();
        const world = createMatchWorld(lobby.config);
        const session = new HostSession({
          world,
          transport: transport!,
          contentHash: defaultContent.hash,
          roster,
        });
        setup.close();
        resolve({
          world,
          session,
          localPlayer: 0,
          isHost: true,
          mapId: lobby.config.mapId,
          ai: computerPlayers(lobby.config),
          // Hosting stops when the match does. Leaving the port open and the
          // relay running after everyone has gone back to the menu would keep
          // this machine reachable for a game that no longer exists.
          release,
        });
      },
      onBack: () => {
        setup.close();
        void release();
        resolve(null);
      },
    });

    setup.say("opening a port on this machine…");

    void bridge
      .host()
      .then(async (info: HostInfo) => {
        // The host connects to its own relay over loopback, exactly as a guest
        // connects across the internet. One transport implementation, not a
        // client one and a server one that have to agree.
        transport = await openTransport(info.localUrl);
        if (started) return;
        lobby = new LobbyHost({
          transport,
          token,
          name,
          config,
          onChange: (next) => setup.update(next, 0),
        });
        setup.setHostInfo(info);
        setup.say("waiting for players — or start whenever you like");
      })
      .catch((error: unknown) => {
        setup.say(message(error), "error");
      });
  });
}

// ---------------------------------------------------------------------------
// Joining
// ---------------------------------------------------------------------------

interface Joined {
  address: string;
  transport: SocketTransport;
  guest: LobbyGuest;
  view: LobbyView;
}

async function joinGame(): Promise<Launch | null> {
  music.play("menu.join");
  const token = playerToken();
  const name = playerName();

  const joined = await showJoin<Joined>({
    connect: (address, say) => openLobby(address, token, name, say),
    dispose: (value) => {
      value.guest.detach();
      value.transport.close();
    },
  });
  if (!joined) return null;

  return waitInLobby(joined, token, name);
}

/**
 * Connect, announce ourselves, and wait for the host's first state message.
 *
 * Resolving on the *state* rather than on the socket opening is deliberate: a
 * machine that is listening but refusing this player should fail on the join
 * screen, where the address is still on screen and can be corrected, rather
 * than a moment later on a lobby screen with nothing in it.
 */
function openLobby(
  address: string,
  token: string,
  name: string,
  say: (message: string) => void,
): Promise<Joined> {
  say("connecting…");

  return openTransport(address).then(
    (transport) =>
      new Promise<Joined>((resolve, reject) => {
        if (transport.localPeer === HOST_PEER) {
          // Peer 0 means the relay had no host yet: this player arrived at a
          // machine that is listening but not playing.
          transport.close();
          reject(new Error("that address is listening but no game is running there"));
          return;
        }

        let settled = false;
        const fail = (reason: string): void => {
          if (settled) return;
          settled = true;
          guest.detach();
          transport.close();
          reject(new Error(reason));
        };

        const guest = new LobbyGuest({
          transport,
          token,
          name,
          onState: (view) => {
            if (settled) return;
            settled = true;
            resolve({ address, transport, guest, view });
          },
          onStart: () => {
            // The host started between our hello and its answer. Racing into a
            // match we were never given a slot in would be worse than saying so.
            fail("that game had already started");
          },
          onClosed: fail,
        });

        say("joining the lobby…");
        guest.connect();
      }),
  );
}

/** Sit in the host's lobby until it starts, or until we leave. */
function waitInLobby(joined: Joined, token: string, name: string): Promise<Launch | null> {
  music.play("menu.lobby");
  return new Promise((resolve) => {
    const { address, transport, guest } = joined;
    // The host can change the map after this screen opened; `joined.view` is
    // this connection's first snapshot, not a live one, so the map the match
    // actually starts on is whatever the most recent state said.
    let mapId = joined.view.mapId;

    const setup: SetupScreen = new SetupScreen({
      mode: "guest",
      config: viewToConfig(joined.view),
      localSlot: joined.view.yourSlot,
      onPickRace: (raceId) => guest.pick(raceId),
      onBack: () => {
        setup.close();
        guest.detach();
        transport.close();
        resolve(null);
      },
    });
    setup.say("waiting for the host to start…");

    guest.replaceHandlers({
      onState: (view) => {
        mapId = view.mapId;
        setup.update(viewToConfig(view), view.yourSlot);
      },
      onStart: (mapTiles) => {
        setup.busy(true);
        setup.say("starting…");
        // The world has to exist, at exactly the host's size, before the
        // welcome snapshot can be decoded into it.
        const world = createEmptyWorld(mapTiles);
        joinMatch({ address, transport, world, token, name, onStatus: (m) => setup.say(m) })
          .then((connection) => {
            setup.close();
            resolve({
              world,
              session: connection.session,
              localPlayer: connection.playerId,
              isHost: false,
              mapId,
              reconnect: { address, token, name, connection },
              ai: new Map(),
              release: () => transport.close(),
            });
          })
          .catch((error: unknown) => {
            setup.busy(false);
            setup.say(message(error), "error");
          });
      },
      onClosed: (reason) => {
        setup.busy(false);
        setup.say(reason, "error");
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Replays
// ---------------------------------------------------------------------------

function watchReplay(): Promise<Launch | null> {
  music.play("menu.replays");
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".rtsreplay";
    input.style.display = "none";
    document.body.appendChild(input);

    const done = (launch: Launch | null): void => {
      input.remove();
      resolve(launch);
    };

    // A cancelled file dialog fires no event in most browsers, so the menu is
    // shown again on the next focus rather than leaving the player staring at
    // nothing. `once` matters: the dialog can be opened repeatedly.
    window.addEventListener(
      "focus",
      () => setTimeout(() => (input.files?.length ? undefined : done(null)), 400),
      { once: true },
    );

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        done(null);
        return;
      }
      void file
        .arrayBuffer()
        .then((buffer) => {
          const replay = decodeReplay(new Uint8Array(buffer), defaultContent.hash);
          // The recording knows its own map size; nothing else here does.
          const world = createEmptyWorld(snapshotMapTiles(replay.initialSnapshot));
          const session = new ReplaySession(world, replay);
          done({
            world,
            session,
            localPlayer: 0,
            isHost: false,
            replay: session,
            ai: new Map(),
            release: () => {},
          });
        })
        .catch((error: unknown) => {
          // Refusing loudly matters here: a replay that loaded but diverged
          // would look exactly like a simulation bug.
          alert(`That replay would not load.\n\n${message(error)}`);
          done(null);
        });
    };

    input.click();
  });
}

// ---------------------------------------------------------------------------

/** The lobby as the setup screen wants it. */
function viewToConfig(view: LobbyView): MatchConfig {
  return {
    mapId: view.mapId,
    seed: view.seed,
    slots: view.slots.map((slot, player) => ({
      kind: slot.kind as SlotKind,
      raceId: slot.raceId,
      name: slot.name || `Computer ${player + 1}`,
    })),
  };
}

/** Somebody to play against. A match of one is over before it begins. */
function hasOpponent(config: MatchConfig): boolean {
  return config.slots.filter((slot) => slot.kind !== "empty").length >= 2;
}

function computerPlayers(config: MatchConfig): Map<number, AiDriver> {
  const drivers = new Map<number, AiDriver>();
  config.slots.forEach((slot, player) => {
    if (slot.kind === "computer") drivers.set(player, idleAi);
  });
  return drivers;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
