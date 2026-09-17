import {
  CAN_BUILD,
  CAN_GATHER,
  CAN_PRODUCE,
  CMD_ATTACK,
  CMD_ATTACK_MOVE,
  CMD_BUILD,
  CMD_GATHER,
  CMD_HOLD,
  CMD_MOVE,
  CMD_RALLY,
  CMD_STOP,
  KIND_RESOURCE,
  NULL_ENTITY,
  type Command,
  type EntityId,
  type World,
} from "@rts/sim";
import * as THREE from "three";
import { simToWorld, worldToSim } from "./coords.js";
import { anyModal } from "./modal.js";
import type { IsoCamera } from "./iso-camera.js";

/**
 * Unit selection and order issuing.
 *
 * Emits commands rather than mutating the world directly. That separation is
 * deliberate and load-bearing: commands go through the arbiter to be scheduled
 * at a future tick rather than being applied locally, so anything that took a
 * shortcut here would desync instantly.
 *
 * Right-click is *contextual* -- the same button means move, attack, gather or
 * rally depending on what is under the cursor and what is selected. That is the
 * genre convention and it is what keeps the command card optional rather than
 * mandatory.
 */

/** Pointer travel under this many pixels counts as a click, not a drag. */
const DRAG_THRESHOLD_PX = 5;
/** Radius in world units for a single-click pick on a unit. */
const CLICK_PICK_RADIUS = 0.65;

export class Selection {
  readonly selected = new Set<EntityId>();

  /** Type id being placed, or 0 when not in build mode. */
  buildType = 0;
  /** Anchor tile the build ghost is currently over, or null. */
  ghostTile: { x: number; y: number } | null = null;
  /** True while waiting for the player to click an attack-move destination. */
  attackMovePending = false;

  /** Fired whenever the selection or a pending mode changes. */
  onChange: (() => void) | null = null;

  private readonly rig: IsoCamera;
  private readonly element: HTMLElement;
  private readonly world: World;
  private readonly localPlayer: number;
  private readonly emit: (command: Command) => void;
  private readonly boxElement: HTMLDivElement;

  private dragging = false;
  private startX = 0;
  private startY = 0;
  private currentX = 0;
  private currentY = 0;

  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly hit = new THREE.Vector3();
  private readonly projected = new THREE.Vector3();

  private readonly disposers: Array<() => void> = [];

  constructor(
    world: World,
    rig: IsoCamera,
    element: HTMLElement,
    localPlayer: number,
    emit: (command: Command) => void,
  ) {
    this.world = world;
    this.rig = rig;
    this.element = element;
    this.localPlayer = localPlayer;
    this.emit = emit;

    this.boxElement = document.createElement("div");
    this.boxElement.style.cssText =
      "position:fixed;border:1px solid #7dffb0;background:rgba(125,255,176,0.12);" +
      "pointer-events:none;display:none;z-index:10";
    document.body.appendChild(this.boxElement);

    this.listen(element, "pointerdown", (e) => {
      const ev = e as PointerEvent;
      if (ev.button === 0) {
        if (this.buildType !== 0) {
          this.placeBuilding(ev.clientX, ev.clientY, ev.shiftKey);
          return;
        }
        if (this.attackMovePending) {
          this.issueAttackMove(ev.clientX, ev.clientY);
          return;
        }
        this.dragging = true;
        this.startX = this.currentX = ev.clientX;
        this.startY = this.currentY = ev.clientY;
        element.setPointerCapture(ev.pointerId);
      } else if (ev.button === 2) {
        ev.preventDefault();
        // Right-click is also the universal "never mind" for a pending mode.
        if (this.buildType !== 0 || this.attackMovePending) {
          this.cancelPending();
          return;
        }
        this.issueContextOrder(ev.clientX, ev.clientY);
      }
    });

    this.listen(element, "pointermove", (e) => {
      const ev = e as PointerEvent;
      if (this.buildType !== 0) {
        this.updateGhost(ev.clientX, ev.clientY);
        return;
      }
      if (!this.dragging) return;
      this.currentX = ev.clientX;
      this.currentY = ev.clientY;
      if (this.dragDistance() > DRAG_THRESHOLD_PX) this.updateBox();
    });

    this.listen(element, "pointerup", (e) => {
      const ev = e as PointerEvent;
      if (ev.button !== 0 || !this.dragging) return;
      this.dragging = false;
      this.boxElement.style.display = "none";
      if (element.hasPointerCapture(ev.pointerId)) element.releasePointerCapture(ev.pointerId);

      // Shift adds to the selection; otherwise the previous one is replaced.
      if (!ev.shiftKey) this.selected.clear();

      if (this.dragDistance() > DRAG_THRESHOLD_PX) {
        this.selectInBox();
      } else {
        this.selectAt(ev.clientX, ev.clientY);
      }
      this.changed();
    });

    this.listen(element, "pointercancel", () => {
      this.dragging = false;
      this.boxElement.style.display = "none";
    });

    this.listen(window, "keydown", (e) => {
      const ev = e as KeyboardEvent;
      // Never steal keys from a focused text field -- the join-code box lives
      // on the same page.
      const target = ev.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      // A menu is open over the match. Reaching Settings with the keyboard
      // would otherwise also tell the selected squad to stop.
      if (anyModal()) return;

      switch (ev.key.toLowerCase()) {
        case "s":
          this.issueToSelection(CMD_STOP);
          break;
        case "h":
          this.issueToSelection(CMD_HOLD);
          break;
        case "a":
          if (this.selected.size > 0) {
            this.attackMovePending = true;
            this.buildType = 0;
            this.changed();
          }
          break;
        // Escape is not here: it cancels a pending order *or* opens the
        // in-game menu, and only one place can decide which. MatchMenu calls
        // `cancelPending` first and opens itself if there was nothing to
        // cancel.
      }
    });
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.boxElement.remove();
  }

  /** Drop handles whose entities have died, so rings do not linger. */
  pruneDead(): void {
    let removed = false;
    for (const id of this.selected) {
      if (!this.world.entities.isAlive(id)) {
        this.selected.delete(id);
        removed = true;
      }
    }
    if (removed) this.changed();
  }

  /** Enter building-placement mode. */
  beginBuild(typeId: number): void {
    this.buildType = typeId;
    this.attackMovePending = false;
    this.changed();
  }

  /**
   * Drop a half-given order: a building waiting to be placed, or an
   * attack-move waiting for its target.
   *
   * Reports whether there was one, because Escape means two things in a match
   * -- cancel this, or open the menu -- and which it meant is exactly this
   * answer. See MatchMenu.
   */
  cancelPending(): boolean {
    if (this.buildType === 0 && !this.attackMovePending) return false;
    this.buildType = 0;
    this.attackMovePending = false;
    this.ghostTile = null;
    this.changed();
    return true;
  }

  /** Replace the selection wholesale, e.g. from a HUD button. */
  setSelection(ids: readonly EntityId[]): void {
    this.selected.clear();
    for (const id of ids) this.selected.add(id);
    this.changed();
  }

  // -------------------------------------------------------------------------

  private changed(): void {
    this.onChange?.();
  }

  private dragDistance(): number {
    return Math.hypot(this.currentX - this.startX, this.currentY - this.startY);
  }

  private updateBox(): void {
    const left = Math.min(this.startX, this.currentX);
    const top = Math.min(this.startY, this.currentY);
    this.boxElement.style.left = `${left}px`;
    this.boxElement.style.top = `${top}px`;
    this.boxElement.style.width = `${Math.abs(this.currentX - this.startX)}px`;
    this.boxElement.style.height = `${Math.abs(this.currentY - this.startY)}px`;
    this.boxElement.style.display = "block";
  }

  /** Screen point to a position on the ground plane. */
  private groundAt(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.element.getBoundingClientRect();
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.rig.camera);
    return this.raycaster.ray.intersectPlane(this.groundPlane, this.hit);
  }

  /**
   * Nearest entity of any owner under the cursor, or NULL_ENTITY.
   *
   * Pick radius scales with footprint so a 4x4 Nexus is clickable across its
   * whole face rather than only at the exact centre point.
   */
  private pickAny(clientX: number, clientY: number): EntityId {
    const point = this.groundAt(clientX, clientY);
    if (!point) return NULL_ENTITY;

    const e = this.world.entities;
    let best = NULL_ENTITY;
    let bestScore = Infinity;

    for (let i = 0; i < e.highWater; i++) {
      if (e.alive[i] !== 1) continue;
      // Nothing hidden by fog is clickable. Otherwise a player could
      // right-click a patch of darkness and happen to order an attack on
      // something they have no way of knowing is there.
      if (!this.isPickable(i)) continue;
      const type = this.world.types.get(e.typeId[i]);
      const reach = type.footprint > 0 ? type.footprint * 0.6 : CLICK_PICK_RADIUS;
      const dx = simToWorld(e.posX[i]) - point.x;
      const dz = simToWorld(e.posY[i]) - point.z;
      const d = Math.hypot(dx, dz);
      if (d > reach) continue;
      // Normalised distance, so a small unit standing on a big building's
      // footprint still wins the pick.
      const score = d / reach;
      if (score < bestScore) {
        bestScore = score;
        best = e.idAt(i);
      }
    }
    return best;
  }

  /**
   * Whether the local player is allowed to click this entity.
   *
   * Matches what the renderer draws: own things always, moving things only
   * while visible, static things once explored. Any mismatch would leave
   * something on screen that cannot be clicked, or clickable and invisible.
   */
  private isPickable(index: number): boolean {
    const e = this.world.entities;
    const vision = this.world.vision;
    if (!vision.enabled) return true;
    if (e.owner[index] === this.localPlayer) return true;

    const tx = e.posX[index] >> 16;
    const ty = e.posY[index] >> 16;
    if (vision.isVisible(this.localPlayer, tx, ty)) return true;
    const isStatic = this.world.types.get(e.typeId[index]).footprint > 0;
    return isStatic && vision.isExplored(this.localPlayer, tx, ty);
  }

  private selectAt(clientX: number, clientY: number): void {
    const point = this.groundAt(clientX, clientY);
    if (!point) return;

    const e = this.world.entities;
    let best: EntityId | null = null;
    let bestScore = Infinity;

    for (let i = 0; i < e.highWater; i++) {
      if (e.alive[i] !== 1 || e.owner[i] !== this.localPlayer) continue;
      const type = this.world.types.get(e.typeId[i]);
      const reach = type.footprint > 0 ? type.footprint * 0.6 : CLICK_PICK_RADIUS;
      const dx = simToWorld(e.posX[i]) - point.x;
      const dz = simToWorld(e.posY[i]) - point.z;
      const d = Math.hypot(dx, dz);
      if (d > reach) continue;
      // Nearest wins, so overlapping units pick the one actually under the
      // cursor rather than whichever has the lowest slot index.
      const score = d / reach;
      if (score < bestScore) {
        bestScore = score;
        best = e.idAt(i);
      }
    }

    if (best !== null) this.selected.add(best);
  }

  private selectInBox(): void {
    const rect = this.element.getBoundingClientRect();
    const minX = Math.min(this.startX, this.currentX) - rect.left;
    const maxX = Math.max(this.startX, this.currentX) - rect.left;
    const minY = Math.min(this.startY, this.currentY) - rect.top;
    const maxY = Math.max(this.startY, this.currentY) - rect.top;

    const e = this.world.entities;
    const camera = this.rig.camera;

    for (let i = 0; i < e.highWater; i++) {
      if (e.alive[i] !== 1 || e.owner[i] !== this.localPlayer) continue;
      // Dragging a box over your base should give you the army in it, not the
      // buildings under it -- selecting a Nexus by accident and then issuing a
      // move order silently does nothing.
      if (e.moveSpeed[i] === 0) continue;

      // Project to screen space rather than intersecting a frustum: at this
      // unit count it is cheap, and it matches exactly what the player sees.
      this.projected.set(simToWorld(e.posX[i]), 0.3, simToWorld(e.posY[i]));
      this.projected.project(camera);

      const sx = ((this.projected.x + 1) / 2) * rect.width;
      const sy = ((-this.projected.y + 1) / 2) * rect.height;

      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) {
        this.selected.add(e.idAt(i));
      }
    }
  }

  // -- orders ---------------------------------------------------------------

  /** Selected entities that can be given a movement order. */
  private mobile(): EntityId[] {
    const out: EntityId[] = [];
    for (const id of this.selected) {
      const i = this.world.entities.indexOfLive(id);
      if (i >= 0 && this.world.entities.moveSpeed[i] > 0) out.push(id);
    }
    return out;
  }

  /** Selected buildings that produce units, for rally points. */
  private producers(): EntityId[] {
    const out: EntityId[] = [];
    for (const id of this.selected) {
      const i = this.world.entities.indexOfLive(id);
      if (i < 0) continue;
      if (this.world.types.can(this.world.entities.typeId[i], CAN_PRODUCE)) out.push(id);
    }
    return out;
  }

  private issueToSelection(kind: typeof CMD_STOP | typeof CMD_HOLD): void {
    const entities = this.mobile();
    if (entities.length === 0) return;
    this.emit({ kind, playerId: this.localPlayer, entities });
  }

  /**
   * Right-click: work out what the player meant from what is under the cursor.
   *
   * Order of preference is deliberate. Attacking an enemy beats everything;
   * harvesting a patch beats walking onto it; and a rally point is only ever
   * inferred for buildings, which cannot move anyway.
   */
  private issueContextOrder(clientX: number, clientY: number): void {
    if (this.selected.size === 0) return;
    const point = this.groundAt(clientX, clientY);
    if (!point) return;

    const targetX = worldToSim(point.x);
    const targetY = worldToSim(point.z);
    const movers = this.mobile();
    const producers = this.producers();

    if (producers.length > 0) {
      this.emit({ kind: CMD_RALLY, playerId: this.localPlayer, entities: producers, targetX, targetY });
    }
    if (movers.length === 0) return;

    const target = this.pickAny(clientX, clientY);
    const ti = this.world.entities.indexOfLive(target);

    if (ti >= 0) {
      const owner = this.world.entities.owner[ti];
      const type = this.world.types.get(this.world.entities.typeId[ti]);

      if (owner >= 0 && owner !== this.localPlayer) {
        this.emit({ kind: CMD_ATTACK, playerId: this.localPlayer, entities: movers, target });
        return;
      }

      if (type.kind === KIND_RESOURCE && type.resourceAmount > 0) {
        const gatherers = movers.filter((id) => {
          const i = this.world.entities.indexOfLive(id);
          return i >= 0 && this.world.types.can(this.world.entities.typeId[i], CAN_GATHER);
        });
        if (gatherers.length > 0) {
          this.emit({ kind: CMD_GATHER, playerId: this.localPlayer, entities: gatherers, target });
          // Anything in the selection that cannot mine still walks over, so a
          // mixed selection does not half-ignore the order.
          const rest = movers.filter((id) => !gatherers.includes(id));
          if (rest.length > 0) {
            this.emit({ kind: CMD_MOVE, playerId: this.localPlayer, entities: rest, targetX, targetY });
          }
          return;
        }
      }
    }

    this.emit({ kind: CMD_MOVE, playerId: this.localPlayer, entities: movers, targetX, targetY });
  }

  private issueAttackMove(clientX: number, clientY: number): void {
    const entities = this.mobile();
    this.attackMovePending = false;
    this.changed();
    if (entities.length === 0) return;
    const point = this.groundAt(clientX, clientY);
    if (!point) return;

    this.emit({
      kind: CMD_ATTACK_MOVE,
      playerId: this.localPlayer,
      entities,
      targetX: worldToSim(point.x),
      targetY: worldToSim(point.z),
    });
  }

  // -- construction ---------------------------------------------------------

  /** Anchor tile for the footprint centred on a screen point. */
  private anchorTileAt(clientX: number, clientY: number): { x: number; y: number } | null {
    const point = this.groundAt(clientX, clientY);
    if (!point || this.buildType === 0) return null;
    const span = this.world.types.get(this.buildType).footprint;
    return {
      x: Math.floor(point.x - span / 2 + 0.5),
      y: Math.floor(point.z - span / 2 + 0.5),
    };
  }

  private updateGhost(clientX: number, clientY: number): void {
    this.ghostTile = this.anchorTileAt(clientX, clientY);
  }

  private placeBuilding(clientX: number, clientY: number, keepPlacing: boolean): void {
    const anchor = this.anchorTileAt(clientX, clientY);
    const buildingType = this.buildType;
    if (!anchor) return;

    const builders: EntityId[] = [];
    for (const id of this.selected) {
      const i = this.world.entities.indexOfLive(id);
      if (i < 0) continue;
      if (!this.world.types.can(this.world.entities.typeId[i], CAN_BUILD)) continue;
      builders.push(id);
    }

    if (builders.length > 0) {
      this.emit({
        kind: CMD_BUILD,
        playerId: this.localPlayer,
        entities: builders,
        buildingType,
        tileX: anchor.x,
        tileY: anchor.y,
      });
    }

    // Shift keeps the ghost up for a row of pylons; otherwise one click, one
    // building, which is what a player expects by default.
    if (!keepPlacing) this.cancelPending();
  }

  private listen(target: EventTarget, type: string, handler: (e: Event) => void): void {
    target.addEventListener(type, handler);
    this.disposers.push(() => target.removeEventListener(type, handler));
  }
}
