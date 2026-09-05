import {
  MSG_HASH,
  MSG_HELLO,
  MSG_SUBMIT,
  MSG_SCHEDULE,
  MSG_SNAPSHOT,
  MSG_WELCOME,
  MSG_REJECT,
  MSG_PEER_STATE,
  PROTOCOL_VERSION,
  encodeMessage,
  tryDecodeMessage,
} from "@rts/protocol";
import { TICK_MS, TickClock, encodeSnapshot, type Command, type World } from "@rts/sim";
import type { PeerId, Transport } from "@rts/transport";

/**
 * The lockstep arbiter.
 *
 * One peer -- normally the player who created the game -- owns the tick clock
 * and decides, for every tick, exactly which commands run. It broadcasts that
 * decision and everyone (including the host) simulates it. Nobody ever sends
 * simulation state; the world is re-derived independently by each peer from an
 * identical command stream.
 *
 * This class is deliberately free of DOM and Node APIs, so the same arbiter
 * runs in the host's browser tab today and in a headless dedicated server later
 * with only the transport swapped.
 *
 * TWO PROPERTIES DO MOST OF THE WORK:
 *
 * 1. The match never stalls on a slow player. Classic peer lockstep freezes
 *    everyone until the laggiest client's input arrives. Here the host owns the
 *    clock: when a tick comes due, its command set is finalised and broadcast,
 *    and a player who has not been heard from simply contributes nothing that
 *    tick. Someone's Wi-Fi hiccuping does not hitch the game for the rest.
 *
 * 2. Input latency is equal for everyone. Guests propose which tick their
 *    commands should run at; the host honours it whenever that tick is still
 *    open. Stamping commands on arrival instead would give the host a full
 *    network trip of advantage over every guest.
 */

export interface HostOptions {
  world: World;
  transport: Transport;
  /**
   * Ticks between issuing a command and executing it. At 20 Hz, 3 ticks is
   * 150 ms -- enough to cover a typical connection's one-way latency so that
   * remote commands arrive before their tick is finalised.
   */
  inputDelay?: number;
  /** How often guests are asked to prove agreement, in ticks. */
  hashInterval?: number;
  /** Ticks of hash history retained for comparison against late reports. */
  hashHistory?: number;
  /** Called when a peer's world diverges from the host's. */
  onDesync?: (peer: PeerId, tick: number, theirs: number, ours: number) => void;
  /**
   * Called immediately before each `world.step`.
   *
   * Exists for renderers, which must snapshot the pre-step transforms to
   * interpolate between ticks. Without a hook the caller would have to drive
   * ticks one at a time and duplicate the scheduling logic.
   */
  /**
   * Fingerprint of the loaded content, compared against each guest's.
   *
   * Defaults to 0, meaning "do not check" -- engine tests build worlds from
   * fixture tables and have no content set. Real matches always pass one.
   */
  contentHash?: number;
  onBeforeTick?: (world: World) => void;
  /**
   * Called immediately after each `world.step`, while `world.events` still
   * holds that tick's events.
   *
   * Events are cleared at the top of the next step, so anything that wants
   * muzzle flashes or death effects has to read them here. A caller that
   * polled after `update()` would see only the last tick of a catch-up burst.
   */
  onAfterTick?: (world: World) => void;
}

interface PlayerSlot {
  peer: PeerId;
  playerId: number;
  name: string;
  connected: boolean;
  /** Most recent tick this peer reported a matching hash for. */
  lastVerifiedTick: number;
  /** Commands accepted but scheduled later than requested. */
  lateCommands: number;
}

export class HostSession {
  readonly world: World;
  readonly inputDelay: number;

  private readonly transport: Transport;
  private readonly clock = new TickClock();
  private readonly hashInterval: number;
  private readonly hashHistory: number;
  private readonly contentHash: number;
  private readonly onDesync: HostOptions["onDesync"];
  /**
   * Renderer hooks. Public and mutable because the renderer is built *after*
   * the session -- the lobby hands back a live session, and the match screen
   * attaches to it. Making these constructor-only would force the lobby to
   * know about interpolation.
   */
  onBeforeTick: HostOptions["onBeforeTick"];
  onAfterTick: HostOptions["onAfterTick"];

  /** Commands finalised for future ticks, keyed by tick. */
  private readonly scheduled = new Map<number, Command[]>();
  /** Our own hash at each recent tick, for comparing against guest reports. */
  private readonly hashes = new Map<number, number>();
  private readonly slots = new Map<PeerId, PlayerSlot>();

  /** Every schedule broadcast this match, in tick order. The replay log. */
  readonly log: Command[][] = [];

  /** Desyncs detected. Exposed for diagnostics and tests. */
  desyncs = 0;

  constructor(options: HostOptions) {
    this.world = options.world;
    this.transport = options.transport;
    this.inputDelay = options.inputDelay ?? 3;
    this.hashInterval = options.hashInterval ?? 30;
    this.hashHistory = options.hashHistory ?? 300;
    this.contentHash = options.contentHash ?? 0;
    this.onDesync = options.onDesync;
    this.onBeforeTick = options.onBeforeTick;
    this.onAfterTick = options.onAfterTick;

    // The host always occupies player slot 0.
    this.slots.set(this.transport.localPeer, {
      peer: this.transport.localPeer,
      playerId: 0,
      name: "host",
      connected: true,
      lastVerifiedTick: 0,
      lateCommands: 0,
    });

    this.transport.on("message", this.handleMessage);
    this.transport.on("peerLeave", this.handleLeave);
  }

  /** Player id this endpoint controls. */
  get localPlayerId(): number {
    return 0;
  }

  get tick(): number {
    return this.world.tick;
  }

  /** Interpolation factor for rendering between ticks. */
  get alpha(): number {
    return this.clock.alpha;
  }

  /** Connected players, for the lobby and score UI. */
  get players(): Array<{ playerId: number; name: string; connected: boolean }> {
    return [...this.slots.values()]
      .map((s) => ({ playerId: s.playerId, name: s.name, connected: s.connected }))
      .sort((a, b) => a.playerId - b.playerId);
  }

  /**
   * Submit a command from the local player.
   *
   * Goes through the same scheduling path as a remote command, deliberately:
   * if the host applied its own orders directly it would enjoy zero input
   * delay while everyone else waited, and the difference would only show up as
   * "the host always wins fights".
   */
  submitLocal(command: Command): void {
    this.scheduleCommand(command, this.world.tick + this.inputDelay);
  }

  /** Advance by elapsed wall-clock time. Returns the number of ticks executed. */
  update(deltaMs: number): number {
    const steps = this.clock.advance(deltaMs);
    for (let i = 0; i < steps; i++) this.advanceOneTick();
    return steps;
  }

  /** Advance exactly one tick, ignoring wall-clock time. For tests and replays. */
  advanceOneTick(): void {
    const tick = this.world.tick;
    const commands = this.scheduled.get(tick) ?? [];
    this.scheduled.delete(tick);

    // Broadcast BEFORE stepping. Guests are behind by the network delay, so
    // every tick of head start matters for them receiving it before they need it.
    this.transport.broadcast(encodeMessage({ t: MSG_SCHEDULE, tick, commands }));
    this.log.push(commands);

    this.onBeforeTick?.(this.world);
    this.world.step(commands);
    this.onAfterTick?.(this.world);

    if (this.world.tick % this.hashInterval === 0) {
      this.hashes.set(this.world.tick, this.world.hash());
      // Bound the history; a match running for hours would otherwise leak.
      const cutoff = this.world.tick - this.hashHistory;
      for (const t of this.hashes.keys()) {
        if (t < cutoff) this.hashes.delete(t);
      }
    }
  }

  close(): void {
    this.transport.off("message", this.handleMessage);
    this.transport.off("peerLeave", this.handleLeave);
  }

  // -------------------------------------------------------------------------

  private scheduleCommand(command: Command, requestedTick: number): boolean {
    // Never schedule into a tick already executed or currently executing --
    // that command would run on some peers and not others.
    const earliest = this.world.tick + 1;
    const tick = Math.max(requestedTick, earliest);

    let list = this.scheduled.get(tick);
    if (!list) {
      list = [];
      this.scheduled.set(tick, list);
    }
    list.push(command);
    return tick === requestedTick;
  }

  private handleMessage = (from: PeerId, data: Uint8Array): void => {
    // Peers are untrusted input: in a peer-hosted game the other end is another
    // player's browser, which may be modified. Malformed payloads are dropped
    // rather than allowed to throw inside a transport callback.
    const message = tryDecodeMessage(data);
    if (!message) return;

    switch (message.t) {
      case MSG_HELLO: {
        this.handleHello(from, message.protocol, message.contentHash, message.name);
        break;
      }

      case MSG_SUBMIT: {
        const slot = this.slots.get(from);
        if (!slot || !slot.connected) return;
        for (const command of message.commands) {
          // A peer may only issue orders as its own player. The simulation
          // re-checks unit ownership too, but rejecting here keeps a forged
          // playerId out of the authoritative command log entirely.
          if (command.playerId !== slot.playerId) continue;
          if (!this.scheduleCommand(command, message.requestedTick)) slot.lateCommands++;
        }
        break;
      }

      case MSG_HASH: {
        this.handleHash(from, message.tick, message.hash);
        break;
      }

      default:
        // Guests do not send anything else; ignore rather than trusting it.
        break;
    }
  };

  private handleHello(
    from: PeerId,
    protocol: number,
    contentHash: number,
    name: string,
  ): void {
    if (protocol !== PROTOCOL_VERSION) {
      this.transport.send(
        from,
        encodeMessage({
          t: MSG_REJECT,
          reason: `protocol ${protocol} but host speaks ${PROTOCOL_VERSION}`,
        }),
      );
      return;
    }

    // Two peers running the same code but disagreeing about how much a unit
    // costs diverge on the first purchase, and the desync report then points at
    // the simulation rather than at the real cause. Refusing at the door turns
    // an afternoon of confusion into one clear sentence.
    if (this.contentHash !== 0 && contentHash !== this.contentHash) {
      this.transport.send(
        from,
        encodeMessage({
          t: MSG_REJECT,
          reason:
            `content mismatch: yours is ${hex(contentHash)}, the host's is ` +
            `${hex(this.contentHash)}. You are running a different build.`,
        }),
      );
      return;
    }

    let slot = this.slots.get(from);
    if (!slot) {
      // Lowest unused player id, so ids stay dense and reproducible.
      const taken = new Set([...this.slots.values()].map((s) => s.playerId));
      let playerId = 0;
      while (taken.has(playerId)) playerId++;
      slot = {
        peer: from,
        playerId,
        name,
        connected: true,
        lastVerifiedTick: 0,
        lateCommands: 0,
      };
      this.slots.set(from, slot);
    } else {
      slot.connected = true;
      slot.name = name;
    }

    // Hand over authoritative state rather than construction parameters. Two
    // peers independently building a world from a seed is one more thing that
    // can silently disagree; copying the bytes cannot.
    this.transport.send(
      from,
      encodeMessage({
        t: MSG_WELCOME,
        protocol: PROTOCOL_VERSION,
        playerId: slot.playerId,
        mapTiles: this.world.mapTiles,
        seed: this.world.rng.state,
        inputDelay: this.inputDelay,
        tick: this.world.tick,
        snapshot: encodeSnapshot(this.world),
      }),
    );

    this.transport.broadcast(encodeMessage({ t: MSG_PEER_STATE, players: this.players }));
  }

  private handleHash(from: PeerId, tick: number, hash: number): void {
    const slot = this.slots.get(from);
    if (!slot) return;

    const ours = this.hashes.get(tick);
    // No record means the report is older than our retained history, or for a
    // tick we never hashed. Not evidence of anything either way.
    if (ours === undefined) return;

    if (ours === hash) {
      slot.lastVerifiedTick = tick;
      return;
    }

    this.desyncs++;
    this.onDesync?.(from, tick, hash, ours);

    // Resync rather than disconnect. A desync is usually a simulation bug
    // rather than the player's fault, and dropping them mid-match is a far
    // worse experience than a brief hitch.
    this.transport.send(
      from,
      encodeMessage({
        t: MSG_SNAPSHOT,
        tick: this.world.tick,
        snapshot: encodeSnapshot(this.world),
      }),
    );
  }

  private handleLeave = (peer: PeerId): void => {
    const slot = this.slots.get(peer);
    if (!slot) return;
    // The slot is kept, marked disconnected, so the player's units remain on
    // the field and the same player id is restored if they reconnect.
    slot.connected = false;
    this.transport.broadcast(encodeMessage({ t: MSG_PEER_STATE, players: this.players }));
  };

  /** Diagnostics: commands that arrived too late for their requested tick. */
  get lateCommandCount(): number {
    let total = 0;
    for (const slot of this.slots.values()) total += slot.lateCommands;
    return total;
  }
}

export { TICK_MS };

/** Eight-digit hex, so two content hashes can be compared by eye in a message. */
function hex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}
