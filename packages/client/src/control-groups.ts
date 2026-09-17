import { type EntityId, type World } from "@rts/sim";
import type { IsoCamera } from "./iso-camera.js";
import { anyModal } from "./modal.js";
import type { Selection } from "./selection.js";

/**
 * Control groups: `Ctrl+1..9` to assign, `1..9` to recall.
 *
 * The single highest-value piece of RTS quality-of-life there is, and about
 * sixty lines. Without it a player re-drags a box over the same army every time
 * they want to do anything with it.
 *
 * Groups hold entity *handles*, not slot indices. When a unit in a group dies
 * its handle stops resolving and it drops out on the next recall -- no sweep
 * needed, and no chance of a group silently acquiring whatever new unit took
 * the recycled slot.
 *
 * Purely client state. Nobody else needs to know which units this player has
 * grouped, so it is not simulation state, not hashed, and not sent anywhere.
 */

/** Recalling the same group twice within this window centres the camera on it. */
const DOUBLE_TAP_MS = 350;

export class ControlGroups {
  private readonly groups = new Map<number, EntityId[]>();
  private readonly world: World;
  private readonly selection: Selection;
  private readonly rig: IsoCamera;
  private readonly localPlayer: number;

  private lastRecalled = -1;
  private lastRecallMs = 0;
  private readonly off: () => void;

  constructor(world: World, selection: Selection, rig: IsoCamera, localPlayer: number) {
    this.world = world;
    this.selection = selection;
    this.rig = rig;
    this.localPlayer = localPlayer;

    const handler = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      // Not while a menu is over the match; see modal.ts.
      if (anyModal()) return;

      const digit = Number(event.key);
      if (!Number.isInteger(digit) || digit < 1 || digit > 9) return;

      // Ctrl/Cmd assigns, a bare digit recalls. Both are prevented so the
      // browser does not treat Ctrl+number as a tab switch.
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) this.assign(digit);
      else this.recall(digit);
    };

    window.addEventListener("keydown", handler);
    this.off = () => window.removeEventListener("keydown", handler);
  }

  dispose(): void {
    this.off();
  }

  /** Groups that currently hold at least one living unit, for the HUD. */
  occupied(): number[] {
    const out: number[] = [];
    for (let digit = 1; digit <= 9; digit++) {
      if (this.living(digit).length > 0) out.push(digit);
    }
    return out;
  }

  /** How many living units a group holds. */
  size(digit: number): number {
    return this.living(digit).length;
  }

  private assign(digit: number): void {
    // Only the player's own mobile units. Grouping a building would make the
    // digit recall something that cannot be ordered anywhere.
    const members: EntityId[] = [];
    for (const id of this.selection.selected) {
      const i = this.world.entities.indexOfLive(id);
      if (i < 0) continue;
      if (this.world.entities.owner[i] !== this.localPlayer) continue;
      if (this.world.entities.moveSpeed[i] === 0) continue;
      members.push(id);
    }

    if (members.length === 0) {
      // Assigning an empty selection clears the group, which is what a player
      // pressing Ctrl+3 on nothing is asking for.
      this.groups.delete(digit);
      return;
    }
    this.groups.set(digit, members);
  }

  private recall(digit: number): void {
    const members = this.living(digit);
    if (members.length === 0) return;

    this.selection.setSelection(members);

    const now = performance.now();
    if (this.lastRecalled === digit && now - this.lastRecallMs < DOUBLE_TAP_MS) {
      this.centreOn(members);
    }
    this.lastRecalled = digit;
    this.lastRecallMs = now;
  }

  /**
   * Members of a group that still exist.
   *
   * Prunes as it goes, so a group whose units died gradually stops holding
   * dead handles rather than growing a permanent tail of them.
   */
  private living(digit: number): EntityId[] {
    const members = this.groups.get(digit);
    if (!members) return [];
    const alive = members.filter((id) => this.world.entities.isAlive(id));
    if (alive.length !== members.length) {
      if (alive.length === 0) this.groups.delete(digit);
      else this.groups.set(digit, alive);
    }
    return alive;
  }

  private centreOn(members: readonly EntityId[]): void {
    const e = this.world.entities;
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (const id of members) {
      const i = e.indexOfLive(id);
      if (i < 0) continue;
      sumX += e.posX[i] / 65536;
      sumY += e.posY[i] / 65536;
      count++;
    }
    if (count > 0) this.rig.lookAtGround(sumX / count, sumY / count);
  }
}
