import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import calibrationUrl from "./__fixtures__/blender-calibration.glb?inline";
import { TEAM_MASK, checkContract, toParts } from "./model-parts.js";

/**
 * The model pipeline, against a real file from a real exporter.
 *
 * Every other model test builds its scene by hand to look like what the loader
 * produces. This one does not trust that: the fixture was exported by Blender
 * 5.2's own glTF add-on, and it goes through the real GLTFLoader. It exists to
 * pin down the things assets/models/README.md *claims* about Blender, which
 * were written before any model had been exported and are exactly the kind of
 * claim that is wrong in a way nobody notices until a unit drives sideways.
 *
 * The calibration model is built to answer four questions at once:
 *
 *   - a nose pointing along Blender +X          -> which way is forward
 *   - a marker on Blender +Y only               -> is anything mirrored
 *   - a band on its own material, masked        -> does the mask survive the
 *                                                  exporter splitting by material
 *   - a base resting exactly on z = 0           -> is up still up
 *
 * The file also contains Blender's default cube, exported by accident because
 * it was selected in another scene. It is kept on purpose: it is the most
 * likely real mistake an export will contain, and the last test here records
 * what it actually does -- which is not what anybody would guess.
 */

function load(): Promise<GLTF> {
  const base64 = calibrationUrl.slice(calibrationUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(bytes.buffer, "", resolve, reject);
  });
}

/** The calibration model alone, as if it had been exported cleanly. */
async function calibration(): Promise<THREE.Object3D> {
  const gltf = await load();
  const node = gltf.scene.getObjectByName("calibration");
  if (!node) throw new Error("fixture has no calibration node");
  const root = new THREE.Group();
  root.add(node);
  return root;
}

function bounds(parts: ReturnType<typeof toParts>): THREE.Box3 {
  const box = new THREE.Box3();
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    box.union(part.geometry.boundingBox!);
  }
  return box;
}

describe("a model exported from Blender 5.2", () => {
  it("really is one", async () => {
    const gltf = await load();
    expect(gltf.asset.generator).toMatch(/Khronos glTF Blender I\/O v5\.2/);
  });

  it("keeps up as up: the base lands on y = 0", async () => {
    const box = bounds(toParts(await calibration()));
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.max.y).toBeCloseTo(0.4, 5);
  });

  it("keeps forward as forward: Blender +X is the game's +X", async () => {
    // The nose reaches 0.56 forward and the hull only 0.3 back.
    const box = bounds(toParts(await calibration()));
    expect(box.max.x).toBeCloseTo(0.56, 5);
    expect(box.min.x).toBeCloseTo(-0.3, 5);
  });

  it("is not mirrored: Blender +Y comes out as -Z", async () => {
    // The marker is on one side only. A handedness flip anywhere between the
    // exporter and the loader would put it on +Z, and every asymmetric model --
    // a gun on the right shoulder, a hatch on the left -- would be backwards.
    // The other side stops at 0.21, the edge of the team band.
    const box = bounds(toParts(await calibration()));
    expect(box.min.z).toBeCloseTo(-0.32, 5);
    expect(box.max.z).toBeCloseTo(0.21, 5);
  });

  it("carries the team mask through the split into one part per material", async () => {
    const parts = toParts(await calibration());
    expect(parts.map((p) => p.material.name).sort()).toEqual(["calib_hull", "calib_paint"]);

    const values = (name: string): Set<number> => {
      const part = parts.find((p) => p.material.name === name)!;
      const mask = part.geometry.getAttribute(TEAM_MASK);
      return new Set(Array.from({ length: mask.count }, (_, i) => mask.getX(i)));
    };
    // The exporter writes `_TEAMMASK` on each primitive it creates, and the
    // loader lowercases it; if either step dropped it, both would read as 0.
    expect(values("calib_paint")).toEqual(new Set([1]));
    expect(values("calib_hull")).toEqual(new Set([0]));
  });

  it("passes the model contract", async () => {
    expect(checkContract(toParts(await calibration()), "unit")).toEqual([]);
  });

  it("loads only the first scene of a file that has several", async () => {
    // What actually happened to the stray cube. Blender's exporter writes one
    // glTF scene per Blender scene that has something selected, and the loader
    // builds only the default one -- so the cube is dead bytes rather than a
    // box welded to the model.
    //
    // Harmless here, and a trap in general: which Blender scene becomes the
    // default is not something an artist chooses, and when it is the wrong one
    // the wrong model loads with no error at all. The model library warns about
    // any file with more than one scene for exactly that reason.
    const gltf = await load();
    expect(gltf.scenes).toHaveLength(2);
    expect(gltf.scene.getObjectByName("Cube")).toBeUndefined();
    expect(gltf.scenes[1].getObjectByName("Cube")).toBeDefined();
  });
});
