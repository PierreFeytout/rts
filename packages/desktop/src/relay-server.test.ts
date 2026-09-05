import { defaultContent } from "@rts/content";
import { GuestSession, HostSession } from "@rts/netcode";
import {
  CMD_MOVE,
  NEUTRAL_PLAYER,
  TICK_MS,
  World,
  enableDevChecks,
  fxFromFloat,
  recomputeSupplyAndDefeat,
  spawnTyped,
  type EntityId,
} from "@rts/sim";
import { SocketTransport, type SocketLike } from "@rts/transport";
import { WebSocket } from "ws";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { startRelay, type RunningRelay } from "./relay-server.js";

/**
 * A real match over real sockets.
 *
 * Every other test in the project runs the netcode over an in-process
 * transport, which is the right default -- it makes lockstep bugs findable
 * without any networking involved. This one exists for the seam those tests
 * cannot cover: an actual listening socket, actual TCP framing, and the
 * host connecting to its own relay over loopback exactly as it does in the
 * desktop app.
 *
 * It is the closest thing to "does the game work when a friend types your
 * address", short of a second machine.
 */

beforeAll(() => {
  enableDevChecks(true);
});

const content = defaultContent;
const MAP_TILES = 64;
const NEXUS = content.id("vanguard.nexus");
const DRONE = content.id("vanguard.drone");
const ORE = content.id("map.alloy-node");

let running: RunningRelay | null = null;
const openSockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of openSockets.splice(0)) socket.close();
  await running?.close();
  running = null;
});

function buildWorld(seed: number): World {
  const world = new World({ mapTiles: MAP_TILES, seed, types: content.types });
  for (const [player, bx, by] of [
    [0, 8, 8],
    [1, 40, 40],
  ] as const) {
    world.placeStructure(NEXUS, bx, by, player);
    world.placeStructure(ORE, bx + 7, by, NEUTRAL_PLAYER);
    for (let d = 0; d < 4; d++) {
      spawnTyped(
        world.entities,
        world.types,
        DRONE,
        fxFromFloat(bx + 5 + (d % 2) * 0.8),
        fxFromFloat(by + 4 + Math.floor(d / 2) * 0.8),
        player,
      );
    }
    world.players.inPlay[player] = 1;
  }
  recomputeSupplyAndDefeat(world);
  return world;
}

/** Open a socket to the relay and wait for it to be assigned a peer id. */
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

function ownedUnits(world: World, player: number): EntityId[] {
  const out: EntityId[] = [];
  const e = world.entities;
  for (let i = 0; i < e.highWater; i++) {
    if (e.alive[i] === 1 && e.owner[i] === player && e.moveSpeed[i] > 0) out.push(e.idAt(i));
  }
  return out;
}

describe("a match over real sockets", () => {
  it("plays host against guest and keeps both worlds identical", async () => {
    // Port 0 asks the OS for a free one, so the test cannot collide with a
    // game the developer happens to be hosting.
    running = await startRelay({ port: 0 });

    const hostTransport = await connect(running.port);
    expect(hostTransport.localPeer).toBe(0);

    const hostWorld = buildWorld(4242);
    const host = new HostSession({
      world: hostWorld,
      transport: hostTransport,
      inputDelay: 4,
      hashInterval: 20,
      contentHash: content.hash,
    });

    const guestTransport = await connect(running.port);
    expect(guestTransport.localPeer).toBe(1);

    const guestWorld = new World({ mapTiles: MAP_TILES, seed: 1, types: content.types });
    let welcomed = -1;
    const guest = new GuestSession({
      world: guestWorld,
      transport: guestTransport,
      hashInterval: 20,
      name: "guest",
      token: "socket-test",
      contentHash: content.hash,
      onWelcome: (playerId) => {
        welcomed = playerId;
      },
    });
    guest.connect();
    await settle(120);

    expect(welcomed).toBe(1);
    expect(guest.isJoined).toBe(true);
    expect(guestWorld.entities.count).toBe(hostWorld.entities.count);

    // The guest orders its own units, which only works if its commands reach
    // the host through the relay and come back in a tick schedule.
    const drones = ownedUnits(hostWorld, 1);
    guest.submitLocal({
      kind: CMD_MOVE,
      playerId: 1,
      entities: drones,
      targetX: fxFromFloat(30),
      targetY: fxFromFloat(30),
    });

    const startX = hostWorld.entities.posX[drones[0] & 0xffff];
    for (let i = 0; i < 200; i++) {
      host.update(TICK_MS);
      guest.update(TICK_MS);
      if (i % 20 === 0) await settle(5);
    }
    await settle(150);
    while (guestWorld.tick < hostWorld.tick) guest.update(TICK_MS);

    expect(hostWorld.entities.posX[drones[0] & 0xffff]).not.toBe(startX);
    expect(guestWorld.hash()).toBe(hostWorld.hash());
    expect(host.desyncs).toBe(0);
    expect(running.relay.refused).toBe(0);
  });

  it("refuses a fifth player with a reason", async () => {
    running = await startRelay({ port: 0, maxPlayers: 2 });
    await connect(running.port);
    await connect(running.port);

    await expect(connect(running.port)).rejects.toThrow(/full/);
  });

  it("tells the host when a player disconnects", async () => {
    running = await startRelay({ port: 0 });
    const hostTransport = await connect(running.port);
    const left: number[] = [];
    hostTransport.on("peerLeave", (peer) => left.push(peer));

    const guestTransport = await connect(running.port);
    await settle();
    guestTransport.close();
    await settle();

    expect(left).toEqual([1]);
  });

  it("serves nothing but the lobby protocol on its port", async () => {
    // A player's home machine should expose one thing to the internet, not a
    // file server as well. The old broker served the client; this does not.
    running = await startRelay({ port: 0 });
    const response = await fetch(`http://127.0.0.1:${running.port}/`);
    expect(response.status).toBe(426);
    expect(await response.text()).toContain("lobby protocol");
  });
});
