import { TILE_BLOCKED, VIS_HIDDEN, VIS_VISIBLE, type CostGrid, type World } from "@rts/sim";
import * as THREE from "three";

/**
 * Draws blocked tiles as raised blocks.
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
 * One instance per blocked tile. At a few hundred tiles that is a single draw
 * call and not worth the complexity of merging runs into larger boxes.
 *
 * Fog is applied as a per-instance colour rather than by the fog overlay quad,
 * because these blocks stand well above it -- an overlay lying on the ground
 * would leave every cliff brightly lit inside an unexplored region.
 */
export class TerrainRenderer {
  private readonly scene: THREE.Scene;
  private mesh: THREE.InstancedMesh | null = null;
  private builtVersion = -1;
  /** Tile coordinate of each instance, so fog can be looked up per frame. */
  private tiles = new Int32Array(0);
  private fogTick = -1;
  private readonly colour = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
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

    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      // White, because the real colour arrives per instance -- a tinted base
      // would multiply with the fog shade and wash out.
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, fog: false }),
      blocked.length,
    );

    this.tiles = new Int32Array(blocked.length * 2);
    this.fogTick = -1;
    const scratch = new THREE.Object3D();
    for (let n = 0; n < blocked.length; n++) {
      const cell = blocked[n];
      const tx = cell % grid.width;
      const ty = (cell / grid.width) | 0;
      // Deterministic per-tile height from the coordinates, so the silhouette
      // has some variety without needing randomness that peers would have to
      // agree on.
      const height = 1.1 + ((tx * 7 + ty * 13) % 7) / 8;
      scratch.position.set(tx + 0.5, height / 2, ty + 0.5);
      scratch.scale.set(1, height, 1);
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
   * Shade each block by what the local player can see of its tile.
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
      const shade = level === VIS_VISIBLE ? 1 : level === VIS_HIDDEN ? 0.06 : 0.42;
      this.colour.setHex(0x2c3a4f).multiplyScalar(shade);
      mesh.setColorAt(n, this.colour);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh = null;
  }
}
