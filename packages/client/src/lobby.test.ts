import { defaultContent } from "@rts/content";
import { MSG_LOBBY_HELLO, PROTOCOL_VERSION, encodeMessage } from "@rts/protocol";
import { VirtualNetwork } from "@rts/transport";
import { describe, expect, it } from "vitest";
import { LobbyGuest, type LobbyView } from "./lobby-guest.js";
import { LobbyHost } from "./lobby-host.js";
import { defaultConfig, emptySlots, type MatchConfig } from "./match.js";

/**
 * The pre-match lobby, host and guest together.
 *
 * Over the in-memory network, because everything interesting here is protocol
 * rather than sockets: who gets which slot, who is allowed to change what, and
 * what the roster says by the time the match starts. None of that needs a real
 * connection, and the two halves being socket-agnostic is what makes testing
 * them against each other possible at all.
 */

const SETTLE_MS = 20;

interface Fixture {
  net: VirtualNetwork;
  host: LobbyHost;
  /** The host's own view, as its screen would render it. */
  hostConfig: () => MatchConfig;
  join(peer: number, name: string, token: string): Guest;
}

interface Guest {
  guest: LobbyGuest;
  /** Last state the host sent, or null if never admitted. */
  view: () => LobbyView | null;
  closed: () => string | null;
  started: () => number | null;
}

function fixture(config?: MatchConfig): Fixture {
  const net = new VirtualNetwork(0xbeef);
  const initial: MatchConfig = config ?? {
    ...defaultConfig("Ada"),
    // Hosting opens with every other slot free, as the host screen does.
    slots: emptySlots().map((slot, player) =>
      player === 0 ? { ...slot, kind: "human" as const, name: "Ada" } : slot,
    ),
  };

  let latest = initial;
  const host = new LobbyHost({
    transport: net.addPeer(0),
    token: "host-token",
    name: "Ada",
    config: initial,
    onChange: (next) => {
      latest = next;
    },
  });

  return {
    net,
    host,
    hostConfig: () => latest,
    join(peer, name, token) {
      let view: LobbyView | null = null;
      let closed: string | null = null;
      let started: number | null = null;

      const guest = new LobbyGuest({
        transport: net.addPeer(peer),
        token,
        name,
        onState: (next) => {
          view = next;
        },
        onStart: (mapTiles) => {
          started = mapTiles;
        },
        onClosed: (reason) => {
          closed = reason;
        },
      });
      guest.connect();
      net.advance(SETTLE_MS);

      return {
        guest,
        view: () => view,
        closed: () => closed,
        started: () => started,
      };
    },
  };
}

describe("joining a lobby", () => {
  it("seats a guest in the first free slot and tells everyone", () => {
    const f = fixture();
    const bo = f.join(1, "Bo", "token-b");

    expect(bo.view()?.yourSlot).toBe(1);
    expect(bo.view()?.slots[0].name).toBe("Ada");
    expect(bo.view()?.slots[1]).toMatchObject({ kind: "human", name: "Bo", connected: true });
    // And the host's own screen sees the same thing.
    expect(f.hostConfig().slots[1]).toMatchObject({ kind: "human", name: "Bo" });
  });

  it("gives each guest its own row number", () => {
    // Per-recipient rather than broadcast, because a guest that had to guess
    // which row was its own would guess wrong the moment two people share a name.
    const f = fixture();
    expect(f.join(1, "Bo", "token-b").view()?.yourSlot).toBe(1);
    expect(f.join(2, "Cy", "token-c").view()?.yourSlot).toBe(2);
  });

  it("hands an arriving human a slot the host had set to Computer", () => {
    // Somebody who travelled to this address wants to play more than the host
    // wanted a fourth idle base.
    const f = fixture({
      ...defaultConfig("Ada"),
      slots: emptySlots().map((slot, player) => ({
        ...slot,
        kind: player === 0 ? ("human" as const) : ("computer" as const),
        name: player === 0 ? "Ada" : slot.name,
      })),
    });
    expect(f.join(1, "Bo", "token-b").view()?.yourSlot).toBe(1);
  });

  it("refuses a guest running different content, and says both hashes", () => {
    const f = fixture();
    let closed: string | null = null;
    const transport = f.net.addPeer(1);
    // Hand-rolled, because LobbyGuest has no API for lying about its content --
    // which is itself part of the answer.
    new LobbyGuest({
      transport,
      token: "token-b",
      name: "Bo",
      onState: () => {},
      onStart: () => {},
      onClosed: (reason) => {
        closed = reason;
      },
    });
    transport.send(
      0,
      encodeMessage({
        t: MSG_LOBBY_HELLO,
        protocol: PROTOCOL_VERSION,
        contentHash: 0x12345678,
        token: "token-b",
        name: "Bo",
      }),
    );
    f.net.advance(SETTLE_MS);

    expect(closed).toContain("content mismatch");
    expect(closed).toContain("12345678");
    expect(closed).toContain(defaultContent.hash.toString(16).padStart(8, "0"));
  });

  it("refuses a fifth player rather than silently doing nothing", () => {
    const f = fixture();
    f.join(1, "Bo", "b");
    f.join(2, "Cy", "c");
    f.join(3, "Di", "d");
    expect(f.join(4, "Ed", "e").closed()).toContain("full");
  });
});

describe("what a guest may change", () => {
  it("applies a race pick and tells everyone", () => {
    const f = fixture();
    const bo = f.join(1, "Bo", "token-b");
    bo.guest.pick("concord");
    f.net.advance(SETTLE_MS);

    expect(bo.view()?.slots[1].raceId).toBe("concord");
    expect(f.hostConfig().slots[1].raceId).toBe("concord");
  });

  it("ignores a race that does not exist", () => {
    // The sender is a peer, not the UI. A race the host has never heard of
    // would build no base at all.
    const f = fixture();
    const bo = f.join(1, "Bo", "token-b");
    const before = bo.view()?.slots[1].raceId;
    bo.guest.pick("not-a-race");
    f.net.advance(SETTLE_MS);
    expect(bo.view()?.slots[1].raceId).toBe(before);
  });

  it("pushes the host's map change out to the guests", () => {
    const f = fixture();
    const bo = f.join(1, "Bo", "token-b");
    f.host.update({ ...f.host.config, mapId: "sprawl" });
    f.net.advance(SETTLE_MS);
    expect(bo.view()?.mapId).toBe("sprawl");
  });
});

describe("leaving", () => {
  it("frees a slot vacated in the lobby", () => {
    // Unlike one vacated mid-match: there are no units on the field to come
    // back to yet, so the seat is open for whoever is next.
    const f = fixture();
    f.join(1, "Bo", "token-b");
    expect(f.hostConfig().slots[1].kind).toBe("human");

    f.net.removePeer(1);
    f.net.advance(SETTLE_MS);
    expect(f.hostConfig().slots[1].kind).toBe("empty");

    expect(f.join(2, "Cy", "token-c").view()?.yourSlot).toBe(1);
  });

  it("does not disturb the players who stayed", () => {
    const f = fixture();
    f.join(1, "Bo", "token-b");
    f.join(2, "Cy", "token-c");

    f.net.removePeer(1);
    f.net.advance(SETTLE_MS);

    // The freed seat is reused -- by Bo returning or by anyone else, it makes no
    // difference pre-match -- and Cy keeps theirs either way. Token identity
    // starts mattering once the match does; see roster.test.ts.
    expect(f.join(3, "Bo", "token-b").view()?.yourSlot).toBe(1);
    expect(f.hostConfig().slots[2].name).toBe("Cy");
    expect(f.hostConfig().slots[2].kind).toBe("human");
  });
});

describe("starting the match", () => {
  it("tells every guest, with the map size they need", () => {
    const f = fixture();
    const bo = f.join(1, "Bo", "token-b");
    f.host.update({ ...f.host.config, mapId: "sprawl" });
    f.net.advance(SETTLE_MS);

    f.host.start();
    f.net.advance(SETTLE_MS);
    // The guest has to build a world of exactly this size before the welcome
    // snapshot can be decoded into it.
    expect(bo.started()).toBe(1024);
  });

  it("hands the match a roster of humans only", () => {
    const f = fixture();
    f.join(1, "Bo", "token-b");
    f.host.update({
      ...f.host.config,
      slots: f.host.config.slots.map((slot, player) =>
        player === 2 ? { ...slot, kind: "computer" as const } : slot,
      ),
    });
    f.net.advance(SETTLE_MS);

    // A computer slot has nobody to connect for it, so it is not on the guest
    // list -- and the host's own entry carries its real name, not "host".
    expect(f.host.start()).toEqual([
      { token: "host-token", playerId: 0, name: "Ada" },
      { token: "token-b", playerId: 1, name: "Bo" },
    ]);
  });

  it("stops answering the lobby once the match has begun", () => {
    // The same socket now carries the match protocol. A lobby message arriving
    // late must not be answered on it.
    const f = fixture();
    const bo = f.join(1, "Bo", "token-b");
    f.host.start();
    f.net.advance(SETTLE_MS);

    const before = f.hostConfig().slots[1].raceId;
    bo.guest.pick(before === "vanguard" ? "concord" : "vanguard");
    f.net.advance(SETTLE_MS);
    expect(f.hostConfig().slots[1].raceId).toBe(before);
  });
});

/*
 * Not tested here: `LobbyHost.clampToMap` evicting a player when the host
 * switches to a map with fewer start positions. Both shipped maps seat four, so
 * there is no way to reach it through the real content set, and a test that
 * faked its way in would be asserting against a situation that cannot occur.
 * The guard stays because a third map could seat two.
 */
