import { TILE_BLOCKED, VIS_HIDDEN, VIS_VISIBLE, type CostGrid, type World } from "@rts/sim";
import * as THREE from "three";
import type { TerrainBiome } from "./materials.js";

/**
 * Draws blocked tiles as spoil heaps.
 *
 * Derived from the cost grid itself rather than from whatever list of
 * rectangles happened to create it. Two reasons, and the second is the reason
 * it had to change:
 *
 *   1. Single source of truth. What the player sees and what pathfinding
 *      believes cannot drift apart, because they are the same data.
 *   2. A guest never receives the rectangles. It receives a world snapshot
 *      containing the grid, so anything reconstructed from generation inputs
 *      would simply be missing on every peer but the host.
 *
 * One instance per blocked tile, which is a single draw call at any map size.
 *
 * Fog is applied as a per-instance colour rather than by the fog overlay quad,
 * because these stand well above it -- an overlay lying on the ground would
 * leave every heap brightly lit inside an unexplored region.
 */

/**
 * The shape of one chunk of slag.
 *
 * A six-sided tapered prism rather than a box. Three reasons, in order of how
 * much they matter:
 *
 *   1. A cylinder's UVs run **vertically** on the side faces, so the rust bleed
 *      baked into the slag texture runs downward like a stain rather than
 *      sideways like a stripe. A box's UVs do not, and there is no per-face
 *      rotation to fix it with.
 *   2. Tapered and rotated per instance, adjacent heaps stop reading as a wall
 *      of identical cubes.
 *   3. The radius is deliberately over half a tile, so neighbouring heaps
 *      overlap into one mass instead of leaving daylight between them.
 *
 * These are spoil, not geology -- see UNIVERSE.md. They should look poured.
 */
function slagChunk(): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(0.4, 0.82, 1, 6, 1);
}

/**
 * How buried a blocked tile is, 0 at the edge of a heap and 2 deep inside it.
 *
 * This is what turns a rectangle of blocked tiles from a flat-topped mass into
 * a mound. Spoil is dumped, and dumped material domes: tall in the middle and
 * tapering to nothing at the rim. Without it every obstacle reads as a stack of
 * identical bricks, which is the one thing poured waste must not look like.
 *
 * Reads `tiles` directly rather than going through `isBlocked`, which also
 * reports building footprints and out-of-bounds as blocked -- a heap must not
 * grow a shoulder because somebody built a wall against it.
 */
function burial(tiles: Uint8Array, width: number, height: number, tx: number, ty: number): number {
  for (let radius = 1; radius <= 2; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const x = tx + dx;
        const y = ty + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) return radius - 1;
        if (tiles[y * width + x] !== TILE_BLOCKED) return radius - 1;
      }
    }
  }
  return 2;
}

export class TerrainRenderer {
  private readonly scene: THREE.Scene;
  private readonly materials: TerrainBiome;
  private mesh: THREE.InstancedMesh | null = null;
  private builtVersion = -1;
  /** Tile coordinate of each instance, so fog can be looked up per frame. */
  private tiles = new Int32Array(0);
  private fogTick = -1;
  private readonly colour = new THREE.Color();

  constructor(scene: THREE.Scene, materials: TerrainBiome) {
    this.scene = scene;
    this.materials = materials;
  }

  /** Rebuild if the grid changed since the last call. Cheap to call per frame. */
  sync(grid: CostGrid): void {
    if (grid.version === this.builtVersion) return;
    this.builtVersion = grid.version;

    const blocked: number[] = [];
    for (let i = 0; i < grid.tiles.length; i++) {
      if (grid.tiles[i] === TILE_BLOCKED) blocked.push(i);
    }

    this.dispose();
    if (blocked.length === 0) return;

    const mesh = new THREE.InstancedMesh(slagChunk(), this.materials.slag, blocked.length);

    this.tiles = new Int32Array(blocked.length * 2);
    this.fogTick = -1;
    const scratch = new THREE.Object3D();

    for (let n = 0; n < blocked.length; n++) {
      const cell = blocked[n];
      const tx = cell % grid.width;
      const ty = (cell / grid.width) | 0;

      // Everything below is a pure function of the tile's coordinates, so the
      // silhouette has variety without any randomness two peers would have to
      // agree about -- and a heap stays the same shape across a reconnect.
      const a = (tx * 7 + ty * 13) % 7;
      const b = (tx * 17 + ty * 11) % 5;
      const c = (tx * 5 + ty * 23) % 6;

      // Tall enough to be cover you can see. At barely one tile they read as
      // rubble strewn on the floor rather than as something to fight around.
      // Domed: the rim of a heap is barely a step up, the middle of one is
      // something you have to walk around.
      const depth = burial(grid.tiles, grid.width, grid.height, tx, ty);
      const height = (0.95 + a / 5) * (0.9 + depth * 0.72);
      // Nudged off the tile centre. Spoil is dumped in rectangles, so without
      // this the heaps line up into courses and read as brickwork -- which is
      // the one thing poured waste must not look like.
      const jitterX = ((b / 5) - 0.5) * 0.5;
      const jitterY = ((c / 6) - 0.5) * 0.5;
      scratch.position.set(tx + 0.5 + jitterX, height / 2, ty + 0.5 + jitterY);
      // Six-sided, so a sixth of a turn is the full range of distinct yaws.
      scratch.rotation.set(0, (c / 6) * Math.PI * 2, 0);
      scratch.scale.set(1 + b * 0.05, height, 1 + c * 0.04);
      scratch.updateMatrix();
      mesh.setMatrixAt(n, scratch.matrix);

      this.tiles[n * 2] = tx;
      this.tiles[n * 2 + 1] = ty;
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;

    this.mesh = mesh;
    this.scene.add(mesh);
  }

  /**
   * Shade each heap by what the local player can see of its tile.
   *
   * Only when the simulation has advanced: fog changes on tick boundaries, and
   * rewriting a few hundred instance colours at display rate would be work
   * nobody could perceive.
   */
  applyFog(world: World, localPlayer: number): void {
    const mesh = this.mesh;
    if (!mesh) return;
    if (world.tick === this.fogTick) return;
    this.fogTick = world.tick;

    for (let n = 0; n < mesh.count; n++) {
      const level = world.vision.enabled
        ? world.vision.levelAt(localPlayer, this.tiles[n * 2], this.tiles[n * 2 + 1])
        : VIS_VISIBLE;
      const shade = level === VIS_VISIBLE ? 1 : level === VIS_HIDDEN ? 0.05 : 0.38;
      // White, because the slag texture carries the colour now. A tinted base
      // would multiply with the fog shade and flatten the surface out.
      this.colour.setRGB(shade, shade * 0.97, shade * 0.93);
      mesh.setColorAt(n, this.colour);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    // The geometry is this mesh's own; the material is shared and outlives it.
    this.mesh.geometry.dispose();
    this.mesh = null;
  }
}
