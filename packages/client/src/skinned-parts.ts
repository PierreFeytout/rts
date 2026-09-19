import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { normalise, standardise, type ModelPart } from "./model-parts.js";

/**
 * Skeletal animation for instanced units, by baking the skeleton into a texture.
 *
 * WHY NOT A SKINNEDMESH
 * ---------------------
 * three.js animates a skinned mesh by recomputing every bone matrix on the CPU
 * and drawing it on its own: one skeleton update and one draw call per figure.
 * The Conscript is a squad of three, and four hundred units on screen is twelve
 * hundred skeletons a frame. That is not a budget problem to optimise; it is the
 * wrong shape of solution.
 *
 * WHAT HAPPENS INSTEAD
 * --------------------
 * At load, every animation clip is played once, frame by frame, and the final
 * matrix of every bone at every frame is written into a float texture: one row
 * per frame, four texels per bone. On the map, every figure is an ordinary
 * instance with one extra number -- which frame it is on -- and the vertex
 * shader reads its bones straight out of that texture. Twelve hundred animated
 * soldiers are a single draw call, and each one can be on its own frame, which
 * is what stops a squad of three marching in step like clockwork.
 *
 * The matrices baked here are exactly the ones three.js would compute on the CPU
 * for the same pose, and skinned-parts.test.ts checks that vertex by vertex. The
 * shader in model-parts.ts reads them back with three.js's own texel packing.
 *
 * Presentation only, like fog memory and the music: nothing here is simulation
 * state, and two peers showing different animation frames cannot disagree about
 * anything that matters.
 */

/** Frames per second at which clips are sampled. Interpolated between on the GPU. */
export const BAKE_FPS = 30;

/**
 * Clips that play once and hold their last pose, rather than looping.
 *
 * By name, because glTF has no loop flag -- looping is a playback decision, and
 * in this game the decision follows from what the clip is. A structure's
 * `build` is scrubbed by construction progress, and its `release` plays each
 * time something it made comes out; neither wraps round to its start.
 */
const ONE_SHOT = new Set(["fire", "attack", "death", "die", "build", "release"]);

export interface BakedClip {
  readonly name: string;
  /** First row of the clip in the animation texture. */
  readonly start: number;
  /** Rows the clip spans. One more row follows it; see `bakeAnimations`. */
  readonly frames: number;
  readonly duration: number;
  readonly loop: boolean;
}

export interface AnimationBake {
  readonly texture: THREE.DataTexture;
  /** The texture's contents. Kept for the tests, which read poses back out of it. */
  readonly data: Float32Array;
  readonly bones: number;
  readonly rows: number;
  readonly clips: ReadonlyMap<string, BakedClip>;
}

/**
 * Where each figure of a squad stands, relative to the unit's position.
 *
 * In game space: +X forward, +Z to the unit's right. `phase` offsets the figure's
 * animation, as a fraction of a clip, so the squad does not step in unison.
 */
export interface SquadSlot {
  readonly x: number;
  readonly z: number;
  readonly phase: number;
}

/** A lone figure at the centre. What every model is unless it says otherwise. */
export const SINGLE: readonly SquadSlot[] = [{ x: 0, z: 0, phase: 0 }];

export interface SkinnedModel {
  parts: ModelPart[];
  bake: AnimationBake;
  squad: readonly SquadSlot[];
}

export function isSkinned(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((object) => {
    if ((object as THREE.SkinnedMesh).isSkinnedMesh) found = true;
  });
  return found;
}

/**
 * Turn a loaded, rigged scene into instanceable parts and a baked animation.
 *
 * Every skinned mesh must share one skeleton -- one rig per model -- and
 * anything in the file that is not skinned is left out with a warning. A rifle
 * parented to a hand bone is the common case of the second rule, and the fix is
 * to weight it fully to that bone instead; see assets/models/README.md.
 */
export function toSkinnedParts(
  root: THREE.Object3D,
  clips: readonly THREE.AnimationClip[],
  warn: (message: string) => void = () => {},
): SkinnedModel {
  root.updateMatrixWorld(true);

  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) meshes.push(mesh);
    else if ((object as THREE.Mesh).isMesh) {
      warn(`"${object.name}" is not skinned and is left out; weight it to a bone instead of parenting it`);
    }
  });
  if (meshes.length === 0) throw new Error("toSkinnedParts: no skinned meshes");

  const skeleton = meshes[0].skeleton;
  for (const mesh of meshes) {
    if (mesh.skeleton.bones.length !== skeleton.bones.length || mesh.skeleton.bones.some((b, i) => b !== skeleton.bones[i])) {
      warn(`"${mesh.name}" uses a different skeleton; one rig per model, and it is drawn with the first`);
    }
  }

  const bake = bakeAnimations(root, meshes[0], clips, warn);

  const byMaterial = new Map<string, { material: THREE.Material; pieces: THREE.BufferGeometry[] }>();
  for (const mesh of meshes) {
    let material = mesh.material;
    if (Array.isArray(material)) {
      warn(`"${mesh.name}" has ${material.length} materials on one mesh; only the first is used`);
      material = material[0];
    }
    // Into bind-pose world space, which is the space the baked matrices expect.
    const piece = normalise(mesh.geometry, mesh.bindMatrix, true);
    const entry = byMaterial.get(material.uuid);
    if (entry) entry.pieces.push(piece);
    else byMaterial.set(material.uuid, { material, pieces: [piece] });
  }

  const parts: ModelPart[] = [];
  for (const { material, pieces } of byMaterial.values()) {
    const geometry = pieces.length === 1 ? pieces[0] : mergeGeometries(pieces, false);
    if (!geometry) {
      warn(`could not merge the geometry for material "${material.name}"`);
      continue;
    }
    if (pieces.length > 1) for (const piece of pieces) piece.dispose();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    parts.push({ geometry, material: standardise(material, warn, bake.texture) });
  }

  return { parts, bake, squad: readSquad(root, warn) };
}

/**
 * Play every clip once and write down where every bone is on every frame.
 *
 * The matrix stored for a bone is `K × bone.matrixWorld × boneInverse`, where
 * `K = mesh.matrixWorld × bindMatrixInverse`. Applied to a vertex already moved
 * into bind-pose world space, that is exactly what three.js's own skinning
 * produces for the same pose -- the test compares the two directly.
 *
 * Each clip gets one row more than it spans. For a loop that row is a copy of
 * its first frame, so interpolating across the wrap is seamless; for a one-shot
 * it is the final pose, so the last frame has something to blend into. Either
 * way the shader can always read `row + 1` without checking.
 */
export function bakeAnimations(
  root: THREE.Object3D,
  mesh: THREE.SkinnedMesh,
  clips: readonly THREE.AnimationClip[],
  warn: (message: string) => void = () => {},
): AnimationBake {
  root.updateMatrixWorld(true);
  const bones = mesh.skeleton.bones;
  const inverses = mesh.skeleton.boneInverses;
  const count = bones.length;
  if (count * 4 > 4096) throw new Error(`bakeAnimations: ${count} bones is more than a texture row can hold`);
  if (count > 64) warn(`${count} bones; a unit seen from this far away needs a fraction of that`);

  // Captured before anything moves: this is the bind pose.
  const K = new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse);

  const plan = clips.length > 0 ? clips : [];
  const layout: BakedClip[] = [];
  let rows = 0;
  for (const clip of plan) {
    const frames = Math.max(1, Math.round(clip.duration * BAKE_FPS));
    layout.push({ name: clip.name, start: rows, frames, duration: clip.duration, loop: !ONE_SHOT.has(clip.name) });
    rows += frames + 1;
  }
  if (layout.length === 0) {
    // A rigged model with no animation still has to draw: one "rest" clip of the
    // bind pose, so every lookup has somewhere to land.
    layout.push({ name: "rest", start: 0, frames: 1, duration: 1, loop: true });
    rows = 2;
  }

  const width = count * 4;
  const data = new Float32Array(width * rows * 4);
  const mixer = new THREE.AnimationMixer(root);
  const scratch = new THREE.Matrix4();

  // The rig's pose as loaded, which for a glTF file is its bind pose. Saved as
  // each bone's *local* transform and put back exactly afterwards.
  //
  // Not `skeleton.pose()`, which is what three.js offers for this and is wrong
  // here: for a root bone whose parent is not itself a bone -- an armature
  // object, which is how every exporter writes a rig -- it copies the bone's
  // world matrix into its local one, and the armature's transform is then
  // applied twice. Every clip baked after that is offset by the armature's
  // position, and so is anything else that reads the rig.
  const rest = bones.map((bone) => ({
    position: bone.position.clone(),
    quaternion: bone.quaternion.clone(),
    scale: bone.scale.clone(),
  }));
  const restore = (): void => {
    bones.forEach((bone, b) => {
      bone.position.copy(rest[b].position);
      bone.quaternion.copy(rest[b].quaternion);
      bone.scale.copy(rest[b].scale);
    });
    root.updateMatrixWorld(true);
  };

  const writeRow = (row: number): void => {
    root.updateMatrixWorld(true);
    for (let b = 0; b < count; b++) {
      scratch.multiplyMatrices(bones[b].matrixWorld, inverses[b]).premultiply(K);
      data.set(scratch.elements, (row * width + b * 4) * 4);
    }
  };

  if (plan.length === 0) {
    restore();
    writeRow(0);
    writeRow(1);
  }

  plan.forEach((clip, index) => {
    const info = layout[index];
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    action.reset().play();
    for (let f = 0; f < info.frames; f++) {
      mixer.setTime(Math.min(f / BAKE_FPS, clip.duration));
      writeRow(info.start + f);
    }
    if (info.loop) {
      data.copyWithin(
        (info.start + info.frames) * width * 4,
        info.start * width * 4,
        (info.start + 1) * width * 4,
      );
    } else {
      mixer.setTime(clip.duration);
      writeRow(info.start + info.frames);
    }
    action.stop();
    mixer.uncacheAction(clip);
  });

  // Leave the rig as it was found, in case anything reads it afterwards.
  mixer.stopAllAction();
  restore();

  const texture = new THREE.DataTexture(data, width, rows, THREE.RGBAFormat, THREE.FloatType);
  // Read with texelFetch, which never filters -- but a float texture that asks
  // to be filtered needs an extension to be valid at all, so it asks not to.
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  return { texture, data, bones: count, rows, clips: new Map(layout.map((c) => [c.name, c])) };
}

/**
 * Which texture row to show for a clip at `time` seconds.
 *
 * Fractional, so the shader blends to the next row. Looping clips wrap; one-shot
 * clips stop just short of their final row, so `row + 1` is that final pose.
 */
export function frameAt(clip: BakedClip, time: number): number {
  const position = time * BAKE_FPS;
  if (clip.loop) {
    const wrapped = ((position % clip.frames) + clip.frames) % clip.frames;
    return clip.start + wrapped;
  }
  return clip.start + Math.min(Math.max(position, 0), clip.frames - 0.0001);
}

/**
 * A squad's layout, from the file.
 *
 * Authored in Blender as a custom property `rts_squad` on any object: a flat list
 * of numbers, three per figure -- forward, left, phase -- in Blender's axes,
 * because that is where it is typed in. glTF carries custom properties through
 * as extras, which three.js puts in `userData`. Blender's +Y is the unit's left,
 * which is -Z here.
 */
export function readSquad(root: THREE.Object3D, warn: (message: string) => void = () => {}): readonly SquadSlot[] {
  let raw: unknown;
  root.traverse((object) => {
    if (raw === undefined && object.userData.rts_squad !== undefined) raw = object.userData.rts_squad;
  });
  if (raw === undefined) return SINGLE;

  if (!Array.isArray(raw) || raw.length === 0 || raw.length % 3 !== 0 || raw.some((v) => typeof v !== "number")) {
    warn("rts_squad must be a list of numbers, three per figure (forward, left, phase); drawn as one figure");
    return SINGLE;
  }
  const slots: SquadSlot[] = [];
  for (let i = 0; i < raw.length; i += 3) {
    slots.push({ x: raw[i] as number, z: -(raw[i + 1] as number), phase: raw[i + 2] as number });
  }
  return slots;
}

/** Where a model smokes, in the unit box and in three.js axes. */
export interface SmokePoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** What every model has unless its file says otherwise. */
export const NO_SMOKE: readonly SmokePoint[] = [];

/**
 * A structure's stacks, from the file.
 *
 * Authored like `rts_squad`: a custom property `rts_smoke` on any object, a
 * flat list of three numbers per stack -- `(forward, left, up)` in Blender
 * axes, in the unit box, the top of the stack. Blender's +Y is the left and
 * its +Z is up, so a point lands at three.js `(x, z, -y)`. The game draws
 * smoke from each point while the building stands (chimney-smoke.ts).
 */
export function readSmoke(root: THREE.Object3D, warn: (message: string) => void = () => {}): readonly SmokePoint[] {
  let raw: unknown;
  root.traverse((object) => {
    if (raw === undefined && object.userData.rts_smoke !== undefined) raw = object.userData.rts_smoke;
  });
  if (raw === undefined) return NO_SMOKE;

  if (!Array.isArray(raw) || raw.length === 0 || raw.length % 3 !== 0 || raw.some((v) => typeof v !== "number")) {
    warn("rts_smoke must be a list of numbers, three per stack (forward, left, up); drawn without smoke");
    return NO_SMOKE;
  }
  const points: SmokePoint[] = [];
  for (let i = 0; i < raw.length; i += 3) {
    points.push({ x: raw[i] as number, y: raw[i + 2] as number, z: -(raw[i + 1] as number) });
  }
  return points;
}
