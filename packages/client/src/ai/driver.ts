import type { Command, World } from "@rts/sim";

/**
 * Where a computer player's orders come from.
 *
 * Nothing implements this yet beyond `idleAi`. It exists as a named seam
 * because "Computer" is an option in the lobby, and a slot labelled that with
 * a bare `if (kind === "computer")` scattered through the match screen is how
 * the eventual real implementation ends up wired in three places.
 *
 * TWO RULES FOR WHOEVER WRITES A REAL ONE
 * ---------------------------------------
 * 1. **It runs on the host only.** Its output is commands, submitted through
 *    `HostSession.submitLocal` and scheduled at `T+delay` exactly like a
 *    human's, so every peer executes them identically and replays reproduce the
 *    match without knowing an AI was involved. The AI itself therefore does not
 *    need to be deterministic *across machines* -- only the commands it emits
 *    ever cross the wire. That is a large amount of freedom and it is the
 *    reason to keep it on this side of the boundary rather than inside
 *    `packages/sim`.
 *
 * 2. **No `Math.random` and no wall clock.** Not for cross-peer agreement, but
 *    for replays: a recorded match re-simulates the command log, and a decision
 *    made from `Date.now()` cannot be re-derived. Drive it from `world.tick`
 *    and, if it needs randomness, from its own seeded generator -- not
 *    `world.rng`, which is hashed simulation state that a host-side helper must
 *    not disturb.
 */
export interface AiDriver {
  /**
   * Called before each simulated tick, for one computer player.
   *
   * `submit` is the same door a human's mouse click goes through. Commands are
   * scheduled, not applied, so nothing here can reach into the world directly.
   */
  onTick(world: World, player: number, submit: (command: Command) => void): void;
}

/**
 * A computer player that owns a base and does nothing with it.
 *
 * Deliberate, and chosen over pretending the option does not exist: the lobby,
 * the slot kinds, the world builder and the victory condition all have to work
 * for a non-human player before any behaviour is worth writing, and this is
 * what proves they do.
 */
export const idleAi: AiDriver = {
  onTick() {},
};
