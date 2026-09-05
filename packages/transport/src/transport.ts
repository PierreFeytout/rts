/**
 * Transport abstraction.
 *
 * Deliberately narrow: send bytes to a peer, receive bytes from a peer, learn
 * when peers come and go. Nothing above this layer knows whether the bytes
 * travel over a WebRTC DataChannel, a WebSocket, or an array in the same
 * process.
 *
 * That narrowness is the point. The entire lockstep layer is built and tested
 * against the in-memory implementation, so netcode bugs are found without any
 * real networking involved. Debugging desyncs and debugging ICE at the same
 * time is what turns a week of work into a month.
 *
 * DELIVERY CONTRACT -- implementations must be reliable and ordered per peer.
 * Lockstep cannot tolerate a lost command: a dropped position update is a
 * cosmetic glitch, a dropped command is two players in different worlds
 * forever. WebRTC DataChannels provide this when configured ordered and fully
 * reliable; the in-memory transport models the same guarantee.
 */

export type PeerId = number;

/** The arbiter is always peer 0, on every transport. */
export const HOST_PEER: PeerId = 0;

export interface TransportEvents {
  message(from: PeerId, data: Uint8Array): void;
  peerJoin(peer: PeerId): void;
  peerLeave(peer: PeerId, reason: string): void;
}

export interface Transport {
  /** This endpoint's own id. */
  readonly localPeer: PeerId;
  /** Peers currently connected, excluding self. Ascending order. */
  readonly peers: readonly PeerId[];

  send(peer: PeerId, data: Uint8Array): void;
  /** Send to every connected peer. */
  broadcast(data: Uint8Array): void;

  on<K extends keyof TransportEvents>(event: K, handler: TransportEvents[K]): void;
  off<K extends keyof TransportEvents>(event: K, handler: TransportEvents[K]): void;

  close(): void;
}

/** Minimal typed event emitter, so implementations need not each write one. */
export class TransportEmitter {
  private readonly handlers = new Map<string, Set<(...args: never[]) => void>>();

  on<K extends keyof TransportEvents>(event: K, handler: TransportEvents[K]): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as (...args: never[]) => void);
  }

  off<K extends keyof TransportEvents>(event: K, handler: TransportEvents[K]): void {
    this.handlers.get(event)?.delete(handler as (...args: never[]) => void);
  }

  emitMessage(from: PeerId, data: Uint8Array): void {
    // Snapshot before iterating: a handler that disconnects a peer would
    // otherwise mutate the set mid-iteration.
    const set = this.handlers.get("message");
    if (!set) return;
    for (const h of [...set]) (h as unknown as TransportEvents["message"])(from, data);
  }

  emitPeerJoin(peer: PeerId): void {
    const set = this.handlers.get("peerJoin");
    if (!set) return;
    for (const h of [...set]) (h as unknown as TransportEvents["peerJoin"])(peer);
  }

  emitPeerLeave(peer: PeerId, reason: string): void {
    const set = this.handlers.get("peerLeave");
    if (!set) return;
    for (const h of [...set]) (h as unknown as TransportEvents["peerLeave"])(peer, reason);
  }

  clear(): void {
    this.handlers.clear();
  }
}
