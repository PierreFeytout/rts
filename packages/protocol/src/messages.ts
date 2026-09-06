import type { Command } from "@rts/sim";

/**
 * Wire messages.
 *
 * Only two kinds of thing ever cross the network: player *intent* (commands)
 * and *agreement* (tick schedules, state hashes). Never simulation state --
 * except a snapshot, which is a recovery mechanism rather than a normal part of
 * the loop. That restriction is what keeps bandwidth flat regardless of how
 * many units are on the field.
 *
 * The `LOBBY_*` messages are a separate conversation that happens over the same
 * socket *before* the match exists, and they stop entirely once it does. They
 * are here rather than in the client because they are a wire format, and the
 * one place a wire format must be written down is next to the others.
 */

/**
 * Bumped on any incompatible change to the messages below.
 *
 * Checked during the handshake, because the failure mode otherwise is a
 * mid-match desync with no obvious cause -- one peer silently misreading a
 * field is indistinguishable from a simulation bug.
 */
export const PROTOCOL_VERSION = 3;

export const MSG_HELLO = 1;
export const MSG_WELCOME = 2;
export const MSG_REJECT = 3;
export const MSG_SUBMIT = 4;
export const MSG_SCHEDULE = 5;
export const MSG_HASH = 6;
export const MSG_SNAPSHOT = 7;
// 8 was MSG_PEER_STATE, which the host broadcast and no client ever handled.
// The lobby's own state message replaced it. The number is left retired rather
// than reused: an old build reaching a new one should find nothing there.

// -- lobby, before the match starts ------------------------------------------
export const MSG_LOBBY_HELLO = 9;
export const MSG_LOBBY_STATE = 10;
export const MSG_LOBBY_PICK = 11;
export const MSG_LOBBY_START = 12;
export const MSG_LOBBY_CLOSED = 13;

/** Guest -> host, first message on connect. */
export interface HelloMessage {
  t: typeof MSG_HELLO;
  protocol: number;
  /**
   * Hash of the loaded content (units, buildings, races).
   *
   * Mismatched content is otherwise an instant and utterly baffling desync:
   * two peers running the same code but disagreeing on how much a unit costs
   * diverge on the first purchase. Catching it here turns that into a clear
   * error at the door. Populated for real in M5; carried now so the handshake
   * does not have to change later.
   */
  contentHash: number;
  /**
   * Stable identity for this player, across connections.
   *
   * A peer id is the identity of a *socket*: reconnecting through the broker
   * produces a new one, and keying player slots on it means a returning player
   * gets a fresh empty slot while their army sits orphaned on the field. The
   * token is generated once by the client and survives the drop, which is what
   * lets the host give them their own units back.
   *
   * It is not a credential. Anyone who can reach the host can claim any token
   * they have seen; the guarantee it provides is "the same browser gets the
   * same slot", not "nobody else can take it". Peer-hosted games between
   * friends do not have an account system to check it against, and inventing
   * one for a four-player lobby would be security theatre.
   */
  token: string;
  name: string;
}

/** Host -> guest, on acceptance. Everything needed to join the match. */
export interface WelcomeMessage {
  t: typeof MSG_WELCOME;
  protocol: number;
  /** The player slot this peer controls. Commands claiming any other are dropped. */
  playerId: number;
  mapTiles: number;
  seed: number;
  /** Ticks between issuing a command and executing it. */
  inputDelay: number;
  /** Tick the attached snapshot represents. */
  tick: number;
  /** Full world state, so nobody has to trust independent construction. */
  snapshot: Uint8Array;
}

/** Host -> guest, on refusal. */
export interface RejectMessage {
  t: typeof MSG_REJECT;
  reason: string;
}

/** Guest -> host. Commands the player wants executed. */
export interface SubmitMessage {
  t: typeof MSG_SUBMIT;
  /**
   * Tick the sender would like these to run at, normally its estimate of the
   * host's current tick plus the input delay.
   *
   * A request rather than an instruction: the host clamps it to the earliest
   * tick it has not already finalised. Letting guests propose a tick is what
   * keeps input latency equal for everyone -- if the host simply stamped
   * arrival time, its own orders would land a full network trip sooner than
   * anyone else's.
   */
  requestedTick: number;
  commands: Command[];
}

/** Host -> everyone. The finalised command set for one tick. */
export interface ScheduleMessage {
  t: typeof MSG_SCHEDULE;
  tick: number;
  commands: Command[];
}

/** Guest -> host. Periodic proof that the two worlds still agree. */
export interface HashMessage {
  t: typeof MSG_HASH;
  tick: number;
  hash: number;
}

/** Host -> guest. Authoritative state, after a desync or on request. */
export interface SnapshotMessage {
  t: typeof MSG_SNAPSHOT;
  tick: number;
  snapshot: Uint8Array;
}

// ---------------------------------------------------------------------------
// The lobby
//
// One rule runs through all of these: the host owns the configuration and
// guests send *requests*. A guest never mutates its own copy and waits to be
// told, exactly as the arbiter owns the command schedule rather than trusting
// each peer's idea of it. Anything else and two people who both changed
// something see two different lobbies, and only find out at the loading screen.
// ---------------------------------------------------------------------------

/** Guest -> host, first message on connect while the lobby is open. */
export interface LobbyHelloMessage {
  t: typeof MSG_LOBBY_HELLO;
  protocol: number;
  /** Same check as the match handshake; see `HelloMessage.contentHash`. */
  contentHash: number;
  /** Same stable identity as the match handshake; see `HelloMessage.token`. */
  token: string;
  name: string;
}

/** One row of the lobby roster. */
export interface LobbySlotState {
  /** "human", "computer" or "empty" -- see the client's `SlotKind`. */
  kind: string;
  raceId: string;
  name: string;
  /**
   * Whether a human slot currently has a socket attached.
   *
   * Distinct from `kind`: a player who closed their window leaves a human slot
   * that is nobody's, and showing it as empty would let the host hand it to
   * someone else while the original is still reconnecting.
   */
  connected: boolean;
}

/** Host -> everyone. The whole lobby, every time any of it changes. */
export interface LobbyStateMessage {
  t: typeof MSG_LOBBY_STATE;
  mapId: string;
  seed: number;
  slots: LobbySlotState[];
  /** Which slot the recipient occupies. Per-recipient, so this is not broadcast. */
  yourSlot: number;
}

/** Guest -> host. "I would like to play this race." */
export interface LobbyPickMessage {
  t: typeof MSG_LOBBY_PICK;
  raceId: string;
}

/**
 * Host -> everyone. The match is beginning; stop talking about the lobby.
 *
 * Carries the map size because the guest has to build a world of exactly the
 * right shape *before* it can receive the snapshot into it -- `decodeSnapshot`
 * refuses a size mismatch rather than reading past the end of a grid.
 */
export interface LobbyStartMessage {
  t: typeof MSG_LOBBY_START;
  mapTiles: number;
}

/** Host -> guest. The lobby is not accepting this player. */
export interface LobbyClosedMessage {
  t: typeof MSG_LOBBY_CLOSED;
  reason: string;
}

export type Message =
  | HelloMessage
  | WelcomeMessage
  | RejectMessage
  | SubmitMessage
  | ScheduleMessage
  | HashMessage
  | SnapshotMessage
  | LobbyHelloMessage
  | LobbyStateMessage
  | LobbyPickMessage
  | LobbyStartMessage
  | LobbyClosedMessage;
