import { defaultContent } from "@rts/content";
import {
  CMD_MOVE,
  NEUTRAL_PLAYER,
  TICK_MS,
  World,
  enableDevChecks,
  fxFromFloat,
  recomputeSupplyAndDefeat,
  spawnTyped,
  type Command,
  type EntityId,
} from "@rts/sim";
import { VirtualNetwork } from "@rts/transport";
import { beforeAll, describe, expect, it } from "vitest";
import { GuestSession } from "./guest.js";
import { HostSession } from "./host.js";

/**
 * Reconnecting after a dropped connection.
 *
 * A WebRTC data channel dies for reasons unrelated to either player: a laptop
 * sleeps, a phone changes cell, a router drops a NAT binding after a quiet
 * minute. Without reconnect support, any of those ends the match for that
 * person and leaves their army standing on the field being shot.
 *
 * The whole mechanism is that the host keys player slots on a token the client
 * keeps, rather than on the peer id, which is the identity of a *socket* and
 * changes when they come back. These tests exercise that at the seam where it
 * matters: a genuinely new transport, a genuinely new session, and an
 * assertion that the returning player got their own units rather than a fresh
 * empty slot.
 */

beforeAll(() => {
  enableDevChecks(true);
});

const content = defaultContent;
const MAP_TILES = 64;
const NEXUS = content.id("vanguard.nexus");
const DRONE = content.id("vanguard.drone");
const ORE = content.id("map.alloy-node");

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

interface Harness {
  net: VirtualNetwork;
  host: HostSession;
  guest: GuestSession;
  /** The world the guest keeps across reconnects. */
  guestWorld: World;
  tick(count?: number): void;
  drain(guest?: GuestSession): void;
  /** Drop the guest's link and bring it back on a new peer id. */
  reconnect(peerId: number, token: string): GuestSession;
}

function makeHarness(token = "player-a", latencyMs = 30): Harness {
  const net = new VirtualNetwork(0x2468);
  const hostTransport = net.addPeer(0);
  const guestTransport = net.addPeer(1);
  net.setSymmetricLink(0, 1, { latencyMs });

  const host = new HostSession({
    world: buildWorld(31337),
    transport: hostTransport,
    inputDelay: 4,
    hashInterval: 20,
    contentHash: content.hash,
  });

  // The guest keeps ONE world across every reconnect, exactly as the client
  // does -- the renderer, selection and HUD all hold a reference to it.
  const guestWorld = new World({ mapTiles: MAP_TILES, seed: 1, types: content.types });
  let guest = new GuestSession({
    world: guestWorld,
    transport: guestTransport,
    hashInterval: 20,
    name: "guest",
    token,
    contentHash: content.hash,
  });
  guest.connect();
  net.advance(latencyMs * 3 + 10);
  /** Peer id the guest is currently on. Changes with every reconnect. */
  let current = 1;

  const harness: Harness = {
    net,
    host,
    get guest() {
      return guest;
    },
    guestWorld,
    tick(count = 1) {
      for (let i = 0; i < count; i++) {
        host.update(TICK_MS);
        net.advance(TICK_MS / 2);
        guest.update(TICK_MS);
        net.advance(TICK_MS / 2);
      }
    },
    drain(target = guest) {
      const goal = host.world.tick;
      for (let i = 0; i < 400; i++) {
        net.advance(TICK_MS);
        target.update(TICK_MS);
        if (target.world.tick >= goal) return;
      }
      throw new Error(`guest failed to reach tick ${goal}`);
    },
    reconnect(peerId: number, newToken: string) {
      // Everything the browser does on a drop: the old link dies, a new one is
      // negotiated with a brand-new peer id, and a fresh session is built over
      // the same world.
      guest.close();
      net.removePeer(current, "connection lost");
      current = peerId;
      const fresh = net.addPeer(peerId);
      net.setSymmetricLink(0, peerId, { latencyMs });

      guest = new GuestSession({
        world: guestWorld,
        transport: fresh,
        hashInterval: 20,
        name: "guest",
        token: newToken,
        contentHash: content.hash,
      });
      guest.connect();
      net.advance(latencyMs * 3 + 10);
      return guest;
    },
  } as Harness;

  return harness;
}

/** Entities a player owns, in the host's authoritative world. */
function owned(world: World, player: number): EntityId[] {
  const out: EntityId[] = [];
  const e = world.entities;
  for (let i = 0; i < e.highWater; i++) {
    if (e.alive[i] === 1 && e.owner[i] === player) out.push(e.idAt(i));
  }
  return out;
}

describe("reconnect", () => {
  it("returns a player to their own slot and their own army", () => {
    const h = makeHarness();
    expect(h.guest.localPlayerId).toBe(1);

    // Play a while, then move the guest's drones so its slot has visible state.
    const drones = owned(h.host.world, 1).filter(
      (id) => h.host.world.entities.moveSpeed[id & 0xffff] > 0,
    );
    h.guest.submitLocal({
      kind: CMD_MOVE,
      playerId: 1,
      entities: drones,
      targetX: fxFromFloat(30),
      targetY: fxFromFloat(30),
    } satisfies Command);
    h.tick(200);

    const armyBefore = owned(h.host.world, 1).length;
    expect(armyBefore).toBeGreaterThan(0);

    // Drop, and keep the match running while the player is away.
    const rejoined = h.reconnect(7, "player-a");
    h.tick(120);
    h.drain(rejoined);

    // Same player id, same army, and in step with the host again.
    expect(rejoined.localPlayerId).toBe(1);
    expect(owned(h.host.world, 1).length).toBe(armyBefore);
    expect(rejoined.world.hash()).toBe(h.host.world.hash());
    expect(h.host.desyncs).toBe(0);
  });

  it("keeps the match running while a player is away", () => {
    // The host owns the clock, so one player's connection dying must not stop
    // anybody else's game.
    const h = makeHarness();
    h.tick(40);
    const tickAtDrop = h.host.world.tick;

    h.guest.close();
    h.net.removePeer(1, "connection lost");
    for (let i = 0; i < 150; i++) h.host.update(TICK_MS);

    expect(h.host.world.tick - tickAtDrop).toBeGreaterThan(100);
    expect(h.host.players.find((p) => p.playerId === 1)?.connected).toBe(false);
  });

  it("can issue orders again immediately after coming back", () => {
    const h = makeHarness();
    h.tick(60);
    const rejoined = h.reconnect(9, "player-a");
    h.tick(20);

    const drones = owned(h.host.world, 1).filter(
      (id) => h.host.world.entities.moveSpeed[id & 0xffff] > 0,
    );
    const before = h.host.world.entities.posX[drones[0] & 0xffff];
    rejoined.submitLocal({
      kind: CMD_MOVE,
      playerId: 1,
      entities: drones,
      targetX: fxFromFloat(30),
      targetY: fxFromFloat(30),
    } satisfies Command);

    h.tick(150);
    h.drain(rejoined);
    expect(h.host.world.entities.posX[drones[0] & 0xffff]).not.toBe(before);
    expect(rejoined.world.hash()).toBe(h.host.world.hash());
  });

  it("gives a different token a different slot", () => {
    // The mirror of the first test, and the reason the token has no default:
    // two players who happened to share one would silently take over each
    // other's army.
    const h = makeHarness("player-a");
    h.tick(40);
    const stranger = h.reconnect(11, "player-b");
    h.tick(20);

    expect(stranger.localPlayerId).not.toBe(1);
    expect(stranger.localPlayerId).toBe(2);
    // Player 1's units are untouched, waiting for the original player.
    expect(owned(h.host.world, 1).length).toBeGreaterThan(0);
  });

  it("does not replay schedules buffered before the drop", () => {
    // Those ticks are already baked into the snapshot the host sends on
    // rejoining. Merging the old buffer in would run their commands a second
    // time, which is a desync that looks like a simulation bug.
    const h = makeHarness();
    h.tick(80);
    const rejoined = h.reconnect(13, "player-a");
    expect(rejoined.bufferedTicks).toBe(0);

    h.tick(100);
    h.drain(rejoined);
    expect(rejoined.world.hash()).toBe(h.host.world.hash());
    expect(h.host.desyncs).toBe(0);
  });

  it("refuses a fifth player rather than handing out an invalid slot", () => {
    // Player ids index fixed-size arrays in the simulation. Slot 4 would read
    // past the end of every per-player array in the world.
    const h = makeHarness("player-a");
    let last: GuestSession | null = null;
    for (const [peer, token] of [
      [21, "b"],
      [22, "c"],
      [23, "d"],
    ] as const) {
      const extra = h.net.addPeer(peer);
      h.net.setSymmetricLink(0, peer, { latencyMs: 30 });
      last = new GuestSession({
        world: new World({ mapTiles: MAP_TILES, seed: 1, types: content.types }),
        transport: extra,
        name: token,
        token,
        contentHash: content.hash,
      });
      last.connect();
      h.net.advance(200);
    }
    expect(last!.isJoined).toBe(false);
  });
});
