import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  GLTF_TEAM_MASK,
  PART_BUDGET,
  TEAM_MASK,
  TRIANGLE_BUDGET,
  checkContract,
  proceduralKey,
  resolveModelKey,
  toParts,
} from "./model-parts.js";
import { MODEL_COUNT, buildModels } from "./models.js";

/**
 * Turning authored models into instanceable parts, and choosing which model a
 * type is drawn with.
 *
 * All of it pure three.js, so it runs here without a GPU. The scenes are built
 * by hand to look like what GLTFLoader produces -- a hierarchy of meshes with
 * transforms, standard materials, and a lowercased `_teammask` attribute --
 * because the loader is the one piece that needs a browser, and everything it
 * hands over is what these tests feed in directly.
 */

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number] = [0, 0, 0],
): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(...position);
  return m;
}

function masked(geometry: THREE.BufferGeometry, value: number): THREE.BufferGeometry {
  const count = geometry.getAttribute("position").count;
  geometry.setAttribute(GLTF_TEAM_MASK, new THREE.BufferAttribute(new Float32Array(count).fill(value), 1));
  return geometry;
}

describe("resolveModelKey", () => {
  const role = "worker" as const;

  it("prefers a model made for the exact type", () => {
    const available = new Set(["vanguard.drone", "vanguard@worker"]);
    expect(resolveModelKey("vanguard.drone", role, available)).toBe("vanguard.drone");
  });

  it("falls back to the race's model for the role", () => {
    // A gatherer added to the Directorate next month is drawn as a Directorate
    // gatherer before anybody has modelled it.
    const available = new Set(["vanguard@worker"]);
    expect(resolveModelKey("vanguard.harvester-mk2", role, available)).toBe("vanguard@worker");
  });

  it("does not borrow another race's look", () => {
    const available = new Set(["vanguard@worker"]);
    expect(resolveModelKey("concord.sporeling", role, available)).toBe(proceduralKey(role));
  });

  it("always ends at the built-in silhouette", () => {
    // The promise the content system is built on: a new race is playable with
    // no art at all.
    expect(resolveModelKey("newrace.anything", role, new Set())).toBe("procedural@worker");
  });
});

describe("toParts", () => {
  it("merges every mesh that shares a material into one part", () => {
    const iron = new THREE.MeshStandardMaterial({ name: "iron" });
    const root = new THREE.Group();
    root.add(mesh(new THREE.BoxGeometry(1, 1, 1), iron));
    root.add(mesh(new THREE.BoxGeometry(1, 1, 1), iron, [2, 0, 0]));

    const parts = toParts(root);
    expect(parts).toHaveLength(1);
    // Two boxes, twelve triangles each, un-indexed.
    expect(parts[0].geometry.getAttribute("position").count).toBe(72);
  });

  it("gives each material its own part", () => {
    const root = new THREE.Group();
    root.add(mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ name: "hull" })));
    root.add(mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ name: "glass" })));
    expect(toParts(root)).toHaveLength(2);
  });

  it("bakes the hierarchy's transforms into the vertices", () => {
    // A turret parented to a hull, as it would be built in Blender.
    const material = new THREE.MeshStandardMaterial();
    const hull = mesh(new THREE.BoxGeometry(1, 1, 1), material, [0, 0.5, 0]);
    const turret = mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), material, [0, 1, 0]);
    hull.add(turret);
    const root = new THREE.Group();
    root.add(hull);

    const [part] = toParts(root);
    part.geometry.computeBoundingBox();
    // Hull top at 1.0; the turret sits a further unit above the hull's centre,
    // so its top is at 0.5 + 1 + 0.1.
    expect(part.geometry.boundingBox!.max.y).toBeCloseTo(1.6, 5);
  });

  it("turns a mirrored object right side out", () => {
    // An object scaled by -1 inverts every triangle; the symptom is a model
    // that renders as its own inside.
    const material = new THREE.MeshStandardMaterial();
    const normal = mesh(new THREE.BoxGeometry(), material);
    const mirrored = mesh(new THREE.BoxGeometry(), material);
    mirrored.scale.set(-1, 1, 1);

    const winding = (object: THREE.Mesh): number => {
      const root = new THREE.Group();
      root.add(object);
      const [part] = toParts(root);
      const p = part.geometry.getAttribute("position");
      const a = new THREE.Vector3().fromBufferAttribute(p, 0);
      const b = new THREE.Vector3().fromBufferAttribute(p, 1);
      const c = new THREE.Vector3().fromBufferAttribute(p, 2);
      const n = new THREE.Vector3().fromBufferAttribute(part.geometry.getAttribute("normal"), 0);
      const face = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      return Math.sign(face.dot(n));
    };

    expect(winding(mirrored)).toBe(winding(normal));
  });

  it("carries the team mask across under the name the shader reads", () => {
    const root = new THREE.Group();
    root.add(mesh(masked(new THREE.BoxGeometry(), 1), new THREE.MeshStandardMaterial()));

    const [part] = toParts(root);
    expect(part.geometry.getAttribute(GLTF_TEAM_MASK)).toBeUndefined();
    expect(part.geometry.getAttribute(TEAM_MASK).getX(0)).toBe(1);
  });

  it("fills in what a file left out, so parts from different tools still merge", () => {
    // One mesh with no uvs, no colours and no mask; one with all three. Merging
    // them only works if both come out with the same attribute set.
    const material = new THREE.MeshStandardMaterial();
    const bare = new THREE.BoxGeometry();
    bare.deleteAttribute("uv");
    const full = masked(new THREE.BoxGeometry(), 0.5);
    full.setAttribute("color", new THREE.BufferAttribute(new Float32Array(24 * 4).fill(1), 4));

    const root = new THREE.Group();
    root.add(mesh(bare, material));
    root.add(mesh(full, material, [2, 0, 0]));

    const [part] = toParts(root);
    const names = Object.keys(part.geometry.attributes).sort();
    expect(names).toEqual(["color", "normal", "position", "teamMask", "uv"]);
    expect(part.geometry.getAttribute("color").itemSize).toBe(3);
  });

  it("warns rather than failing on a material that is not physically based", () => {
    const warnings: string[] = [];
    const root = new THREE.Group();
    root.add(mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ name: "flat" })));

    const [part] = toParts(root, (m) => warnings.push(m));
    expect(part.material.isMeshStandardMaterial).toBe(true);
    expect(warnings.join()).toContain("not physically based");
  });

  it("puts the team shader on every material", () => {
    const root = new THREE.Group();
    root.add(mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    const [part] = toParts(root);
    expect(part.material.customProgramCacheKey()).toBe("rts-team-mask");
    expect(part.material.vertexColors).toBe(true);
  });
});

describe("checkContract", () => {
  function partsFrom(geometry: THREE.BufferGeometry, mask = 1): ReturnType<typeof toParts> {
    const root = new THREE.Group();
    root.add(mesh(masked(geometry, mask), new THREE.MeshStandardMaterial()));
    return toParts(root);
  }

  /** A box of the given size, sitting on the ground. */
  function standing(w: number, h: number, d: number): THREE.BufferGeometry {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    return g;
  }

  it("accepts a unit that follows the rules", () => {
    expect(checkContract(partsFrom(standing(0.7, 0.4, 0.5)), "unit")).toEqual([]);
  });

  it("catches a model sunk below the ground", () => {
    expect(checkContract(partsFrom(new THREE.BoxGeometry(0.5, 0.5, 0.5)), "unit").join()).toContain(
      "below the origin",
    );
  });

  it("catches a structure authored at its real size instead of in a unit box", () => {
    // The most likely mistake, and it produces a building four times too big
    // once the renderer scales it by a footprint of two.
    const issues = checkContract(partsFrom(standing(2, 1, 2)), "structure");
    expect(issues.join()).toContain("1 x 1 footprint");
  });

  it("catches a unit too big to fit through a gap", () => {
    expect(checkContract(partsFrom(standing(2.5, 0.5, 0.5)), "unit").join()).toContain("across");
  });

  it("catches a model with no team colour on it", () => {
    expect(checkContract(partsFrom(standing(0.5, 0.5, 0.5), 0), "unit").join()).toContain(
      "nobody will be able to tell whose it is",
    );
  });

  it("catches a model over its triangle budget", () => {
    const heavy = standing(0.5, 0.5, 0.5);
    const dense = new THREE.SphereGeometry(0.3, 160, 160);
    dense.translate(0, 0.3, 0);
    const issues = checkContract(partsFrom(dense), "unit");
    expect(TRIANGLE_BUDGET.unit).toBeLessThan(160 * 160 * 2);
    expect(issues.join()).toContain("budget");
    heavy.dispose();
  });

  it("catches too many materials", () => {
    const root = new THREE.Group();
    for (let i = 0; i <= PART_BUDGET; i++) {
      root.add(mesh(masked(standing(0.2, 0.2, 0.2), 1), new THREE.MeshStandardMaterial()));
    }
    expect(checkContract(toParts(root), "unit").join()).toContain("materials");
  });
});

describe("the built-in silhouettes", () => {
  it("exist for every role and pass their own contract", () => {
    // They are the floor under every authored model. If they break the rules
    // an artist is held to, the rules are wrong.
    const models = buildModels();
    expect(models).toHaveLength(MODEL_COUNT);
    models.forEach((parts, role) => {
      const kind = role >= 5 ? "structure" : "unit";
      expect(checkContract(parts, kind), `role ${role}`).toEqual([]);
    });
  });
});
