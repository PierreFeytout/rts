import {
  ARMOUR_HEAVY,
  CAN_ATTACK,
  CAN_GATHER,
  CAN_PRODUCE,
  IS_DROPOFF,
  KIND_BUILDING,
  KIND_RESOURCE,
  type EntityType,
} from "@rts/sim";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TEAM_MASK, applyTeamMask, type ModelPart, type RoleName, ROLE_NAMES } from "./model-parts.js";

/**
 * The built-in silhouettes: what anything without an authored model is drawn as.
 *
 * Authored `.glb` models replace these one type at a time -- see
 * model-library.ts for the lookup and assets/models/README.md for the rules --
 * and nothing is ever *required* to have one. These are the floor.
 *
 * **Models are chosen by what a unit IS, not by what it is called.** A
 * harvester gets the harvester silhouette because it has the `gather`
 * behaviour, a brawler because its weapon is short-ranged. That means a race
 * added tomorrow gets sensible, readable models with no art and no code -- the
 * same principle that makes the rest of the content system work, applied to the
 * one part of it that would otherwise need a hand-written table per race.
 *
 * Everything faces +X at rest, matching the BAM convention documented in
 * coords.ts, and sits with its base on y = 0 so instance transforms need no
 * per-model offset.
 */

/** Indices into the geometry list. Order is arbitrary but must stay stable. */
export const MODEL_WORKER = 0;
export const MODEL_BRAWLER = 1;
export const MODEL_RANGED = 2;
export const MODEL_SCOUT = 3;
export const MODEL_HEAVY = 4;
export const MODEL_HQ = 5;
export const MODEL_FACTORY = 6;
export const MODEL_TURRET = 7;
export const MODEL_EXTRACTOR = 8;
export const MODEL_SUPPORT = 9;
export const MODEL_CRYSTAL = 10;
export const MODEL_COUNT = 11;

/** The role's name, which is also how an authored model is filed for it. */
export function roleName(model: number): RoleName {
  return ROLE_NAMES[model];
}

/** Whether a role stands in for a structure, which is authored in a unit box. */
export function isStructureRole(model: number): boolean {
  return model >= MODEL_HQ;
}

/** Weapon range, in tiles, above which a unit reads as "ranged" rather than a brawler. */
const RANGED_TILES = 3;
/**
 * Speed, in Q16.16 tiles per tick, above which a unit reads as a fast mover.
 *
 * 0.17 per tick is 3.4 tiles a second. Without this class the Vanguard's Scout
 * and Trooper both landed on the ranged silhouette and were indistinguishable
 * on the field, which for two units with different jobs is a real readability
 * failure rather than a cosmetic one.
 */
const FAST_SPEED = 0.17 * 65536;

/**
 * Which silhouette a type should be drawn with.
 *
 * Deliberately total: every type resolves to something, because a unit that
 * fails to pick a model would simply not be drawn, which is the single most
 * confusing failure a renderer can have.
 */
export function modelFor(type: EntityType): number {
  if (type.kind === KIND_RESOURCE) return MODEL_CRYSTAL;

  if (type.kind === KIND_BUILDING) {
    // Ordered by how strongly each property defines the building's role. A
    // producer that also receives alloy is the headquarters; a producer that
    // does not is a factory; the rest are support. Both shipped races fall out
    // of this correctly without either being named.
    if ((type.abilities & CAN_ATTACK) !== 0) return MODEL_TURRET;
    if ((type.abilities & CAN_PRODUCE) !== 0) {
      return (type.abilities & IS_DROPOFF) !== 0 ? MODEL_HQ : MODEL_FACTORY;
    }
    if (type.plasmaPerSecond > 0) return MODEL_EXTRACTOR;
    return MODEL_SUPPORT;
  }

  if ((type.abilities & CAN_GATHER) !== 0) return MODEL_WORKER;
  if (type.armour === ARMOUR_HEAVY) return MODEL_HEAVY;
  if (type.moveSpeed > FAST_SPEED) return MODEL_SCOUT;
  if (type.range > RANGED_TILES * 65536) return MODEL_RANGED;
  return MODEL_BRAWLER;
}

/**
 * Build every silhouette once, as parts ready for the team shader.
 *
 * Indexed by the MODEL_* constants. Geometries and materials are shared by every
 * instance of a model and by the portrait studio, so this runs once per process.
 */
export function buildModels(): ModelPart[][] {
  const material = new THREE.MeshStandardMaterial({
    name: "procedural",
    roughness: 0.62,
    metalness: 0.35,
    flatShading: true,
    vertexColors: true,
  });
  applyTeamMask(material);

  const models = new Array<THREE.BufferGeometry>(MODEL_COUNT);
  models[MODEL_WORKER] = worker();
  models[MODEL_BRAWLER] = brawler();
  models[MODEL_RANGED] = ranged();
  models[MODEL_SCOUT] = scout();
  models[MODEL_HEAVY] = heavy();
  models[MODEL_HQ] = hq();
  models[MODEL_FACTORY] = factory();
  models[MODEL_TURRET] = turret();
  models[MODEL_EXTRACTOR] = extractor();
  models[MODEL_SUPPORT] = support();
  models[MODEL_CRYSTAL] = crystal();
  return models.map((geometry) => [{ geometry, material }]);
}

/**
 * How a piece of a silhouette is painted.
 *
 * Linear values, which is what three.js assumes vertex colours are. `hull` is
 * warm iron from the palette, lifted enough to read under the low key light;
 * `dark` is for barrels, vents and anything that should read as a hole; `team`
 * is the 45% grey that the team shader turns into exactly the owner's colour.
 */
type Paint = "hull" | "dark" | "team";

const PAINT: Record<Paint, { colour: [number, number, number]; mask: number }> = {
  hull: { colour: [0.144, 0.11, 0.08], mask: 0 },
  dark: { colour: [0.027, 0.022, 0.019], mask: 0 },
  team: { colour: [0.45, 0.45, 0.45], mask: 1 },
};

// ---------------------------------------------------------------------------
// Units. Roughly 0.6-0.9 world units long, so they read at the default zoom
// without crowding each other out of their collision radii.
// ---------------------------------------------------------------------------

/** Squat hauler with two side pods: reads as a working vehicle, not a soldier. */
function worker(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.52, 0.26, 0.34);
  body.translate(0, 0.22, 0);
  // A wedge nose, so facing is legible even when the unit is stationary.
  const nose = new THREE.ConeGeometry(0.17, 0.26, 4);
  nose.rotateZ(-Math.PI / 2);
  nose.translate(0.36, 0.22, 0);

  const podL = new THREE.BoxGeometry(0.3, 0.16, 0.12);
  podL.translate(-0.05, 0.18, 0.24);
  const podR = podL.clone();
  podR.translate(0, 0, -0.48);

  return merge([[body, "hull"], [nose, "team"], [podL, "team"], [podR, "team"]]);
}

/** Short, wide and forward-leaning: something that wants to be close. */
function brawler(): THREE.BufferGeometry {
  const torso = new THREE.CylinderGeometry(0.2, 0.26, 0.42, 6);
  torso.translate(0, 0.26, 0);
  const head = new THREE.ConeGeometry(0.2, 0.3, 6);
  head.rotateZ(-Math.PI / 2);
  head.translate(0.26, 0.4, 0);
  const skirt = new THREE.CylinderGeometry(0.3, 0.32, 0.1, 6);
  skirt.translate(0, 0.06, 0);
  return merge([[torso, "hull"], [head, "team"], [skirt, "dark"]]);
}

/** Slim, with a long barrel. Its reach is the thing worth reading at a glance. */
function ranged(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.16, 0.2, 0.44, 5);
  body.translate(0, 0.28, 0);
  const barrel = new THREE.CylinderGeometry(0.05, 0.05, 0.5, 5);
  barrel.rotateZ(-Math.PI / 2);
  barrel.translate(0.3, 0.34, 0);
  const base = new THREE.CylinderGeometry(0.22, 0.24, 0.09, 5);
  base.translate(0, 0.05, 0);
  return merge([[body, "team"], [barrel, "dark"], [base, "hull"]]);
}

/** Low, swept and outriggered. Reads as speed rather than firepower. */
function scout(): THREE.BufferGeometry {
  const hull = new THREE.ConeGeometry(0.2, 0.72, 3);
  hull.rotateZ(-Math.PI / 2);
  hull.scale(1, 0.55, 1);
  hull.translate(0.06, 0.24, 0);
  const finL = new THREE.BoxGeometry(0.34, 0.05, 0.1);
  finL.translate(-0.16, 0.2, 0.22);
  const finR = finL.clone();
  finR.translate(0, 0, -0.44);
  const vane = new THREE.BoxGeometry(0.16, 0.22, 0.04);
  vane.translate(-0.28, 0.32, 0);
  return merge([[hull, "hull"], [finL, "team"], [finR, "team"], [vane, "team"]]);
}

/** Wide hull, raised turret, thick gun. Unmistakably the expensive one. */
function heavy(): THREE.BufferGeometry {
  const hull = new THREE.BoxGeometry(0.78, 0.22, 0.6);
  hull.translate(0, 0.16, 0);
  const glacis = new THREE.ConeGeometry(0.3, 0.3, 4);
  glacis.rotateZ(-Math.PI / 2);
  // Squashed to the hull's height. At full radius the plate hung 0.14 below
  // the ground, and every heavy unit in the game had been sinking into the
  // terrain unnoticed until the model contract was checked against it.
  glacis.scale(1, 0.5, 1);
  glacis.translate(0.5, 0.16, 0);
  const turretBlock = new THREE.BoxGeometry(0.4, 0.2, 0.4);
  turretBlock.translate(-0.04, 0.36, 0);
  const gun = new THREE.CylinderGeometry(0.07, 0.08, 0.56, 6);
  gun.rotateZ(-Math.PI / 2);
  gun.translate(0.38, 0.38, 0);
  return merge([[hull, "hull"], [glacis, "hull"], [turretBlock, "team"], [gun, "dark"]]);
}

// ---------------------------------------------------------------------------
// Buildings. Modelled inside a 1x1x1 box anchored on the ground, so the
// renderer can scale a whole model by its footprint with no other maths.
// ---------------------------------------------------------------------------

/** Broad plinth with a stepped tower: the thing you look for first on a map. */
function hq(): THREE.BufferGeometry {
  const plinth = new THREE.BoxGeometry(0.98, 0.34, 0.98);
  plinth.translate(0, 0.17, 0);
  const mid = new THREE.BoxGeometry(0.7, 0.3, 0.7);
  mid.translate(0, 0.48, 0);
  const cap = new THREE.CylinderGeometry(0.3, 0.36, 0.26, 6);
  cap.translate(0, 0.75, 0);
  const mast = new THREE.CylinderGeometry(0.04, 0.04, 0.36, 4);
  mast.translate(0, 1.03, 0);
  return merge([[plinth, "hull"], [mid, "team"], [cap, "hull"], [mast, "dark"]]);
}

/** A long hall with a vented roof. Reads as industry rather than command. */
function factory(): THREE.BufferGeometry {
  const hall = new THREE.BoxGeometry(0.96, 0.44, 0.8);
  hall.translate(0, 0.22, 0);
  const roof = new THREE.CylinderGeometry(0.4, 0.4, 0.9, 6, 1, false, 0, Math.PI);
  roof.rotateZ(Math.PI / 2);
  roof.scale(1, 1, 0.55);
  roof.translate(0, 0.44, 0);
  const stack = new THREE.CylinderGeometry(0.07, 0.09, 0.34, 5);
  stack.translate(-0.3, 0.72, 0.26);
  return merge([[hall, "hull"], [roof, "team"], [stack, "dark"]]);
}

/** Small base, tall pivot, gun. Obviously a weapon and obviously static. */
function turret(): THREE.BufferGeometry {
  const base = new THREE.CylinderGeometry(0.42, 0.5, 0.24, 8);
  base.translate(0, 0.12, 0);
  const post = new THREE.CylinderGeometry(0.18, 0.22, 0.34, 6);
  post.translate(0, 0.4, 0);
  const head = new THREE.SphereGeometry(0.26, 8, 6);
  head.translate(0, 0.62, 0);
  const gun = new THREE.CylinderGeometry(0.06, 0.06, 0.5, 5);
  gun.rotateZ(-Math.PI / 2);
  // Kept inside the footprint. It used to reach past the edge, which put the
  // barrel through whatever was built on the next tile.
  gun.translate(0.26, 0.66, 0);
  return merge([[base, "hull"], [post, "hull"], [head, "team"], [gun, "dark"]]);
}

/** A capped drum with an offtake pipe: obviously plumbing, obviously on a vent. */
function extractor(): THREE.BufferGeometry {
  const pad = new THREE.BoxGeometry(0.96, 0.14, 0.96);
  pad.translate(0, 0.07, 0);
  const drum = new THREE.CylinderGeometry(0.34, 0.38, 0.46, 8);
  drum.translate(0, 0.37, 0);
  const cap = new THREE.SphereGeometry(0.34, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.translate(0, 0.6, 0);
  const pipe = new THREE.CylinderGeometry(0.09, 0.09, 0.5, 6);
  pipe.rotateZ(Math.PI / 2);
  // Inside the footprint, for the same reason as the turret's barrel.
  pipe.translate(0.24, 0.24, 0.26);
  return merge([[pad, "dark"], [drum, "hull"], [cap, "team"], [pipe, "hull"]]);
}

/** Low, wide and unremarkable. Support buildings should not draw the eye. */
function support(): THREE.BufferGeometry {
  const slab = new THREE.BoxGeometry(0.9, 0.3, 0.9);
  slab.translate(0, 0.15, 0);
  const fin = new THREE.BoxGeometry(0.18, 0.5, 0.72);
  fin.translate(0.16, 0.4, 0);
  const light = new THREE.OctahedronGeometry(0.14, 0);
  light.translate(-0.26, 0.44, 0);
  return merge([[slab, "hull"], [fin, "team"], [light, "team"]]);
}

/** A cluster of shards rather than one crystal, so patches read as terrain. */
function crystal(): THREE.BufferGeometry {
  const main = new THREE.OctahedronGeometry(0.42, 0);
  main.scale(1, 1.5, 1);
  // Its lower point sat 0.13 below the ground, and the model contract says a
  // base rests on y = 0 -- the rule an artist will be held to has to hold for
  // the placeholder too, or it is not a rule.
  main.translate(0, 0.63, 0);
  const a = new THREE.OctahedronGeometry(0.24, 0);
  a.scale(1, 1.4, 1);
  a.translate(0.34, 0.28, 0.18);
  const b = new THREE.OctahedronGeometry(0.19, 0);
  b.scale(1, 1.3, 1);
  b.translate(-0.3, 0.22, -0.24);
  // Painted all over: scenery's "team" colour is neutral or vent, and that colour
  // is the whole of how the two are told apart. The scale that used to be
  // applied at draw time lives here now, because the renderer scales every
  // structure by its footprint in exactly one way.
  const merged = merge([[main, "team"], [a, "team"], [b, "team"]]);
  merged.scale(0.62, 0.62, 0.62);
  return merged;
}

/**
 * Merge parts into one geometry.
 *
 * One geometry per model is what keeps a model instanced: four hundred units
 * drawn as four hundred three-part groups would be twelve hundred draw calls,
 * where four hundred merged instances are one.
 */
function merge(painted: Array<[THREE.BufferGeometry, Paint]>): THREE.BufferGeometry {
  const parts = painted.map(([geometry]) => geometry);
  // Everything is un-indexed first. `mergeGeometries` requires that all inputs
  // either have an index buffer or none do, and three.js primitives disagree:
  // Box, Cylinder, Cone and Sphere are indexed, while the polyhedra
  // (Octahedron, Icosahedron) are not. Mixing one polyhedron into a model built
  // from boxes throws, and the throw happens during scene construction -- so
  // the whole game fails to start over a decorative shard.
  //
  // Normalising here rather than at each call site keeps `merge` total: adding
  // a part should not require knowing which primitives three.js indexes.
  // Un-indexed also suits the flat shading these models are drawn with.
  const flat = painted.map(([part, paint]) => {
    const geometry = part.index ? part.toNonIndexed() : part;
    // Only the attributes every authored model also carries, so a procedural
    // part and a loaded one are interchangeable to everything downstream.
    for (const name of Object.keys(geometry.attributes)) {
      if (!["position", "normal", "uv"].includes(name)) geometry.deleteAttribute(name);
    }
    const count = geometry.getAttribute("position").count;
    const { colour, mask } = PAINT[paint];
    const colours = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colours.set(colour, i * 3);
    geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    geometry.setAttribute(TEAM_MASK, new THREE.BufferAttribute(new Float32Array(count).fill(mask), 1));
    return geometry;
  });
  const merged = mergeGeometries(flat, false);
  for (const part of parts) part.dispose();
  for (const part of flat) if (!parts.includes(part)) part.dispose();
  if (!merged) throw new Error("models: geometry merge failed");
  merged.computeBoundingSphere();
  return merged;
}
