/**
 * Minimal structural declarations for the WebRTC surface we actually use.
 *
 * Declared here rather than pulled in from `lib.dom` for two reasons:
 *
 *   1. This package stays free of a DOM dependency, so `@rts/netcode` -- which
 *      imports it and must run headless -- does not inherit browser globals.
 *   2. The peer-connection constructor becomes injectable, which makes the
 *      negotiation choreography unit-testable. That matters more than it
 *      sounds: offer/answer ordering and ICE candidate queuing are exactly the
 *      kind of logic that is miserable to debug against a real network.
 *
 * These describe only what the transport calls. They are intentionally narrower
 * than the real API, and a compile error here means we started depending on
 * something new -- which is worth noticing.
 */

export interface RTCIceServerLike {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface RTCSessionDescriptionLike {
  type: string;
  sdp?: string;
}

export interface RTCIceCandidateLike {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface RTCDataChannelLike {
  readonly readyState: string;
  binaryType: string;
  send(data: ArrayBuffer | ArrayBufferView): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export interface RTCDataChannelInit {
  /**
   * Ordered, reliable delivery. Lockstep requires it: a dropped position update
   * is a cosmetic glitch, a dropped command puts two players in different
   * worlds permanently.
   */
  ordered?: boolean;
}

export interface RTCPeerConnectionLike {
  readonly connectionState: string;
  readonly iceConnectionState: string;
  readonly iceGatheringState: string;

  createDataChannel(label: string, options?: RTCDataChannelInit): RTCDataChannelLike;
  createOffer(): Promise<RTCSessionDescriptionLike>;
  createAnswer(): Promise<RTCSessionDescriptionLike>;
  setLocalDescription(description?: RTCSessionDescriptionLike): Promise<void>;
  setRemoteDescription(description: RTCSessionDescriptionLike): Promise<void>;
  addIceCandidate(candidate: RTCIceCandidateLike): Promise<void>;
  close(): void;

  onicecandidate: ((event: { candidate: RTCIceCandidateLike | null }) => void) | null;
  ondatachannel: ((event: { channel: RTCDataChannelLike }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  oniceconnectionstatechange: (() => void) | null;
}

export type PeerConnectionFactory = (config: {
  iceServers?: RTCIceServerLike[];
}) => RTCPeerConnectionLike;

/**
 * Public STUN servers.
 *
 * STUN lets two peers discover their own public address and punch through most
 * home NATs without anyone configuring a router. It succeeds for the large
 * majority of consumer connections but fails behind symmetric NAT -- some
 * corporate networks, many mobile carriers, ISPs using CGNAT -- which needs a
 * TURN relay instead.
 *
 * TURN is affordable here in a way it would not be for most games: lockstep
 * sends only commands, a few KB/s per player regardless of army size, so
 * relaying is cheap. Add a TURN entry to `iceServers` once real-world success
 * rates are known.
 */
export const DEFAULT_ICE_SERVERS: RTCIceServerLike[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];
