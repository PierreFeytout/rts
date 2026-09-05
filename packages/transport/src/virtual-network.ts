import {
  TransportEmitter,
  type PeerId,
  type Transport,
  type TransportEvents,
} from "./transport.js";

/**
 * In-process transport with a virtual clock.
 *
 * This is the test harness the whole lockstep layer is developed against. It
 * matters for two reasons:
 *
 *   1. Time is virtual. Tests call `advance(ms)` instead of waiting, so a
 *      simulated ten-minute match with 150 ms latency runs in milliseconds and
 *      produces the same result every run. Tests that depend on wall-clock
 *      timing are flaky by construction, and a flaky desync test is worthless
 *      -- you can never tell a real regression from noise.
 *   2. It models exactly the guarantees WebRTC will provide: reliable, ordered
 *      per peer. It does NOT simulate packet loss, because the real transport
 *      will be configured fully reliable and SCTP handles retransmission
 *      beneath us. Simulating loss here would mean testing against a network
 *      the game will never actually run on.
 *
 * Latency is configurable per directed link, so asymmetric and lopsided
 * connections -- the interesting cases -- can be reproduced exactly.
 */

interface InFlight {
  from: PeerId;
  to: PeerId;
  data: Uint8Array;
  arriveAt: number;
  /** Tiebreaker so equal arrival times keep send order. */
  sequence: number;
}

export interface LinkOptions {
  /** One-way latency in milliseconds. */
  latencyMs?: number;
  /**
   * Random extra delay, uniform in [0, jitterMs].
   * Applied without reordering: see `deliverAt`.
   */
  jitterMs?: number;
}

export class VirtualNetwork {
  private readonly transports = new Map<PeerId, VirtualTransport>();
  private readonly inFlight: InFlight[] = [];
  private readonly links = new Map<string, Required<LinkOptions>>();
  /** Last scheduled arrival per directed link, to preserve ordering. */
  private readonly lastArrival = new Map<string, number>();

  private sequence = 0;
  private seed: number;

  /** Current virtual time in milliseconds. */
  now = 0;

  /** Default one-way latency for links with no explicit setting. */
  defaultLatencyMs = 0;
  defaultJitterMs = 0;

  /** Total messages delivered. Useful for asserting bandwidth behaviour. */
  delivered = 0;
  /** Total bytes delivered. */
  deliveredBytes = 0;

  constructor(seed = 0x9e3779b9) {
    this.seed = seed | 0;
  }

  /** Deterministic jitter source. Independent of the simulation's own Rng. */
  private nextRandom(): number {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x | 0;
    return (x >>> 0) / 0x100000000;
  }

  addPeer(id: PeerId): Transport {
    if (this.transports.has(id)) throw new Error(`peer ${id} already exists`);
    const transport = new VirtualTransport(this, id);
    this.transports.set(id, transport);

    // Announce in both directions so every endpoint sees a consistent roster.
    for (const [otherId, other] of this.transports) {
      if (otherId === id) continue;
      other.notifyJoin(id);
      transport.notifyJoin(otherId);
    }
    return transport;
  }

  removePeer(id: PeerId, reason = "left"): void {
    if (!this.transports.delete(id)) return;
    // Drop anything still in flight to or from the departed peer.
    for (let i = this.inFlight.length - 1; i >= 0; i--) {
      if (this.inFlight[i].from === id || this.inFlight[i].to === id) this.inFlight.splice(i, 1);
    }
    for (const other of this.transports.values()) other.notifyLeave(id, reason);
  }

  setLink(from: PeerId, to: PeerId, options: LinkOptions): void {
    this.links.set(`${from}>${to}`, {
      latencyMs: options.latencyMs ?? this.defaultLatencyMs,
      jitterMs: options.jitterMs ?? this.defaultJitterMs,
    });
  }

  /** Apply the same latency to both directions of a link. */
  setSymmetricLink(a: PeerId, b: PeerId, options: LinkOptions): void {
    this.setLink(a, b, options);
    this.setLink(b, a, options);
  }

  /** Queue a message. Called by VirtualTransport. */
  enqueue(from: PeerId, to: PeerId, data: Uint8Array): void {
    if (!this.transports.has(to)) return;

    const key = `${from}>${to}`;
    const link = this.links.get(key);
    const latency = link?.latencyMs ?? this.defaultLatencyMs;
    const jitter = link?.jitterMs ?? this.defaultJitterMs;

    let arriveAt = this.now + latency + (jitter > 0 ? this.nextRandom() * jitter : 0);

    // Enforce ordered delivery. Jitter alone would let a later message overtake
    // an earlier one, which a reliable ordered DataChannel never does -- and
    // testing against reordering the real transport cannot produce would send
    // us chasing bugs that do not exist.
    const previous = this.lastArrival.get(key);
    if (previous !== undefined && arriveAt < previous) arriveAt = previous;
    this.lastArrival.set(key, arriveAt);

    // Copy: the caller is free to reuse its buffer the moment send() returns,
    // exactly as a real transport allows.
    this.inFlight.push({
      from,
      to,
      data: data.slice(),
      arriveAt,
      sequence: this.sequence++,
    });
  }

  /**
   * Advance virtual time, delivering everything that comes due.
   *
   * Delivery can trigger sends, which may themselves come due within the same
   * window (on a zero-latency link), so this loops until quiescent.
   */
  advance(deltaMs: number): void {
    const target = this.now + deltaMs;

    for (;;) {
      let nextIndex = -1;
      let nextTime = Infinity;
      let nextSequence = Infinity;

      for (let i = 0; i < this.inFlight.length; i++) {
        const m = this.inFlight[i];
        if (m.arriveAt > target) continue;
        if (m.arriveAt < nextTime || (m.arriveAt === nextTime && m.sequence < nextSequence)) {
          nextTime = m.arriveAt;
          nextSequence = m.sequence;
          nextIndex = i;
        }
      }

      if (nextIndex === -1) break;

      const message = this.inFlight.splice(nextIndex, 1)[0];
      this.now = message.arriveAt;
      this.delivered++;
      this.deliveredBytes += message.data.byteLength;
      this.transports.get(message.to)?.deliver(message.from, message.data);
    }

    this.now = target;
  }

  /** Messages still in transit. */
  get pending(): number {
    return this.inFlight.length;
  }
}

class VirtualTransport implements Transport {
  readonly localPeer: PeerId;

  private readonly network: VirtualNetwork;
  private readonly emitter = new TransportEmitter();
  private readonly connected = new Set<PeerId>();
  private closed = false;

  constructor(network: VirtualNetwork, localPeer: PeerId) {
    this.network = network;
    this.localPeer = localPeer;
  }

  get peers(): readonly PeerId[] {
    return [...this.connected].sort((a, b) => a - b);
  }

  send(peer: PeerId, data: Uint8Array): void {
    if (this.closed) return;
    this.network.enqueue(this.localPeer, peer, data);
  }

  broadcast(data: Uint8Array): void {
    if (this.closed) return;
    // Ascending order so a test observing send order sees something stable.
    for (const peer of this.peers) this.network.enqueue(this.localPeer, peer, data);
  }

  on<K extends keyof TransportEvents>(event: K, handler: TransportEvents[K]): void {
    this.emitter.on(event, handler);
  }

  off<K extends keyof TransportEvents>(event: K, handler: TransportEvents[K]): void {
    this.emitter.off(event, handler);
  }

  close(): void {
    this.closed = true;
    this.network.removePeer(this.localPeer, "closed");
    this.emitter.clear();
  }

  deliver(from: PeerId, data: Uint8Array): void {
    if (this.closed) return;
    this.emitter.emitMessage(from, data);
  }

  notifyJoin(peer: PeerId): void {
    this.connected.add(peer);
    this.emitter.emitPeerJoin(peer);
  }

  notifyLeave(peer: PeerId, reason: string): void {
    if (!this.connected.delete(peer)) return;
    this.emitter.emitPeerLeave(peer, reason);
  }
}
