import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import rigUrl from "./__fixtures__/blender-rig.glb?inline";
import { TEAM_MASK, checkContract } from "./model-parts.js";
import { BAKE_FPS, bakeAnimations, isSkinned, toSkinnedParts, type AnimationBake } from "./skinned-parts.js";

/**
 * The animation pipeline, against a real rigged file from Blender's exporter.
 *
 * skinned-parts.test.ts proves the bake matches three.js on a rig built by hand.
 * This proves the hand-built rig was a fair stand-in: the fixture is written by
 * scripts/models/calibration_rig.py through Blender 5.2's own glTF add-on, with
 * the same kit helpers every rigged unit uses, and what those helpers promise
 * -- clips named and timed as scripted, rigid parts on the right bones, a squad
 * carried as an extra, forward still forward -- is checked here on the result.
 *
 * Regenerate with:
 *   blender -b --factory-startup --python scripts/models/calibration_rig.py
 */

function load(): Promise<GLTF> {
  const base64 = rigUrl.slice(rigUrl.indexOf(",") + 1);
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(bytes.buffer, "", resolve, reject);
  });
}

/** Skin one vertex from the baked texture, the way the vertex shader does. */
function skin(bake: AnimationBake, frame: number, index: number[], weight: number[], v: THREE.Vector3): THREE.Vector3 {
  const width = bake.bones * 4;
  const row = Math.floor(frame);
  const t = frame - row;
  const pose = new Float32Array(16);
  for (let k = 0; k < 4; k++) {
    const a = bake.data.subarray((row * width + index[k] * 4) * 4);
    const b = bake.data.subarray(((row + 1) * width + index[k] * 4) * 4);
    for (let e = 0; e < 16; e++) pose[e] += weight[k] * (a[e] * (1 - t) + b[e] * t);
  }
  return v.clone().applyMatrix4(new THREE.Matrix4().fromArray(pose));
}

/** Every vertex of a merged part, posed at `frame`. */
function posed(bake: AnimationBake, geometry: THREE.BufferGeometry, frame: number): THREE.Vector3[] {
  const position = geometry.getAttribute("position");
  const skinIndex = geometry.getAttribute("skinIndex");
  const skinWeight = geometry.getAttribute("skinWeight");
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < position.count; i++) {
    const index = [0, 1, 2, 3].map((k) => skinIndex.getComponent(i, k));
    const weight = [0, 1, 2, 3].map((k) => skinWeight.getComponent(i, k));
    out.push(skin(bake, frame, index, weight, new THREE.Vector3().fromBufferAttribute(position, i)));
  }
  return out;
}

async function parts() {
  const gltf = await load();
  const warnings: string[] = [];
  const skinned = toSkinnedParts(gltf.scene, gltf.animations, (m) => warnings.push(m));
  const byMaterial = new Map(skinned.parts.map((p) => [p.material.name, p]));
  return { gltf, skinned, warnings, byMaterial };
}

describe("a rigged model exported by Blender", () => {
  it("loads as one skinned model with every scripted clip, timed as scripted", async () => {
    const { gltf, skinned, warnings } = await parts();
    expect(gltf.scenes).toHaveLength(1);
    expect(isSkinned(gltf.scene)).toBe(true);
    expect(warnings).toEqual([]);
    expect(skinned.bake.bones).toBe(5);

    const clips = skinned.bake.clips;
    expect([...clips.keys()].sort()).toEqual(["fire", "idle", "walk"]);
    // Keyed at 30 fps in Blender, baked at 30 fps here: a scripted frame is a
    // baked row, which is what lets a model script time a recoil in frames.
    expect(BAKE_FPS).toBe(30);
    expect(clips.get("idle")).toMatchObject({ frames: 30, loop: true });
    expect(clips.get("walk")).toMatchObject({ frames: 20, loop: true });
    expect(clips.get("fire")).toMatchObject({ frames: 9, loop: false });
  });

  it("carries the squad through as an extra, in the game's axes", async () => {
    const { skinned } = await parts();
    expect(skinned.squad).toHaveLength(3);
    expect(skinned.squad[0]).toEqual({ x: 0.2, z: -0, phase: 0 });
    // Blender +Y (left) is -Z in the game.
    expect(skinned.squad[1].z).toBeCloseTo(-0.15, 5);
    expect(skinned.squad[2].z).toBeCloseTo(0.15, 5);
    expect(skinned.squad[1].phase).toBeCloseTo(0.33, 5);
  });

  it("keeps the team mask on the painted part, and passes the contract as a squad", async () => {
    const { skinned, byMaterial } = await parts();
    const paint = byMaterial.get("paint")!.geometry.getAttribute(TEAM_MASK);
    const iron = byMaterial.get("iron")!.geometry.getAttribute(TEAM_MASK);
    expect(Math.min(...Array.from(paint.array))).toBe(1);
    expect(Math.max(...Array.from(iron.array))).toBe(0);
    expect(checkContract(skinned.parts, "unit", skinned.squad)).toEqual([]);
  });

  it("applied the bevel: a modifier other than the armature reaches the game", async () => {
    // Twelve triangles for a plain box. The chest was bevelled before binding;
    // with the modifier left unapplied it would have been exported as a box.
    const { byMaterial } = await parts();
    const iron = byMaterial.get("iron")!.geometry;
    const triangles = iron.getAttribute("position").count / 3;
    expect(triangles).toBeGreaterThan(24);
  });

  it("is posed by the bake exactly as three.js poses the file itself", async () => {
    // End to end on real exported data: Blender's bone axes, its inverse bind
    // matrices and its sampled keys, against three.js's own CPU skinning.
    const gltf = await load();
    const meshes: THREE.SkinnedMesh[] = [];
    gltf.scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
    });
    gltf.scene.updateMatrixWorld(true);
    const bake = bakeAnimations(gltf.scene, meshes[0], gltf.animations);
    const mixer = new THREE.AnimationMixer(gltf.scene);

    for (const [name, frame] of [["walk", 5], ["fire", 2], ["idle", 15]] as const) {
      const clip = bake.clips.get(name)!;
      const action = mixer.clipAction(gltf.animations.find((a) => a.name === name)!);
      action.play();
      mixer.setTime(frame / BAKE_FPS);
      gltf.scene.updateMatrixWorld(true);

      let worst = 0;
      for (const mesh of meshes) {
        const g = mesh.geometry;
        const position = g.getAttribute("position");
        for (let i = 0; i < position.count; i++) {
          const expected = mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
          const bound = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix);
          const index = [0, 1, 2, 3].map((k) => g.getAttribute("skinIndex").getComponent(i, k));
          const weight = [0, 1, 2, 3].map((k) => g.getAttribute("skinWeight").getComponent(i, k));
          worst = Math.max(worst, skin(bake, clip.start + frame, index, weight, bound).distanceTo(expected));
        }
      }
      action.stop();
      expect(worst, `${name} frame ${frame}`).toBeLessThan(1e-5);
    }
  });

  it("faces +X and swings the legs the way the script says", async () => {
    const { skinned, byMaterial } = await parts();
    const { bake } = skinned;
    const idle = bake.clips.get("idle")!;
    const walk = bake.clips.get("walk")!;
    const fire = bake.clips.get("fire")!;

    // The chest plate is on the front of the figure: forward is +X.
    const plate = posed(bake, byMaterial.get("paint")!.geometry, idle.start);
    expect(Math.min(...plate.map((v) => v.x))).toBeGreaterThan(0.03);

    // The dark part holds the arm and both legs. At rest, the arm is the part of
    // it far forward, and the feet are the part of it on the ground.
    const dark = byMaterial.get("dark")!.geometry;
    const rest = posed(bake, dark, idle.start);
    const tips = rest.flatMap((v, i) => (v.x > 0.15 ? [i] : []));
    const feet = (side: number) => rest.flatMap((v, i) => (v.y < 0.01 && Math.sign(v.z) === side ? [i] : []));
    expect(tips.length).toBeGreaterThan(0);

    // Blender's +Y is the figure's left, and left is -Z here. The script swings
    // the left leg by +25 degrees about Y at the start of the walk -- foot back --
    // and the right leg the other way.
    const stride = posed(bake, dark, walk.start);
    const meanX = (vs: THREE.Vector3[], idx: number[]) => idx.reduce((s, i) => s + vs[i].x, 0) / idx.length;
    expect(meanX(stride, feet(-1))).toBeLessThan(meanX(rest, feet(-1)) - 0.03);
    expect(meanX(stride, feet(1))).toBeGreaterThan(meanX(rest, feet(1)) + 0.03);

    // The recoil swings the muzzle about the up axis toward the figure's left.
    const recoil = posed(bake, dark, fire.start + 2);
    const meanZ = (vs: THREE.Vector3[]) => tips.reduce((s, i) => s + vs[i].z, 0) / tips.length;
    expect(meanZ(recoil)).toBeLessThan(meanZ(rest) - 0.02);
  });
});
