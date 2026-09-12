import {
  KIND_BUILDING,
  KIND_RESOURCE,
  TILE_BLOCKED,
  VIS_HIDDEN,
  VIS_VISIBLE,
  type World,
} from "@rts/sim";
import type { IsoCamera } from "./iso-camera.js";
import {
  NEUTRAL_COLOUR as PALETTE_NEUTRAL,
  TEAM_COLOURS as PALETTE_TEAMS,
  css,
} from "./palette.js";

/**
 * Minimap: terrain, fog, units, and where the camera is pointing.
 *
 * A 2D canvas rather than a second WebGL view. A render-to-texture minimap
 * means maintaining a second camera, a second render pass and a second set of
 * culling rules for something that is a few hundred coloured squares; drawing
 * it directly costs about a millisecond and has no interaction with the main
 * scene at all.
 *
 * Redrawn on a timer rather than every frame. Nothing on it moves fast enough
 * at this scale for 60 Hz to be distinguishable from 15 Hz, and the terrain
 * layer is cached to an offscreen canvas so only the moving parts are redrawn.
 */

/** Pixels on a side. */
const SIZE = 190;
/** How often the unit and fog layers are redrawn, in milliseconds. */
const REDRAW_MS = 66;

const TEAM_COLOURS = PALETTE_TEAMS.map(css);
const NEUTRAL_COLOUR = css(PALETTE_NEUTRAL);
/** Open ashfield, and the spoil heaps standing on it. See UNIVERSE.md. */
const GROUND_COLOUR = "#241a12";
const SPOIL_COLOUR = "#0f0c09";

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** Terrain only. Rebuilt when the cost grid changes, not per frame. */
  private readonly terrain: HTMLCanvasElement;
  private readonly terrainCtx: CanvasRenderingContext2D;

  private readonly world: World;
  private readonly rig: IsoCamera;
  private readonly localPlayer: number;
  private readonly scale: number;
  /**
   * Tiles per fog sample.
   *
   * The canvas is `SIZE` pixels across, so on a 1024-tile map one pixel already
   * covers five tiles and sampling every tile is nearly thirty times more work
   * than the display can show. Redrawn at 15 Hz, that is the difference between
   * a minimap and a stutter.
   */
  private readonly fogStep: number;

  private terrainVersion = -1;
  private lastDraw = 0;
  private dragging = false;
  private readonly disposers: Array<() => void> = [];

  constructor(world: World, rig: IsoCamera, localPlayer: number, parent: HTMLElement) {
    this.world = world;
    this.rig = rig;
    this.localPlayer = localPlayer;
    this.scale = SIZE / world.mapTiles;
    this.fogStep = Math.max(1, Math.floor(world.mapTiles / SIZE));

    this.canvas = document.createElement("canvas");
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    // Mounted into the console's left bay rather than positioned itself. The
    // console owns the layout; a minimap that placed itself would have to know
    // how wide the command card happened to be.
    this.canvas.style.cssText =
      `display:block;width:${SIZE}px;height:${SIZE}px;` +
      "border:1px solid var(--line-2);border-radius:3px;background:#0d0a07;cursor:crosshair;" +
      "image-rendering:pixelated";
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    this.terrain = document.createElement("canvas");
    this.terrain.width = SIZE;
    this.terrain.height = SIZE;
    this.terrainCtx = this.terrain.getContext("2d")!;

    // Click or drag to move the camera. Dragging is captured on the window so
    // the camera keeps following once the pointer leaves the little canvas,
    // which is what happens on any fast flick to the far side of the map.
    const jump = (event: PointerEvent): void => {
      const rect = this.canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * this.world.mapTiles;
      const y = ((event.clientY - rect.top) / rect.height) * this.world.mapTiles;
      this.rig.lookAtGround(x, y);
    };

    this.listen(this.canvas, "pointerdown", (e) => {
      const event = e as PointerEvent;
      event.preventDefault();
      this.dragging = true;
      jump(event);
    });
    this.listen(window, "pointermove", (e) => {
      if (this.dragging) jump(e as PointerEvent);
    });
    this.listen(window, "pointerup", () => {
      this.dragging = false;
    });
    // Right-clicking the minimap would otherwise fall through to the canvas
    // behind it and issue an order at whatever the cursor happens to be over.
    this.listen(this.canvas, "contextmenu", (e) => e.preventDefault());
  }

  dispose(): void {
    for (const off of this.disposers) off();
    this.canvas.remove();
  }

  draw(nowMs: number): void {
    if (nowMs - this.lastDraw < REDRAW_MS) return;
    this.lastDraw = nowMs;

    this.syncTerrain();
    const ctx = this.ctx;
    const s = this.scale;

    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(this.terrain, 0, 0);

    // Fog, drawn as a coarse overlay. One rect per tile is far too many at 128
    // tiles, so runs of equal darkness on a row are merged into one fill --
    // which on a normal map is a handful of rects rather than sixteen thousand.
    const vision = this.world.vision;
    if (vision.enabled) {
      ctx.fillStyle = "#060504";
      const n = this.world.mapTiles;
      const step = this.fogStep;
      for (let ty = 0; ty < n; ty += step) {
        let runStart = -1;
        let runAlpha = -1;
        for (let tx = 0; tx <= n; tx += step) {
          const level = tx < n ? vision.levelAt(this.localPlayer, tx, ty) : -1;
          const alpha = level === VIS_VISIBLE ? 0 : level === VIS_HIDDEN ? 1 : 0.5;
          if (alpha !== runAlpha) {
            if (runAlpha > 0 && runStart >= 0) {
              ctx.globalAlpha = runAlpha;
              ctx.fillRect(runStart * s, ty * s, (tx - runStart) * s, step * s + 1);
            }
            runStart = tx;
            runAlpha = alpha;
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    // Entities. Enemies only where they are actually visible, which is the
    // whole reason the minimap is worth having.
    const e = this.world.entities;
    for (let i = 0; i < e.highWater; i++) {
      if (e.alive[i] !== 1) continue;
      const owner = e.owner[i];
      const mine = owner === this.localPlayer;
      if (!mine && !vision.canSee(this.localPlayer, e, i)) continue;

      const type = this.world.types.get(e.typeId[i]);
      if (type.kind === KIND_RESOURCE) {
        // Ore is only worth marking once you know it is there.
        if (!vision.isExplored(this.localPlayer, e.posX[i] >> 16, e.posY[i] >> 16)) continue;
        ctx.fillStyle = NEUTRAL_COLOUR;
      } else {
        ctx.fillStyle = owner < 0 ? NEUTRAL_COLOUR : TEAM_COLOURS[owner % TEAM_COLOURS.length];
      }

      const size = type.kind === KIND_BUILDING ? Math.max(3, type.footprint * s) : 2.5;
      ctx.fillRect((e.posX[i] / 65536) * s - size / 2, (e.posY[i] / 65536) * s - size / 2, size, size);
    }

    this.drawViewport();
  }

  /** Outline of what the camera can currently see. */
  private drawViewport(): void {
    const ctx = this.ctx;
    const s = this.scale;
    // The isometric view is a diamond on the ground plane, not a rectangle, so
    // an axis-aligned box would be a lie about what is on screen. Half-extents
    // come from the frustum: height is `viewHeight`, width follows the aspect.
    const halfH = this.rig.viewHeight / 2;
    const halfW = (this.rig.camera.right - this.rig.camera.left) / 2;
    const t = this.rig.target;

    // Screen-right and screen-up in ground coordinates, for this fixed camera.
    const rx = Math.SQRT1_2;
    const rz = -Math.SQRT1_2;
    const ux = -Math.SQRT1_2;
    const uz = -Math.SQRT1_2;
    // Vertical extent on screen foreshortens by sin(elevation) on the ground.
    const up = halfH / Math.sin(Math.atan(1 / Math.SQRT2));

    ctx.strokeStyle = "rgba(207,228,255,0.75)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let corner = 0; corner < 4; corner++) {
      const sx = corner === 0 || corner === 3 ? -1 : 1;
      const sy = corner < 2 ? -1 : 1;
      const x = t.x + rx * halfW * sx + ux * up * sy;
      const z = t.z + rz * halfW * sx + uz * up * sy;
      if (corner === 0) ctx.moveTo(x * s, z * s);
      else ctx.lineTo(x * s, z * s);
    }
    ctx.closePath();
    ctx.stroke();
  }

  /** Redraw the cached terrain layer if the cost grid has changed. */
  private syncTerrain(): void {
    if (this.world.grid.version === this.terrainVersion) return;
    this.terrainVersion = this.world.grid.version;

    const ctx = this.terrainCtx;
    const s = this.scale;
    ctx.fillStyle = GROUND_COLOUR;
    ctx.fillRect(0, 0, SIZE, SIZE);

    ctx.fillStyle = SPOIL_COLOUR;
    const grid = this.world.grid;
    for (let ty = 0; ty < grid.height; ty++) {
      for (let tx = 0; tx < grid.width; tx++) {
        // Only real terrain. Building footprints are drawn as entities, so
        // painting them here too would leave a rock behind when one is
        // destroyed until the next grid change happened to repaint it.
        if (grid.tiles[ty * grid.width + tx] !== TILE_BLOCKED) continue;
        ctx.fillRect(tx * s, ty * s, s + 1, s + 1);
      }
    }
  }

  private listen(target: EventTarget, type: string, handler: (e: Event) => void): void {
    target.addEventListener(type, handler);
    this.disposers.push(() => target.removeEventListener(type, handler));
  }
}
