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
 *
 * Every command carries `playerId`, and the simulation re-checks it against the
 * owner of each affected entity. The host validates the field on arrival, but
 * the sim never *relies* on that: in a peer-hosted game the arbiter is another
 * player's browser, so trusting an incoming field would make a modified client
 * able to order enemy units around.
 *
 * Commands are plain structural objects because they are msgpack'd directly.
 * Adding a kind needs no codec change -- only this union.
 */

export const CMD_MOVE = 1;
export const CMD_STOP = 2;
export const CMD_ATTACK = 3;
export const CMD_ATTACK_MOVE = 4;
export const CMD_GATHER = 5;
export const CMD_BUILD = 6;
export const CMD_TRAIN = 7;
export const CMD_CANCEL_TRAIN = 8;
export const CMD_RALLY = 9;
export const CMD_HOLD = 10;

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

/** Stand ground: hold position, but fire on anything that comes into range. */
export interface HoldCommand {
  kind: typeof CMD_HOLD;
  playerId: number;
  entities: readonly EntityId[];
}

/** Chase and destroy one specific entity. */
export interface AttackCommand {
  kind: typeof CMD_ATTACK;
  playerId: number;
  entities: readonly EntityId[];
  target: EntityId;
}

/** Advance on a point, engaging hostiles encountered along the way. */
export interface AttackMoveCommand {
  kind: typeof CMD_ATTACK_MOVE;
  playerId: number;
  entities: readonly EntityId[];
  targetX: Fx;
  targetY: Fx;
}

/** Harvest an ore node, looping until told otherwise or the node runs dry. */
export interface GatherCommand {
  kind: typeof CMD_GATHER;
  playerId: number;
  entities: readonly EntityId[];
  target: EntityId;
}

/**
 * Place a construction site and send builders to it.
 *
 * The site is paid for and created the moment the command executes, not when a
 * builder arrives. Deducting on arrival would let a player queue a dozen
 * buildings they cannot afford and discover which ones failed minutes later.
 */
export interface BuildCommand {
  kind: typeof CMD_BUILD;
  playerId: number;
  entities: readonly EntityId[];
  buildingType: number;
  /** Top-left tile of the footprint. */
  tileX: number;
  tileY: number;
}

/** Add a unit to a building's production queue. */
export interface TrainCommand {
  kind: typeof CMD_TRAIN;
  playerId: number;
  building: EntityId;
  unitType: number;
}

/** Remove a queued item and refund it. Position -1 means the last entry. */
export interface CancelTrainCommand {
  kind: typeof CMD_CANCEL_TRAIN;
  playerId: number;
  building: EntityId;
  position: number;
}

/** Set where units produced by a building walk to on completion. */
export interface RallyCommand {
  kind: typeof CMD_RALLY;
  playerId: number;
  entities: readonly EntityId[];
  targetX: Fx;
  targetY: Fx;
}

export type Command =
  | MoveCommand
  | StopCommand
  | HoldCommand
  | AttackCommand
  | AttackMoveCommand
  | GatherCommand
  | BuildCommand
  | TrainCommand
  | CancelTrainCommand
  | RallyCommand;
