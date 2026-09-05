import {
  KIND_BUILDING,
  KIND_RESOURCE,
  MAX_ENTITIES,
  VIS_HIDDEN,
  VIS_VISIBLE,
  entityIndex,
  type EntityId,
  type World,
} from "@rts/sim";
import * as THREE from "three";
import { bamToThreeY, simToWorld } from "./coords.js";
import { MODEL_COUNT, buildModels, modelFor, scalesWithFootprint } from "./models.js";

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
 * One `InstancedMesh` per *silhouette*, not per unit type. Both races share the
 * same handful of shapes -- see models.ts, which picks a shape from what a unit
 * can do rather than from what it is called -- so a 400-unit battle between two
 * factions is still eight draw calls, and adding a race adds none.
 */

/** Team colours, indexed by owner id. */
const TEAM_COLOURS = [0x63d0ff, 0xff7a59, 0x9d7aff, 0x6ee7a8];
/** Unowned scenery: ore patches and geothermal vents. */
const NEUTRAL_COLOUR = 0xd8c37a;
const VENT_COLOUR = 0x7fd8b0;

/** Health bar geometry, in world units. */
const BAR_WIDTH = 1.1;
const BAR_HEIGHT = 0.13;

/**
 * Per-model instance capacity.
 *
 * Generous rather than tight: overflowing silently drops units from the screen,
 * which is a far worse failure than a few hundred kilobytes of unused matrix
 * buffer. The whole set costs well under a megabyte.
 */
const MODEL_CAPACITY = 768;

export class WorldRenderer {
  /** One mesh per silhouette, indexed by the MODEL_* constants. */
  private readonly models: THREE.InstancedMesh[] = [];
  /** Live instance count per model this frame. */
  private readonly counts = new Int32Array(MODEL_COUNT);

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

  constructor(scene: THREE.Scene, camera: THREE.Camera, capacity = 1024) {
    camera.updateMatrixWorld();
    this.billboard.copy(camera.quaternion);
    this.barRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();

    const geometries = buildModels();
    for (let model = 0; model < MODEL_COUNT; model++) {
      this.models.push(
        makeInstanced(
          scene,
          geometries[model],
          new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.25, flatShading: true }),
          MODEL_CAPACITY,
        ),
      );
    }

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

  /**
   * Push interpolated transforms into the instance buffers.
   *
   * Fog is applied here rather than by the overlay quad, because everything
   * drawn by this class stands above the ground plane. The rule differs by
   * category, and the difference is what makes fog read correctly:
   *
   *   - Enemy *units* vanish entirely once out of sight. A unit is where it is
   *     right now; drawing a remembered one would be a lie.
   *   - Enemy *buildings and ore* stay drawn once explored, dimmed. Those do
   *     not move, so remembering them is what a player expects.
   *   - Your own things are always fully lit.
   */
  update(world: World, alpha: number, selected: ReadonlySet<EntityId>, localPlayer: number): void {
    const e = world.entities;
    const types = world.types;
    const vision = world.vision;

    this.counts.fill(0);
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

      // Fog. Own entities skip the lookup entirely -- by far the common case in
      // the middle of your own base.
      let shade = 1;
      if (vision.enabled && owner !== localPlayer) {
        const level = vision.levelAt(localPlayer, e.posX[i] >> 16, e.posY[i] >> 16);
        if (level === VIS_HIDDEN) continue;
        if (level !== VIS_VISIBLE) {
          // Remembered ground: static things persist, anything that moves does
          // not. A remembered tank is a tank that is no longer there.
          if (type.footprint === 0) continue;
          shade = 0.45;
        }
      }

      const model = modelFor(type);
      const mesh = this.models[model];
      const n = this.counts[model];
      if (n < MODEL_CAPACITY) {
        if (type.kind === KIND_RESOURCE) {
          const scale = type.footprint * 0.62;
          this.scratch.position.set(x, 0, z);
          this.scratch.rotation.set(0, 0, 0);
          this.scratch.scale.set(scale, scale, scale);
          this.colour.setHex(type.resourceAmount > 0 ? NEUTRAL_COLOUR : VENT_COLOUR);
        } else if (type.kind === KIND_BUILDING) {
          const span = type.footprint;
          // A site rises out of the ground as it is built, which reads as
          // progress without needing a separate progress bar.
          const progress =
            e.buildRemaining[i] > 0 ? 1 - e.buildRemaining[i] / Math.max(1, type.buildTime) : 1;
          const height = scalesWithFootprint(model) ? span * Math.max(0.15, progress) : span;
          this.scratch.position.set(x, 0, z);
          this.scratch.rotation.set(0, 0, 0);
          this.scratch.scale.set(span * 0.94, height * 0.94, span * 0.94);
          this.colour.setHex(teamColour(owner));
          // Unfinished structures are washed out, so a half-built factory is
          // never mistaken for a working one at a glance.
          if (e.buildRemaining[i] > 0) this.colour.multiplyScalar(0.5);
        } else {
          this.scratch.position.set(x, 0, z);
          this.scratch.rotation.set(0, bamToThreeY(lerpAngle(pf, e.facing[i], alpha)), 0);
          this.scratch.scale.setScalar(1);
          this.colour.setHex(teamColour(owner));
        }

        this.colour.multiplyScalar(shade);
        this.scratch.updateMatrix();
        mesh.setMatrixAt(n, this.scratch.matrix);
        mesh.setColorAt(n, this.colour);
        this.counts[model] = n + 1;
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
      const damaged = shade === 1 && e.health[i] < type.maxHealth && type.kind !== KIND_RESOURCE;
      if (damaged && nBars < this.barBack.instanceMatrix.count) {
        const fraction = Math.max(0, Math.min(1, e.health[i] / type.maxHealth));
        const y = type.kind === KIND_BUILDING ? type.footprint * 1.05 + 0.5 : 1.1;

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

    for (let model = 0; model < MODEL_COUNT; model++) {
      commit(this.models[model], this.counts[model]);
    }
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
