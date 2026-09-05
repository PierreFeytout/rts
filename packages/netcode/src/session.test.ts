import {
  FX_RUNNER,
  fixtureTypes,
  CMD_MOVE,
  CMD_STOP,
  TICK_MS,
  World,
  enableDevChecks,
  fxFromFloat,
  spawnUnit,
  type Command,
  type EntityId,
} from "@rts/sim";
import { MSG_HELLO, encodeMessage } from "@rts/protocol";
import { VirtualNetwork } from "@rts/transport";
import { beforeAll, describe, expect, it } from "vitest";
import { GuestSession } from "./guest.js";
import { HostSession } from "./host.js";

beforeAll(() => {
  enableDevChecks(true);
});

const MAP_TILES = 48;

function buildWorld(seed = 4242): World {
  return new World({ mapTiles: MAP_TILES, seed, types: fixtureTypes });
}

function populate(world: World, playerCount: number): EntityId[][] {
  const perPlayer: EntityId[][] = [];
  for (let p = 0; p < playerCount; p++) {
    const ids: EntityId[] = [];
    for (let i = 0; i < 12; i++) {
      ids.push(
        spawnUnit(world.entities, {
          x: fxFromFloat(4 + p * 8 + (i % 4)),
          y: fxFromFloat(4 + Math.floor(i / 4)),
          radius: fxFromFloat(0.32),
          moveSpeed: fxFromFloat(0.18),
          turnRate: 3600,
          owner: p,
          typeId: FX_RUNNER,
          health: 100,
        }),
      );
    }
    perPlayer.push(ids);
  }
  return perPlayer;
}

function moveCmd(playerId: number, ids: EntityId[], x: number, y: number): Command {
  return {
    kind: CMD_MOVE,
    playerId,
    entities: ids,
    targetX: fxFromFloat(x),
    targetY: fxFromFloat(y),
  };
}

interface Harness {
  net: VirtualNetwork;
  host: HostSession;
  guests: GuestSession[];
  units: EntityId[][];
  /** Advance every session and the network by one tick's worth of time. */
  tick(count?: number): void;
  /**
   * Let the network settle and every guest catch up to the host's tick, with
   * the host's clock frozen.
   *
   * Necessary before comparing hashes across peers. A guest is ALWAYS behind
   * the host by roughly the transmission delay -- that is what lockstep over a
   * real link looks like -- so comparing `host.hash()` to `guest.hash()` at the
   * same wall-clock moment compares two different ticks and is meaningless.
   * Hashes are only comparable at equal tick numbers.
   */
  drain(waitFor?: GuestSession[], maxRounds?: number): void;
  all(): Array<HostSession | GuestSession>;
}

function makeHarness(guestCount: number, latencyMs = 40, jitterMs = 0): Harness {
  const net = new VirtualNetwork(0xbeef);
  const hostTransport = net.addPeer(0);

  const hostWorld = buildWorld();
  const units = populate(hostWorld, guestCount + 1);
  const host = new HostSession({ world: hostWorld, transport: hostTransport, inputDelay: 4 });

  const guests: GuestSession[] = [];
  for (let g = 1; g <= guestCount; g++) {
    const transport = net.addPeer(g);
    net.setSymmetricLink(0, g, { latencyMs, jitterMs });
    // A guest starts from an EMPTY world; everything arrives in the welcome
    // snapshot. Constructing it independently would be one more thing that
    // could silently disagree.
    const guest = new GuestSession({
      world: buildWorld(1),
      transport,
      name: `guest${g}`,
    });
    guests.push(guest);
    guest.connect();
  }

  // Let the handshake complete.
  net.advance(latencyMs * 3 + jitterMs + 10);

  return {
    net,
    host,
    guests,
    units,
    all: () => [host, ...guests],
    tick(count = 1) {
      for (let i = 0; i < count; i++) {
        host.update(TICK_MS);
        net.advance(TICK_MS / 2);
        for (const guest of guests) guest.update(TICK_MS);
        net.advance(TICK_MS / 2);
      }
    },
    // `waitFor` defaults to every guest. Pass a subset when a peer has been
    // disconnected on purpose -- it can never advance again, so waiting on it
    // would hang rather than tell us anything.
    drain(waitFor = guests, maxRounds = 400) {
      const target = host.world.tick;
      for (let i = 0; i < maxRounds; i++) {
        net.advance(TICK_MS);
        let caughtUp = true;
        for (const guest of guests) guest.update(TICK_MS);
        for (const guest of waitFor) {
          if (guest.world.tick < target) caughtUp = false;
        }
        if (caughtUp) return;
      }
      throw new Error(`guests failed to reach tick ${target} within ${maxRounds} rounds`);
    },
  };
}

describe("handshake", () => {
  it("assigns dense player ids and delivers the world", () => {
    const h = makeHarness(3);
    expect(h.guests.map((g) => g.localPlayerId)).toEqual([1, 2, 3]);
    for (const guest of h.guests) {
      expect(guest.isJoined).toBe(true);
      expect(guest.world.entities.count).toBe(h.host.world.entities.count);
      expect(guest.world.hash()).toBe(h.host.world.hash());
    }
  });

  it("rejects a peer speaking a different protocol version", () => {
    // Without this the failure mode is a mid-match desync with no visible
    // cause, which is far harder to diagnose than a refusal at the door.
    const net = new VirtualNetwork();
    const hostTransport = net.addPeer(0);
    const guestTransport = net.addPeer(1);
    new HostSession({ world: buildWorld(), transport: hostTransport });

    let rejection = "";
    const guest = new GuestSession({
      world: buildWorld(),
      transport: guestTransport,
      onReject: (reason) => {
        rejection = reason;
      },
    });

    // Hand-roll a hello claiming an impossible version.
    guestTransport.send(
      0,
      encodeMessage({ t: MSG_HELLO, protocol: 999, contentHash: 0, name: "old" }),
    );
    net.advance(50);

    expect(guest.isJoined).toBe(false);
    expect(rejection).toContain("999");
  });
});

describe("lockstep", () => {
  it("keeps every peer hash-identical through a scripted match", () => {
    // The property the entire netcode exists to provide.
    const h = makeHarness(3, 45);

    for (let t = 0; t < 400; t++) {
      if (t === 5) h.host.submitLocal(moveCmd(0, h.units[0], 40, 40));
      if (t === 20) h.guests[0].submitLocal(moveCmd(1, h.units[1], 40, 8));
      if (t === 60) h.guests[1].submitLocal(moveCmd(2, h.units[2], 8, 40));
      if (t === 120) h.guests[2].submitLocal(moveCmd(3, h.units[3], 24, 24));
      if (t === 200) h.host.submitLocal({ kind: CMD_STOP, playerId: 0, entities: h.units[0] });
      h.tick();
    }

    h.drain();

    expect(h.host.desyncs).toBe(0);
    for (const guest of h.guests) {
      expect(guest.resyncs).toBe(0);
      expect(guest.world.tick).toBe(h.host.world.tick);
      expect(guest.world.hash()).toBe(h.host.world.hash());
    }
  });

  it("survives heavy jitter without desyncing", () => {
    const h = makeHarness(3, 60, 90);
    for (let t = 0; t < 300; t++) {
      if (t % 40 === 10) h.guests[t % 3].submitLocal(moveCmd((t % 3) + 1, h.units[(t % 3) + 1], 10 + (t % 20), 30));
      h.tick();
    }
    h.drain();

    expect(h.host.desyncs).toBe(0);
    for (const guest of h.guests) {
      expect(guest.world.tick).toBe(h.host.world.tick);
      expect(guest.world.hash()).toBe(h.host.world.hash());
    }
  });

  it("gives the host no input-latency advantage", () => {
    // Guests propose the tick their commands run at. If the host stamped
    // commands on arrival instead, its own orders would execute a full network
    // trip sooner -- which players experience as "the host always wins fights".
    const h = makeHarness(1, 80);

    h.host.submitLocal(moveCmd(0, h.units[0], 40, 40));
    h.guests[0].submitLocal(moveCmd(1, h.units[1], 40, 40));
    h.tick(30);

    const hostOrderTick = h.host.log.findIndex((c) => c.some((x) => x.playerId === 0));
    const guestOrderTick = h.host.log.findIndex((c) => c.some((x) => x.playerId === 1));

    expect(hostOrderTick).toBeGreaterThanOrEqual(0);
    expect(guestOrderTick).toBeGreaterThanOrEqual(0);
    // Allow a tick of slack for clock estimation; a full network trip would be
    // several ticks at this latency.
    expect(Math.abs(hostOrderTick - guestOrderTick)).toBeLessThanOrEqual(1);
    expect(h.host.lateCommandCount).toBe(0);
  });

  it("does not stall the match when a peer goes silent", () => {
    // Classic peer lockstep freezes everyone waiting for the laggiest client.
    // The host owns the clock precisely so that cannot happen.
    const h = makeHarness(2, 40);
    const tickBefore = h.host.world.tick;

    h.net.removePeer(2, "wifi died");
    for (let t = 0; t < 100; t++) {
      if (t === 10) h.host.submitLocal(moveCmd(0, h.units[0], 30, 30));
      h.tick();
    }

    expect(h.host.world.tick - tickBefore).toBeGreaterThan(90);
    // Only the surviving guest; peer 2 is gone and will never advance again.
    h.drain([h.guests[0]]);
    expect(h.guests[0].world.hash()).toBe(h.host.world.hash());
    expect(h.host.players.find((p) => p.playerId === 2)?.connected).toBe(false);
  });

  it("never lets a guest run ahead of the schedule it has received", () => {
    // A guest cannot invent commands it has not seen, so running ahead means
    // simulating a different game. It must stop and wait instead.
    const h = makeHarness(1, 250);
    for (let t = 0; t < 40; t++) h.tick();

    expect(h.guests[0].world.tick).toBeLessThanOrEqual(h.host.world.tick);
    // High latency should show up as starvation, not as divergence.
    expect(h.guests[0].resyncs).toBe(0);
  });

  it("keeps bandwidth flat as army size grows", () => {
    // The core claim of lockstep. Ordering 12 units and ordering 12 units
    // a hundred times over should cost nearly the same per tick, because only
    // intent travels -- never state.
    const measure = (unitsPerOrder: number): number => {
      const h = makeHarness(1, 30);
      const ids = h.units[0].slice(0, Math.min(unitsPerOrder, h.units[0].length));
      const before = h.net.deliveredBytes;
      for (let t = 0; t < 100; t++) {
        if (t === 10) h.host.submitLocal(moveCmd(0, ids, 40, 40));
        h.tick();
      }
      return h.net.deliveredBytes - before;
    };

    const small = measure(1);
    const large = measure(12);
    // The difference must be the order payload itself, not proportional to the
    // simulation's size or activity.
    expect(large - small).toBeLessThan(300);
  });
});

describe("desync detection and recovery", () => {
  it("detects a corrupted guest world and resyncs it", () => {
    const h = makeHarness(1, 30);
    const host = h.host;
    const originalDesyncs = host.desyncs;

    for (let t = 0; t < 20; t++) h.tick();

    // Corrupt the guest exactly as an undetected simulation bug would: one
    // unit, one fixed-point unit off.
    h.guests[0].world.entities.posX[0] += 1;
    expect(h.guests[0].world.hash()).not.toBe(host.world.hash());

    for (let t = 0; t < 120; t++) h.tick();

    expect(host.desyncs).toBeGreaterThan(originalDesyncs);
    expect(h.guests[0].resyncs).toBeGreaterThan(0);
    // And after the snapshot, the two must agree again.
    h.drain();
    expect(h.guests[0].world.hash()).toBe(host.world.hash());
  });

  it("stays in agreement after a resync, not just at the moment of it", () => {
    // A resync that restores state but leaves allocation or derived data
    // inconsistent would re-diverge within seconds, which looks like the
    // resync silently failing.
    const h = makeHarness(1, 30);
    for (let t = 0; t < 20; t++) h.tick();

    h.guests[0].world.entities.posY[3] -= 7;
    for (let t = 0; t < 120; t++) h.tick();
    expect(h.guests[0].resyncs).toBeGreaterThan(0);

    const resyncsAfterRecovery = h.guests[0].resyncs;
    for (let t = 0; t < 200; t++) {
      if (t === 40) h.host.submitLocal(moveCmd(0, h.units[0], 12, 40));
      h.tick();
    }
    h.drain();

    expect(h.guests[0].world.hash()).toBe(h.host.world.hash());
    // No further desyncs after the first recovery.
    expect(h.guests[0].resyncs).toBe(resyncsAfterRecovery);
  });
});

describe("command authority", () => {
  it("drops commands claiming another player's id", () => {
    // The host is another player's browser and may be modified, so a forged
    // playerId must never reach the authoritative command log.
    const h = makeHarness(1, 20);
    h.guests[0].submitLocal(moveCmd(0, h.units[0], 40, 40));
    h.tick(30);

    const forged = h.host.log.some((commands) => commands.some((c) => c.playerId === 0));
    expect(forged).toBe(false);
  });

  it("accepts commands a peer legitimately owns", () => {
    const h = makeHarness(1, 20);
    h.guests[0].submitLocal(moveCmd(1, h.units[1], 40, 40));
    h.tick(30);

    const accepted = h.host.log.some((commands) => commands.some((c) => c.playerId === 1));
    expect(accepted).toBe(true);
  });
});
