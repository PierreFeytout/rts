import { hashArrayPrefix, hashNumber } from "./hash.js";

/**
 * Per-player simulation state: resources, supply, and whether they are still in
 * the match.
 *
 * Fixed-size arrays rather than a list of objects, for the same reason the
 * entity store is: this is hashed every desync check and serialised into every
 * snapshot, and a flat typed array makes both a single memcpy-shaped operation.
 *
 * A player slot always exists. Nobody is "added" when they connect -- the slot
 * was there from tick zero, and connecting only decides who sends commands for
 * it. That keeps joining a networking concern rather than a simulation event,
 * which is what allows a guest to join a match already in progress.
 */

export const MAX_PLAYERS = 4;

/** Starting bank. Enough to open with a Foundry or a few drones, not both. */
export const START_ALLOY = 500;
export const START_PLASMA = 100;

export class PlayerState {
  readonly alloy = new Int32Array(MAX_PLAYERS);
  readonly plasma = new Int32Array(MAX_PLAYERS);
  /** Supply consumed by living units, including those still in production. */
  readonly supplyUsed = new Int32Array(MAX_PLAYERS);
  /** Supply available from completed buildings. Recomputed each tick. */
  readonly supplyCap = new Int32Array(MAX_PLAYERS);
  /**
   * 1 for slots that are actually contesting this match.
   *
   * Player slots exist from tick zero whether or not anyone occupies them, so
   * without this an empty slot would count as instantly eliminated and a
   * two-player game would declare a winner on the first tick.
   */
  readonly inPlay = new Uint8Array(MAX_PLAYERS);
  /** 1 once the player has lost everything. Never returns to 0. */
  readonly defeated = new Uint8Array(MAX_PLAYERS);
  /**
   * Tick at which the player was eliminated, or -1.
   *
   * Recorded rather than derived so that a replay or a post-match screen can
   * show elimination order without having to re-simulate.
   */
  readonly defeatedTick = new Int32Array(MAX_PLAYERS);

  /**
   * Fractional plasma from extractors, in twentieths of a unit.
   *
   * Extractors produce a few plasma per second, which at 20 ticks per second is
   * not a whole number per tick. Accumulating the remainder in integer state
   * keeps the trickle exact -- rounding down every tick would silently produce
   * nothing at all for any rate below 20/second.
   */
  readonly plasmaFraction = new Int32Array(MAX_PLAYERS);

  /** Winner's player id once the match is decided, else -1. */
  winner = -1;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.alloy.fill(START_ALLOY);
    this.plasma.fill(START_PLASMA);
    this.supplyUsed.fill(0);
    this.supplyCap.fill(0);
    this.inPlay.fill(0);
    this.defeated.fill(0);
    this.defeatedTick.fill(-1);
    this.plasmaFraction.fill(0);
    this.winner = -1;
  }

  /** Whether a slot index is a real, playable slot. */
  isValid(playerId: number): boolean {
    return playerId >= 0 && playerId < MAX_PLAYERS;
  }

  /** Can this player afford a purchase right now? */
  canAfford(playerId: number, alloy: number, plasma: number): boolean {
    if (!this.isValid(playerId)) return false;
    return this.alloy[playerId] >= alloy && this.plasma[playerId] >= plasma;
  }

  /**
   * Deduct a cost, or return false and change nothing.
   *
   * All-or-nothing on purpose: a partial deduction on a failed purchase is the
   * kind of bug that shows up as resources quietly leaking over a long match.
   */
  spend(playerId: number, alloy: number, plasma: number): boolean {
    if (!this.canAfford(playerId, alloy, plasma)) return false;
    this.alloy[playerId] -= alloy;
    this.plasma[playerId] -= plasma;
    return true;
  }

  refund(playerId: number, alloy: number, plasma: number): void {
    if (!this.isValid(playerId)) return;
    this.alloy[playerId] += alloy;
    this.plasma[playerId] += plasma;
  }

  /** Component arrays in serialisation order. Snapshot and hash share this. */
  arrays(): Int32Array[] {
    return [this.alloy, this.plasma, this.supplyUsed, this.supplyCap, this.plasmaFraction, this.defeatedTick];
  }

  /** Flag arrays in serialisation order. Kept separate: different element type. */
  flagArrays(): Uint8Array[] {
    return [this.inPlay, this.defeated];
  }

  hash(h: number): number {
    let acc = hashNumber(h, this.winner);
    for (const array of this.arrays()) acc = hashArrayPrefix(acc, array, MAX_PLAYERS);
    for (const array of this.flagArrays()) acc = hashArrayPrefix(acc, array, MAX_PLAYERS);
    return acc;
  }
}
