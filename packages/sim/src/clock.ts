/**
 * Fixed-timestep pacing.
 *
 * The simulation advances in discrete 50 ms ticks and nothing else. Rendering
 * runs free at whatever rate the display allows and interpolates between the
 * previous and current tick using `alpha`, so a 20 Hz simulation still looks
 * smooth at 144 Hz.
 *
 * NOTE: `TickClock` is a *pacing helper*, not simulation state. It is never
 * hashed and never sent over the wire. The authoritative tick number lives in
 * the world; this class only decides how many times to call the sim this frame.
 * That distinction matters -- the clock consumes wall-clock deltas, which differ
 * on every peer, and it would desync instantly if it fed the simulation anything
 * other than "step exactly one tick".
 */

/** Simulation rate. 20 Hz is the classic RTS cadence: responsive, cheap to send. */
export const TICK_HZ = 20;
/** Milliseconds per simulation tick. */
export const TICK_MS = 1000 / TICK_HZ;

/**
 * Upper bound on ticks executed for a single frame.
 *
 * Without this, a long stall (alt-tab, a GC pause, a breakpoint) leaves a huge
 * accumulated delta; running all of it takes longer than real time, which grows
 * the delta further -- the classic "spiral of death". Capping means the sim
 * falls behind wall-clock instead, which is recoverable and vastly preferable to
 * a permanent freeze.
 */
const MAX_TICKS_PER_FRAME = 5;

export class TickClock {
  readonly tickMs: number;
  /** Ticks stepped since construction. Pacing only -- see the note above. */
  tick = 0;
  /** Unconsumed time, always in [0, tickMs). */
  private accumulator = 0;
  /** Ticks dropped to the spiral-of-death cap; useful as a performance signal. */
  dropped = 0;

  constructor(tickMs: number = TICK_MS) {
    this.tickMs = tickMs;
  }

  /**
   * Feed elapsed wall-clock time and learn how many ticks to run now.
   * Call the simulation exactly this many times, each advancing one tick.
   */
  advance(deltaMs: number): number {
    // Guard against negative or absurd deltas from clock adjustments and from
    // the first frame after a tab is restored.
    if (!(deltaMs > 0)) return 0;

    this.accumulator += deltaMs;

    let steps = Math.floor(this.accumulator / this.tickMs);
    if (steps > MAX_TICKS_PER_FRAME) {
      this.dropped += steps - MAX_TICKS_PER_FRAME;
      steps = MAX_TICKS_PER_FRAME;
      // Discard the backlog rather than carrying it forward, otherwise the
      // cap merely delays the spiral instead of breaking it.
      this.accumulator = 0;
    } else {
      this.accumulator -= steps * this.tickMs;
    }

    this.tick += steps;
    return steps;
  }

  /**
   * Interpolation factor in [0, 1) between the previous and current tick.
   * Multiply into the render transform blend so motion is smooth between ticks.
   */
  get alpha(): number {
    return this.accumulator / this.tickMs;
  }

  reset(): void {
    this.tick = 0;
    this.accumulator = 0;
    this.dropped = 0;
  }
}
