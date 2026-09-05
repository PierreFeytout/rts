import { describe, expect, it } from "vitest";
import { VirtualNetwork } from "./virtual-network.js";
import type { PeerId, Transport } from "./transport.js";

function collect(transport: Transport): Array<{ from: PeerId; text: string }> {
  const received: Array<{ from: PeerId; text: string }> = [];
  transport.on("message", (from, data) => {
    received.push({ from, text: new TextDecoder().decode(data) });
  });
  return received;
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("VirtualNetwork", () => {
  it("delivers a message after the link latency", () => {
    const net = new VirtualNetwork();
    const host = net.addPeer(0);
    const guest = net.addPeer(1);
    net.setSymmetricLink(0, 1, { latencyMs: 50 });

    const received = collect(guest);
    host.send(1, bytes("hello"));

    net.advance(49);
    expect(received).toHaveLength(0);
    net.advance(2);
    expect(received).toEqual([{ from: 0, text: "hello" }]);
  });

  it("preserves order even with jitter", () => {
    // A reliable ordered DataChannel never reorders. If the harness could,
    // we would spend time fixing bugs the real transport cannot produce.
    const net = new VirtualNetwork(12345);
    const host = net.addPeer(0);
    const guest = net.addPeer(1);
    net.setSymmetricLink(0, 1, { latencyMs: 40, jitterMs: 120 });

    const received = collect(guest);
    for (let i = 0; i < 200; i++) host.send(1, bytes(String(i)));
    net.advance(5000);

    expect(received.map((m) => m.text)).toEqual(
      Array.from({ length: 200 }, (_, i) => String(i)),
    );
  });

  it("supports asymmetric latency", () => {
    const net = new VirtualNetwork();
    const host = net.addPeer(0);
    const guest = net.addPeer(1);
    net.setLink(0, 1, { latencyMs: 10 });
    net.setLink(1, 0, { latencyMs: 200 });

    const atGuest = collect(guest);
    const atHost = collect(host);
    host.send(1, bytes("down"));
    guest.send(0, bytes("up"));

    net.advance(20);
    expect(atGuest).toHaveLength(1);
    expect(atHost).toHaveLength(0);
    net.advance(200);
    expect(atHost).toHaveLength(1);
  });

  it("broadcasts to every peer but not to self", () => {
    const net = new VirtualNetwork();
    const host = net.addPeer(0);
    const a = net.addPeer(1);
    const b = net.addPeer(2);

    const atHost = collect(host);
    const atA = collect(a);
    const atB = collect(b);

    host.broadcast(bytes("tick"));
    net.advance(1);

    expect(atA).toHaveLength(1);
    expect(atB).toHaveLength(1);
    expect(atHost).toHaveLength(0);
  });

  it("announces joins to existing peers and vice versa", () => {
    const net = new VirtualNetwork();
    const host = net.addPeer(0);
    const joins: PeerId[] = [];
    host.on("peerJoin", (p) => joins.push(p));

    net.addPeer(1);
    net.addPeer(2);
    expect(joins).toEqual([1, 2]);
    expect(host.peers).toEqual([1, 2]);
  });

  it("reports departures and drops their in-flight traffic", () => {
    const net = new VirtualNetwork();
    const host = net.addPeer(0);
    const guest = net.addPeer(1);
    net.setSymmetricLink(0, 1, { latencyMs: 100 });

    const atHost = collect(host);
    const leaves: Array<[PeerId, string]> = [];
    host.on("peerLeave", (p, reason) => leaves.push([p, reason]));

    guest.send(0, bytes("in flight"));
    net.removePeer(1, "connection lost");
    net.advance(500);

    expect(leaves).toEqual([[1, "connection lost"]]);
    expect(host.peers).toEqual([]);
    // A message from a peer that vanished mid-flight must not surface after
    // the disconnect has already been handled.
    expect(atHost).toHaveLength(0);
  });

  it("copies payloads, so senders may reuse their buffers", () => {
    // Real transports serialise on send. A harness that kept a live reference
    // would hide mutation bugs that only appear over a real connection.
    const net = new VirtualNetwork();
    const host = net.addPeer(0);
    const guest = net.addPeer(1);

    const received = collect(guest);
    const buffer = bytes("original");
    host.send(1, buffer);
    buffer.fill(0x21);

    net.advance(1);
    expect(received[0].text).toBe("original");
  });

  it("delivers zero-latency chains within a single advance", () => {
    // A reply sent from inside a delivery handler must arrive in the same
    // advance() when latency is zero, or the harness needs an arbitrary number
    // of pumps to settle.
    const net = new VirtualNetwork();
    const host = net.addPeer(0);
    const guest = net.addPeer(1);

    const atHost = collect(host);
    guest.on("message", () => guest.send(0, bytes("pong")));

    host.send(1, bytes("ping"));
    net.advance(1);
    expect(atHost.map((m) => m.text)).toEqual(["pong"]);
  });

  it("is reproducible for a given seed", () => {
    const run = (): string[] => {
      const net = new VirtualNetwork(4242);
      const host = net.addPeer(0);
      const guest = net.addPeer(1);
      net.setSymmetricLink(0, 1, { latencyMs: 30, jitterMs: 80 });
      const received: string[] = [];
      guest.on("message", (_from, data) =>
        received.push(`${net.now.toFixed(3)}:${new TextDecoder().decode(data)}`),
      );
      for (let i = 0; i < 50; i++) {
        host.send(1, bytes(String(i)));
        net.advance(7);
      }
      net.advance(1000);
      return received;
    };
    expect(run()).toEqual(run());
  });

  it("tracks delivered volume", () => {
    const net = new VirtualNetwork();
    const host = net.addPeer(0);
    net.addPeer(1);
    net.addPeer(2);
    host.broadcast(bytes("0123456789"));
    net.advance(1);
    expect(net.delivered).toBe(2);
    expect(net.deliveredBytes).toBe(20);
  });

  it("drops sends to unknown peers instead of throwing", () => {
    const net = new VirtualNetwork();
    const host = net.addPeer(0);
    expect(() => host.send(99, bytes("nobody"))).not.toThrow();
    net.advance(100);
    expect(net.pending).toBe(0);
  });
});
