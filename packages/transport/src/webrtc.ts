import type { SignalingClient } from "./signaling-client.js";
import { HOST_PEER, TransportEmitter, type PeerId, type Transport, type TransportEvents } from "./transport.js";
import {
  DEFAULT_ICE_SERVERS,
  type PeerConnectionFactory,
  type RTCDataChannelLike,
  type RTCIceCandidateLike,
  type RTCIceServerLike,
  type RTCPeerConnectionLike,
  type RTCSessionDescriptionLike,
} from "./webrtc-types.js";

/**
 * Peer-to-peer transport over WebRTC DataChannels.
 *
 * Topology is a star with the host at the centre, which is exactly what
 * lockstep wants: every command routes through the arbiter anyway, so guests
 * never need to talk to each other. Four players means three connections, not
 * six.
 *
 * Roles are fixed and asymmetric -- the host always offers, guests always
 * answer -- so none of the "perfect negotiation" glare-handling machinery is
 * needed. That machinery exists for peers that may both initiate at once, which
 * cannot happen here.
 *
 * Once a channel opens, the signaling server is out of the loop entirely. It is
 * needed again only when another player joins.
 */

export type ConnectionPhase =
  | "new"
  | "signaling"
  | "connecting"
  | "connected"
  | "failed"
  | "closed";

export interface PeerDiagnostic {
  peer: PeerId;
  phase: ConnectionPhase;
  /** Raw RTCPeerConnection state, for the details pane. */
  connectionState: string;
  iceConnectionState: string;
  /** Candidate types seen, e.g. "host", "srflx", "relay". */
  candidateTypes: string[];
  detail?: string;
}

export interface WebRtcOptions {
  signaling: SignalingClient;
  localPeer: PeerId;
  /** Host creates offers and one connection per guest; a guest has exactly one. */
  isHost: boolean;
  iceServers?: RTCIceServerLike[];
  /** Injected in tests; defaults to the global RTCPeerConnection. */
  createPeerConnection?: PeerConnectionFactory;
  onDiagnostic?: (diagnostic: PeerDiagnostic) => void;
}

interface PeerLink {
  peerId: PeerId;
  connection: RTCPeerConnectionLike;
  channel: RTCDataChannelLike | null;
  phase: ConnectionPhase;
  /**
   * Candidates that arrived before the remote description was set.
   *
   * Trickle ICE means candidates routinely overtake the offer or answer they
   * belong to. `addIceCandidate` throws if there is no remote description yet,
   * so they have to wait rather than be discarded -- discarding them is a
   * classic cause of connections that work on a LAN and fail over the internet,
   * because the dropped candidate was the only one that would have worked.
   */
  pendingCandidates: RTCIceCandidateLike[];
  remoteDescriptionSet: boolean;
  candidateTypes: Set<string>;
}

export class WebRtcTransport implements Transport {
  readonly localPeer: PeerId;

  private readonly signaling: SignalingClient;
  private readonly isHost: boolean;
  private readonly iceServers: RTCIceServerLike[];
  private readonly createPeerConnection: PeerConnectionFactory;
  private readonly onDiagnostic: WebRtcOptions["onDiagnostic"];
  private readonly emitter = new TransportEmitter();
  private readonly links = new Map<PeerId, PeerLink>();
  private closed = false;

  constructor(options: WebRtcOptions) {
    this.localPeer = options.localPeer;
    this.signaling = options.signaling;
    this.isHost = options.isHost;
    this.iceServers = options.iceServers ?? DEFAULT_ICE_SERVERS;
    this.onDiagnostic = options.onDiagnostic;
    this.createPeerConnection =
      options.createPeerConnection ??
      ((config) =>
        new (globalThis as unknown as { RTCPeerConnection: new (c: unknown) => RTCPeerConnectionLike })
          .RTCPeerConnection(config));
  }

  get peers(): readonly PeerId[] {
    return [...this.links.keys()]
      .filter((id) => this.links.get(id)?.phase === "connected")
      .sort((a, b) => a - b);
  }

  /** Per-peer connection state, for the lobby's diagnostics panel. */
  get diagnostics(): PeerDiagnostic[] {
    return [...this.links.values()].map((link) => this.describe(link));
  }

  /**
   * Begin connecting to a peer.
   *
   * The host calls this when the broker announces a guest; the guest calls it
   * once on join. Only the host produces an offer -- a guest that also offered
   * would create a second, competing negotiation.
   */
  connectTo(peerId: PeerId): void {
    if (this.closed || this.links.has(peerId)) return;
    const link = this.createLink(peerId);
    if (this.isHost) void this.makeOffer(link);
  }

  /** Handle a relayed payload from the signaling channel. */
  handleSignal(from: PeerId, payload: unknown): void {
    if (this.closed) return;
    const message = payload as {
      description?: RTCSessionDescriptionLike;
      candidate?: RTCIceCandidateLike;
    };

    let link = this.links.get(from);
    if (!link) {
      // A guest learns about the host only when its offer arrives.
      if (this.isHost) return;
      link = this.createLink(from);
    }

    if (message.description) void this.applyDescription(link, message.description);
    else if (message.candidate) void this.applyCandidate(link, message.candidate);
  }

  /** Tear down a peer's connection. */
  disconnect(peerId: PeerId, reason = "left"): void {
    const link = this.links.get(peerId);
    if (!link) return;
    this.links.delete(peerId);
    const wasConnected = link.phase === "connected";
    link.phase = "closed";
    try {
      link.channel?.close();
      link.connection.close();
    } catch {
      // Already torn down by the browser; nothing useful to do.
    }
    if (wasConnected) this.emitter.emitPeerLeave(peerId, reason);
  }

  send(peer: PeerId, data: Uint8Array): void {
    const link = this.links.get(peer);
    if (!link?.channel || link.channel.readyState !== "open") return;
    // Copy into a plain ArrayBuffer. A Uint8Array view over a larger pooled
    // buffer would otherwise be sent in full, silently corrupting the stream.
    link.channel.send(data.slice().buffer);
  }

  broadcast(data: Uint8Array): void {
    // Serialise once, then hand the same bytes to each channel.
    const buffer = data.slice().buffer;
    for (const link of this.links.values()) {
      if (link.channel?.readyState === "open") link.channel.send(buffer);
    }
  }

  on<K extends keyof TransportEvents>(event: K, handler: TransportEvents[K]): void {
    this.emitter.on(event, handler);
  }

  off<K extends keyof TransportEvents>(event: K, handler: TransportEvents[K]): void {
    this.emitter.off(event, handler);
  }

  close(): void {
    this.closed = true;
    for (const peerId of [...this.links.keys()]) this.disconnect(peerId, "closed");
    this.emitter.clear();
  }

  // -------------------------------------------------------------------------

  private createLink(peerId: PeerId): PeerLink {
    const connection = this.createPeerConnection({ iceServers: this.iceServers });
    const link: PeerLink = {
      peerId,
      connection,
      channel: null,
      phase: "signaling",
      pendingCandidates: [],
      remoteDescriptionSet: false,
      candidateTypes: new Set(),
    };
    this.links.set(peerId, link);

    connection.onicecandidate = (event) => {
      if (!event.candidate) return;
      link.candidateTypes.add(candidateType(event.candidate.candidate));
      this.signaling.signal(peerId, { candidate: event.candidate });
      this.report(link);
    };

    connection.onconnectionstatechange = () => {
      const state = connection.connectionState;
      if (state === "connected") {
        // Do not announce the peer yet. The connection being up does not mean
        // the data channel is usable; that is what `onopen` below is for.
        if (link.phase !== "connected") link.phase = "connecting";
      } else if (state === "failed") {
        link.phase = "failed";
        this.report(
          link,
          link.candidateTypes.has("relay")
            ? "connection failed even via a relay"
            : "could not establish a direct connection -- this network may need a TURN relay",
        );
        return;
      } else if (state === "closed" || state === "disconnected") {
        if (link.phase === "connected") {
          link.phase = "closed";
          this.links.delete(peerId);
          this.emitter.emitPeerLeave(peerId, `connection ${state}`);
          return;
        }
      }
      this.report(link);
    };

    connection.oniceconnectionstatechange = () => this.report(link);

    if (this.isHost) {
      // The offerer creates the channel; the answerer receives it via
      // `ondatachannel`.
      this.attachChannel(link, connection.createDataChannel("rts", { ordered: true }));
    } else {
      connection.ondatachannel = (event) => this.attachChannel(link, event.channel);
    }

    this.report(link);
    return link;
  }

  private attachChannel(link: PeerLink, channel: RTCDataChannelLike): void {
    link.channel = channel;
    channel.binaryType = "arraybuffer";

    channel.onopen = () => {
      link.phase = "connected";
      this.report(link);
      this.emitter.emitPeerJoin(link.peerId);
    };

    channel.onclose = () => {
      if (link.phase !== "connected") return;
      link.phase = "closed";
      this.links.delete(link.peerId);
      this.emitter.emitPeerLeave(link.peerId, "channel closed");
    };

    channel.onerror = () => this.report(link, "data channel error");

    channel.onmessage = (event) => {
      const data = event.data;
      if (data instanceof ArrayBuffer) {
        this.emitter.emitMessage(link.peerId, new Uint8Array(data));
      } else if (ArrayBuffer.isView(data)) {
        const view = data as ArrayBufferView;
        this.emitter.emitMessage(
          link.peerId,
          new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
        );
      }
      // Anything else means binaryType was not honoured; dropping is correct
      // rather than guessing at a decoding.
    };
  }

  private async makeOffer(link: PeerLink): Promise<void> {
    try {
      const offer = await link.connection.createOffer();
      await link.connection.setLocalDescription(offer);
      this.signaling.signal(link.peerId, { description: offer });
    } catch (error) {
      link.phase = "failed";
      this.report(link, `offer failed: ${String(error)}`);
    }
  }

  private async applyDescription(
    link: PeerLink,
    description: RTCSessionDescriptionLike,
  ): Promise<void> {
    try {
      await link.connection.setRemoteDescription(description);
      link.remoteDescriptionSet = true;

      // Flush candidates that arrived ahead of this description.
      for (const candidate of link.pendingCandidates) {
        await link.connection.addIceCandidate(candidate);
      }
      link.pendingCandidates.length = 0;

      if (description.type === "offer") {
        const answer = await link.connection.createAnswer();
        await link.connection.setLocalDescription(answer);
        this.signaling.signal(link.peerId, { description: answer });
      }
      this.report(link);
    } catch (error) {
      link.phase = "failed";
      this.report(link, `negotiation failed: ${String(error)}`);
    }
  }

  private async applyCandidate(link: PeerLink, candidate: RTCIceCandidateLike): Promise<void> {
    link.candidateTypes.add(candidateType(candidate.candidate));
    if (!link.remoteDescriptionSet) {
      link.pendingCandidates.push(candidate);
      return;
    }
    try {
      await link.connection.addIceCandidate(candidate);
    } catch {
      // A rejected candidate is not fatal -- others may still succeed.
    }
  }

  private describe(link: PeerLink): PeerDiagnostic {
    return {
      peer: link.peerId,
      phase: link.phase,
      connectionState: link.connection.connectionState,
      iceConnectionState: link.connection.iceConnectionState,
      candidateTypes: [...link.candidateTypes].sort(),
    };
  }

  private report(link: PeerLink, detail?: string): void {
    if (!this.onDiagnostic) return;
    const diagnostic = this.describe(link);
    if (detail !== undefined) diagnostic.detail = detail;
    this.onDiagnostic(diagnostic);
  }
}

/**
 * Extract the candidate type from an ICE candidate string.
 *
 * Worth surfacing: seeing only "host" candidates means STUN never returned a
 * public address, while "relay" means the connection fell back to TURN. Those
 * point at completely different problems, and a player told merely "connection
 * failed" has no way to tell them apart.
 */
export function candidateType(candidate: string): string {
  const match = /\btyp\s+(\w+)/.exec(candidate);
  return match ? match[1] : "unknown";
}

export { HOST_PEER };
