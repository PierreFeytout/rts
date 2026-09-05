import {
  SIGNALING_VERSION,
  type ClientMessage,
  type ErrorCode,
  type ServerMessage,
} from "./broker-protocol.js";

/**
 * Room brokering and signaling relay.
 *
 * This is the only always-on infrastructure the game needs, and it is
 * deliberately tiny. It holds a map of join code to host connection and passes
 * WebRTC offers, answers and ICE candidates between peers who cannot yet talk
 * directly. Once their DataChannel opens it drops out entirely: it never sees a
 * game command, a unit position, or anything else about a match.
 *
 * If it goes down, matches already in progress keep running -- they are
 * peer-to-peer. Only starting new ones stops working.
 *
 * The class takes an abstract `BrokerSocket` rather than a `ws` instance, so
 * the routing rules -- which is where the security-relevant decisions live --
 * are testable without opening a port.
 */

/** Anything that can carry a text message to one client. */
export interface BrokerSocket {
  /** Unique per connection, assigned by the server. */
  readonly id: number;
  send(data: string): void;
  close(code: number, reason: string): void;
}

export interface BrokerOptions {
  maxRooms?: number;
  maxGuestsPerRoom?: number;
  /** Largest accepted message, in bytes. */
  maxMessageBytes?: number;
  /** Messages per second per connection before the socket is dropped. */
  maxMessagesPerSecond?: number;
  /** Rooms whose host vanished are reaped after this long, in ms. */
  roomTtlMs?: number;
  /** Injected for tests, and so the server can use a crypto-backed generator. */
  generateCode?: () => string;
  now?: () => number;
  log?: (message: string) => void;
}

interface Room {
  code: string;
  host: BrokerSocket | null;
  guests: Map<number, BrokerSocket>;
  nextPeerId: number;
  /** When the host disconnected, or 0 while connected. */
  abandonedAt: number;
}

interface SocketState {
  room: Room;
  peerId: number;
  isHost: boolean;
  /** Token bucket for rate limiting. */
  tokens: number;
  lastRefill: number;
}

/**
 * Join-code alphabet.
 *
 * Excludes 0/O, 1/I/L and other easily confused pairs, because these codes get
 * read aloud over voice chat and retyped from memory. Thirty characters at six
 * places is about 7e8 combinations, which together with rate limiting makes
 * guessing a stranger's room impractical.
 */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

export class Broker {
  private readonly rooms = new Map<string, Room>();
  private readonly sockets = new Map<number, SocketState>();

  private readonly maxRooms: number;
  private readonly maxGuestsPerRoom: number;
  private readonly maxMessageBytes: number;
  private readonly maxMessagesPerSecond: number;
  private readonly roomTtlMs: number;
  private readonly generateCode: () => string;
  private readonly now: () => number;
  private readonly log: (message: string) => void;

  constructor(options: BrokerOptions = {}) {
    this.maxRooms = options.maxRooms ?? 500;
    this.maxGuestsPerRoom = options.maxGuestsPerRoom ?? 7;
    this.maxMessageBytes = options.maxMessageBytes ?? 64 * 1024;
    this.maxMessagesPerSecond = options.maxMessagesPerSecond ?? 40;
    this.roomTtlMs = options.roomTtlMs ?? 60_000;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => {});
    this.generateCode = options.generateCode ?? defaultCodeGenerator;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  stats(): { rooms: number; sockets: number } {
    return { rooms: this.rooms.size, sockets: this.sockets.size };
  }

  handleMessage(socket: BrokerSocket, raw: string): void {
    if (raw.length > this.maxMessageBytes) {
      this.fail(socket, "bad-message", "message too large");
      return;
    }

    const existing = this.sockets.get(socket.id);
    if (existing && !this.consumeToken(existing)) {
      this.fail(socket, "rate-limited", "too many messages");
      socket.close(1008, "rate limited");
      this.handleDisconnect(socket);
      return;
    }

    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      this.fail(socket, "bad-message", "not valid JSON");
      return;
    }

    if (typeof message !== "object" || message === null) {
      this.fail(socket, "bad-message", "not an object");
      return;
    }

    switch (message.type) {
      case "create":
        this.handleCreate(socket, message.version);
        break;
      case "join":
        this.handleJoin(socket, message.version, message.code);
        break;
      case "signal":
        this.handleSignal(socket, message.to, message.payload);
        break;
      default:
        this.fail(socket, "bad-message", "unknown message type");
    }
  }

  handleDisconnect(socket: BrokerSocket): void {
    const state = this.sockets.get(socket.id);
    if (!state) return;
    this.sockets.delete(socket.id);

    const room = state.room;

    if (state.isHost) {
      room.host = null;
      room.abandonedAt = this.now();
      // Tell the guests rather than leaving them watching a frozen lobby. Their
      // match may well continue -- it is peer-to-peer once connected -- but no
      // new peer can join without the host, so the room is finished.
      for (const guest of room.guests.values()) {
        this.send(guest, { type: "error", code: "host-left", reason: "host disconnected" });
      }
      this.log(`room ${room.code}: host left`);
      return;
    }

    room.guests.delete(state.peerId);
    if (room.host) this.send(room.host, { type: "peer-left", peerId: state.peerId });
  }

  /** Drop rooms whose host vanished and never returned. */
  sweep(): number {
    const cutoff = this.now() - this.roomTtlMs;
    let removed = 0;
    for (const [code, room] of this.rooms) {
      if (room.host === null && room.abandonedAt > 0 && room.abandonedAt < cutoff) {
        for (const guest of room.guests.values()) guest.close(1000, "room closed");
        this.rooms.delete(code);
        removed++;
      }
    }
    return removed;
  }

  // -------------------------------------------------------------------------

  private handleCreate(socket: BrokerSocket, version: number): void {
    if (version !== SIGNALING_VERSION) {
      this.fail(socket, "bad-version", `broker speaks version ${SIGNALING_VERSION}`);
      return;
    }
    if (this.sockets.has(socket.id)) {
      this.fail(socket, "bad-message", "already in a room");
      return;
    }
    if (this.rooms.size >= this.maxRooms) {
      this.fail(socket, "too-many-rooms", "broker is at capacity");
      return;
    }

    // Retry on collision rather than trusting randomness. At a few hundred
    // rooms the birthday odds are small, but "small" is not "never", and two
    // hosts sharing a code would be a baffling failure to diagnose.
    let code = this.generateCode();
    for (let attempt = 0; this.rooms.has(code) && attempt < 12; attempt++) {
      code = this.generateCode();
    }
    if (this.rooms.has(code)) {
      this.fail(socket, "too-many-rooms", "could not allocate a code");
      return;
    }

    const room: Room = {
      code,
      host: socket,
      guests: new Map(),
      // Guests start at 1; the host is peer 0, matching HOST_PEER.
      nextPeerId: 1,
      abandonedAt: 0,
    };
    this.rooms.set(code, room);
    this.sockets.set(socket.id, this.newState(room, 0, true));

    this.send(socket, { type: "created", code, peerId: 0 });
    this.log(`room ${code}: created`);
  }

  private handleJoin(socket: BrokerSocket, version: number, code: string): void {
    if (version !== SIGNALING_VERSION) {
      this.fail(socket, "bad-version", `broker speaks version ${SIGNALING_VERSION}`);
      return;
    }
    if (this.sockets.has(socket.id)) {
      this.fail(socket, "bad-message", "already in a room");
      return;
    }
    if (typeof code !== "string") {
      this.fail(socket, "bad-message", "code must be a string");
      return;
    }

    // Codes get shared by voice and retyped from memory, so accept whatever
    // casing, dashes and spaces arrive.
    const room = this.rooms.get(normaliseCode(code));
    if (!room || !room.host) {
      this.fail(socket, "no-such-room", "no game with that code");
      return;
    }
    if (room.guests.size >= this.maxGuestsPerRoom) {
      this.fail(socket, "room-full", "that game is full");
      return;
    }

    const peerId = room.nextPeerId++;
    room.guests.set(peerId, socket);
    this.sockets.set(socket.id, this.newState(room, peerId, false));

    this.send(socket, { type: "joined", code: room.code, peerId });
    this.send(room.host, { type: "peer-joined", peerId });
    this.log(`room ${room.code}: peer ${peerId} joined`);
  }

  private handleSignal(socket: BrokerSocket, to: number, payload: unknown): void {
    const state = this.sockets.get(socket.id);
    if (!state) {
      this.fail(socket, "not-in-room", "join a room first");
      return;
    }

    // The routing rule, and the main reason this relay is not a free-for-all:
    // a guest may only reach the host, and the host only its own guests. One
    // guest cannot address another, so it can neither spray signaling at
    // strangers nor discover who else is in the room.
    let target: BrokerSocket | undefined;
    if (state.isHost) {
      target = state.room.guests.get(to);
    } else if (to === 0) {
      target = state.room.host ?? undefined;
    }

    if (!target) {
      this.fail(socket, "not-in-room", "no such peer in this room");
      return;
    }

    this.send(target, { type: "signal", from: state.peerId, payload });
  }

  private newState(room: Room, peerId: number, isHost: boolean): SocketState {
    return {
      room,
      peerId,
      isHost,
      tokens: this.maxMessagesPerSecond,
      lastRefill: this.now(),
    };
  }

  private consumeToken(state: SocketState): boolean {
    const now = this.now();
    const elapsed = now - state.lastRefill;
    if (elapsed > 0) {
      state.tokens = Math.min(
        this.maxMessagesPerSecond,
        state.tokens + (elapsed / 1000) * this.maxMessagesPerSecond,
      );
      state.lastRefill = now;
    }
    if (state.tokens < 1) return false;
    state.tokens -= 1;
    return true;
  }

  private send(socket: BrokerSocket, message: ServerMessage): void {
    socket.send(JSON.stringify(message));
  }

  private fail(socket: BrokerSocket, code: ErrorCode, reason: string): void {
    this.send(socket, { type: "error", code, reason });
  }
}

function defaultCodeGenerator(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

/** Uppercase and strip anything outside the code alphabet. */
export function normaliseCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
