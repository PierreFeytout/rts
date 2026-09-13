import {
  EV_SHOT,
  KIND_BUILDING,
  KIND_RESOURCE,
  MAX_ENTITIES,
  VIS_HIDDEN,
  VIS_VISIBLE,
  entityIndex,
  type EntityId,
  type EntityType,
  type World,
} from "@rts/sim";
import * as THREE from "three";
import { bamToThreeY, simToWorld } from "./coords.js";
import type { Model, ModelLibrary } from "./model-library.js";
import { teamAttributes } from "./model-parts.js";
import { frameAt, type AnimationBake, type BakedClip } from "./skinned-parts.js";
import { NEUTRAL_COLOUR, VENT_COLOUR, teamColour } from "./palette.js";

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
 * One `InstancedMesh` per *model part*, not per unit. A model is one merged
 * geometry per material -- see model-parts.ts -- so a 400-unit battle costs a
 * draw call per part per distinct model on screen, however many units share
 * it. Parts of one model share a single matrix buffer and a single pair of
 * team-colour buffers, because they are the same instances.
 */

/** One model's instances: its meshes, and the buffers they share. */
interface Batch {
  model: Model;
  meshes: THREE.InstancedMesh[];
  team: THREE.InstancedBufferAttribute;
  shade: THREE.InstancedBufferAttribute;
  /** Frame, second frame and blend per instance. Rigged models only. */
  animation: THREE.InstancedBufferAttribute | null;
  /** Instances, not units: a squad of three is three of these. */
  capacity: number;
  count: number;
}

/** Which clip a unit wants. Resolved to a real clip per model; see `clipFor`. */
const IDLE = 0;
const WALK = 1;
const FIRE = 2;

/**
 * Seconds to blend from one clip into the next.
 *
 * Short. The point is only that a unit which stops does not snap from mid-stride
 * to standing; anything longer and a squad that stops and fires is still
 * visibly walking when its first shot lands.
 */
const BLEND_SECONDS = 0.18;

/**
 * The clip a model actually has for what a unit wants to do.
 *
 * A model is not required to have every clip. One with no firing animation
 * stands and shoots; one with no walk slides at rest; one with no clips at all
 * was baked with a single "rest" pose. Missing animation is a thing to fix in
 * the model, never a reason for a unit to vanish or throw.
 */
function clipFor(bake: AnimationBake, wanted: number): BakedClip {
  const name = wanted === FIRE ? "fire" : wanted === WALK ? "walk" : "idle";
  return (
    bake.clips.get(name) ??
    bake.clips.get("idle") ??
    bake.clips.get("rest") ??
    // Baking always produces at least one clip, so this cannot come back empty.
    bake.clips.values().next().value!
  );
}


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
  private readonly scene: THREE.Scene;
  private readonly library: ModelLibrary;
  /**
   * Instances by model key, created the first time a model is needed.
   *
   * Lazily rather than up front, because the library holds a model for every
   * role and every authored file whether or not this match contains a single
   * unit that uses it.
   */
  private readonly batches = new Map<string, Batch>();

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

  /*
   * Animation, per entity slot. Presentation only, like everything else here:
   * none of it is read by the simulation, and two peers on different frames of a
   * walk cycle agree about everything that matters.
   */
  /** The entity id each slot's animation belongs to, so a reused slot restarts. */
  private readonly animOwner = new Float64Array(MAX_ENTITIES).fill(-1);
  private readonly animClip = new Int8Array(MAX_ENTITIES);
  private readonly animTime = new Float32Array(MAX_ENTITIES);
  private readonly animPrev = new Int8Array(MAX_ENTITIES);
  private readonly animPrevTime = new Float32Array(MAX_ENTITIES);
  private readonly animBlend = new Float32Array(MAX_ENTITIES);
  /** When each entity last fired, in seconds on the frame clock. */
  private readonly lastShot = new Float64Array(MAX_ENTITIES).fill(-Infinity);
  private lastFrame = -1;
  /**
   * Camera orientation, baked into every health bar instance.
   *
   * The isometric rig never rotates, so this is captured once rather than
   * recomputed per frame -- billboarding a few hundred bars against a camera
   * that cannot turn would be pure waste.
   */
  private readonly billboard = new THREE.Quaternion();
  private readonly barRight = new THREE.Vector3();

  constructor(scene: THREE.Scene, camera: THREE.Camera, library: ModelLibrary, capacity = 1024) {
    this.scene = scene;
    this.library = library;
    camera.updateMatrixWorld();
    this.billboard.copy(camera.quaternion);
    this.barRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();

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

    // Animation runs on the frame clock, not the tick clock: a walk cycle that
    // advanced twenty times a second would stutter on every display.
    const now = performance.now() / 1000;
    const dt = this.lastFrame < 0 ? 0 : Math.min(0.1, now - this.lastFrame);
    this.lastFrame = now;

    for (const batch of this.batches.values()) batch.count = 0;
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

      const batch = this.batch(this.library.forType(type));
      const n = batch.count;
      if (n < batch.capacity) {
        let light = shade;
        if (type.kind === KIND_RESOURCE) {
          // Structures, scenery included, are authored in a 1 x 1 box and scaled
          // to their footprint here -- in exactly one way, for every model.
          const scale = type.footprint;
          this.scratch.position.set(x, 0, z);
          this.scratch.rotation.set(0, 0, 0);
          this.scratch.scale.set(scale, scale, scale);
          this.colour.setHex(type.resourceAmount > 0 ? NEUTRAL_COLOUR : VENT_COLOUR);
        } else if (type.kind === KIND_BUILDING) {
          const span = type.footprint;
          // A site rises out of the ground as it is built, which reads as
          // progress without needing a separate progress bar.
          const building = e.buildRemaining[i] > 0;
          const progress = building ? 1 - e.buildRemaining[i] / Math.max(1, type.buildTime) : 1;
          const height = span * Math.max(0.15, progress);
          this.scratch.position.set(x, 0, z);
          this.scratch.rotation.set(0, 0, 0);
          this.scratch.scale.set(span * 0.94, height * 0.94, span * 0.94);
          this.colour.setHex(teamColour(owner));
          // Unfinished structures are washed out, so a half-built factory is
          // never mistaken for a working one at a glance.
          if (building) light *= 0.5;
        } else {
          this.colour.setHex(teamColour(owner));
        }

        if (type.kind === KIND_RESOURCE || type.kind === KIND_BUILDING) {
          this.scratch.updateMatrix();
          // The matrix buffer is shared by every part, so one write moves them all.
          batch.meshes[0].setMatrixAt(n, this.scratch.matrix);
          batch.team.setXYZ(n, this.colour.r, this.colour.g, this.colour.b);
          batch.shade.setX(n, light);
          batch.count = n + 1;
        } else {
          // How far the unit moved this tick, which picks and paces its walk.
          const step = fresh ? 0 : Math.hypot(e.posX[i] - this.prevX[i], e.posY[i] - this.prevY[i]);
          const yaw = bamToThreeY(lerpAngle(pf, e.facing[i], alpha));
          this.drawUnit(batch, i, type, e.idAt(i), step, x, z, yaw, light, e.health[i], dt, now);
        }
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

    for (const batch of this.batches.values()) {
      for (const mesh of batch.meshes) mesh.count = batch.count;
      batch.meshes[0].instanceMatrix.needsUpdate = true;
      batch.team.needsUpdate = true;
      batch.shade.needsUpdate = true;
      if (batch.animation) batch.animation.needsUpdate = true;
    }
    commit(this.rings, nRings);
    commit(this.barBack, nBars);
    commit(this.barFill, nBars);
  }

  /**
   * Read one tick's shots, so a unit that fired plays its firing clip.
   *
   * Call from the session's after-tick hook, while `world.events` still holds
   * the tick -- the same place effects and the HUD read it.
   */
  ingest(world: World): void {
    const now = performance.now() / 1000;
    for (const event of world.events.all) {
      if (event.kind === EV_SHOT) this.lastShot[entityIndex(event.shooter)] = now;
    }
  }

  /**
   * One unit: every figure of its squad, each on its own frame.
   *
   * A squad thins as it is hurt -- one figure fewer for each share of its health
   * lost -- so a battered squad is visible as one at a glance, without reading a
   * health bar. It is still one unit to the simulation, with one health pool;
   * the missing figures are purely how the damage is shown.
   */
  private drawUnit(
    batch: Batch,
    i: number,
    type: EntityType,
    id: EntityId,
    step: number,
    x: number,
    z: number,
    yaw: number,
    light: number,
    health: number,
    dt: number,
    now: number,
  ): void {
    const { squad, animation } = batch.model;
    const figures =
      squad.length > 1
        ? Math.max(1, Math.min(squad.length, Math.ceil((squad.length * health) / type.maxHealth)))
        : 1;

    let clip: BakedClip | null = null;
    let prev: BakedClip | null = null;
    if (animation) {
      this.animate(i, id, step, type, animation, dt, now);
      clip = clipFor(animation, this.animClip[i]);
      prev = clipFor(animation, this.animPrev[i]);
    }

    // The squad turns with the unit. A positive yaw about Y takes +X toward -Z.
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);

    for (let k = 0; k < figures && batch.count < batch.capacity; k++) {
      const slot = squad[k];
      this.scratch.position.set(x + slot.x * cos + slot.z * sin, 0, z - slot.x * sin + slot.z * cos);
      this.scratch.rotation.set(0, yaw, 0);
      this.scratch.scale.setScalar(1);
      this.scratch.updateMatrix();

      const n = batch.count;
      batch.meshes[0].setMatrixAt(n, this.scratch.matrix);
      batch.team.setXYZ(n, this.colour.r, this.colour.g, this.colour.b);
      batch.shade.setX(n, light);
      if (batch.animation && clip && prev) {
        // Each figure is offset into the clip by its phase, so three soldiers
        // walking together do not step in unison like clockwork.
        const offset = (c: BakedClip): number => (c.loop ? slot.phase * c.duration : 0);
        batch.animation.setXYZ(
          n,
          frameAt(clip, this.animTime[i] + offset(clip)),
          frameAt(prev, this.animPrevTime[i] + offset(prev)),
          this.animBlend[i],
        );
      }
      batch.count = n + 1;
    }
  }

  /**
   * Decide which clip a unit should be playing, and move it along.
   *
   * Firing beats walking beats standing still. A change of clip does not cut: the
   * clip being left is kept running for a moment and blended out on the GPU.
   */
  private animate(
    i: number,
    id: EntityId,
    step: number,
    type: EntityType,
    bake: AnimationBake,
    dt: number,
    now: number,
  ): void {
    if (this.animOwner[i] !== id) {
      // A new unit, or a slot reused by one. Start somewhere in the idle cycle
      // rather than at its first frame, so units trained together do not breathe
      // in unison either.
      this.animOwner[i] = id;
      this.animClip[i] = IDLE;
      this.animPrev[i] = IDLE;
      this.animTime[i] = ((i * 0.6180339) % 1) * 2;
      this.animPrevTime[i] = 0;
      this.animBlend[i] = 0;
      this.lastShot[i] = -Infinity;
    }

    // `step` is how far the unit moved on the last tick. A little movement is not
    // walking: separation nudges a standing crowd apart, and a squad shuffled a
    // hair sideways should not break into a stride.
    const moving = type.moveSpeed > 0 && step > type.moveSpeed * 0.15;

    const fire = bake.clips.get("fire");
    const firing = fire !== undefined && now - this.lastShot[i] < fire.duration;

    const wanted = firing ? FIRE : moving ? WALK : IDLE;
    if (wanted !== this.animClip[i]) {
      this.animPrev[i] = this.animClip[i];
      this.animPrevTime[i] = this.animTime[i];
      this.animBlend[i] = 1;
      this.animClip[i] = wanted;
      if (wanted === FIRE) this.animTime[i] = 0;
    } else if (wanted === FIRE && now - this.lastShot[i] < this.animTime[i]) {
      // Fired again before the last shot's clip finished: start the recoil over.
      this.animTime[i] = 0;
    }

    // A walk plays at the speed the unit is actually covering ground, so a unit
    // slowed in a crowd shuffles rather than moonwalking at full stride.
    const rate = moving ? Math.min(1.5, Math.max(0.5, step / type.moveSpeed)) : 1;
    this.animTime[i] += dt * rate;
    this.animPrevTime[i] += dt;
    this.animBlend[i] = Math.max(0, this.animBlend[i] - dt / BLEND_SECONDS);
  }

  /**
   * The instances for one model, built the first time it is drawn.
   *
   * Geometry is cloned from the library rather than used directly, because the
   * per-instance buffers are attached to it -- and the portrait studio draws the
   * same library geometry with buffers of its own.
   */
  private batch(model: Model): Batch {
    const existing = this.batches.get(model.key);
    if (existing) return existing;

    // Room for every figure, not every unit.
    const capacity = MODEL_CAPACITY * model.squad.length;
    const { team, shade } = teamAttributes(capacity);
    const animation = model.animation
      ? new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
      : null;
    animation?.setUsage(THREE.DynamicDrawUsage);

    const meshes: THREE.InstancedMesh[] = [];
    for (const part of model.parts) {
      const geometry = part.geometry.clone();
      geometry.setAttribute("instanceTeam", team);
      geometry.setAttribute("instanceShade", shade);
      if (animation) geometry.setAttribute("instanceAnimation", animation);
      const mesh = makeInstanced(this.scene, geometry, part.material, capacity);
      // One matrix buffer for all of a model's parts. They are the same units.
      if (meshes.length > 0) mesh.instanceMatrix = meshes[0].instanceMatrix;
      meshes.push(mesh);
    }

    const batch: Batch = { model, meshes, team, shade, animation, capacity, count: 0 };
    this.batches.set(model.key, batch);
    return batch;
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
