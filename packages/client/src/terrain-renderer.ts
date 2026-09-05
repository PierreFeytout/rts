import { TILE_BLOCKED, type CostGrid } from "@rts/sim";
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
 */
export class TerrainRenderer {
  private readonly scene: THREE.Scene;
  private mesh: THREE.InstancedMesh | null = null;
  private builtVersion = -1;

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
      new THREE.MeshStandardMaterial({ color: 0x2c3a4f, roughness: 0.85 }),
      blocked.length,
    );

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
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;

    this.mesh = mesh;
    this.scene.add(mesh);
  }

  dispose(): void {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh = null;
  }
}
