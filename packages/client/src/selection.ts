import { CMD_MOVE, type Command, type EntityId, type World } from "@rts/sim";
import * as THREE from "three";
import { simToWorld, worldToSim } from "./coords.js";
import type { IsoCamera } from "./iso-camera.js";

/**
 * Unit selection and order issuing.
 *
 * Emits commands rather than mutating the world directly. That separation is
 * deliberate and load-bearing for M2: once netcode lands, the same commands go
 * through the arbiter to be scheduled at a future tick instead of being applied
 * locally. Keeping input on the command path from the start means the netcode
 * has nothing to untangle.
 */

/** Pointer travel under this many pixels counts as a click, not a drag. */
const DRAG_THRESHOLD_PX = 5;
/** Radius in world units for a single-click pick. */
const CLICK_PICK_RADIUS = 0.65;

export class Selection {
  readonly selected = new Set<EntityId>();

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
        this.dragging = true;
        this.startX = this.currentX = ev.clientX;
        this.startY = this.currentY = ev.clientY;
        element.setPointerCapture(ev.pointerId);
      } else if (ev.button === 2) {
        ev.preventDefault();
        this.issueMoveOrder(ev.clientX, ev.clientY);
      }
    });

    this.listen(element, "pointermove", (e) => {
      const ev = e as PointerEvent;
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
    });

    this.listen(element, "pointercancel", () => {
      this.dragging = false;
      this.boxElement.style.display = "none";
    });
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.boxElement.remove();
  }

  /** Drop handles whose entities have died, so rings do not linger. */
  pruneDead(): void {
    for (const id of this.selected) {
      if (!this.world.entities.isAlive(id)) this.selected.delete(id);
    }
  }

  // -------------------------------------------------------------------------

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

  private selectAt(clientX: number, clientY: number): void {
    const point = this.groundAt(clientX, clientY);
    if (!point) return;

    const e = this.world.entities;
    let best: EntityId | null = null;
    let bestDistSq = CLICK_PICK_RADIUS * CLICK_PICK_RADIUS;

    for (let i = 0; i < e.highWater; i++) {
      if (e.alive[i] !== 1 || e.owner[i] !== this.localPlayer) continue;
      const dx = simToWorld(e.posX[i]) - point.x;
      const dz = simToWorld(e.posY[i]) - point.z;
      const d = dx * dx + dz * dz;
      // Nearest wins, so overlapping units pick the one actually under the
      // cursor rather than whichever has the lowest slot index.
      if (d < bestDistSq) {
        bestDistSq = d;
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

  private issueMoveOrder(clientX: number, clientY: number): void {
    if (this.selected.size === 0) return;
    const point = this.groundAt(clientX, clientY);
    if (!point) return;

    this.emit({
      kind: CMD_MOVE,
      playerId: this.localPlayer,
      entities: [...this.selected],
      targetX: worldToSim(point.x),
      targetY: worldToSim(point.z),
    });
  }

  private listen(target: EventTarget, type: string, handler: (e: Event) => void): void {
    target.addEventListener(type, handler);
    this.disposers.push(() => target.removeEventListener(type, handler));
  }
}
