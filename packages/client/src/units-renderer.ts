import { MAX_ENTITIES, entityIndex, type EntityId, type World } from "@rts/sim";
import * as THREE from "three";
import { bamToThreeY, simToWorld } from "./coords.js";

/**
 * Instanced rendering of simulation entities, with tick interpolation.
 *
 * The simulation runs at 20 Hz; displays run at 60 to 240. Drawing units at
 * their raw simulation positions would look like a 20 fps game. So the previous
 * tick's transform is retained and blended toward the current one by the tick
 * alpha, which is what makes a coarse simulation rate invisible to the player.
 *
 * Interpolation is strictly a rendering concern. The simulation is never
 * stepped a fractional amount and never reads these buffers -- doing so would
 * make rendering affect gameplay and desync peers running at different frame
 * rates.
 */

/** Team colours, indexed by owner id. */
const TEAM_COLOURS = [0x63d0ff, 0xff7a59, 0x9d7aff, 0x6ee7a8];

export class UnitRenderer {
  readonly mesh: THREE.InstancedMesh;
  readonly selectionMesh: THREE.InstancedMesh;

  /** Previous-tick transforms, for interpolation. */
  private readonly prevX = new Int32Array(MAX_ENTITIES);
  private readonly prevY = new Int32Array(MAX_ENTITIES);
  private readonly prevFacing = new Int32Array(MAX_ENTITIES);
  /**
   * Whether a slot was live at the previous capture. A unit that just spawned
   * has no meaningful previous transform, and interpolating from a zeroed slot
   * would streak it in from the map origin on its first frame.
   */
  private readonly wasLive = new Uint8Array(MAX_ENTITIES);

  private readonly scratch = new THREE.Object3D();
  private readonly colour = new THREE.Color();

  constructor(scene: THREE.Scene, capacity = 1024) {
    // Tip along +X, matching the asset convention documented in coords.ts.
    const geometry = new THREE.ConeGeometry(0.34, 0.95, 4);
    geometry.rotateZ(-Math.PI / 2);

    this.mesh = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.25 }),
      capacity,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    // Flat ring drawn just above the ground under selected units.
    const ring = new THREE.RingGeometry(0.44, 0.56, 20);
    ring.rotateX(-Math.PI / 2);
    this.selectionMesh = new THREE.InstancedMesh(
      ring,
      new THREE.MeshBasicMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.85 }),
      capacity,
    );
    this.selectionMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.selectionMesh.count = 0;
    this.selectionMesh.frustumCulled = false;
    scene.add(this.selectionMesh);
  }

  /**
   * Snapshot current transforms as the interpolation source.
   * Must be called immediately BEFORE `world.step()`.
   */
  capturePrevious(world: World): void {
    const e = world.entities;
    for (let i = 0; i < e.highWater; i++) {
      this.prevX[i] = e.posX[i];
      this.prevY[i] = e.posY[i];
      this.prevFacing[i] = e.facing[i];
      this.wasLive[i] = e.alive[i];
    }
  }

  /** Push interpolated transforms into the instance buffers. */
  update(world: World, alpha: number, selected: ReadonlySet<EntityId>): void {
    const e = world.entities;
    const capacity = this.mesh.instanceMatrix.count;

    let n = 0;
    let rings = 0;

    for (let i = 0; i < e.highWater && n < capacity; i++) {
      if (e.alive[i] !== 1) continue;

      // A freshly spawned unit interpolates from where it is, not from zero.
      const fresh = this.wasLive[i] !== 1;
      const px = fresh ? e.posX[i] : this.prevX[i];
      const py = fresh ? e.posY[i] : this.prevY[i];
      const pf = fresh ? e.facing[i] : this.prevFacing[i];

      const x = simToWorld(px + (e.posX[i] - px) * alpha);
      const z = simToWorld(py + (e.posY[i] - py) * alpha);

      this.scratch.position.set(x, 0.3, z);
      this.scratch.rotation.set(0, bamToThreeY(lerpAngle(pf, e.facing[i], alpha)), 0);
      this.scratch.updateMatrix();
      this.mesh.setMatrixAt(n, this.scratch.matrix);

      this.colour.setHex(TEAM_COLOURS[e.owner[i] % TEAM_COLOURS.length]);
      this.mesh.setColorAt(n, this.colour);
      n++;

      if (selected.size > 0 && selected.has(e.idAt(i)) && rings < capacity) {
        this.scratch.position.set(x, 0.06, z);
        this.scratch.rotation.set(0, 0, 0);
        this.scratch.updateMatrix();
        this.selectionMesh.setMatrixAt(rings, this.scratch.matrix);
        rings++;
      }
    }

    this.mesh.count = n;
    this.selectionMesh.count = rings;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.selectionMesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** World-space position of an entity right now, for picking and UI. */
  static worldPosition(world: World, id: EntityId, out: THREE.Vector3): THREE.Vector3 {
    const i = entityIndex(id);
    return out.set(simToWorld(world.entities.posX[i]), 0.3, simToWorld(world.entities.posY[i]));
  }
}

/**
 * Shortest-path angle interpolation.
 *
 * Interpolating BAM angles directly makes a unit crossing the 65535 -> 0 wrap
 * spin nearly all the way around in one frame. Going via the signed delta keeps
 * the turn short.
 */
function lerpAngle(a: number, b: number, t: number): number {
  const delta = (((b - a) & 0xffff) ^ 0x8000) - 0x8000;
  return a + delta * t;
}
