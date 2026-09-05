import { decodeBinary, encodeBinary } from "@rts/protocol";
import {
  SNAPSHOT_VERSION,
  decodeSnapshot,
  encodeSnapshot,
  type Command,
  type World,
} from "@rts/sim";

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

  /**
   * Sample a checkpoint hash, without recording commands.
   *
   * For the live host, which already keeps the authoritative command log --
   * calling `record` as well would hold a second copy of every command array
   * for the length of the match. Checkpoints are the only thing that has to be
   * captured as it happens, because a hash cannot be recovered afterwards.
   */
  checkpoint(world: World): void {
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

  /** Finish using a command log kept elsewhere, such as the host's. */
  finishFrom(world: World, commands: readonly Command[][]): Replay {
    return {
      initialSnapshot: this.initialSnapshot,
      initialTick: this.initialTick,
      commands: commands.map((tick) => [...tick]),
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

// ---------------------------------------------------------------------------
// File format
// ---------------------------------------------------------------------------

/**
 * Replay file version.
 *
 * A replay is only meaningful against the build that produced it: it is a
 * command stream, and the simulation is what turns commands into a match.
 * Change the simulation and the same commands produce a different game, which
 * is not a bug but does mean an old file cannot be trusted. The snapshot
 * version is folded in for the same reason -- it moves whenever the world's
 * shape does.
 */
export const REPLAY_FORMAT = 1;

export interface ReplayFile {
  format: number;
  snapshotVersion: number;
  /** Content fingerprint, so a replay recorded against other content is refused. */
  contentHash: number;
  /** Milliseconds since the epoch, for sorting a folder of them. */
  recordedAt: number;
  replay: Replay;
}

/** Serialise a replay for saving to disk. */
export function encodeReplay(replay: Replay, contentHash: number, recordedAt: number): Uint8Array {
  const file: ReplayFile = {
    format: REPLAY_FORMAT,
    snapshotVersion: SNAPSHOT_VERSION,
    contentHash,
    recordedAt,
    replay,
  };
  return encodeBinary(file);
}

/**
 * Read a replay file, refusing anything this build cannot faithfully replay.
 *
 * Refusing loudly matters more here than almost anywhere else. A replay that
 * loads but diverges looks exactly like a simulation bug, and someone would
 * reasonably spend a day chasing it.
 */
export function decodeReplay(data: Uint8Array, contentHash: number): Replay {
  const file = decodeBinary(data) as Partial<ReplayFile> | null;
  if (!file || typeof file !== "object" || file.replay === undefined) {
    throw new Error("not a replay file");
  }
  if (file.format !== REPLAY_FORMAT) {
    throw new Error(`replay format ${file.format}, this build reads ${REPLAY_FORMAT}`);
  }
  if (file.snapshotVersion !== SNAPSHOT_VERSION) {
    throw new Error(
      `replay was recorded by a different build (snapshot v${file.snapshotVersion}, ` +
        `this build v${SNAPSHOT_VERSION})`,
    );
  }
  if (contentHash !== 0 && file.contentHash !== contentHash) {
    throw new Error("replay was recorded against different content");
  }
  const replay = file.replay;
  // msgpack gives back a plain object; the snapshot must be a byte view or
  // `decodeSnapshot` will read garbage rather than fail.
  if (!(replay.initialSnapshot instanceof Uint8Array)) {
    replay.initialSnapshot = new Uint8Array(replay.initialSnapshot as ArrayLike<number>);
  }
  return replay;
}
