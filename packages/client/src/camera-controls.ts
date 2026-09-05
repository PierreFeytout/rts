import type { IsoCamera } from "./iso-camera.js";

/**
 * Keyboard, mouse and edge-scroll panning for the isometric camera.
 *
 * Kept separate from `IsoCamera` so the rig stays a pure transform that a
 * replay viewer or a headless screenshot tool can drive without dragging in DOM
 * event listeners.
 */

/** Keyboard pan speed, in screen-heights per second. Scales with zoom. */
const KEY_PAN_SCREENS_PER_SEC = 0.9;
/** Distance from the window edge that triggers edge scrolling, in pixels. */
const EDGE_MARGIN_PX = 12;
/** Edge scroll speed, in screen-heights per second. */
const EDGE_PAN_SCREENS_PER_SEC = 0.8;
/** Multiplier per wheel notch. */
const ZOOM_STEP = 1.12;

export class CameraControls {
  private readonly keys = new Set<string>();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private pointerX = -1;
  private pointerY = -1;
  private pointerInside = false;
  private readonly disposers: Array<() => void> = [];

  /** Set false while a modal or text field has focus. */
  enabled = true;
  /** Edge scrolling is off by default: it fights with UI along the screen edges. */
  edgeScroll = false;

  private readonly rig: IsoCamera;
  private readonly element: HTMLElement;

  constructor(rig: IsoCamera, element: HTMLElement) {
    this.rig = rig;
    this.element = element;

    this.listen(window, "keydown", (e) => {
      const ev = e as KeyboardEvent;
      // Never swallow keys aimed at a text field -- chat and the lobby need them.
      if (isTextTarget(ev.target)) return;
      this.keys.add(ev.code);
    });
    this.listen(window, "keyup", (e) => this.keys.delete((e as KeyboardEvent).code));
    // A lost focus leaves keys stuck down forever, so the camera slides away
    // on its own after alt-tab. Clearing on blur avoids that.
    this.listen(window, "blur", () => this.keys.clear());

    this.listen(element, "pointerdown", (e) => {
      const ev = e as PointerEvent;
      // Middle button only. Left selects and right issues orders -- the RTS
      // convention players already have in their fingers -- so neither is
      // available for panning.
      if (ev.button !== 1) return;
      ev.preventDefault();
      this.dragging = true;
      this.lastX = ev.clientX;
      this.lastY = ev.clientY;
      element.setPointerCapture(ev.pointerId);
    });

    this.listen(element, "pointermove", (e) => {
      const ev = e as PointerEvent;
      this.pointerX = ev.clientX;
      this.pointerY = ev.clientY;
      this.pointerInside = true;
      if (!this.dragging || !this.enabled) return;
      const scale = this.rig.worldUnitsPerPixel(element.clientHeight);
      // Drag moves the world with the cursor, so pan the camera the other way.
      this.rig.pan(-(ev.clientX - this.lastX) * scale, (ev.clientY - this.lastY) * scale);
      this.lastX = ev.clientX;
      this.lastY = ev.clientY;
    });

    const endDrag = (e: Event): void => {
      const ev = e as PointerEvent;
      if (!this.dragging) return;
      this.dragging = false;
      if (element.hasPointerCapture(ev.pointerId)) element.releasePointerCapture(ev.pointerId);
    };
    this.listen(element, "pointerup", endDrag);
    this.listen(element, "pointercancel", endDrag);
    this.listen(element, "pointerleave", () => {
      this.pointerInside = false;
    });

    this.listen(
      element,
      "wheel",
      (e) => {
        const ev = e as WheelEvent;
        if (!this.enabled) return;
        ev.preventDefault();
        this.rig.zoomBy(ev.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
      },
      { passive: false },
    );

    // Right-click issues move orders, so the browser menu must never appear.
    this.listen(element, "contextmenu", (e) => e.preventDefault());
  }

  /** Advance continuous (held-key and edge) panning. `dtSec` is real seconds. */
  update(dtSec: number): void {
    if (!this.enabled) return;

    let dx = 0;
    let dy = 0;

    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) dx -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) dx += 1;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) dy += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) dy -= 1;

    if (dx !== 0 || dy !== 0) {
      // Normalise so diagonal panning is not ~1.41x faster than straight.
      const len = Math.hypot(dx, dy);
      const speed = this.rig.viewHeight * KEY_PAN_SCREENS_PER_SEC * dtSec;
      this.rig.pan((dx / len) * speed, (dy / len) * speed);
    }

    if (this.edgeScroll && this.pointerInside && !this.dragging) {
      const w = this.element.clientWidth;
      const h = this.element.clientHeight;
      let ex = 0;
      let ey = 0;
      if (this.pointerX < EDGE_MARGIN_PX) ex -= 1;
      else if (this.pointerX > w - EDGE_MARGIN_PX) ex += 1;
      if (this.pointerY < EDGE_MARGIN_PX) ey += 1;
      else if (this.pointerY > h - EDGE_MARGIN_PX) ey -= 1;

      if (ex !== 0 || ey !== 0) {
        const speed = this.rig.viewHeight * EDGE_PAN_SCREENS_PER_SEC * dtSec;
        const len = Math.hypot(ex, ey);
        this.rig.pan((ex / len) * speed, (ey / len) * speed);
      }
    }
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }

  private listen(
    target: EventTarget,
    type: string,
    handler: (e: Event) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler, options);
    this.disposers.push(() => target.removeEventListener(type, handler, options));
  }
}

function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}
