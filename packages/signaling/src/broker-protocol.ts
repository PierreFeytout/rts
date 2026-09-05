/**
 * Signaling protocol.
 *
 * Entirely separate from the game protocol in `@rts/protocol`, and deliberately
 * so. These messages exist only to help two browsers find each other; once the
 * WebRTC DataChannel opens, the broker is out of the loop and never sees a
 * single game command. Keeping the two vocabularies apart makes that boundary
 * impossible to blur by accident.
 *
 * JSON rather than MessagePack: a handful of small messages per connection, all
 * of them strings, and being able to read them in a browser's network tab is
 * worth more here than the bytes saved.
 */

/** Bumped on any incompatible change. Checked at connect time. */
export const SIGNALING_VERSION = 1;

// --- client -> broker ------------------------------------------------------

/** Ask for a new room and a join code. */
export interface CreateRequest {
  type: "create";
  version: number;
}

/** Ask to join an existing room. */
export interface JoinRequest {
  type: "join";
  version: number;
  code: string;
}

/**
 * Relay a WebRTC offer/answer/ICE candidate to another peer in the room.
 *
 * `to` is a peer id, not a room-wide broadcast: a guest may only address the
 * host, and the host may only address guests in its own room. Without that
 * restriction any guest could spray signaling at every other guest.
 */
export interface SignalRequest {
  type: "signal";
  to: number;
  payload: unknown;
}

export type ClientMessage = CreateRequest | JoinRequest | SignalRequest;

// --- broker -> client ------------------------------------------------------

/** Room created. The code is what the host shares with friends. */
export interface CreatedResponse {
  type: "created";
  code: string;
  /** The host is always peer 0, matching HOST_PEER in the transport layer. */
  peerId: 0;
}

/** Join accepted. */
export interface JoinedResponse {
  type: "joined";
  code: string;
  peerId: number;
}

/** A guest arrived. Sent to the host only. */
export interface PeerJoinedEvent {
  type: "peer-joined";
  peerId: number;
}

/** A peer went away. */
export interface PeerLeftEvent {
  type: "peer-left";
  peerId: number;
}

/** Relayed signaling payload, with the sender stamped by the broker. */
export interface SignalEvent {
  type: "signal";
  from: number;
  payload: unknown;
}

/** Request refused. `code` is machine-readable; `reason` is for humans. */
export interface ErrorResponse {
  type: "error";
  code: ErrorCode;
  reason: string;
}

export type ErrorCode =
  | "bad-version"
  | "bad-message"
  | "no-such-room"
  | "room-full"
  | "too-many-rooms"
  | "not-in-room"
  | "rate-limited"
  | "host-left";

export type ServerMessage =
  | CreatedResponse
  | JoinedResponse
  | PeerJoinedEvent
  | PeerLeftEvent
  | SignalEvent
  | ErrorResponse;
