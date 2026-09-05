import {
  MSG_HASH,
  MSG_HELLO,
  MSG_REJECT,
  MSG_SCHEDULE,
  MSG_SNAPSHOT,
  MSG_SUBMIT,
  MSG_WELCOME,
  PROTOCOL_VERSION,
  encodeMessage,
  tryDecodeMessage,
} from "@rts/protocol";
import { TickClock, decodeSnapshot, type Command, type World } from "@rts/sim";
import { HOST_PEER, type PeerId, type Transport } from "@rts/transport";

/**
 * A non-arbitrating peer.
 *
 * The guest never decides anything. It sends its player's intent to the host
 * and executes the tick schedules it receives, in order, with no gaps. Its
 * world is derived purely from that command stream, which is what makes it
 * bit-identical to the host's.
 *
 * THE CENTRAL CONSTRAINT: a guest must never simulate a tick it has not
 * received the commands for. Not "should not" -- there is no way to guess a
 * command it has not seen, so running ahead means simulating a different game
 * and desyncing with certainty. When the schedule buffer runs dry the guest
 * stops and waits, which is why input delay exists: to keep enough schedule
 * buffered that this is rare.
 */

export interface GuestOptions {
  world: World;
  transport: Transport;
  name?: string;
  contentHash?: number;
  /**
   * Stable identity across reconnects. See HelloMessage.token.
   *
   * Required, with no default. A shared default is worse than no default: two
   * guests carrying the same token are, as far as the host is concerned, the
   * same player reconnecting, so the second silently takes over the first's
   * slot and army. That is precisely what happened the first time this had one.
   */
  token: string;
  /** Ticks between sending a state hash to the host. */
  hashInterval?: number;
  /**
   * Ticks the guest may run per update beyond the normal one, to catch up
   * after a stall. Capped so a long stall does not produce a visible
   * fast-forward.
   */
  maxCatchUpTicks?: number;
  onWelcome?: (playerId: number) => void;
  onReject?: (reason: string) => void;
  onResync?: (tick: number) => void;
  /**
   * Called immediately before each `world.step`, for renderers that snapshot
   * pre-step transforms to interpolate between ticks.
   */
  onBeforeTick?: (world: World) => void;
  /**
   * Called immediately after each `world.step`, while `world.events` still
   * holds that tick's events. They are cleared at the top of the next step.
   */
  onAfterTick?: (world: World) => void;
}

export class GuestSession {
  readonly world: World;

  private readonly transport: Transport;
  private readonly clock = new TickClock();
  private readonly hashInterval: number;
  private readonly maxCatchUpTicks: number;
  private readonly name: string;
  private readonly contentHash: number;
  private readonly token: string;
  private readonly onWelcome: GuestOptions["onWelcome"];
  private readonly onReject: GuestOptions["onReject"];
  private readonly onResync: GuestOptions["onResync"];
  /**
   * Renderer hooks. Public and mutable because the renderer is built *after*
   * the session -- the lobby hands back a live session, and the match screen
   * attaches to it. Making these constructor-only would force the lobby to
   * know about interpolation.
   */
  onBeforeTick: GuestOptions["onBeforeTick"];
  onAfterTick: GuestOptions["onAfterTick"];

  /** Received but not yet executed schedules, keyed by tick. */
  private readonly pending = new Map<number, Command[]>();

  private playerId = -1;
  private inputDelay = 3;
  private joined = false;
  /** Highest tick the host has told us about; our estimate of its clock. */
  private latestKnownHostTick = 0;

  /** Ticks we wanted to run but could not, for want of a schedule. */
  starvedTicks = 0;
  /** Snapshots applied after a desync. */
  resyncs = 0;

  constructor(options: GuestOptions) {
    this.world = options.world;
    this.transport = options.transport;
    this.hashInterval = options.hashInterval ?? 30;
    this.maxCatchUpTicks = options.maxCatchUpTicks ?? 4;
    this.name = options.name ?? "player";
    this.contentHash = options.contentHash ?? 0;
    this.token = options.token;
    this.onWelcome = options.onWelcome;
    this.onReject = options.onReject;
    this.onResync = options.onResync;
    this.onBeforeTick = options.onBeforeTick;
    this.onAfterTick = options.onAfterTick;

    this.transport.on("message", this.handleMessage);
  }

  get localPlayerId(): number {
    return this.playerId;
  }

  get isJoined(): boolean {
    return this.joined;
  }

  get alpha(): number {
    return this.clock.alpha;
  }

  /** Schedules received but not yet executed. A rough health signal. */
  get bufferedTicks(): number {
    return this.pending.size;
  }

  /** Announce ourselves to the host. */
  connect(): void {
    this.transport.send(
      HOST_PEER,
      encodeMessage({
        t: MSG_HELLO,
        protocol: PROTOCOL_VERSION,
        contentHash: this.contentHash,
        token: this.token,
        name: this.name,
      }),
    );
  }

  /**
   * Queue a local command and send it to the host.
   *
   * The requested tick is our estimate of the host's clock plus the input
   * delay. Proposing rather than letting the host stamp on arrival is what
   * equalises input latency: otherwise the host's own orders would execute a
   * network trip sooner than ours.
   */
  submitLocal(command: Command): void {
    if (!this.joined) return;
    // Not applied locally, and not buffered locally. The host echoes every
    // command back inside the tick schedule, and that echo is the only copy
    // this peer ever executes -- applying it here as well would run it twice.
    this.transport.send(
      HOST_PEER,
      encodeMessage({
        t: MSG_SUBMIT,
        requestedTick: this.latestKnownHostTick + this.inputDelay,
        commands: [command],
      }),
    );
  }

  /**
   * Advance by elapsed wall-clock time, bounded by the schedules received.
   * Returns the number of ticks executed.
   */
  update(deltaMs: number): number {
    if (!this.joined) return 0;

    const wanted = this.clock.advance(deltaMs);
    let executed = 0;

    // Run what the clock asks for, plus a little extra when behind, so a peer
    // that stalled briefly can close the gap instead of drifting further back
    // every tick.
    const behind = this.pending.size;
    const budget = wanted + Math.min(behind > 2 ? behind - 2 : 0, this.maxCatchUpTicks);

    for (let i = 0; i < budget; i++) {
      const commands = this.pending.get(this.world.tick);
      if (commands === undefined) {
        // Out of schedule. Stop -- there is no valid way to continue.
        if (i < wanted) this.starvedTicks += wanted - i;
        break;
      }
      this.pending.delete(this.world.tick);
      this.onBeforeTick?.(this.world);
      this.world.step(commands);
      this.onAfterTick?.(this.world);
      executed++;

      if (this.world.tick % this.hashInterval === 0) {
        this.transport.send(
          HOST_PEER,
          encodeMessage({ t: MSG_HASH, tick: this.world.tick, hash: this.world.hash() }),
        );
      }
    }

    return executed;
  }

  close(): void {
    this.transport.off("message", this.handleMessage);
  }

  // -------------------------------------------------------------------------

  private handleMessage = (from: PeerId, data: Uint8Array): void => {
    // Only the host may direct this session. Ignoring everyone else means a
    // peer cannot impersonate the arbiter and feed us a forged schedule.
    if (from !== HOST_PEER) return;

    const message = tryDecodeMessage(data);
    if (!message) return;

    switch (message.t) {
      case MSG_WELCOME: {
        if (message.protocol !== PROTOCOL_VERSION) {
          this.onReject?.(`host speaks protocol ${message.protocol}`);
          return;
        }
        this.playerId = message.playerId;
        this.inputDelay = message.inputDelay;
        decodeSnapshot(this.world, message.snapshot);
        // A welcome can arrive twice: once on joining, once after a reconnect.
        // Schedules buffered before the drop are for ticks the snapshot has
        // already passed, and replaying them would run those commands a second
        // time -- so the buffer is emptied rather than merged.
        this.pending.clear();
        this.latestKnownHostTick = message.tick;
        this.joined = true;
        this.clock.reset();
        this.onWelcome?.(this.playerId);
        break;
      }

      case MSG_REJECT: {
        this.onReject?.(message.reason);
        break;
      }

      case MSG_SCHEDULE: {
        if (message.tick >= this.world.tick) {
          this.pending.set(message.tick, message.commands);
        }
        if (message.tick > this.latestKnownHostTick) this.latestKnownHostTick = message.tick;
        break;
      }

      case MSG_SNAPSHOT: {
        decodeSnapshot(this.world, message.snapshot);
        this.latestKnownHostTick = Math.max(this.latestKnownHostTick, message.tick);
        // Schedules older than the snapshot are already baked into it; replaying
        // them would double-apply commands the host has already executed.
        for (const tick of [...this.pending.keys()]) {
          if (tick < this.world.tick) this.pending.delete(tick);
        }
        this.resyncs++;
        this.onResync?.(message.tick);
        break;
      }

      default:
        break;
    }
  };
}
