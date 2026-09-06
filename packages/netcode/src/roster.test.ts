import { FX_RUNNER, TICK_MS, World, fixtureTypes, fxFromFloat, spawnUnit } from "@rts/sim";
import { VirtualNetwork } from "@rts/transport";
import { describe, expect, it } from "vitest";
import { GuestSession } from "./guest.js";
import { HostSession, type RosterEntry } from "./host.js";

/**
 * The roster gate: who may still join once the match has started.
 *
 * The lobby closes at Start, so from then on there are exactly two kinds of
 * arrival -- a player coming back from a dropped connection, who must land back
 * on their own units, and a stranger, who has no base on the field and nothing
 * to play. Telling them apart is the roster's whole job.
 *
 * Every test here runs over the in-memory network, because the interesting
 * failures are handshake failures and none of them need a socket.
 */

const MAP_TILES = 48;

function world(seed = 7): World {
  const w = new World({ mapTiles: MAP_TILES, seed, types: fixtureTypes });
  for (let p = 0; p < 3; p++) {
    spawnUnit(w.entities, {
      x: fxFromFloat(4 + p * 8),
      y: fxFromFloat(4),
      radius: fxFromFloat(0.32),
      moveSpeed: fxFromFloat(0.18),
      turnRate: 3600,
      owner: p,
      typeId: FX_RUNNER,
      health: 100,
    });
  }
  return w;
}

const LOBBY: RosterEntry[] = [
  { token: "host-token", playerId: 0, name: "Ada" },
  { token: "token-b", playerId: 1, name: "Bo" },
  { token: "token-c", playerId: 2, name: "Cy" },
];

interface Fixture {
  net: VirtualNetwork;
  host: HostSession;
  /** Connect a guest and run the handshake to completion. */
  join(peer: number, token: string): { guest: GuestSession; rejection: string | null };
}

function fixture(roster?: readonly RosterEntry[]): Fixture {
  const net = new VirtualNetwork(0xbeef);
  const host = new HostSession({
    world: world(),
    transport: net.addPeer(0),
    ...(roster ? { roster } : {}),
  });

  return {
    net,
    host,
    join(peer: number, token: string) {
      let rejection: string | null = null;
      const guest = new GuestSession({
        world: world(1),
        transport: net.addPeer(peer),
        name: `peer${peer}`,
        token,
        onReject: (reason) => {
          rejection = reason;
        },
      });
      guest.connect();
      net.advance(TICK_MS * 4);
      return { guest, rejection };
    },
  };
}

describe("without a roster", () => {
  it("still accepts anyone, in arrival order", () => {
    // The engine tests and every pre-lobby match rely on this. A roster is an
    // opt-in restriction, not a new default.
    const f = fixture();
    expect(f.join(1, "whoever").guest.localPlayerId).toBe(1);
    expect(f.join(2, "somebody-else").guest.localPlayerId).toBe(2);
  });
});

describe("with a roster", () => {
  it("admits a player the lobby agreed on", () => {
    const f = fixture(LOBBY);
    const { guest, rejection } = f.join(1, "token-b");
    expect(rejection).toBeNull();
    expect(guest.isJoined).toBe(true);
  });

  it("gives them the player id the lobby assigned, not the next free one", () => {
    // Cy is player 2. Arriving first must not make them player 1 -- the base on
    // the field belongs to whichever slot the lobby placed it for, and a
    // renumbered player would find themselves commanding somebody else's units.
    const f = fixture(LOBBY);
    expect(f.join(1, "token-c").guest.localPlayerId).toBe(2);
    expect(f.join(2, "token-b").guest.localPlayerId).toBe(1);
  });

  it("refuses a stranger, and says why", () => {
    const f = fixture(LOBBY);
    const { guest, rejection } = f.join(1, "never-heard-of-them");
    expect(guest.isJoined).toBe(false);
    expect(rejection).toContain("already begun");
  });

  it("lets a dropped player back onto their own slot", () => {
    // The regression that would hurt most. Reconnect and initial join are the
    // same code path, so a gate that broke one would break the other.
    const f = fixture(LOBBY);
    const first = f.join(1, "token-b");
    expect(first.guest.localPlayerId).toBe(1);

    f.net.removePeer(1);
    f.net.advance(TICK_MS);

    const again = f.join(3, "token-b");
    expect(again.rejection).toBeNull();
    expect(again.guest.localPlayerId).toBe(1);
  });

  it("takes the host's own name from the roster", () => {
    // A scoreboard reading "host" next to three real names is the kind of
    // detail that makes a lobby feel unfinished.
    const f = fixture(LOBBY);
    expect(f.host.players[0]).toEqual({ playerId: 0, name: "Ada", connected: true });
  });
});
