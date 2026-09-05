import { describe, expect, it } from "vitest";
import { MatchRelay, type RelaySocket } from "./relay.js";
import { SocketTransport, type SocketLike } from "./socket-transport.js";
import { BROADCAST, FRAME_DATA, decodeFrame, encodeFrame } from "./socket-frame.js";
import { HOST_PEER, type PeerId } from "./transport.js";

/**
 * The direct-connection transport, end to end, without opening a port.
 *
 * Both halves are socket-agnostic on purpose, so the relay's routing and the
 * client's framing can be wired straight to each other in-process. That is the
 * same reason the old broker was written this way: the interesting failures are
 * routing failures, and none of them need a real network to reproduce.
 */

/**
 * A socket pair joining a `SocketTransport` to a `MatchRelay`.
 *
 * Delivery is synchronous. Ordering is what lockstep actually requires, and TCP
 * provides it; latency is modelled by `VirtualNetwork` where it matters, so
 * adding it here would only make these tests slower to read.
 */
function connect(relay: MatchRelay): {
  transport: SocketTransport;
  peer: PeerId;
  sentToRelay: Uint8Array[];
  drop: () => void;
} {
  const sentToRelay: Uint8Array[] = [];
  // The two ends of one pipe, so each has to reach the other. A holder breaks
  // the cycle without either being reassigned.
  const pipe: { client?: SocketLike } = {};

  const serverSide: RelaySocket = {
    send: (data) =>
      pipe.client?.onmessage?.({
        data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      }),
    close: () => pipe.client?.onclose?.({}),
  };

  const clientSide: SocketLike = {
    binaryType: "",
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    send: (data) => {
      sentToRelay.push(data);
      relay.receive(serverSide, data);
    },
    close: () => relay.disconnect(serverSide),
  };
  pipe.client = clientSide;

  let peer: PeerId = -1;
  const transport = new SocketTransport({
    socket: clientSide,
    onReady: (id) => {
      peer = id;
    },
  });
  relay.connect(serverSide);

  return { transport, peer, sentToRelay, drop: () => relay.disconnect(serverSide) };
}

describe("relay routing", () => {
  it("makes the first connection the host", () => {
    const relay = new MatchRelay();
    const host = connect(relay);
    expect(host.peer).toBe(HOST_PEER);
    expect(relay.hasHost).toBe(true);
  });

  it("assigns dense ids and reuses one that is freed", () => {
    const relay = new MatchRelay();
    connect(relay);
    const a = connect(relay);
    const b = connect(relay);
    expect([a.peer, b.peer]).toEqual([1, 2]);

    a.drop();
    const c = connect(relay);
    expect(c.peer).toBe(1);
  });

  it("carries a guest's message to the host, tagged with the sender", () => {
    const relay = new MatchRelay();
    const host = connect(relay);
    const guest = connect(relay);

    const received: Array<{ from: PeerId; text: string }> = [];
    host.transport.on("message", (from, data) => {
      received.push({ from, text: String.fromCharCode(...data) });
    });

    guest.transport.send(HOST_PEER, Uint8Array.from([104, 105]));
    expect(received).toEqual([{ from: guest.peer, text: "hi" }]);
  });

  it("fans a host broadcast out to every guest, once from the host", () => {
    const relay = new MatchRelay();
    const host = connect(relay);
    const a = connect(relay);
    const b = connect(relay);

    const seen: number[] = [];
    a.transport.on("message", () => seen.push(a.peer));
    b.transport.on("message", () => seen.push(b.peer));

    host.transport.broadcast(Uint8Array.from([1, 2, 3]));

    expect(seen.sort()).toEqual([a.peer, b.peer]);
    // One frame left the host, not one per guest. On a domestic uplink -- which
    // is what the hosting player has -- the difference is a smooth match or a
    // stuttering one.
    expect(host.sentToRelay.length).toBe(1);
  });

  it("refuses to carry a frame from one guest to another", () => {
    // The only security-relevant rule in the relay. Without it a modified
    // client could send tick schedules to another guest and split the match.
    const relay = new MatchRelay();
    connect(relay);
    const a = connect(relay);
    const b = connect(relay);

    const heard: unknown[] = [];
    b.transport.on("message", (from, data) => heard.push({ from, data }));

    a.transport.send(b.peer, Uint8Array.from([9]));

    expect(heard).toEqual([]);
    expect(relay.refused).toBe(1);
  });

  it("ignores a control frame forged by a client", () => {
    // Only the relay may say who joined. A client that could would be able to
    // invent peers the host then tries to send schedules to.
    const relay = new MatchRelay();
    const host = connect(relay);
    const guest = connect(relay);

    const joins: PeerId[] = [];
    host.transport.on("peerJoin", (peer) => joins.push(peer));

    // Hand-rolled: SocketTransport has no API for sending a control frame,
    // which is itself part of the answer.
    guest.transport["socket"].send(encodeFrame(2 /* FRAME_JOIN */, 77));

    expect(joins).toEqual([]);
    expect(relay.refused).toBeGreaterThan(0);
  });

  it("tells the host when a guest joins and when it leaves", () => {
    const relay = new MatchRelay();
    const host = connect(relay);
    const joins: PeerId[] = [];
    const leaves: PeerId[] = [];
    host.transport.on("peerJoin", (p) => joins.push(p));
    host.transport.on("peerLeave", (p) => leaves.push(p));

    const guest = connect(relay);
    expect(joins).toEqual([guest.peer]);

    guest.drop();
    expect(leaves).toEqual([guest.peer]);
    expect(host.transport.peers).toEqual([]);
  });

  it("ends the match for everyone when the host leaves", () => {
    // A guest's world is derived entirely from the host's command stream, so
    // with the host gone there is nothing left to derive from. Closing the
    // connections is more honest than leaving them frozen.
    const relay = new MatchRelay();
    const host = connect(relay);
    const guest = connect(relay);

    const reasons: string[] = [];
    guest.transport.on("peerLeave", (_peer, reason) => reasons.push(reason));

    host.drop();

    expect(relay.playerCount).toBe(0);
    expect(reasons[0]).toContain("host left");
  });

  it("refuses a fifth player with a reason rather than silently", () => {
    const relay = new MatchRelay({ maxPlayers: 4 });
    connect(relay);
    connect(relay);
    connect(relay);
    connect(relay);

    let rejection = "";
    const socket: RelaySocket = {
      send: (data) => {
        const frame = decodeFrame(data);
        if (frame?.kind === 4 /* FRAME_REJECT */) {
          rejection = String.fromCharCode(...frame.payload);
        }
      },
      close: () => {},
    };
    expect(relay.connect(socket)).toBeNull();
    expect(rejection).toContain("full");
  });
});

describe("framing", () => {
  it("round-trips a header and payload", () => {
    const frame = decodeFrame(encodeFrame(FRAME_DATA, 3, Uint8Array.from([7, 8, 9])));
    expect(frame).not.toBeNull();
    expect(frame!.kind).toBe(FRAME_DATA);
    expect(frame!.peer).toBe(3);
    expect([...frame!.payload]).toEqual([7, 8, 9]);
  });

  it("survives the broadcast id, which is the largest one used", () => {
    const frame = decodeFrame(encodeFrame(FRAME_DATA, BROADCAST));
    expect(frame!.peer).toBe(BROADCAST);
  });

  it("returns null for bytes too short to be a frame", () => {
    // Input from the network. A malformed frame must be a dropped message, not
    // a crashed host.
    expect(decodeFrame(Uint8Array.from([0, 1]))).toBeNull();
  });

  it("does not copy the payload", () => {
    // The receiver hands it straight to a decoder that reads it synchronously.
    // Copying every frame would double the cost of the largest message in the
    // protocol, which is the snapshot a joining player receives.
    const encoded = encodeFrame(FRAME_DATA, 1, Uint8Array.from([1, 2, 3]));
    const frame = decodeFrame(encoded)!;
    expect(frame.payload.buffer).toBe(encoded.buffer);
  });
});
