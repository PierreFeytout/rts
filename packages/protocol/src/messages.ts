import type { Command } from "@rts/sim";

/**
 * Wire messages.
 *
 * Only two kinds of thing ever cross the network: player *intent* (commands)
 * and *agreement* (tick schedules, state hashes). Never simulation state --
 * except a snapshot, which is a recovery mechanism rather than a normal part of
 * the loop. That restriction is what keeps bandwidth flat regardless of how
 * many units are on the field.
 */

/**
 * Bumped on any incompatible change to the messages below.
 *
 * Checked during the handshake, because the failure mode otherwise is a
 * mid-match desync with no obvious cause -- one peer silently misreading a
 * field is indistinguishable from a simulation bug.
 */
export const PROTOCOL_VERSION = 1;

export const MSG_HELLO = 1;
export const MSG_WELCOME = 2;
export const MSG_REJECT = 3;
export const MSG_SUBMIT = 4;
export const MSG_SCHEDULE = 5;
export const MSG_HASH = 6;
export const MSG_SNAPSHOT = 7;
export const MSG_PEER_STATE = 8;

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

/** Host -> everyone. Roster changes, for the lobby and score UI. */
export interface PeerStateMessage {
  t: typeof MSG_PEER_STATE;
  players: Array<{ playerId: number; name: string; connected: boolean }>;
}

export type Message =
  | HelloMessage
  | WelcomeMessage
  | RejectMessage
  | SubmitMessage
  | ScheduleMessage
  | HashMessage
  | SnapshotMessage
  | PeerStateMessage;
