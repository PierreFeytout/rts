import type { EntityId } from "./entities.js";
import type { Fx } from "./fixed.js";

/**
 * Things that happened during a tick, for the presentation layer.
 *
 * Muzzle flashes, tracers, explosions and "not enough alloy" nags all need to
 * know about events that are invisible in the resulting state -- a shot that
 * killed its target leaves nothing behind to draw a tracer from.
 *
 * These are *derived output*, never simulation state. The list is rebuilt from
 * scratch each tick and is not hashed, not snapshotted, and never read back by
 * the simulation. That is what keeps it safe: because every peer runs the same
 * step over the same commands, every peer produces the same events anyway, but
 * nothing breaks if a headless peer ignores them entirely.
 *
 * The consequence to respect: a peer that resyncs from a snapshot skips the
 * events for the ticks it missed. Effects are therefore allowed to be missed,
 * which is fine for a tracer and would not be for anything gameplay-visible.
 */

export const EV_SHOT = 1;
export const EV_DEATH = 2;
export const EV_DEPOSIT = 3;
export const EV_BUILD_COMPLETE = 4;
export const EV_UNIT_TRAINED = 5;
export const EV_BLOCKED = 6;
export const EV_PLAYER_DEFEATED = 7;

/** Why a command could not be carried out, for a HUD nag. */
export const BLOCKED_RESOURCES = 1;
export const BLOCKED_SUPPLY = 2;
export const BLOCKED_SPACE = 3;
export const BLOCKED_QUEUE_FULL = 4;

export interface ShotEvent {
  kind: typeof EV_SHOT;
  shooter: EntityId;
  target: EntityId;
  fromX: Fx;
  fromY: Fx;
  toX: Fx;
  toY: Fx;
  damage: number;
  /** True if this shot was the one that killed the target. */
  lethal: boolean;
}

export interface DeathEvent {
  kind: typeof EV_DEATH;
  entity: EntityId;
  typeId: number;
  owner: number;
  x: Fx;
  y: Fx;
}

export interface DepositEvent {
  kind: typeof EV_DEPOSIT;
  player: number;
  amount: number;
  x: Fx;
  y: Fx;
}

export interface BuildCompleteEvent {
  kind: typeof EV_BUILD_COMPLETE;
  entity: EntityId;
  typeId: number;
  owner: number;
}

export interface UnitTrainedEvent {
  kind: typeof EV_UNIT_TRAINED;
  entity: EntityId;
  typeId: number;
  owner: number;
  from: EntityId;
}

export interface BlockedEvent {
  kind: typeof EV_BLOCKED;
  player: number;
  reason: number;
  /** The type the player was trying to produce or place, if any. */
  typeId: number;
}

export interface PlayerDefeatedEvent {
  kind: typeof EV_PLAYER_DEFEATED;
  player: number;
  /** Set when this defeat decided the match. */
  winner: number;
}

export type SimEvent =
  | ShotEvent
  | DeathEvent
  | DepositEvent
  | BuildCompleteEvent
  | UnitTrainedEvent
  | BlockedEvent
  | PlayerDefeatedEvent;

/**
 * Bounded event buffer.
 *
 * Capped because a 400-unit brawl produces hundreds of shots a tick and the
 * renderer can only draw so many; an unbounded list would be a slow memory leak
 * during a long siege. Dropping the overflow is safe precisely because nothing
 * downstream is load-bearing.
 */
export class EventLog {
  private readonly items: SimEvent[] = [];
  private readonly capacity: number;
  /** Events discarded this tick because the buffer was full. */
  dropped = 0;

  constructor(capacity = 512) {
    this.capacity = capacity;
  }

  push(event: SimEvent): void {
    if (this.items.length >= this.capacity) {
      this.dropped++;
      return;
    }
    this.items.push(event);
  }

  clear(): void {
    this.items.length = 0;
    this.dropped = 0;
  }

  get all(): readonly SimEvent[] {
    return this.items;
  }

  get length(): number {
    return this.items.length;
  }
}
