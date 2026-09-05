import type { EntityId } from "./entities.js";
import type { Fx } from "./fixed.js";

/**
 * Player commands -- the only thing that crosses the network.
 *
 * Commands express *intent*, never state: "these units should move there", not
 * "this unit is now at (x, y)". That distinction is what keeps lockstep
 * bandwidth flat regardless of army size, and it is why a peer can never assert
 * a position directly. Every peer derives positions by running the same
 * simulation over the same command stream.
 */

export const CMD_MOVE = 1;
export const CMD_STOP = 2;

export interface MoveCommand {
  kind: typeof CMD_MOVE;
  /** Issuing player. Ownership is re-checked in the sim; see applyCommand. */
  playerId: number;
  entities: readonly EntityId[];
  targetX: Fx;
  targetY: Fx;
}

export interface StopCommand {
  kind: typeof CMD_STOP;
  playerId: number;
  entities: readonly EntityId[];
}

export type Command = MoveCommand | StopCommand;
