import { describe, expect, it } from "vitest";
import { Broker, normaliseCode, type BrokerSocket } from "./broker.js";
import { SIGNALING_VERSION, type ServerMessage } from "./broker-protocol.js";

let nextSocketId = 1;

class FakeSocket implements BrokerSocket {
  readonly id = nextSocketId++;
  readonly sent: ServerMessage[] = [];
  closed: { code: number; reason: string } | null = null;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ServerMessage);
  }

  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }

  /** Most recent message, which is what assertions almost always want. */
  get last(): ServerMessage | undefined {
    return this.sent[this.sent.length - 1];
  }

  ofType<T extends ServerMessage["type"]>(type: T): Array<Extract<ServerMessage, { type: T }>> {
    return this.sent.filter((m) => m.type === type) as Array<Extract<ServerMessage, { type: T }>>;
  }
}

function send(broker: Broker, socket: BrokerSocket, message: unknown): void {
  broker.handleMessage(socket, JSON.stringify(message));
}

function create(broker: Broker, socket: BrokerSocket): string {
  send(broker, socket, { type: "create", version: SIGNALING_VERSION });
  const last = (socket as FakeSocket).last;
  if (last?.type !== "created") throw new Error(`create failed: ${JSON.stringify(last)}`);
  return last.code;
}

function join(broker: Broker, socket: BrokerSocket, code: string): void {
  send(broker, socket, { type: "join", version: SIGNALING_VERSION, code });
}

/** Deterministic codes, so tests never depend on randomness. */
function sequentialCodes(): () => string {
  let n = 0;
  return () => `CODE${String(n++).padStart(2, "0")}`;
}

describe("rooms", () => {
  it("creates a room and returns a code", () => {
    const broker = new Broker({ generateCode: sequentialCodes() });
    const host = new FakeSocket();
    const code = create(broker, host);

    expect(code).toBe("CODE00");
    expect(host.last).toEqual({ type: "created", code: "CODE00", peerId: 0 });
    expect(broker.roomCount).toBe(1);
  });

  it("assigns the host peer 0 and guests from 1 upward", () => {
    // Must line up with HOST_PEER in the transport layer: the game protocol
    // treats peer 0 as the arbiter, so a mismatch here would silently point
    // guests at the wrong endpoint.
    const broker = new Broker({ generateCode: sequentialCodes() });
    const host = new FakeSocket();
    const code = create(broker, host);

    const a = new FakeSocket();
    const b = new FakeSocket();
    join(broker, a, code);
    join(broker, b, code);

    expect(a.last).toMatchObject({ type: "joined", peerId: 1 });
    expect(b.last).toMatchObject({ type: "joined", peerId: 2 });
    expect(host.ofType("peer-joined").map((m) => m.peerId)).toEqual([1, 2]);
  });

  it("accepts codes typed with any casing or punctuation", () => {
    // Codes get read aloud and retyped from memory. Rejecting "code-00" when
    // the room is "CODE00" is a pointless way to fail a join.
    const broker = new Broker({ generateCode: sequentialCodes() });
    const host = new FakeSocket();
    create(broker, host);

    for (const typed of ["code00", "CODE-00", " code 00 ", "Code00"]) {
      const guest = new FakeSocket();
      join(broker, guest, typed);
      expect(guest.last, `failed for ${typed}`).toMatchObject({ type: "joined" });
    }
  });

  it("refuses an unknown code", () => {
    const broker = new Broker();
    const guest = new FakeSocket();
    join(broker, guest, "NOSUCH");
    expect(guest.last).toMatchObject({ type: "error", code: "no-such-room" });
  });

  it("refuses to exceed the guest limit", () => {
    const broker = new Broker({ generateCode: sequentialCodes(), maxGuestsPerRoom: 2 });
    const host = new FakeSocket();
    const code = create(broker, host);

    join(broker, new FakeSocket(), code);
    join(broker, new FakeSocket(), code);
    const overflow = new FakeSocket();
    join(broker, overflow, code);

    expect(overflow.last).toMatchObject({ type: "error", code: "room-full" });
  });

  it("refuses to exceed the room limit", () => {
    const broker = new Broker({ generateCode: sequentialCodes(), maxRooms: 2 });
    create(broker, new FakeSocket());
    create(broker, new FakeSocket());

    const third = new FakeSocket();
    send(broker, third, { type: "create", version: SIGNALING_VERSION });
    expect(third.last).toMatchObject({ type: "error", code: "too-many-rooms" });
  });

  it("retries on a code collision", () => {
    // Randomness alone is not a guarantee. Two hosts sharing a code would be a
    // deeply confusing failure, so a collision must be resolved, not hoped away.
    let calls = 0;
    const broker = new Broker({
      generateCode: () => (calls++ < 2 ? "SAME00" : "OTHER1"),
    });
    const first = new FakeSocket();
    const second = new FakeSocket();
    expect(create(broker, first)).toBe("SAME00");
    expect(create(broker, second)).toBe("OTHER1");
    expect(broker.roomCount).toBe(2);
  });

  it("rejects a mismatched signaling version", () => {
    const broker = new Broker();
    const socket = new FakeSocket();
    send(broker, socket, { type: "create", version: SIGNALING_VERSION + 1 });
    expect(socket.last).toMatchObject({ type: "error", code: "bad-version" });
    expect(broker.roomCount).toBe(0);
  });
});

describe("signal relay", () => {
  it("relays from guest to host, stamping the sender", () => {
    const broker = new Broker({ generateCode: sequentialCodes() });
    const host = new FakeSocket();
    const code = create(broker, host);
    const guest = new FakeSocket();
    join(broker, guest, code);

    send(broker, guest, { type: "signal", to: 0, payload: { sdp: "offer" } });

    expect(host.last).toEqual({ type: "signal", from: 1, payload: { sdp: "offer" } });
  });

  it("relays from host to a specific guest", () => {
    const broker = new Broker({ generateCode: sequentialCodes() });
    const host = new FakeSocket();
    const code = create(broker, host);
    const a = new FakeSocket();
    const b = new FakeSocket();
    join(broker, a, code);
    join(broker, b, code);

    send(broker, host, { type: "signal", to: 2, payload: { sdp: "answer" } });

    expect(b.last).toEqual({ type: "signal", from: 0, payload: { sdp: "answer" } });
    expect(a.ofType("signal")).toHaveLength(0);
  });

  it("does not let a guest address another guest", () => {
    // The main reason the relay is not a free-for-all. Without this a guest
    // could spray signaling at strangers, or probe who else is in the room.
    const broker = new Broker({ generateCode: sequentialCodes() });
    const host = new FakeSocket();
    const code = create(broker, host);
    const a = new FakeSocket();
    const b = new FakeSocket();
    join(broker, a, code);
    join(broker, b, code);

    send(broker, a, { type: "signal", to: 2, payload: "hello" });

    expect(b.ofType("signal")).toHaveLength(0);
    expect(a.last).toMatchObject({ type: "error", code: "not-in-room" });
  });

  it("does not let a host reach into another room", () => {
    const broker = new Broker({ generateCode: sequentialCodes() });
    const hostA = new FakeSocket();
    const codeA = create(broker, hostA);
    const hostB = new FakeSocket();
    create(broker, hostB);

    const guestA = new FakeSocket();
    join(broker, guestA, codeA);

    // hostB has no peer 1 of its own, so this must not reach guestA.
    send(broker, hostB, { type: "signal", to: 1, payload: "cross-room" });

    expect(guestA.ofType("signal")).toHaveLength(0);
    expect(hostB.last).toMatchObject({ type: "error", code: "not-in-room" });
  });

  it("refuses to relay for a socket that never joined", () => {
    const broker = new Broker();
    const stranger = new FakeSocket();
    send(broker, stranger, { type: "signal", to: 0, payload: "x" });
    expect(stranger.last).toMatchObject({ type: "error", code: "not-in-room" });
  });

  it("passes payloads through untouched", () => {
    // The broker must stay ignorant of WebRTC. If it ever needs to understand
    // an SDP field, the abstraction has leaked.
    const broker = new Broker({ generateCode: sequentialCodes() });
    const host = new FakeSocket();
    const code = create(broker, host);
    const guest = new FakeSocket();
    join(broker, guest, code);

    const payload = { candidate: "candidate:1 1 udp", nested: { deep: [1, 2, 3] } };
    send(broker, guest, { type: "signal", to: 0, payload });

    expect((host.last as { payload: unknown }).payload).toEqual(payload);
  });
});

describe("disconnects", () => {
  it("tells the host when a guest leaves", () => {
    const broker = new Broker({ generateCode: sequentialCodes() });
    const host = new FakeSocket();
    const code = create(broker, host);
    const guest = new FakeSocket();
    join(broker, guest, code);

    broker.handleDisconnect(guest);

    expect(host.last).toEqual({ type: "peer-left", peerId: 1 });
  });

  it("tells guests when the host leaves", () => {
    const broker = new Broker({ generateCode: sequentialCodes() });
    const host = new FakeSocket();
    const code = create(broker, host);
    const guest = new FakeSocket();
    join(broker, guest, code);

    broker.handleDisconnect(host);

    expect(guest.last).toMatchObject({ type: "error", code: "host-left" });
  });

  it("stops accepting joins once the host is gone", () => {
    const broker = new Broker({ generateCode: sequentialCodes() });
    const host = new FakeSocket();
    const code = create(broker, host);
    broker.handleDisconnect(host);

    const late = new FakeSocket();
    join(broker, late, code);
    expect(late.last).toMatchObject({ type: "error", code: "no-such-room" });
  });

  it("frees the peer id slot arithmetic without reusing ids", () => {
    // Reusing a departed peer's id would let a new connection inherit an
    // in-flight WebRTC negotiation aimed at the previous one.
    const broker = new Broker({ generateCode: sequentialCodes() });
    const host = new FakeSocket();
    const code = create(broker, host);

    const first = new FakeSocket();
    join(broker, first, code);
    broker.handleDisconnect(first);

    const second = new FakeSocket();
    join(broker, second, code);
    expect(second.last).toMatchObject({ type: "joined", peerId: 2 });
  });

  it("ignores a disconnect for an unknown socket", () => {
    const broker = new Broker();
    expect(() => broker.handleDisconnect(new FakeSocket())).not.toThrow();
  });

  it("sweeps abandoned rooms after the ttl", () => {
    let now = 1000;
    const broker = new Broker({
      generateCode: sequentialCodes(),
      roomTtlMs: 5000,
      now: () => now,
    });
    const host = new FakeSocket();
    create(broker, host);
    broker.handleDisconnect(host);

    now = 4000;
    expect(broker.sweep()).toBe(0);
    expect(broker.roomCount).toBe(1);

    now = 7000;
    expect(broker.sweep()).toBe(1);
    expect(broker.roomCount).toBe(0);
  });

  it("does not sweep a room whose host is still connected", () => {
    let now = 1000;
    const broker = new Broker({ generateCode: sequentialCodes(), roomTtlMs: 1, now: () => now });
    create(broker, new FakeSocket());
    now = 100000;
    expect(broker.sweep()).toBe(0);
  });
});

describe("abuse resistance", () => {
  it("rejects malformed input without throwing", () => {
    // The broker is exposed to anyone who can reach the port, so garbage must
    // never take the process down.
    const broker = new Broker();
    const socket = new FakeSocket();

    for (const raw of ["", "not json", "[]", "null", '{"type":"nonsense"}', '"a string"']) {
      expect(() => broker.handleMessage(socket, raw)).not.toThrow();
    }
    expect(socket.sent.every((m) => m.type === "error")).toBe(true);
  });

  it("rejects oversized messages", () => {
    const broker = new Broker({ maxMessageBytes: 100 });
    const socket = new FakeSocket();
    broker.handleMessage(socket, JSON.stringify({ type: "signal", to: 0, payload: "x".repeat(200) }));
    expect(socket.last).toMatchObject({ type: "error", code: "bad-message" });
  });

  it("rate limits a flooding connection", () => {
    // Time never advances here: the point is that a burst inside one instant
    // must be throttled, with no refill to rescue it.
    const now = 0;
    const broker = new Broker({
      generateCode: sequentialCodes(),
      maxMessagesPerSecond: 10,
      now: () => now,
    });
    const host = new FakeSocket();
    const code = create(broker, host);
    const guest = new FakeSocket();
    join(broker, guest, code);

    for (let i = 0; i < 50; i++) send(broker, guest, { type: "signal", to: 0, payload: i });

    expect(guest.ofType("error").some((e) => e.code === "rate-limited")).toBe(true);
    expect(guest.closed).toMatchObject({ code: 1008 });
    // And the flood must not have all reached the host.
    expect(host.ofType("signal").length).toBeLessThan(20);
  });

  it("refills rate-limit tokens over time", () => {
    let now = 0;
    const broker = new Broker({
      generateCode: sequentialCodes(),
      maxMessagesPerSecond: 10,
      now: () => now,
    });
    const host = new FakeSocket();
    const code = create(broker, host);
    const guest = new FakeSocket();
    join(broker, guest, code);

    for (let i = 0; i < 200; i++) {
      now += 200; // 5 messages per second, well under the limit
      send(broker, guest, { type: "signal", to: 0, payload: i });
    }
    expect(guest.ofType("error")).toHaveLength(0);
  });

  it("refuses a second room from one connection", () => {
    const broker = new Broker({ generateCode: sequentialCodes() });
    const socket = new FakeSocket();
    create(broker, socket);
    send(broker, socket, { type: "create", version: SIGNALING_VERSION });
    expect(socket.last).toMatchObject({ type: "error", code: "bad-message" });
    expect(broker.roomCount).toBe(1);
  });
});

describe("normaliseCode", () => {
  it("uppercases and strips punctuation", () => {
    expect(normaliseCode("abc-123")).toBe("ABC123");
    expect(normaliseCode(" a b c ")).toBe("ABC");
    expect(normaliseCode("")).toBe("");
  });
});
