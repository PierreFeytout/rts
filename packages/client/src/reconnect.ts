import type { GuestSession } from "@rts/netcode";
import type { World } from "@rts/sim";
import { HOST_PEER, type PeerDiagnostic, type WebRtcTransport } from "@rts/transport";
import { joinMatch, type GuestConnection } from "./connect.js";

/**
 * Getting a dropped guest back into the match.
 *
 * A WebRTC data channel dies for reasons that have nothing to do with either
 * player: a laptop sleeps, a phone changes cell, a router drops a NAT binding
 * after a quiet minute. Without this, any of those ends the match for that
 * person and leaves their army standing on the field being shot.
 *
 * Reconnecting works because of two decisions made earlier:
 *
 *   - The host keeps a disconnected player's slot, keyed by a token that
 *     survives the drop, so the returning player gets their own units back
 *     rather than an empty slot.
 *   - Match state is exchanged as a snapshot rather than replayed, so catching
 *     up after any length of absence costs one message.
 *
 * The old session is replaced wholesale rather than re-pointed at a new
 * transport. A `GuestSession` registers its listeners at construction and holds
 * buffered schedules for ticks the new snapshot has already passed; building a
 * fresh one over the *same world object* is both simpler and less likely to
 * leave something stale behind.
 */

/** Backoff between attempts, in milliseconds. Repeats the last value forever. */
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];

export interface ReconnectorOptions {
  brokerUrl: string;
  code: string;
  world: World;
  token: string;
  name: string;
  /** Called with each new session, so the match loop can switch over to it. */
  onReconnected: (connection: GuestConnection) => void;
  onStatus?: (message: string, tone: "info" | "error") => void;
  onDiagnostics?: (list: PeerDiagnostic[]) => void;
}

export class Reconnector {
  private readonly options: ReconnectorOptions;
  private transport: WebRtcTransport;
  private attempt = 0;
  private retrying = false;
  private stopped = false;
  private timer = 0;

  constructor(options: ReconnectorOptions, initial: GuestConnection) {
    this.options = options;
    this.transport = initial.transport;
    this.watch(initial);
  }

  /** True while a reconnect is in progress, for the HUD. */
  get isReconnecting(): boolean {
    return this.retrying;
  }

  stop(): void {
    this.stopped = true;
    window.clearTimeout(this.timer);
  }

  /**
   * Watch a connection for the host going away.
   *
   * Only `HOST_PEER` matters. A guest has exactly one link, but filtering makes
   * the intent explicit rather than relying on that staying true.
   */
  private watch(connection: GuestConnection): void {
    this.transport = connection.transport;
    connection.transport.on("peerLeave", (peer) => {
      if (peer !== HOST_PEER || this.stopped || this.retrying) return;
      this.begin();
    });
  }

  private begin(): void {
    this.retrying = true;
    this.attempt = 0;
    this.options.onStatus?.("connection lost — reconnecting...", "error");
    this.schedule();
  }

  private schedule(): void {
    if (this.stopped) return;
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
    this.attempt++;
    this.timer = window.setTimeout(() => void this.tryOnce(), delay);
  }

  private async tryOnce(): Promise<void> {
    if (this.stopped) return;
    this.options.onStatus?.(`reconnecting (attempt ${this.attempt})...`, "error");

    // The old transport is closed before the new attempt rather than after.
    // Two live peer connections to the same host would both receive tick
    // schedules, and the session that lost the race would keep stepping a world
    // nobody is watching.
    this.transport.close();

    try {
      const connection = await joinMatch({
        brokerUrl: this.options.brokerUrl,
        code: this.options.code,
        world: this.options.world,
        token: this.options.token,
        name: this.options.name,
        ...(this.options.onDiagnostics ? { onDiagnostics: this.options.onDiagnostics } : {}),
      });
      if (this.stopped) {
        connection.session.close();
        connection.transport.close();
        connection.signaling.close();
        return;
      }
      this.retrying = false;
      this.watch(connection);
      this.options.onStatus?.("reconnected", "info");
      this.options.onReconnected(connection);
    } catch {
      // Deliberately swallowed. Every failure mode here -- host gone, broker
      // down, still offline -- has the same remedy, and surfacing each one as
      // its own message would just flicker text at a player who can only wait.
      this.schedule();
    }
  }
}

/** The session type the match loop switches between. Narrower than the union. */
export type ReconnectableSession = GuestSession;
