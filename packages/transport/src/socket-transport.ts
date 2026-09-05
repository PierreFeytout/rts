import {
  BROADCAST,
  FRAME_DATA,
  FRAME_JOIN,
  FRAME_LEAVE,
  FRAME_REJECT,
  FRAME_WELCOME,
  decodeFrame,
  decodeText,
  encodeFrame,
} from "./socket-frame.js";
import {
  HOST_PEER,
  TransportEmitter,
  type PeerId,
  type Transport,
  type TransportEvents,
} from "./transport.js";

/**
 * Transport over a single WebSocket to the host's relay.
 *
 * Used by *every* player, the one hosting included. The host's machine runs the
 * relay and the host's game connects to it over loopback like anyone else,
 * which means there is exactly one transport implementation rather than a
 * client one and a server one that have to agree.
 *
 * Reliable and ordered, which is what lockstep requires -- that comes free with
 * TCP, where the WebRTC version had to ask for it explicitly.
 *
 * The socket is injected rather than constructed, for the same reason the
 * WebRTC transport injected its peer connection: it makes the whole thing
 * testable without a network, and it lets the same class run against the
 * browser's `WebSocket` and against `ws` in Node without importing either.
 */

/** The subset of WebSocket this needs. Both the browser's and `ws` satisfy it. */
export interface SocketLike {
  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
  binaryType: string;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export interface SocketTransportOptions {
  socket: SocketLike;
  /** Called once the relay has assigned this endpoint its peer id. */
  onReady?: (localPeer: PeerId) => void;
  /** Called when the relay refuses the connection, with its reason. */
  onRejected?: (reason: string) => void;
}

export class SocketTransport implements Transport {
  private readonly socket: SocketLike;
  private readonly emitter = new TransportEmitter();
  private readonly connected = new Set<PeerId>();
  private readonly onReady: SocketTransportOptions["onReady"];
  private readonly onRejected: SocketTransportOptions["onRejected"];

  private assigned: PeerId = -1;
  private closed = false;
  private rejection: string | null = null;

  constructor(options: SocketTransportOptions) {
    this.socket = options.socket;
    this.onReady = options.onReady;
    this.onRejected = options.onRejected;

    this.socket.binaryType = "arraybuffer";
    this.socket.onmessage = (event) => this.handle(event.data);
    this.socket.onclose = () => {
      if (this.closed) return;
      this.closed = true;
      // Every peer this endpoint knew about is unreachable now: the relay was
      // the only path to any of them.
      for (const peer of [...this.connected]) {
        this.connected.delete(peer);
        this.emitter.emitPeerLeave(peer, this.rejection ?? "connection lost");
      }
    };
  }

  /**
   * This endpoint's id, or -1 until the relay has assigned one.
   *
   * Callers must wait for `onReady` before building a session on top. Guessing
   * would mean the host and the relay disagreeing about who peer 0 is, which
   * shows up as every command being routed to nobody.
   */
  get localPeer(): PeerId {
    return this.assigned;
  }

  get peers(): readonly PeerId[] {
    return [...this.connected].sort((a, b) => a - b);
  }

  send(peer: PeerId, data: Uint8Array): void {
    if (this.closed) return;
    this.socket.send(encodeFrame(FRAME_DATA, peer, data));
  }

  broadcast(data: Uint8Array): void {
    if (this.closed) return;
    // One frame, fanned out by the relay. Sending N copies from here would put
    // the host's uplink in the path of its own broadcast N times, which for the
    // player hosting is the difference between a smooth match and a stuttering
    // one on a domestic connection.
    this.socket.send(encodeFrame(FRAME_DATA, BROADCAST, data));
  }

  on<K extends keyof TransportEvents>(event: K, handler: TransportEvents[K]): void {
    this.emitter.on(event, handler);
  }

  off<K extends keyof TransportEvents>(event: K, handler: TransportEvents[K]): void {
    this.emitter.off(event, handler);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.socket.close();
    this.connected.clear();
    this.emitter.clear();
  }

  private handle(raw: unknown): void {
    const bytes = toBytes(raw);
    if (!bytes) return;
    const frame = decodeFrame(bytes);
    // A malformed frame is a dropped message, never a crash: this is input
    // from the network and a modified client can send anything at all.
    if (!frame) return;

    switch (frame.kind) {
      case FRAME_WELCOME:
        this.assigned = frame.peer;
        // A guest is, by construction, connected to the host -- that is what
        // being a guest means. Waiting for traffic to discover it would leave
        // the connection looking empty until the host said something, and a
        // guest that dropped before then would never report the loss.
        if (frame.peer !== HOST_PEER) {
          this.connected.add(HOST_PEER);
          this.emitter.emitPeerJoin(HOST_PEER);
        }
        this.onReady?.(frame.peer);
        break;

      case FRAME_JOIN:
        if (frame.peer === this.assigned) break;
        this.connected.add(frame.peer);
        this.emitter.emitPeerJoin(frame.peer);
        break;

      case FRAME_LEAVE:
        if (!this.connected.delete(frame.peer)) break;
        this.emitter.emitPeerLeave(frame.peer, "left");
        break;

      case FRAME_REJECT:
        this.rejection = decodeText(frame.payload);
        this.onRejected?.(this.rejection);
        break;

      case FRAME_DATA:
        // Membership is managed only by control frames from the relay, never
        // inferred from traffic. Inferring it would paper over a routing bug
        // by quietly inventing whatever peer the stray frame claimed to be
        // from -- and routing bugs are the ones worth failing loudly on.
        this.emitter.emitMessage(frame.peer, frame.payload);
        break;

      default:
        break;
    }
  }
}

/** Normalise whatever the socket handed us into bytes, or null. */
function toBytes(raw: unknown): Uint8Array | null {
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (ArrayBuffer.isView(raw)) {
    const view = raw as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  // A string means `binaryType` was not honoured. Dropping is correct: there
  // is no text in this protocol, so anything textual is a bug elsewhere.
  return null;
}
