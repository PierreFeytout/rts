/**
 * Browser-side signaling connection.
 *
 * Talks to the broker over a WebSocket to obtain (or look up) a join code and
 * to exchange WebRTC offers, answers and ICE candidates. It knows nothing about
 * WebRTC itself -- payloads pass through opaquely -- so the transport can change
 * how it negotiates without touching this file.
 *
 * Kept separate from `WebRtcTransport` for a practical reason: signaling and
 * ICE fail in completely different ways, and a player staring at "connection
 * failed" needs to know which. "Cannot reach the lobby server" and "cannot
 * reach your friend directly" call for entirely different fixes.
 *
 * Types are declared structurally rather than pulled from lib.dom, so this
 * package stays free of a DOM dependency for the Node-side transports.
 */

export const SIGNALING_VERSION = 1;

interface MinimalWebSocket {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

type WebSocketFactory = (url: string) => MinimalWebSocket;

export interface SignalingEvents {
  /** Room created; we are the host. */
  onCreated?: (code: string) => void;
  /** Joined an existing room; we are a guest with this peer id. */
  onJoined?: (code: string, peerId: number) => void;
  /** A guest arrived. Host only. */
  onPeerJoined?: (peerId: number) => void;
  /** A peer went away. */
  onPeerLeft?: (peerId: number) => void;
  /** Relayed WebRTC payload from another peer. */
  onSignal?: (from: number, payload: unknown) => void;
  /** Broker refused something, or the connection failed. */
  onError?: (code: string, reason: string) => void;
  /** The WebSocket closed. Matches already connected are unaffected. */
  onClosed?: () => void;
}

export interface SignalingOptions extends SignalingEvents {
  url: string;
  /** Injected in tests; defaults to the global WebSocket. */
  createSocket?: WebSocketFactory;
}

export class SignalingClient {
  private readonly url: string;
  private readonly events: SignalingEvents;
  private readonly createSocket: WebSocketFactory;

  private socket: MinimalWebSocket | null = null;
  /** Queued while the socket is still opening. */
  private readonly outbox: string[] = [];
  private closedByUs = false;

  peerId = -1;
  code = "";

  constructor(options: SignalingOptions) {
    this.url = options.url;
    this.events = options;
    this.createSocket =
      options.createSocket ??
      // Reached through globalThis rather than the bare global, so this package
      // needs no DOM lib -- see webrtc-types.ts for the same reasoning.
      ((url) =>
        new (globalThis as unknown as { WebSocket: new (u: string) => MinimalWebSocket }).WebSocket(
          url,
        ));
  }

  get isOpen(): boolean {
    return this.socket !== null && this.socket.readyState === 1;
  }

  connect(): void {
    const socket = this.createSocket(this.url);
    this.socket = socket;

    socket.onopen = () => {
      for (const message of this.outbox) socket.send(message);
      this.outbox.length = 0;
    };

    socket.onmessage = (event) => this.handle(String(event.data));

    socket.onerror = () => {
      // Browsers deliberately give no detail on WebSocket errors, so the most
      // useful thing we can say is which hop failed.
      this.events.onError?.("signaling-unreachable", `could not reach the lobby server at ${this.url}`);
    };

    socket.onclose = () => {
      this.socket = null;
      if (!this.closedByUs) this.events.onClosed?.();
    };
  }

  /** Ask for a new room. */
  create(): void {
    this.send({ type: "create", version: SIGNALING_VERSION });
  }

  /** Ask to join an existing room. */
  join(code: string): void {
    this.send({ type: "join", version: SIGNALING_VERSION, code });
  }

  /** Relay a WebRTC payload to another peer in the room. */
  signal(to: number, payload: unknown): void {
    this.send({ type: "signal", to, payload });
  }

  /**
   * Close the signaling connection.
   *
   * Safe once every peer is connected: the broker is not part of the gameplay
   * path, and dropping it frees a socket on the shared server. Reconnect before
   * accepting a new player.
   */
  close(): void {
    this.closedByUs = true;
    this.socket?.close();
    this.socket = null;
  }

  private send(message: unknown): void {
    const raw = JSON.stringify(message);
    // Sending before the socket opens is the normal case -- `connect()` and
    // `create()` are called back to back -- so queue rather than fail.
    if (this.socket && this.socket.readyState === 1) this.socket.send(raw);
    else this.outbox.push(raw);
  }

  private handle(raw: string): void {
    let message: { type?: string } & Record<string, unknown>;
    try {
      message = JSON.parse(raw) as { type?: string } & Record<string, unknown>;
    } catch {
      return;
    }

    switch (message.type) {
      case "created":
        this.code = String(message.code);
        this.peerId = 0;
        this.events.onCreated?.(this.code);
        break;
      case "joined":
        this.code = String(message.code);
        this.peerId = Number(message.peerId);
        this.events.onJoined?.(this.code, this.peerId);
        break;
      case "peer-joined":
        this.events.onPeerJoined?.(Number(message.peerId));
        break;
      case "peer-left":
        this.events.onPeerLeft?.(Number(message.peerId));
        break;
      case "signal":
        this.events.onSignal?.(Number(message.from), message.payload);
        break;
      case "error":
        this.events.onError?.(String(message.code), String(message.reason));
        break;
      default:
        break;
    }
  }
}
