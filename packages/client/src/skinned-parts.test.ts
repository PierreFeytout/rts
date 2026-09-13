import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { TEAM_MASK } from "./model-parts.js";
import {
  BAKE_FPS,
  SINGLE,
  bakeAnimations,
  frameAt,
  readSquad,
  toSkinnedParts,
  type AnimationBake,
} from "./skinned-parts.js";

/**
 * Baked skeletal animation, checked against three.js itself.
 *
 * The claim in skinned-parts.ts is that a vertex skinned from the baked texture
 * lands exactly where three.js's own CPU skinning puts it. These tests do not
 * trust the claim: they build a real rig with awkward transforms at every level
 * -- a moved and rotated root, an offset armature, a mesh that is not at the
 * origin -- play a real clip, and compare every vertex both ways.
 *
 * The GPU side is emulated in `skin` below, reading the texture's float data
 * exactly as the shader in model-parts.ts does: row per frame, four texels per
 * bone, column-major. If the packing or the maths were wrong anywhere, the two
 * would disagree here rather than on screen as a subtly broken walk.
 */

interface Rig {
  root: THREE.Group;
  mesh: THREE.SkinnedMesh;
  clip: THREE.AnimationClip;
  rest: Array<{ position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }>;
}

/** A two-bone arm: a column of boxes, weighted along its height, that bends. */
function rig(): Rig {
  const geometry = new THREE.BoxGeometry(0.2, 1, 0.2, 1, 6, 1);
  geometry.translate(0, 0.5, 0);
  const position = geometry.getAttribute("position");
  const indices: number[] = [];
  const weights: number[] = [];
  for (let i = 0; i < position.count; i++) {
    // A soft joint in the middle: the blend between bones is where skinning bugs
    // show, so every vertex near the knee uses both.
    const upper = THREE.MathUtils.clamp((position.getY(i) - 0.3) / 0.4, 0, 1);
    indices.push(0, 1, 0, 0);
    weights.push(1 - upper, upper, 0, 0);
  }
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));

  const root = new THREE.Group();
  root.position.set(2, 0.5, -1);
  root.rotation.y = 0.7;

  const armature = new THREE.Group();
  armature.position.set(0.3, 0, 0.1);
  root.add(armature);

  const hip = new THREE.Bone();
  hip.name = "hip";
  const knee = new THREE.Bone();
  knee.name = "knee";
  knee.position.y = 0.5;
  hip.add(knee);
  armature.add(hip);

  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial({ name: "body" }));
  mesh.position.set(0.1, 0.05, 0);
  armature.add(mesh);

  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([hip, knee]));

  const bend = (angle: number): number[] =>
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle).toArray();
  const clip = new THREE.AnimationClip("walk", 1, [
    new THREE.QuaternionKeyframeTrack("knee.quaternion", [0, 0.5, 1], [...bend(0), ...bend(1.1), ...bend(0)]),
    new THREE.QuaternionKeyframeTrack("hip.quaternion", [0, 1], [...bend(0.2), ...bend(-0.3)]),
  ]);

  const rest = [hip, knee].map((bone) => ({
    position: bone.position.clone(),
    quaternion: bone.quaternion.clone(),
    scale: bone.scale.clone(),
  }));
  return { root, mesh, clip, rest };
}

/** Skin one vertex from the baked texture, the way the vertex shader does. */
function skin(bake: AnimationBake, frame: number, index: number[], weight: number[], v: THREE.Vector3): THREE.Vector3 {
  const width = bake.bones * 4;
  const bone = (b: number, row: number): THREE.Matrix4 => {
    const offset = (row * width + b * 4) * 4;
    return new THREE.Matrix4().fromArray(bake.data, offset);
  };
  const row = Math.floor(frame);
  const t = frame - row;
  const pose = new Float32Array(16);
  for (let k = 0; k < 4; k++) {
    const a = bone(index[k], row).elements;
    const b = bone(index[k], row + 1).elements;
    for (let e = 0; e < 16; e++) pose[e] += weight[k] * (a[e] * (1 - t) + b[e] * t);
  }
  return v.clone().applyMatrix4(new THREE.Matrix4().fromArray(pose));
}

/** Where three.js itself puts every vertex at `time` into the clip, in world space. */
function cpu(r: Rig, time: number): THREE.Vector3[] {
  const mixer = new THREE.AnimationMixer(r.root);
  mixer.clipAction(r.clip).play();
  mixer.setTime(time);
  r.root.updateMatrixWorld(true);
  const out: THREE.Vector3[] = [];
  const count = r.mesh.geometry.getAttribute("position").count;
  for (let i = 0; i < count; i++) {
    out.push(r.mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(r.mesh.matrixWorld));
  }
  mixer.stopAllAction();
  // Back to the pose the rig was built in -- by restoring each bone's local
  // transform, not with skeleton.pose(); see the note in bakeAnimations.
  r.mesh.skeleton.bones.forEach((bone, b) => {
    bone.position.copy(r.rest[b].position);
    bone.quaternion.copy(r.rest[b].quaternion);
    bone.scale.copy(r.rest[b].scale);
  });
  r.root.updateMatrixWorld(true);
  return out;
}

/** Where three.js puts every vertex with no clip playing: the bind pose. */
function bindPose(r: Rig): THREE.Vector3[] {
  r.root.updateMatrixWorld(true);
  const out: THREE.Vector3[] = [];
  const count = r.mesh.geometry.getAttribute("position").count;
  for (let i = 0; i < count; i++) {
    out.push(r.mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(r.mesh.matrixWorld));
  }
  return out;
}

/** Every vertex from the bake, in the same world space. */
function gpu(r: Rig, bake: AnimationBake, frame: number): THREE.Vector3[] {
  const g = r.mesh.geometry;
  const position = g.getAttribute("position");
  const skinIndex = g.getAttribute("skinIndex");
  const skinWeight = g.getAttribute("skinWeight");
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < position.count; i++) {
    // Vertices go into bind-pose world space first, exactly as toSkinnedParts
    // moves the geometry before it is merged.
    const bound = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(r.mesh.bindMatrix);
    const index = [0, 1, 2, 3].map((k) => skinIndex.getComponent(i, k));
    const weight = [0, 1, 2, 3].map((k) => skinWeight.getComponent(i, k));
    out.push(skin(bake, frame, index, weight, bound));
  }
  return out;
}

function maxError(a: THREE.Vector3[], b: THREE.Vector3[]): number {
  return Math.max(...a.map((v, i) => v.distanceTo(b[i])));
}

describe("bakeAnimations", () => {
  it("puts every vertex exactly where three.js's own skinning does, on a baked frame", () => {
    const r = rig();
    const bake = bakeAnimations(r.root, r.mesh, [r.clip]);
    const walk = bake.clips.get("walk")!;

    for (const f of [0, 7, 15, 22, 29]) {
      const error = maxError(gpu(r, bake, walk.start + f), cpu(r, f / BAKE_FPS));
      expect(error, `frame ${f}`).toBeLessThan(1e-5);
    }
  });

  it("stays within a hair of it between baked frames", () => {
    // The shader blends matrices between adjacent rows. That is not exact for a
    // rotation, but at thirty frames a second the difference is far below a
    // pixel for a unit this size -- and this pins down how far below.
    const r = rig();
    const bake = bakeAnimations(r.root, r.mesh, [r.clip]);
    const walk = bake.clips.get("walk")!;
    const error = maxError(gpu(r, bake, walk.start + 7.5), cpu(r, 7.5 / BAKE_FPS));
    expect(error).toBeLessThan(2e-3);
  });

  it("follows a loop with a copy of its first frame, so the wrap is seamless", () => {
    const r = rig();
    const bake = bakeAnimations(r.root, r.mesh, [r.clip]);
    const walk = bake.clips.get("walk")!;
    const width = bake.bones * 4 * 4;
    const first = bake.data.slice(walk.start * width, (walk.start + 1) * width);
    const extra = bake.data.slice((walk.start + walk.frames) * width, (walk.start + walk.frames + 1) * width);
    expect(Array.from(extra)).toEqual(Array.from(first));
  });

  it("follows a one-shot with its final pose, and does not loop it", () => {
    const r = rig();
    const fire = r.clip.clone();
    fire.name = "fire";
    const bake = bakeAnimations(r.root, r.mesh, [fire]);
    const clip = bake.clips.get("fire")!;
    expect(clip.loop).toBe(false);
    // Through frameAt, as the renderer does: it holds a finished one-shot a hair
    // short of the final row, so the shader never reads past the texture.
    const error = maxError(gpu(r, bake, frameAt(clip, fire.duration)), cpu(r, fire.duration));
    expect(error).toBeLessThan(1e-3);
  });

  it("packs several clips into contiguous rows", () => {
    const r = rig();
    const idle = r.clip.clone();
    idle.name = "idle";
    idle.duration = 2;
    const bake = bakeAnimations(r.root, r.mesh, [r.clip, idle]);
    const walk = bake.clips.get("walk")!;
    const rest = bake.clips.get("idle")!;
    expect(walk.start).toBe(0);
    expect(rest.start).toBe(walk.frames + 1);
    expect(bake.rows).toBe(walk.frames + 1 + rest.frames + 1);
    expect(bake.texture.image.height).toBe(bake.rows);
  });

  it("still draws a rig with no animation at all", () => {
    const r = rig();
    const bake = bakeAnimations(r.root, r.mesh, []);
    const rest = bake.clips.get("rest")!;
    // Against the bind pose itself. A clip's first frame is not the bind pose --
    // this rig's walk starts with the hip already bent.
    expect(maxError(gpu(r, bake, rest.start), bindPose(r))).toBeLessThan(1e-5);
  });

  it("leaves every bone exactly as it found it", () => {
    // What a baked clip must not do is leave the rig mid-stride, or -- as
    // skeleton.pose() did -- with the armature's offset applied twice.
    const r = rig();
    const before = bindPose(r);
    bakeAnimations(r.root, r.mesh, [r.clip]);
    expect(maxError(bindPose(r), before)).toBeLessThan(1e-6);
    r.mesh.skeleton.bones.forEach((bone, b) => {
      expect(bone.position.distanceTo(r.rest[b].position)).toBeLessThan(1e-9);
      expect(bone.quaternion.angleTo(r.rest[b].quaternion)).toBeLessThan(1e-9);
    });
  });
});

describe("frameAt", () => {
  const loop = { name: "walk", start: 10, frames: 30, duration: 1, loop: true };
  const once = { name: "fire", start: 50, frames: 9, duration: 0.3, loop: false };

  it("wraps a loop", () => {
    expect(frameAt(loop, 0)).toBe(10);
    expect(frameAt(loop, 1.5)).toBeCloseTo(10 + 15, 5);
    expect(frameAt(loop, -0.1)).toBeCloseTo(10 + 27, 5);
  });

  it("holds a one-shot just short of its final row", () => {
    // row + 1 is the final pose, so this shows the end of the clip without the
    // shader ever reading past it.
    expect(frameAt(once, 10)).toBeLessThan(50 + 9);
    expect(frameAt(once, 10)).toBeGreaterThan(50 + 8.99);
  });
});

describe("structure clips", () => {
  it("never loop a construction or a release", () => {
    const r = rig();
    const build = r.clip.clone();
    build.name = "build";
    const release = r.clip.clone();
    release.name = "release";
    const bake = bakeAnimations(r.root, r.mesh, [build, release]);
    expect(bake.clips.get("build")!.loop).toBe(false);
    expect(bake.clips.get("release")!.loop).toBe(false);
  });
});

describe("toSkinnedParts", () => {
  it("keeps the skin weights and moves geometry into bind-pose world space", () => {
    const r = rig();
    const { parts } = toSkinnedParts(r.root, [r.clip]);
    expect(parts).toHaveLength(1);
    const g = parts[0].geometry;
    expect(g.getAttribute("skinIndex")).toBeDefined();
    expect(g.getAttribute("skinWeight")).toBeDefined();
    expect(g.getAttribute(TEAM_MASK)).toBeDefined();

    // The first vertex of the un-indexed source, moved by the bind matrix.
    const source = r.mesh.geometry.toNonIndexed();
    const expected = new THREE.Vector3().fromBufferAttribute(source.getAttribute("position"), 0).applyMatrix4(r.mesh.bindMatrix);
    const actual = new THREE.Vector3().fromBufferAttribute(g.getAttribute("position"), 0);
    expect(actual.distanceTo(expected)).toBeLessThan(1e-6);
  });

  it("puts the skinning shader on the material", () => {
    const r = rig();
    const { parts } = toSkinnedParts(r.root, [r.clip]);
    expect(parts[0].material.customProgramCacheKey()).toBe("rts-team-mask-skinned");
  });

  it("leaves out, and names, anything that is not skinned", () => {
    const r = rig();
    const rifle = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    rifle.name = "rifle";
    r.mesh.skeleton.bones[1].add(rifle);
    const warnings: string[] = [];
    const { parts } = toSkinnedParts(r.root, [r.clip], (m) => warnings.push(m));
    expect(parts).toHaveLength(1);
    expect(warnings.join()).toContain('"rifle" is not skinned');
  });
});

describe("readSquad", () => {
  it("is a single figure unless the file says otherwise", () => {
    expect(readSquad(new THREE.Group())).toBe(SINGLE);
  });

  it("converts Blender's axes: its +Y is the unit's left, which is -Z here", () => {
    const root = new THREE.Group();
    root.userData.rts_squad = [0.2, 0.15, 0, -0.1, -0.2, 0.33];
    expect(readSquad(root)).toEqual([
      { x: 0.2, z: -0.15, phase: 0 },
      { x: -0.1, z: 0.2, phase: 0.33 },
    ]);
  });

  it("falls back to one figure, with a warning, on a malformed list", () => {
    const root = new THREE.Group();
    root.userData.rts_squad = [0.2, 0.15];
    const warnings: string[] = [];
    expect(readSquad(root, (m) => warnings.push(m))).toBe(SINGLE);
    expect(warnings.join()).toContain("three per figure");
  });
});
