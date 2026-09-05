import { EV_DEATH, EV_DEPOSIT, EV_SHOT, type World } from "@rts/sim";
import * as THREE from "three";
import { simToWorld } from "./coords.js";

/**
 * Transient combat and economy effects: tracers, explosions, deposit sparks.
 *
 * Driven entirely from the simulation's per-tick event list, which is derived
 * output rather than state -- so nothing here can affect the game, and a peer
 * that skipped some events after a resync simply misses a few flashes.
 *
 * Effects live on a *render* clock, not the simulation clock. A tracer's
 * lifetime is measured in seconds so it looks the same at 30 fps and 240, and
 * so a stalled simulation leaves the last flashes fading out rather than frozen
 * mid-air.
 */

/** How long a tracer stays on screen. Short: it marks a shot, it is not a beam. */
const TRACER_SECONDS = 0.11;
/** How long a death flash lasts. */
const BLAST_SECONDS = 0.42;

const MAX_TRACERS = 256;
const MAX_BLASTS = 96;

interface Tracer {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  life: number;
  colour: number;
}

interface Blast {
  x: number;
  z: number;
  life: number;
  scale: number;
  colour: number;
}

export class Effects {
  private readonly tracerMesh: THREE.InstancedMesh;
  private readonly blastMesh: THREE.InstancedMesh;

  /**
   * Fixed-size pools, overwritten oldest-first when full.
   *
   * A 400-unit engagement produces far more shots per second than are worth
   * drawing, and an unbounded list would turn a big fight into a memory
   * problem. Dropping the excess is invisible: the screen is already saturated.
   */
  private readonly tracers: Tracer[] = [];
  private readonly blasts: Blast[] = [];

  private readonly scratch = new THREE.Object3D();
  private readonly colour = new THREE.Color();

  constructor(scene: THREE.Scene) {
    // A unit-length beam along +X, so an instance only needs a yaw and an X
    // scale to span any two points.
    const beam = new THREE.BoxGeometry(1, 0.07, 0.07);
    beam.translate(0.5, 0, 0);
    this.tracerMesh = new THREE.InstancedMesh(
      beam,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }),
      MAX_TRACERS,
    );
    this.tracerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tracerMesh.count = 0;
    this.tracerMesh.frustumCulled = false;
    scene.add(this.tracerMesh);

    this.blastMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.5, 0),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.75, depthWrite: false }),
      MAX_BLASTS,
    );
    this.blastMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.blastMesh.count = 0;
    this.blastMesh.frustumCulled = false;
    scene.add(this.blastMesh);
  }

  /** Read one tick's events. Call from the session's after-tick hook. */
  ingest(world: World): void {
    for (const event of world.events.all) {
      if (event.kind === EV_SHOT) {
        this.push(this.tracers, MAX_TRACERS, {
          ax: simToWorld(event.fromX),
          az: simToWorld(event.fromY),
          bx: simToWorld(event.toX),
          bz: simToWorld(event.toY),
          life: TRACER_SECONDS,
          colour: event.lethal ? 0xfff0a8 : 0xffd27a,
        });
      } else if (event.kind === EV_DEATH) {
        this.push(this.blasts, MAX_BLASTS, {
          x: simToWorld(event.x),
          z: simToWorld(event.y),
          life: BLAST_SECONDS,
          scale: 1.6,
          colour: 0xff9a5c,
        });
      } else if (event.kind === EV_DEPOSIT) {
        // A small green pop at the drop-off, so the economy is visibly running
        // rather than just a number ticking up in a corner.
        this.push(this.blasts, MAX_BLASTS, {
          x: simToWorld(event.x),
          z: simToWorld(event.y),
          life: BLAST_SECONDS * 0.5,
          scale: 0.7,
          colour: 0x8ef0b0,
        });
      }
    }
  }

  /** Age effects and rebuild the instance buffers. `deltaSeconds` is render time. */
  update(deltaSeconds: number): void {
    let n = 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= deltaSeconds;
      if (t.life <= 0) {
        this.tracers.splice(i, 1);
        continue;
      }
      if (n >= MAX_TRACERS) continue;

      const dx = t.bx - t.ax;
      const dz = t.bz - t.az;
      const length = Math.hypot(dx, dz);
      this.scratch.position.set(t.ax, 0.45, t.az);
      // atan2(-dz, dx): the sim's +y maps to three.js +z, and a Y rotation
      // turns the opposite way -- the same sign flip as unit facing.
      this.scratch.rotation.set(0, Math.atan2(-dz, dx), 0);
      this.scratch.scale.set(Math.max(length, 0.01), 1, 1);
      this.scratch.updateMatrix();
      this.tracerMesh.setMatrixAt(n, this.scratch.matrix);
      // Fade by darkening toward the scene ground rather than by opacity: a
      // per-instance alpha would need a custom shader for one flash effect.
      this.colour.setHex(t.colour).multiplyScalar(0.25 + 0.75 * (t.life / TRACER_SECONDS));
      this.tracerMesh.setColorAt(n, this.colour);
      n++;
    }
    this.tracerMesh.count = n;
    this.tracerMesh.instanceMatrix.needsUpdate = true;
    if (this.tracerMesh.instanceColor) this.tracerMesh.instanceColor.needsUpdate = true;

    let b = 0;
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const blast = this.blasts[i];
      blast.life -= deltaSeconds;
      if (blast.life <= 0) {
        this.blasts.splice(i, 1);
        continue;
      }
      if (b >= MAX_BLASTS) continue;

      const age = 1 - blast.life / BLAST_SECONDS;
      const scale = blast.scale * (0.4 + age * 1.3);
      this.scratch.position.set(blast.x, 0.5, blast.z);
      this.scratch.rotation.set(age * 3, age * 2, 0);
      this.scratch.scale.setScalar(scale);
      this.scratch.updateMatrix();
      this.blastMesh.setMatrixAt(b, this.scratch.matrix);
      this.colour.setHex(blast.colour).multiplyScalar(Math.max(0.05, 1 - age));
      this.blastMesh.setColorAt(b, this.colour);
      b++;
    }
    this.blastMesh.count = b;
    this.blastMesh.instanceMatrix.needsUpdate = true;
    if (this.blastMesh.instanceColor) this.blastMesh.instanceColor.needsUpdate = true;
  }

  private push<T>(pool: T[], capacity: number, item: T): void {
    if (pool.length >= capacity) pool.shift();
    pool.push(item);
  }
}
