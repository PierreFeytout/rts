import { KIND_BUILDING, VIS_VISIBLE, type World } from "@rts/sim";
import * as THREE from "three";
import { simToWorld } from "./coords.js";
import type { ModelLibrary } from "./model-library.js";
import { STRUCTURE_FIT } from "./world-renderer.js";

/**
 * Smoke from a structure's stacks.
 *
 * A model says where it smokes -- `rts_smoke` on its armature, see the model
 * README -- and this draws it: soft puffs that leave the top of each stack,
 * rise, spread and thin out, a few a second per stack and twice as many while
 * the building has work queued. Presentation only, like the resource glow: it
 * reads the world and never writes it, and two peers at different frame rates
 * see different puffs over the same match.
 *
 * Puffs live on a render clock, in seconds, so they climb at one speed at
 * thirty frames a second and at two hundred and forty. Nothing spawns on a
 * frame whose delta is zero: a capture renders a still, and a still keeps the
 * puffs it had.
 *
 * Drawn as one instanced quad for every stack on the map, turned once to face
 * the camera -- the isometric rig never rotates, so a billboard here is a
 * fixed orientation rather than a per-frame lookAt -- with an alpha per
 * instance, which is the one thing `InstancedMesh` cannot do by itself and
 * the whole reason for the small shader below. A puff fades, and fading is
 * alpha: darkening the colour instead would read as soot turning to nothing
 * while still covering what is behind it.
 */

/** Every stack on the map shares this pool; the oldest puff goes when it is full. */
const MAX_PUFFS = 1024;
/** How long a puff lasts, from the stack's mouth to nothing. */
const PUFF_SECONDS = 2.8;
/** Puffs per second from one stack, standing and working. */
const RATE_IDLE = 2.5;
const RATE_BUSY = 6;
/** How far a puff climbs over its life, in tiles, easing off as it cools. */
const RISE = 1.4;
/** The wind, in tiles per second. Everything on the map drifts the same way. */
const DRIFT_X = 0.16;
const DRIFT_Z = -0.1;
/** A puff's width in tiles, at birth and at the end. */
const SIZE_START = 0.3;
const SIZE_END = 1.15;
/** Peak alpha. Thin: smoke is seen by the light it dims, not as a shape. */
const OPACITY = 0.55;
/** Ash-grey with the furnace's warmth in it, never black -- black smoke
 * against this ground is invisible, and it is lit from below anyway. */
const COLOUR = 0x8f8279;
/** Longest frame the clock accepts: a tab in the background comes back to a
 * plume that kept its shape, not to a burst. */
const MAX_DELTA = 0.1;

interface Puff {
  x: number;
  y: number;
  z: number;
  age: number;
  seed: number;
}

export class ChimneySmoke {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly mesh: THREE.InstancedMesh;
  private readonly alpha: THREE.InstancedBufferAttribute;
  private readonly texture: THREE.Texture;
  private readonly puffs: Puff[] = [];
  /** Per entity slot: puffs owed but not yet spawned, and which stack is next. */
  private due = new Float32Array(0);
  private next = new Uint8Array(0);
  private oriented = false;
  private readonly scratch = new THREE.Object3D();

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene;
    this.camera = camera;
    this.texture = puffTexture();

    const geometry = new THREE.PlaneGeometry(1, 1);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS), 1);
    this.alpha.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("puffAlpha", this.alpha);

    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { map: { value: this.texture }, colour: { value: new THREE.Color(COLOUR) } },
      ]),
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      fog: true,
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_PUFFS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    // After the ground, the fog decal and the resource glows, so a puff over
    // a vent dims the vent rather than being cut by it.
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  /** Spawn what the frame owes, age everything, and rebuild the instances. */
  update(world: World, deltaSeconds: number, localPlayer: number, models: ModelLibrary): void {
    const dt = Math.min(Math.max(deltaSeconds, 0), MAX_DELTA);
    this.orient();

    const e = world.entities;
    if (this.due.length < e.alive.length) {
      this.due = new Float32Array(e.alive.length);
      this.next = new Uint8Array(e.alive.length);
    }

    if (dt > 0) {
      const types = world.types;
      const vision = world.vision;
      for (let i = 0; i < e.highWater; i++) {
        if (e.alive[i] !== 1) {
          this.due[i] = 0;
          continue;
        }
        const type = types.get(e.typeId[i]);
        if (type.kind !== KIND_BUILDING || e.buildRemaining[i] > 0) continue;
        const points = models.forType(type).smoke;
        if (points.length === 0) continue;

        // Only what the player can see: a remembered building is a memory,
        // and memories do not smoke.
        const tx = e.posX[i] >> 16;
        const ty = e.posY[i] >> 16;
        if (vision.enabled && vision.levelAt(localPlayer, tx, ty) !== VIS_VISIBLE) {
          this.due[i] = 0;
          continue;
        }

        const rate = (e.queueLen[i] > 0 ? RATE_BUSY : RATE_IDLE) * points.length;
        this.due[i] += rate * dt;
        if (this.due[i] < 1) continue;
        // One puff per frame however many are owed, and never more than one
        // carried over: a hitch should not empty a chimney all at once.
        this.due[i] = Math.min(this.due[i] - 1, 1);

        const k = this.next[i] % points.length;
        this.next[i] = (k + 1) % points.length;
        const p = points[k];
        const span = type.footprint * STRUCTURE_FIT;
        this.spawn(
          simToWorld(e.posX[i]) + p.x * span + (Math.random() - 0.5) * 0.06,
          p.y * span,
          simToWorld(e.posY[i]) + p.z * span + (Math.random() - 0.5) * 0.06,
        );
      }
    }

    let n = 0;
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const puff = this.puffs[i];
      puff.age += dt;
      if (puff.age >= PUFF_SECONDS) {
        this.puffs.splice(i, 1);
        continue;
      }
      const t = puff.age / PUFF_SECONDS;
      // Fast off the stack, slowing as it cools; wandering a little on the way.
      const climb = 1 - (1 - t) * (1 - t);
      const wobble = Math.sin(puff.seed + t * 5) * 0.07;
      this.scratch.position.set(
        puff.x + DRIFT_X * puff.age + wobble,
        puff.y + RISE * climb,
        puff.z + DRIFT_Z * puff.age - wobble * 0.5,
      );
      const size = SIZE_START + (SIZE_END - SIZE_START) * Math.pow(t, 0.7);
      this.scratch.scale.set(size, size, 1);
      this.scratch.updateMatrix();
      this.mesh.setMatrixAt(n, this.scratch.matrix);
      // In over the first tenth of its life, then thinning all the way out.
      const fadeIn = Math.min(t / 0.1, 1);
      this.alpha.setX(n, OPACITY * fadeIn * Math.pow(1 - t, 1.4));
      n++;
    }
    this.mesh.count = n;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.alpha.needsUpdate = true;
    }
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
    this.puffs.length = 0;
  }

  private spawn(x: number, y: number, z: number): void {
    if (this.puffs.length >= MAX_PUFFS) this.puffs.shift();
    this.puffs.push({ x, y, z, age: 0, seed: Math.random() * Math.PI * 2 });
  }

  /**
   * Turn the quad to face the camera, once the rig has aimed it.
   *
   * Done on the first update rather than in the constructor: the camera's
   * orientation is set when the rig first looks at the ground, which is
   * after everything drawn is constructed.
   */
  private orient(): void {
    if (this.oriented) return;
    this.mesh.geometry.applyQuaternion(this.camera.quaternion);
    this.oriented = true;
  }
}

const VERTEX = /* glsl */ `
  attribute float puffAlpha;
  varying vec2 vUv;
  varying float vAlpha;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vAlpha = puffAlpha;
    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 colour;
  varying vec2 vUv;
  varying float vAlpha;
  #include <fog_pars_fragment>
  void main() {
    float a = texture2D(map, vUv).a * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(colour, a);
    #include <fog_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * A soft, slightly lumpy puff: three overlapping discs, opaque toward their
 * middles and gone by their edges, so a plume of them reads as billows rather
 * than as a stack of coins.
 */
function puffTexture(size = 128): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const r = size / 2;
  for (const [dx, dy, scale] of [
    [0, 0, 0.82],
    [-0.2, 0.14, 0.62],
    [0.22, -0.1, 0.58],
  ]) {
    const cx = r + dx * r;
    const cy = r + dy * r;
    const radius = r * scale;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, "rgba(255,255,255,0.75)");
    gradient.addColorStop(0.5, "rgba(255,255,255,0.35)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}
