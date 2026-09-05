import {
  BROADCAST,
  FRAME_DATA,
  FRAME_JOIN,
  FRAME_LEAVE,
  FRAME_REJECT,
  FRAME_WELCOME,
  decodeFrame,
  encodeFrame,
  encodeText,
} from "./socket-frame.js";
import { HOST_PEER, type PeerId } from "./transport.js";

/**
 * The relay that runs on the host player's machine.
 *
 * This is what replaces the signaling broker, and the difference is the whole
 * point: nothing has to be deployed anywhere. The player who creates the game
 * runs it, in their own process, and it dies when they close the game.
 *
 * It is a byte pipe with a routing rule. It reads a five-byte header to decide
 * where a frame goes and never looks at the payload, so it cannot disagree with
 * the simulation about anything -- there is nothing in here for it to disagree
 * with.
 *
 * Socket-agnostic on purpose, exactly like the old broker: the whole routing
 * and lifecycle logic is testable in-process, without opening a port.
 */

/** The subset of a server-side socket this needs. */
export interface RelaySocket {
  send(data: Uint8Array): void;
  close(): void;
}

export interface RelayOptions {
  /** Refuse connections past this many players. Includes the host. */
  maxPlayers?: number;
  /** Called with a one-line summary whenever the roster changes. */
  onRoster?: (players: number) => void;
}

interface Member {
  peer: PeerId;
  socket: RelaySocket;
}

export class MatchRelay {
  private readonly members = new Map<PeerId, Member>();
  private readonly bySocket = new Map<RelaySocket, Member>();
  private readonly maxPlayers: number;
  private readonly onRoster: RelayOptions["onRoster"];

  /** Frames forwarded since start. Diagnostics only. */
  forwarded = 0;
  /** Frames dropped because they broke the routing rule. Should stay zero. */
  refused = 0;

  constructor(options: RelayOptions = {}) {
    this.maxPlayers = options.maxPlayers ?? 4;
    this.onRoster = options.onRoster;
  }

  get playerCount(): number {
    return this.members.size;
  }

  /** Whether the host player has connected yet. */
  get hasHost(): boolean {
    return this.members.has(HOST_PEER);
  }

  /**
   * Accept a connection and assign it a peer id.
   *
   * The first connection is always peer 0, the host. That is safe because the
   * host's own game connects over loopback the instant the relay is listening,
   * long before anyone across the internet could reach it -- and if somehow a
   * stranger did arrive first, they would be the host of a match with no world,
   * which the arbiter refuses rather than silently accepting.
   */
  connect(socket: RelaySocket): PeerId | null {
    if (this.members.size >= this.maxPlayers) {
      socket.send(encodeFrame(FRAME_REJECT, 0, encodeText(`match is full (${this.maxPlayers})`)));
      socket.close();
      this.refused++;
      return null;
    }

    // Lowest free id, so ids stay dense and a player who leaves frees theirs.
    let peer = 0;
    while (this.members.has(peer)) peer++;

    const member: Member = { peer, socket };
    this.members.set(peer, member);
    this.bySocket.set(socket, member);

    socket.send(encodeFrame(FRAME_WELCOME, peer));
    // Only the host is told about the roster. A guest talks to the host and to
    // nobody else, so a list of its fellow guests would be information it has
    // no way to use and one more thing to keep in sync.
    if (peer !== HOST_PEER) this.send(HOST_PEER, encodeFrame(FRAME_JOIN, peer));

    this.onRoster?.(this.members.size);
    return peer;
  }

  /** Handle one frame from a connected socket. */
  receive(socket: RelaySocket, data: Uint8Array): void {
    const from = this.bySocket.get(socket);
    if (!from) return;

    const frame = decodeFrame(data);
    if (!frame || frame.kind !== FRAME_DATA) {
      // Clients send nothing but data frames. Anything else is a modified
      // client, and the honest response is to ignore it.
      this.refused++;
      return;
    }

    // THE ROUTING RULE, and the only security-relevant line in the file: a
    // guest may only reach the host. Without it a modified client could send
    // tick schedules to another guest and split the match in two.
    if (from.peer !== HOST_PEER) {
      if (frame.peer !== HOST_PEER) {
        this.refused++;
        return;
      }
      this.forward(HOST_PEER, from.peer, frame.payload);
      return;
    }

    if (frame.peer === BROADCAST) {
      for (const member of this.members.values()) {
        if (member.peer === HOST_PEER) continue;
        this.forward(member.peer, HOST_PEER, frame.payload);
      }
      return;
    }
    this.forward(frame.peer, HOST_PEER, frame.payload);
  }

  /** Drop a connection and tell the host. */
  disconnect(socket: RelaySocket): void {
    const member = this.bySocket.get(socket);
    if (!member) return;
    this.bySocket.delete(socket);
    this.members.delete(member.peer);

    if (member.peer === HOST_PEER) {
      // The host leaving ends the match: every guest's world was derived from
      // its command stream, and there is nothing left to derive from. Closing
      // their sockets is more honest than leaving them frozen.
      for (const other of this.members.values()) {
        other.socket.send(encodeFrame(FRAME_REJECT, 0, encodeText("the host left the game")));
        other.socket.close();
      }
      this.members.clear();
      this.bySocket.clear();
    } else {
      this.send(HOST_PEER, encodeFrame(FRAME_LEAVE, member.peer));
    }

    this.onRoster?.(this.members.size);
  }

  /** Close every connection. */
  closeAll(): void {
    for (const member of this.members.values()) member.socket.close();
    this.members.clear();
    this.bySocket.clear();
  }

  private forward(to: PeerId, source: PeerId, payload: Uint8Array): void {
    const target = this.members.get(to);
    if (!target) return;
    target.socket.send(encodeFrame(FRAME_DATA, source, payload));
    this.forwarded++;
  }

  private send(to: PeerId, frame: Uint8Array): void {
    this.members.get(to)?.socket.send(frame);
  }
}
