import {
  KIND_BUILDING,
  KIND_RESOURCE,
  MAX_ENTITIES,
  entityIndex,
  type EntityId,
  type World,
} from "@rts/sim";
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
 *
 * Everything is drawn from a handful of `InstancedMesh` pools, one per visual
 * category rather than one per unit type. At 400 units the entire world is a
 * few draw calls, which is the whole reason the renderer can afford to be this
 * naive about culling.
 */

/** Team colours, indexed by owner id. */
const TEAM_COLOURS = [0x63d0ff, 0xff7a59, 0x9d7aff, 0x6ee7a8];
/** Unowned scenery: ore patches and geothermal vents. */
const NEUTRAL_COLOUR = 0xd8c37a;
const VENT_COLOUR = 0x7fd8b0;

/** Health bar geometry, in world units. */
const BAR_WIDTH = 1.1;
const BAR_HEIGHT = 0.13;

export class WorldRenderer {
  private readonly units: THREE.InstancedMesh;
  private readonly buildings: THREE.InstancedMesh;
  private readonly resources: THREE.InstancedMesh;
  private readonly rings: THREE.InstancedMesh;
  private readonly barBack: THREE.InstancedMesh;
  private readonly barFill: THREE.InstancedMesh;

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
  /**
   * Camera orientation, baked into every health bar instance.
   *
   * The isometric rig never rotates, so this is captured once rather than
   * recomputed per frame -- billboarding a few hundred bars against a camera
   * that cannot turn would be pure waste.
   */
  private readonly billboard = new THREE.Quaternion();
  private readonly barRight = new THREE.Vector3();

  constructor(scene: THREE.Scene, camera: THREE.Camera, capacity = 2048) {
    camera.updateMatrixWorld();
    this.billboard.copy(camera.quaternion);
    this.barRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();

    // Tip along +X, matching the asset convention documented in coords.ts.
    const cone = new THREE.ConeGeometry(0.34, 0.95, 4);
    cone.rotateZ(-Math.PI / 2);
    this.units = makeInstanced(
      scene,
      cone,
      new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.25 }),
      capacity,
    );

    // A unit cube anchored on the ground, so per-instance scale maps directly
    // to a building's footprint without any offset maths at the call site.
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    this.buildings = makeInstanced(
      scene,
      box,
      new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.35 }),
      256,
    );

    const crystal = new THREE.OctahedronGeometry(0.75, 0);
    crystal.translate(0, 0.55, 0);
    this.resources = makeInstanced(
      scene,
      crystal,
      new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.1, flatShading: true }),
      256,
    );

    // Flat ring drawn just above the ground under selected units.
    const ring = new THREE.RingGeometry(0.44, 0.56, 20);
    ring.rotateX(-Math.PI / 2);
    this.rings = makeInstanced(
      scene,
      ring,
      new THREE.MeshBasicMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.85 }),
      capacity,
    );

    const bar = new THREE.PlaneGeometry(BAR_WIDTH, BAR_HEIGHT);
    this.barBack = makeInstanced(
      scene,
      bar,
      new THREE.MeshBasicMaterial({ color: 0x0b0f16, transparent: true, opacity: 0.75 }),
      512,
    );
    this.barFill = makeInstanced(scene, bar.clone(), new THREE.MeshBasicMaterial(), 512);
    // Bars must not be hidden by the unit they belong to.
    this.barBack.renderOrder = 10;
    this.barFill.renderOrder = 11;
    (this.barBack.material as THREE.Material).depthTest = false;
    (this.barFill.material as THREE.Material).depthTest = false;
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
    const types = world.types;

    let nUnits = 0;
    let nBuildings = 0;
    let nResources = 0;
    let nRings = 0;
    let nBars = 0;

    for (let i = 0; i < e.highWater; i++) {
      if (e.alive[i] !== 1) continue;

      // A freshly spawned unit interpolates from where it is, not from zero.
      const fresh = this.wasLive[i] !== 1;
      const px = fresh ? e.posX[i] : this.prevX[i];
      const py = fresh ? e.posY[i] : this.prevY[i];
      const pf = fresh ? e.facing[i] : this.prevFacing[i];

      const x = simToWorld(px + (e.posX[i] - px) * alpha);
      const z = simToWorld(py + (e.posY[i] - py) * alpha);

      const type = types.get(e.typeId[i]);
      const owner = e.owner[i];
      const isMine = selected.has(e.idAt(i));

      if (type.kind === KIND_RESOURCE) {
        if (nResources < this.resources.instanceMatrix.count) {
          const scale = type.footprint * 0.82;
          this.scratch.position.set(x, 0, z);
          this.scratch.rotation.set(0, 0, 0);
          this.scratch.scale.set(scale, scale, scale);
          this.scratch.updateMatrix();
          this.resources.setMatrixAt(nResources, this.scratch.matrix);
          this.colour.setHex(type.resourceAmount > 0 ? NEUTRAL_COLOUR : VENT_COLOUR);
          this.resources.setColorAt(nResources, this.colour);
          nResources++;
        }
      } else if (type.kind === KIND_BUILDING) {
        if (nBuildings < this.buildings.instanceMatrix.count) {
          const span = type.footprint;
          // A site rises out of the ground as it is built, which reads as
          // progress without needing a separate progress bar.
          const progress =
            e.buildRemaining[i] > 0
              ? 1 - e.buildRemaining[i] / Math.max(1, type.buildTime)
              : 1;
          const height = span * (0.35 + 0.55 * Math.max(0.12, progress));
          this.scratch.position.set(x, 0, z);
          this.scratch.rotation.set(0, 0, 0);
          this.scratch.scale.set(span * 0.92, height, span * 0.92);
          this.scratch.updateMatrix();
          this.buildings.setMatrixAt(nBuildings, this.scratch.matrix);

          this.colour.setHex(teamColour(owner));
          // Unfinished structures are washed out, so a half-built Foundry is
          // never mistaken for a working one at a glance.
          if (e.buildRemaining[i] > 0) this.colour.multiplyScalar(0.45);
          this.buildings.setColorAt(nBuildings, this.colour);
          nBuildings++;
        }
      } else if (nUnits < this.units.instanceMatrix.count) {
        this.scratch.position.set(x, 0.3, z);
        this.scratch.rotation.set(0, bamToThreeY(lerpAngle(pf, e.facing[i], alpha)), 0);
        this.scratch.scale.setScalar(1);
        this.scratch.updateMatrix();
        this.units.setMatrixAt(nUnits, this.scratch.matrix);
        this.colour.setHex(teamColour(owner));
        this.units.setColorAt(nUnits, this.colour);
        nUnits++;
      }

      if (isMine && nRings < this.rings.instanceMatrix.count) {
        const scale = type.footprint > 0 ? type.footprint * 0.9 : 1;
        this.scratch.position.set(x, 0.06, z);
        this.scratch.rotation.set(0, 0, 0);
        this.scratch.scale.set(scale, scale, scale);
        this.scratch.updateMatrix();
        this.rings.setMatrixAt(nRings, this.scratch.matrix);
        nRings++;
      }

      // Health bars only appear once something is actually hurt. A field of
      // full green bars is noise that hides the one unit that needs attention.
      const damaged = e.health[i] < type.maxHealth && type.kind !== KIND_RESOURCE;
      if (damaged && nBars < this.barBack.instanceMatrix.count) {
        const fraction = Math.max(0, Math.min(1, e.health[i] / type.maxHealth));
        const y = type.kind === KIND_BUILDING ? type.footprint * 0.95 + 0.5 : 1.1;

        this.scratch.position.set(x, y, z);
        this.scratch.quaternion.copy(this.billboard);
        this.scratch.scale.setScalar(1);
        this.scratch.updateMatrix();
        this.barBack.setMatrixAt(nBars, this.scratch.matrix);

        // Grow from the left edge rather than the centre, so a bar draining
        // looks like a bar draining.
        this.scratch.position
          .set(x, y, z)
          .addScaledVector(this.barRight, -(BAR_WIDTH * (1 - fraction)) / 2);
        this.scratch.scale.set(fraction, 0.72, 1);
        this.scratch.updateMatrix();
        this.barFill.setMatrixAt(nBars, this.scratch.matrix);
        this.colour.setHex(healthColour(fraction));
        this.barFill.setColorAt(nBars, this.colour);
        nBars++;
      }
    }

    commit(this.units, nUnits);
    commit(this.buildings, nBuildings);
    commit(this.resources, nResources);
    commit(this.rings, nRings);
    commit(this.barBack, nBars);
    commit(this.barFill, nBars);
  }

  /** World-space position of an entity right now, for picking and UI. */
  static worldPosition(world: World, id: EntityId, out: THREE.Vector3): THREE.Vector3 {
    const i = entityIndex(id);
    return out.set(simToWorld(world.entities.posX[i]), 0.3, simToWorld(world.entities.posY[i]));
  }
}

function makeInstanced(
  scene: THREE.Scene,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  capacity: number,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  // The whole world is a handful of instanced meshes whose bounding volumes
  // would cover the entire map anyway, so per-mesh culling can only cost time.
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}

function commit(mesh: THREE.InstancedMesh, count: number): void {
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function teamColour(owner: number): number {
  return owner < 0 ? NEUTRAL_COLOUR : TEAM_COLOURS[owner % TEAM_COLOURS.length];
}

/** Green through amber to red as health drains. */
function healthColour(fraction: number): number {
  if (fraction > 0.6) return 0x5ee08a;
  if (fraction > 0.3) return 0xe8c15a;
  return 0xe8615a;
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
