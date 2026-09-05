import type { Replay } from "@rts/netcode";
import { TICK_MS, TickClock, decodeSnapshot, type Command, type World } from "@rts/sim";

/**
 * Watching a recorded match.
 *
 * Implements the same shape as `HostSession` and `GuestSession` -- `update`,
 * `alpha`, `submitLocal`, the tick hooks -- so the entire match screen replays
 * a game without knowing it is doing so. The renderer, the fog, the minimap and
 * the HUD are all the real ones; only the thing feeding them ticks is
 * different. That is the payoff for having kept the session interface narrow.
 *
 * Orders are ignored rather than rejected. A viewer clicking around is not an
 * error, and a replay that argued back would be worse than one that quietly
 * carries on.
 */

/** Playback speeds offered by the controls. */
export const REPLAY_SPEEDS = [0.5, 1, 2, 4, 8];

export class ReplaySession {
  readonly world: World;
  private readonly replay: Replay;
  private readonly clock = new TickClock();

  /** Index into the recorded command stream. */
  private cursor = 0;
  private playing = true;
  private speed = 1;

  onBeforeTick?: (world: World) => void;
  onAfterTick?: (world: World) => void;

  constructor(world: World, replay: Replay) {
    this.world = world;
    this.replay = replay;
    this.restart();
  }

  /** Total ticks in the recording. */
  get length(): number {
    return this.replay.commands.length;
  }

  get position(): number {
    return this.cursor;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get playbackSpeed(): number {
    return this.speed;
  }

  get isFinished(): boolean {
    return this.cursor >= this.replay.commands.length;
  }

  /** Interpolation alpha, exactly as a live session provides it. */
  get alpha(): number {
    return this.playing ? this.clock.alpha : 0;
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  /**
   * Jump to a tick.
   *
   * Backwards means replaying from the start, because a simulation step is not
   * invertible -- there is no way to un-kill a unit. Forwards from the current
   * position is just fast-forwarding. Neither is fast for a long match, so the
   * scrub happens in one synchronous burst rather than being animated, which
   * is also what a viewer expects from dragging a slider.
   */
  seek(tick: number): void {
    const target = Math.max(0, Math.min(tick, this.replay.commands.length));
    if (target < this.cursor) this.restart();
    while (this.cursor < target) this.stepOnce();
    this.clock.reset();
  }

  /** Advance by elapsed wall-clock time. Returns the number of ticks executed. */
  update(deltaMs: number): number {
    if (!this.playing || this.isFinished) return 0;

    const wanted = this.clock.advance(deltaMs * this.speed);
    let executed = 0;
    for (let i = 0; i < wanted; i++) {
      if (this.isFinished) {
        // Hold on the final frame rather than looping. A replay that restarted
        // itself would make it impossible to look at how a match ended.
        this.playing = false;
        break;
      }
      this.stepOnce();
      executed++;
    }
    return executed;
  }

  /** Accepted and discarded: a viewer cannot change a recorded match. */
  submitLocal(_command: Command): void {
    void _command;
  }

  close(): void {
    this.playing = false;
  }

  private restart(): void {
    decodeSnapshot(this.world, this.replay.initialSnapshot);
    this.world.tick = this.replay.initialTick;
    this.cursor = 0;
    this.clock.reset();
  }

  private stepOnce(): void {
    const commands = this.replay.commands[this.cursor] ?? [];
    this.onBeforeTick?.(this.world);
    this.world.step(commands);
    this.onAfterTick?.(this.world);
    this.cursor++;
  }
}

export { TICK_MS };
