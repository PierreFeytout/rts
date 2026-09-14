import { defaultContent } from "@rts/content";
import {
  BLOCKED_QUEUE_FULL,
  BLOCKED_RESOURCES,
  BLOCKED_SPACE,
  BLOCKED_SUPPLY,
  CMD_ATTACK,
  CMD_ATTACK_MOVE,
  CMD_BUILD,
  CMD_CANCEL_TRAIN,
  CMD_GATHER,
  CMD_HOLD,
  CMD_MOVE,
  CMD_RALLY,
  CMD_STOP,
  CMD_TRAIN,
  EV_BLOCKED,
  EV_BUILD_COMPLETE,
  EV_DEATH,
  EV_DEPOSIT,
  EV_SHOT,
  EV_UNIT_TRAINED,
  KIND_BUILDING,
  VIS_VISIBLE,
  type Command,
  type EntityId,
  type Fx,
  type World,
} from "@rts/sim";
import { keysFor } from "./sfx-config.js";
import { sfx } from "./sfx.js";

/**
 * What a match sounds like: simulation events and the local player's own
 * actions, turned into sound keys (see sfx-config.ts).
 *
 * **Nothing is heard that could not be seen.** A shot, a death or a finished
 * building somewhere in the fog plays nothing at all -- a battle audible
 * through fog of war is a scouting report the player did not earn. The
 * player's own deposits, orders and refusals are theirs, and always play.
 *
 * Reads events and state only; nothing here is simulation state.
 */

const DAMAGE = ["kinetic", "plasma", "explosive"];
const BLOCKED: Record<number, string> = {
  [BLOCKED_RESOURCES]: "resources",
  [BLOCKED_SUPPLY]: "supply",
  [BLOCKED_SPACE]: "space",
  [BLOCKED_QUEUE_FULL]: "queue",
};
const ORDERS: Record<number, string> = {
  [CMD_MOVE]: "move",
  [CMD_STOP]: "stop",
  [CMD_HOLD]: "hold",
  [CMD_ATTACK]: "attack",
  [CMD_ATTACK_MOVE]: "attack",
  [CMD_GATHER]: "gather",
  [CMD_BUILD]: "build",
  [CMD_TRAIN]: "train",
  [CMD_CANCEL_TRAIN]: "cancel",
  [CMD_RALLY]: "rally",
};

export class MatchSounds {
  private readonly localPlayer: number;
  private selection = "";

  constructor(localPlayer: number) {
    this.localPlayer = localPlayer;
  }

  /** Call from the session's after-tick hook, while `world.events` is current. */
  ingest(world: World): void {
    const e = world.entities;
    for (const event of world.events.all) {
      switch (event.kind) {
        case EV_SHOT: {
          const i = e.indexOfLive(event.shooter);
          const type = i >= 0 ? world.types.get(e.typeId[i]) : null;
          const damage = type ? [DAMAGE[type.damageType]] : [];
          if (this.sees(world, event.fromX, event.fromY)) {
            sfx.play(keysFor("shot", type ? defaultContent.contentIdOf(type.id) : null, damage), at(event.fromX, event.fromY));
          }
          if (this.sees(world, event.toX, event.toY)) {
            sfx.play(keysFor("impact", null, damage), at(event.toX, event.toY));
          }
          break;
        }
        case EV_DEATH: {
          if (!this.sees(world, event.x, event.y)) break;
          const kind = world.types.get(event.typeId).kind === KIND_BUILDING ? "building" : "unit";
          sfx.play(keysFor("death", defaultContent.contentIdOf(event.typeId), [kind]), at(event.x, event.y));
          break;
        }
        case EV_BUILD_COMPLETE:
          this.atEntity(world, event.entity, keysFor("built", defaultContent.contentIdOf(event.typeId)));
          break;
        case EV_UNIT_TRAINED:
          this.atEntity(world, event.from, keysFor("trained", defaultContent.contentIdOf(event.typeId)));
          break;
        case EV_DEPOSIT:
          if (event.player === this.localPlayer) sfx.play(["deposit"], at(event.x, event.y));
          break;
        case EV_BLOCKED:
          if (event.player === this.localPlayer) sfx.play(keysFor("blocked", null, [BLOCKED[event.reason] ?? "other"]));
          break;
        default:
          break;
      }
    }
  }

  /** The local player gave an order. */
  order(command: Command): void {
    const name = ORDERS[command.kind];
    if (name) sfx.play(keysFor("order", null, [name]));
  }

  /**
   * The selection, every frame. Plays when it changes to something new: the
   * first thing selected speaks for the group.
   */
  select(world: World, selected: ReadonlySet<EntityId>): void {
    const signature = [...selected].join(",");
    if (signature === this.selection) return;
    this.selection = signature;
    const first = selected.values().next().value;
    if (first === undefined) return;
    const i = world.entities.indexOfLive(first);
    if (i < 0) return;
    const type = world.types.get(world.entities.typeId[i]);
    sfx.play(keysFor("select", defaultContent.contentIdOf(type.id), [type.kind === KIND_BUILDING ? "building" : "unit"]));
  }

  private atEntity(world: World, id: EntityId, keys: string[]): void {
    const i = world.entities.indexOfLive(id);
    if (i < 0) return;
    const x = world.entities.posX[i];
    const y = world.entities.posY[i];
    if (world.entities.owner[i] === this.localPlayer || this.sees(world, x, y)) sfx.play(keys, at(x, y));
  }

  private sees(world: World, x: Fx, y: Fx): boolean {
    if (!world.vision.enabled) return true;
    return world.vision.levelAt(this.localPlayer, x >> 16, y >> 16) === VIS_VISIBLE;
  }
}

function at(x: Fx, y: Fx): { x: number; z: number } {
  return { x: x / 65536, z: y / 65536 };
}
