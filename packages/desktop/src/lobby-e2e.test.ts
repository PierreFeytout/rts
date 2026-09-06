import { defaultContent } from "@rts/content";
import { GuestSession, HostSession } from "@rts/netcode";
import { TICK_MS, enableDevChecks, type World } from "@rts/sim";
import { SocketTransport, type SocketLike } from "@rts/transport";
import { WebSocket } from "ws";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
// Reaching across into the renderer's package, deliberately. The lobby lives
// there because it is a screen; the socket it runs over lives here. This is the
// only place the two meet, and the seam is worth one real test rather than two
// halves that each work alone.
import { LobbyGuest, type LobbyView } from "../../client/src/lobby-guest.js";
import { LobbyHost } from "../../client/src/lobby-host.js";
import { createEmptyWorld, createMatchWorld, emptySlots } from "../../client/src/match.js";
import { startRelay, type RunningRelay } from "./relay-server.js";

/**
 * Host a game, have a friend join, pick a race, start -- over a real socket.
 *
 * The lobby's own tests run over the in-process network, which is where the
 * protocol questions belong. This one covers what those cannot: that the same
 * connection carries the lobby conversation and then the match, with no second
 * handshake and nothing left listening in between. Handing a live socket from
 * one protocol to another is the part most likely to be subtly wrong, and it
 * cannot be wrong in a way an in-memory transport would reveal.
 */

beforeAll(() => {
  enableDevChecks(true);
});

let running: RunningRelay | null = null;
const openSockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of openSockets.splice(0)) socket.close();
  await running?.close();
  running = null;
});

function connect(port: number): Promise<SocketTransport> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    openSockets.push(socket);
    socket.binaryType = "arraybuffer";

    const timer = setTimeout(() => reject(new Error("relay did not answer")), 4000);
    const transport = new SocketTransport({
      socket: socket as unknown as SocketLike,
      onReady: () => {
        clearTimeout(timer);
        resolve(transport);
      },
      onRejected: (reason) => {
        clearTimeout(timer);
        reject(new Error(reason));
      },
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/** Let queued socket traffic actually cross the loopback interface. */
function settle(ms = 60): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("the lobby, over a real socket", () => {
  it("carries a guest from joining to playing on one connection", async () => {
    // Port 0 asks the OS for a free one, so the test cannot collide with a game
    // the developer happens to be hosting.
    running = await startRelay({ port: 0 });

    // -- the host opens a lobby ---------------------------------------------
    const hostTransport = await connect(running.port);
    expect(hostTransport.localPeer).toBe(0);

    let hostView = {
      mapId: "rift-basin",
      seed: 99,
      slots: emptySlots().map((slot, player) =>
        player === 0 ? { ...slot, kind: "human" as const, name: "Ada" } : slot,
      ),
    };
    const lobby = new LobbyHost({
      transport: hostTransport,
      token: "host-token",
      name: "Ada",
      config: hostView,
      onChange: (next) => {
        hostView = next;
      },
    });

    // -- a friend joins ------------------------------------------------------
    const guestTransport = await connect(running.port);
    expect(guestTransport.localPeer).toBe(1);

    let view: LobbyView | null = null;
    let startedWith = -1;
    const lobbyGuest = new LobbyGuest({
      transport: guestTransport,
      token: "guest-token",
      name: "Bo",
      onState: (next) => {
        view = next;
      },
      onStart: (mapTiles) => {
        startedWith = mapTiles;
      },
      onClosed: (reason) => {
        throw new Error(`guest was refused: ${reason}`);
      },
    });
    lobbyGuest.connect();
    await settle();

    expect(view).not.toBeNull();
    expect(view!.yourSlot).toBe(1);
    expect(view!.slots[0].name).toBe("Ada");

    // -- and picks a race ----------------------------------------------------
    lobbyGuest.pick("concord");
    await settle();
    expect(view!.slots[1].raceId).toBe("concord");
    expect(hostView.slots[1].raceId).toBe("concord");

    // -- the host starts -----------------------------------------------------
    const roster = lobby.start();
    expect(roster).toEqual([
      { token: "host-token", playerId: 0, name: "Ada" },
      { token: "guest-token", playerId: 1, name: "Bo" },
    ]);

    const hostWorld = createMatchWorld(hostView);
    const host = new HostSession({
      world: hostWorld,
      transport: hostTransport,
      inputDelay: 4,
      hashInterval: 20,
      contentHash: defaultContent.hash,
      roster,
    });
    await settle();
    expect(startedWith).toBe(hostWorld.mapTiles);

    // -- the guest joins the match, on the same socket ------------------------
    const guestWorld = createEmptyWorld(startedWith);
    let welcomed = -1;
    const guest = new GuestSession({
      world: guestWorld,
      transport: guestTransport,
      name: "Bo",
      token: "guest-token",
      contentHash: defaultContent.hash,
      onWelcome: (playerId) => {
        welcomed = playerId;
      },
      onReject: (reason) => {
        throw new Error(`match refused the guest: ${reason}`);
      },
    });
    guest.connect();
    await settle(120);

    expect(welcomed).toBe(1);

    // -- and both worlds agree ------------------------------------------------
    for (let i = 0; i < 40; i++) {
      host.update(TICK_MS);
      await settle(4);
      guest.update(TICK_MS);
    }
    await settle(150);
    guest.update(TICK_MS * 10);

    expect(guestWorld.tick).toBeGreaterThan(0);
    const tick = Math.min(hostWorld.tick, guestWorld.tick);
    expect(tick).toBeGreaterThan(5);

    // The guest plays the race it chose in the lobby -- which is the whole
    // point of the lobby, and is carried entirely by the welcome snapshot.
    const heartwood = defaultContent.race("concord").startBuilding;
    const nexus = defaultContent.race("vanguard").startBuilding;
    expect(ownsType(guestWorld, 1, heartwood)).toBe(true);
    expect(ownsType(guestWorld, 0, nexus)).toBe(true);
    expect(host.desyncs).toBe(0);
  });

  it("refuses a stranger once the match has begun", async () => {
    running = await startRelay({ port: 0 });

    const hostTransport = await connect(running.port);
    const config = {
      mapId: "rift-basin",
      seed: 7,
      slots: emptySlots().map((slot, player) =>
        player === 0
          ? { ...slot, kind: "human" as const, name: "Ada" }
          : player === 1
            ? { ...slot, kind: "computer" as const }
            : slot,
      ),
    };
    const lobby = new LobbyHost({
      transport: hostTransport,
      token: "host-token",
      name: "Ada",
      config,
      onChange: () => {},
    });
    const roster = lobby.start();
    new HostSession({
      world: createMatchWorld(config),
      transport: hostTransport,
      contentHash: defaultContent.hash,
      roster,
    });
    await settle();

    // Somebody who was never in the lobby has no base on the field and nothing
    // to play. The refusal has to say so rather than seating them.
    const lateTransport = await connect(running.port);
    let rejection = "";
    const late = new GuestSession({
      world: createEmptyWorld(defaultContent.map("rift-basin").size),
      transport: lateTransport,
      name: "Ed",
      token: "never-in-the-lobby",
      contentHash: defaultContent.hash,
      onReject: (reason) => {
        rejection = reason;
      },
    });
    late.connect();
    await settle(120);

    expect(late.isJoined).toBe(false);
    expect(rejection).toContain("already begun");
  });
});

function ownsType(world: World, player: number, typeId: number): boolean {
  const e = world.entities;
  for (let i = 0; i < e.highWater; i++) {
    if (e.alive[i] === 1 && e.owner[i] === player && e.typeId[i] === typeId) return true;
  }
  return false;
}
