import { decodeSnapshot, encodeSnapshot, type Command, type World } from "@rts/sim";

/**
 * Replay recording and playback.
 *
 * Replays cost almost nothing here, which is a direct dividend of lockstep: the
 * command log the arbiter already broadcasts *is* the replay. An initial
 * snapshot plus the per-tick command sets reconstruct the match exactly, with
 * no additional recording during play.
 *
 * That also makes replays the sharpest determinism test available. If replaying
 * a recorded match does not reproduce its final state hash, the simulation has
 * a non-determinism somewhere -- and it is far easier to find with a replay
 * that fails reproducibly than by chasing a desync report from a friend.
 */

export interface Replay {
  /** World state before the first recorded tick. */
  initialSnapshot: Uint8Array;
  /** Tick the snapshot represents. */
  initialTick: number;
  /** Commands per tick, starting at `initialTick`. */
  commands: Command[][];
  /** Hash at the end of playback, for verification. */
  finalHash: number;
  /** Hashes at intervals, so a divergence can be bisected to a tick range. */
  checkpoints: Array<{ tick: number; hash: number }>;
}

export class ReplayRecorder {
  private readonly initialSnapshot: Uint8Array;
  private readonly initialTick: number;
  private readonly commands: Command[][] = [];
  private readonly checkpoints: Array<{ tick: number; hash: number }> = [];
  private readonly checkpointInterval: number;

  constructor(world: World, checkpointInterval = 100) {
    this.initialSnapshot = encodeSnapshot(world);
    this.initialTick = world.tick;
    this.checkpointInterval = checkpointInterval;
  }

  /** Record the command set for one tick. Call once per executed tick. */
  record(world: World, tickCommands: Command[]): void {
    this.commands.push(tickCommands);
    if (world.tick % this.checkpointInterval === 0) {
      this.checkpoints.push({ tick: world.tick, hash: world.hash() });
    }
  }

  finish(world: World): Replay {
    return {
      initialSnapshot: this.initialSnapshot,
      initialTick: this.initialTick,
      commands: this.commands,
      finalHash: world.hash(),
      checkpoints: this.checkpoints,
    };
  }
}

export interface ReplayResult {
  ok: boolean;
  finalHash: number;
  /** First checkpoint whose hash disagreed, or null if all matched. */
  divergedAtTick: number | null;
  ticksPlayed: number;
}

/**
 * Replay into a world and verify it reproduces the recorded hashes.
 *
 * Reports the FIRST diverging checkpoint rather than only pass/fail: knowing a
 * replay ends wrong is nearly useless, while knowing it went wrong between tick
 * 300 and 400 narrows the search enormously.
 */
export function playReplay(world: World, replay: Replay): ReplayResult {
  decodeSnapshot(world, replay.initialSnapshot);

  let divergedAtTick: number | null = null;
  let checkpointIndex = 0;

  for (const commands of replay.commands) {
    world.step(commands);

    const checkpoint = replay.checkpoints[checkpointIndex];
    if (checkpoint && checkpoint.tick === world.tick) {
      checkpointIndex++;
      if (divergedAtTick === null && world.hash() !== checkpoint.hash) {
        divergedAtTick = world.tick;
      }
    }
  }

  const finalHash = world.hash();
  return {
    ok: divergedAtTick === null && finalHash === replay.finalHash,
    finalHash,
    divergedAtTick,
    ticksPlayed: replay.commands.length,
  };
}
