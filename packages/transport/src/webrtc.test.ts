import { describe, expect, it, vi } from "vitest";
import { SignalingClient } from "./signaling-client.js";
import type { PeerId } from "./transport.js";
import { WebRtcTransport, candidateType } from "./webrtc.js";
import type {
  RTCDataChannelLike,
  RTCIceCandidateLike,
  RTCPeerConnectionLike,
  RTCSessionDescriptionLike,
} from "./webrtc-types.js";

/**
 * These tests mock RTCPeerConnection but run the real negotiation logic, the
 * real SignalingClient, and a relay that mimics the broker's routing rules.
 *
 * What that buys: offer/answer ordering and ICE candidate queuing get exercised
 * deterministically, in milliseconds. Those are precisely the parts that are
 * miserable to debug against a live network, where a dropped candidate shows up
 * as "works on my LAN, fails over the internet" days later.
 */

// ---------------------------------------------------------------------------
// Mock WebRTC
// ---------------------------------------------------------------------------

class MockChannel implements RTCDataChannelLike {
  readyState = "connecting";
  binaryType = "blob";
  peer: MockChannel | null = null;
  readonly sent: Uint8Array[] = [];

  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  send(data: ArrayBuffer | ArrayBufferView): void {
    if (this.readyState !== "open") throw new Error("channel not open");
    const bytes =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.sent.push(bytes.slice());
    this.peer?.onmessage?.({ data: bytes.slice().buffer });
  }

  open(): void {
    this.readyState = "open";
    this.onopen?.();
  }

  close(): void {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.onclose?.();
  }
}

class MockPeerConnection implements RTCPeerConnectionLike {
  connectionState = "new";
  iceConnectionState = "new";
  iceGatheringState = "new";

  localChannel: MockChannel | null = null;
  remoteDescription: RTCSessionDescriptionLike | null = null;
  localDescription: RTCSessionDescriptionLike | null = null;
  readonly addedCandidates: RTCIceCandidateLike[] = [];

  onicecandidate: ((event: { candidate: RTCIceCandidateLike | null }) => void) | null = null;
  ondatachannel: ((event: { channel: RTCDataChannelLike }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;

  createDataChannel(): RTCDataChannelLike {
    this.localChannel = new MockChannel();
    return this.localChannel;
  }

  createOffer(): Promise<RTCSessionDescriptionLike> {
    return Promise.resolve({ type: "offer", sdp: "mock-offer" });
  }

  createAnswer(): Promise<RTCSessionDescriptionLike> {
    return Promise.resolve({ type: "answer", sdp: "mock-answer" });
  }

  setLocalDescription(description?: RTCSessionDescriptionLike): Promise<void> {
    this.localDescription = description ?? null;
    return Promise.resolve();
  }

  setRemoteDescription(description: RTCSessionDescriptionLike): Promise<void> {
    this.remoteDescription = description;
    return Promise.resolve();
  }

  addIceCandidate(candidate: RTCIceCandidateLike): Promise<void> {
    // Mirrors the real API: adding a candidate before the remote description
    // exists throws. The transport must queue rather than discard.
    if (!this.remoteDescription) return Promise.reject(new Error("no remote description"));
    this.addedCandidates.push(candidate);
    return Promise.resolve();
  }

  close(): void {
    this.connectionState = "closed";
    this.localChannel?.close();
  }

  emitCandidate(candidate: string): void {
    this.onicecandidate?.({ candidate: { candidate } });
  }

  setConnectionState(state: string): void {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

/** Wire two mock connections into a working pair and open their channels. */
function establish(hostPc: MockPeerConnection, guestPc: MockPeerConnection): void {
  const hostChannel = hostPc.localChannel;
  if (!hostChannel) throw new Error("host never created a channel");

  const guestChannel = new MockChannel();
  hostChannel.peer = guestChannel;
  guestChannel.peer = hostChannel;

  guestPc.ondatachannel?.({ channel: guestChannel });
  hostPc.setConnectionState("connected");
  guestPc.setConnectionState("connected");
  hostChannel.open();
  guestChannel.open();
}

// ---------------------------------------------------------------------------
// Fake broker relay, applying the same routing rules as the real one
// ---------------------------------------------------------------------------

interface FakeSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((e: unknown) => void) | null;
  onclose: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
}

class FakeRelay {
  readonly sockets = new Map<PeerId, FakeSocket>();
  private nextGuestId = 1;

  socketFor(peerId: PeerId | "auto"): FakeSocket {
    // Capture the map rather than `this`: the socket callbacks below are plain
    // functions, so `this` inside them is not the relay.
    const sockets = this.sockets;
    let assigned: PeerId = peerId === "auto" ? this.nextGuestId++ : peerId;

    const socket: FakeSocket = {
      readyState: 1,
      onopen: null,
      onclose: null,
      onerror: null,
      onmessage: null,
      send(raw: string) {
        const message = JSON.parse(raw) as {
          type: string;
          to?: number;
          payload?: unknown;
          code?: string;
        };
        if (message.type === "create") {
          assigned = 0;
          sockets.set(0, socket);
          socket.onmessage?.({ data: JSON.stringify({ type: "created", code: "TEST01", peerId: 0 }) });
        } else if (message.type === "join") {
          sockets.set(assigned, socket);
          socket.onmessage?.({
            data: JSON.stringify({ type: "joined", code: "TEST01", peerId: assigned }),
          });
          sockets
            .get(0)
            ?.onmessage?.({ data: JSON.stringify({ type: "peer-joined", peerId: assigned }) });
        } else if (message.type === "signal") {
          const target = sockets.get(message.to ?? -1);
          target?.onmessage?.({
            data: JSON.stringify({ type: "signal", from: assigned, payload: message.payload }),
          });
        }
      },
      close() {
        socket.readyState = 3;
        socket.onclose?.(null);
      },
    };
    return socket;
  }
}

interface Endpoint {
  signaling: SignalingClient;
  transport: WebRtcTransport;
  /**
   * Mock connections in creation order. Keyed by order rather than peer id so
   * a test can drive a link without a real peer having joined to name it.
   */
  created: MockPeerConnection[];
  received: Array<{ from: PeerId; text: string }>;
  joined: PeerId[];
  left: PeerId[];
}

function makeHost(relay: FakeRelay): Endpoint {
  const created: MockPeerConnection[] = [];

  const signaling = new SignalingClient({
    url: "ws://test",
    createSocket: () => relay.socketFor(0) as never,
    onPeerJoined: (peerId) => endpoint.transport.connectTo(peerId),
    onSignal: (from, payload) => endpoint.transport.handleSignal(from, payload),
  });

  const transport = new WebRtcTransport({
    signaling,
    localPeer: 0,
    isHost: true,
    createPeerConnection: () => {
      const pc = new MockPeerConnection();
      created.push(pc);
      return pc;
    },
  });

  const endpoint = wire(signaling, transport, created);
  signaling.connect();
  signaling.create();
  return endpoint;
}

function makeGuest(relay: FakeRelay): Endpoint {
  const created: MockPeerConnection[] = [];

  const signaling = new SignalingClient({
    url: "ws://test",
    createSocket: () => relay.socketFor("auto") as never,
    onSignal: (from, payload) => endpoint.transport.handleSignal(from, payload),
  });

  const transport = new WebRtcTransport({
    signaling,
    localPeer: 1,
    isHost: false,
    createPeerConnection: () => {
      const pc = new MockPeerConnection();
      created.push(pc);
      return pc;
    },
  });

  const endpoint = wire(signaling, transport, created);
  signaling.connect();
  signaling.join("TEST01");
  return endpoint;
}

function wire(
  signaling: SignalingClient,
  transport: WebRtcTransport,
  created: MockPeerConnection[],
): Endpoint {
  const endpoint: Endpoint = {
    signaling,
    transport,
    created,
    received: [],
    joined: [],
    left: [],
  };
  transport.on("message", (from, data) =>
    endpoint.received.push({ from, text: new TextDecoder().decode(data) }),
  );
  transport.on("peerJoin", (peer) => endpoint.joined.push(peer));
  transport.on("peerLeave", (peer) => endpoint.left.push(peer));
  return endpoint;
}

/** Let queued promise callbacks in the negotiation chain run. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// ---------------------------------------------------------------------------

describe("WebRtcTransport negotiation", () => {
  it("completes an offer/answer handshake and opens a channel", async () => {
    const relay = new FakeRelay();
    const host = makeHost(relay);
    const guest = makeGuest(relay);
    await settle();

    const hostPc = host.created[0];
    const guestPc = guest.created[0];

    // The host offers and the guest answers; roles are fixed, so no glare.
    expect(hostPc.localDescription).toMatchObject({ type: "offer" });
    expect(guestPc.remoteDescription).toMatchObject({ type: "offer" });
    expect(guestPc.localDescription).toMatchObject({ type: "answer" });
    expect(hostPc.remoteDescription).toMatchObject({ type: "answer" });

    establish(hostPc, guestPc);
    expect(host.joined).toEqual([1]);
    expect(guest.joined).toEqual([0]);
    expect(host.transport.peers).toEqual([1]);
  });

  it("only the host offers", async () => {
    // A guest that also offered would open a second, competing negotiation.
    const relay = new FakeRelay();
    const host = makeHost(relay);
    const guest = makeGuest(relay);
    await settle();

    expect(guest.created[0].localDescription).toMatchObject({ type: "answer" });
    expect(host.created[0].localDescription).toMatchObject({ type: "offer" });
  });

  it("queues ICE candidates that arrive before the remote description", async () => {
    // Trickle ICE routinely delivers candidates ahead of the answer they belong
    // to. addIceCandidate throws in that window, so they must be held rather
    // than dropped -- discarding one is a classic cause of "works on my LAN,
    // fails over the internet", because the dropped candidate was the only
    // route that would have worked.
    const relay = new FakeRelay();
    const host = makeHost(relay);
    // Start the link explicitly rather than via a joining guest, so the
    // candidate can be delivered before any answer exists.
    host.transport.connectTo(1);
    await settle();
    const hostPc = host.created[0];

    // Deliver a candidate to the host before any answer arrives.
    host.transport.handleSignal(1, { candidate: { candidate: "candidate:1 1 udp typ srflx" } });
    await settle();
    expect(hostPc.addedCandidates).toHaveLength(0);

    // Now the answer lands; the queued candidate must be flushed.
    host.transport.handleSignal(1, { description: { type: "answer", sdp: "mock" } });
    await settle();
    expect(hostPc.addedCandidates).toHaveLength(1);
    expect(hostPc.addedCandidates[0].candidate).toContain("srflx");
  });

  it("applies candidates immediately once the description is set", async () => {
    const relay = new FakeRelay();
    // The host must exist to own the room, but this test only drives the guest.
    makeHost(relay);
    const guest = makeGuest(relay);
    await settle();

    const guestPc = guest.created[0];
    const before = guestPc.addedCandidates.length;
    guest.transport.handleSignal(0, { candidate: { candidate: "candidate:2 1 udp typ host" } });
    await settle();
    expect(guestPc.addedCandidates.length).toBe(before + 1);
  });

  it("relays locally gathered candidates through signaling", async () => {
    const relay = new FakeRelay();
    const host = makeHost(relay);
    const guest = makeGuest(relay);
    await settle();

    const guestPc = guest.created[0];
    host.created[0].emitCandidate("candidate:9 1 udp 2 1.2.3.4 5 typ srflx");
    await settle();

    expect(guestPc.addedCandidates.some((c) => c.candidate.includes("srflx"))).toBe(true);
  });
});

describe("WebRtcTransport data", () => {
  it("carries bytes in both directions", async () => {
    const relay = new FakeRelay();
    const host = makeHost(relay);
    const guest = makeGuest(relay);
    await settle();
    establish(host.created[0], guest.created[0]);

    host.transport.send(1, bytes("to guest"));
    guest.transport.send(0, bytes("to host"));

    expect(guest.received).toEqual([{ from: 0, text: "to guest" }]);
    expect(host.received).toEqual([{ from: 1, text: "to host" }]);
  });

  it("sends only the intended slice of a pooled buffer", async () => {
    // A Uint8Array view over a larger buffer would otherwise be sent whole,
    // silently corrupting the message stream with neighbouring bytes.
    const relay = new FakeRelay();
    const host = makeHost(relay);
    const guest = makeGuest(relay);
    await settle();
    establish(host.created[0], guest.created[0]);

    const pool = new Uint8Array(64).fill(0xaa);
    const view = pool.subarray(8, 13);
    view.set(bytes("hello"));
    host.transport.send(1, view);

    expect(guest.received[0].text).toBe("hello");
  });

  it("drops sends to a peer whose channel is not open", async () => {
    const relay = new FakeRelay();
    const host = makeHost(relay);
    makeGuest(relay);
    await settle();
    // Channel never established.
    expect(() => host.transport.send(1, bytes("early"))).not.toThrow();
  });

  it("broadcasts to every connected peer", async () => {
    const relay = new FakeRelay();
    const host = makeHost(relay);
    const a = makeGuest(relay);
    await settle();
    establish(host.created[0], a.created[0]);

    host.transport.broadcast(bytes("everyone"));
    expect(a.received[0].text).toBe("everyone");
  });
});

describe("WebRtcTransport failure handling", () => {
  it("reports a failed connection with an actionable hint", async () => {
    // "Connection failed" alone leaves a player with nothing to do. Whether any
    // relay candidate was seen distinguishes "needs TURN" from "TURN did not
    // help either", which are different problems.
    const diagnostics: string[] = [];
    const relay = new FakeRelay();
    const connections = new Map<PeerId, MockPeerConnection>();
    let pending = 1;

    const signaling = new SignalingClient({
      url: "ws://test",
      createSocket: () => relay.socketFor(0) as never,
      onPeerJoined: (peerId) => {
        pending = peerId;
        transport.connectTo(peerId);
      },
    });
    const transport = new WebRtcTransport({
      signaling,
      localPeer: 0,
      isHost: true,
      createPeerConnection: () => {
        const pc = new MockPeerConnection();
        connections.set(pending, pc);
        return pc;
      },
      onDiagnostic: (d) => {
        if (d.detail) diagnostics.push(d.detail);
      },
    });
    signaling.connect();
    signaling.create();
    transport.connectTo(1);
    await settle();

    connections.get(1)!.setConnectionState("failed");
    expect(diagnostics.some((d) => d.includes("TURN"))).toBe(true);
  });

  it("emits peerLeave when a connected channel closes", async () => {
    const relay = new FakeRelay();
    const host = makeHost(relay);
    const guest = makeGuest(relay);
    await settle();
    const hostPc = host.created[0];
    establish(hostPc, guest.created[0]);

    hostPc.localChannel!.close();
    expect(host.left).toEqual([1]);
    expect(host.transport.peers).toEqual([]);
  });

  it("does not emit peerLeave for a peer that never connected", async () => {
    // A negotiation that fails before the channel opens never announced a join,
    // so announcing a leave would leave the roster inconsistent.
    const relay = new FakeRelay();
    const host = makeHost(relay);
    makeGuest(relay);
    await settle();

    host.transport.disconnect(1, "gave up");
    expect(host.left).toEqual([]);
  });

  it("survives a signaling payload for an unknown peer", async () => {
    const relay = new FakeRelay();
    const host = makeHost(relay);
    await settle();
    expect(() => host.transport.handleSignal(99, { candidate: { candidate: "x" } })).not.toThrow();
  });

  it("closes every connection on close()", async () => {
    const relay = new FakeRelay();
    const host = makeHost(relay);
    const guest = makeGuest(relay);
    await settle();
    establish(host.created[0], guest.created[0]);

    host.transport.close();
    expect(host.created[0].connectionState).toBe("closed");
    expect(host.transport.peers).toEqual([]);
  });
});

describe("candidateType", () => {
  it("extracts the type from a candidate line", () => {
    // Surfacing this distinguishes "STUN never returned a public address" from
    // "we fell back to a relay", which are entirely different problems.
    expect(candidateType("candidate:1 1 udp 2130706431 192.168.1.5 54321 typ host")).toBe("host");
    expect(candidateType("candidate:2 1 udp 1694498815 1.2.3.4 54321 typ srflx raddr 0.0.0.0")).toBe(
      "srflx",
    );
    expect(candidateType("candidate:3 1 udp 1 5.6.7.8 3478 typ relay")).toBe("relay");
    expect(candidateType("garbage")).toBe("unknown");
  });
});

describe("SignalingClient", () => {
  it("queues messages sent before the socket opens", () => {
    // connect() and create() are called back to back, so this is the normal
    // path rather than an edge case.
    const sent: string[] = [];
    const socket = {
      readyState: 0,
      onopen: null as ((e: unknown) => void) | null,
      onclose: null,
      onerror: null,
      onmessage: null,
      send: (data: string) => sent.push(data),
      close: () => {},
    };
    const client = new SignalingClient({ url: "ws://test", createSocket: () => socket as never });
    client.connect();
    client.create();
    expect(sent).toHaveLength(0);

    socket.readyState = 1;
    socket.onopen?.(null);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0])).toMatchObject({ type: "create" });
  });

  it("reports an unreachable broker distinctly from a peer failure", () => {
    const onError = vi.fn();
    const socket = {
      readyState: 0,
      onopen: null,
      onclose: null,
      onerror: null as ((e: unknown) => void) | null,
      onmessage: null,
      send: () => {},
      close: () => {},
    };
    const client = new SignalingClient({
      url: "ws://unreachable",
      createSocket: () => socket as never,
      onError,
    });
    client.connect();
    socket.onerror?.(null);

    expect(onError).toHaveBeenCalledWith("signaling-unreachable", expect.stringContaining("lobby"));
  });

  it("ignores malformed broker messages", () => {
    const onCreated = vi.fn();
    const socket = {
      readyState: 1,
      onopen: null,
      onclose: null,
      onerror: null,
      onmessage: null as ((e: { data: unknown }) => void) | null,
      send: () => {},
      close: () => {},
    };
    const client = new SignalingClient({
      url: "ws://test",
      createSocket: () => socket as never,
      onCreated,
    });
    client.connect();
    expect(() => socket.onmessage?.({ data: "not json" })).not.toThrow();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
