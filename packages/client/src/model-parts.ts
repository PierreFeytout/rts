import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Models as the renderer needs them, whatever they were authored in.
 *
 * A model is a list of **parts**, one per material, each a single merged
 * geometry. That is the shape instanced rendering wants: every part becomes one
 * `InstancedMesh`, so a 400-unit battle costs one draw call per part per model
 * on screen rather than one per unit.
 *
 * Everything in this file is pure three.js with no DOM and no loader, so it runs
 * under the test suite. Loading lives in model-library.ts.
 *
 * The rules an authored model has to follow are written down for the people
 * making them in packages/client/assets/models/README.md. This file is where
 * those rules are enforced -- and enforced as warnings rather than failures,
 * because a model that is slightly too big is still a better thing to show
 * than a missing unit.
 */

export interface ModelPart {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
}

/**
 * Whether a model stands in for something that moves or something that is
 * built. The two have different size rules: units are authored in world units
 * at their real size, structures inside a unit box that the renderer scales to
 * their footprint.
 */
export type ModelKind = "unit" | "structure";

/** What the renderer and the team-colour shader expect every part to carry. */
export const TEAM_MASK = "teamMask";

/**
 * The attribute name an authored file uses for the team-colour mask.
 *
 * glTF only carries custom vertex attributes whose names begin with an
 * underscore, and three.js lowercases unrecognised ones on load. Blender's
 * exporter writes `_TEAMMASK` when "Attributes" is enabled; it arrives here as
 * `_teammask`, and is renamed on the way in -- a GLSL identifier beginning with
 * an underscore is legal but invites exactly the kind of reserved-name bug
 * nobody wants to debug inside a shader.
 */
export const GLTF_TEAM_MASK = "_teammask";

// ---------------------------------------------------------------------------
// Which model draws which type
// ---------------------------------------------------------------------------

/** The procedural silhouette roles, by name. Order matches models.ts. */
export const ROLE_NAMES = [
  "worker",
  "brawler",
  "ranged",
  "scout",
  "heavy",
  "hq",
  "factory",
  "turret",
  "extractor",
  "support",
  "resource",
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

/** The key a procedural fallback is stored under. Never a file name. */
export function proceduralKey(role: RoleName): string {
  return `procedural@${role}`;
}

/**
 * Pick the most specific model that exists for a type.
 *
 *   1. `vanguard.drone`     -- a model made for this exact unit
 *   2. `vanguard@worker`    -- this race's look for anything in that role
 *   3. `procedural@worker`  -- the built-in silhouette, which always exists
 *
 * The middle step is what keeps a faction looking like itself as it grows: a
 * gatherer added to the Directorate next month is drawn as a Directorate
 * gatherer rather than as a teal primitive, before anyone has modelled it.
 *
 * The last step is what keeps the promise the whole content system is built on.
 * A race added tomorrow needs no art to be playable -- it gets silhouettes that
 * are chosen by what its units do, exactly as every unit did before there were
 * any models at all.
 */
export function resolveModelKey(
  contentId: string,
  role: RoleName,
  available: ReadonlySet<string>,
): string {
  if (available.has(contentId)) return contentId;
  const dot = contentId.indexOf(".");
  if (dot > 0) {
    const raceRole = `${contentId.slice(0, dot)}@${role}`;
    if (available.has(raceRole)) return raceRole;
  }
  return proceduralKey(role);
}

// ---------------------------------------------------------------------------
// Turning a loaded scene into parts
// ---------------------------------------------------------------------------

/**
 * Flatten a scene graph into one merged geometry per material.
 *
 * Every mesh's world transform is baked into its vertices, so a model built as
 * a hierarchy in Blender -- a turret parented to a hull, a mirrored copy -- comes
 * out as plain triangles in model space. That is what makes it instanceable,
 * and it is also why rigid-part animation is not supported yet: once the
 * turret is baked into the hull, it cannot turn on its own.
 */
export function toParts(root: THREE.Object3D, warn: (message: string) => void = () => {}): ModelPart[] {
  root.updateMatrixWorld(true);

  const byMaterial = new Map<string, { material: THREE.Material; pieces: THREE.BufferGeometry[] }>();

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if ((mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) {
      warn(`"${mesh.name}" is skinned; skeletons are not supported yet and it is drawn in bind pose`);
    }

    let material = mesh.material;
    if (Array.isArray(material)) {
      // glTF splits multi-material meshes into one primitive per material on
      // export, so this is rare -- but silently dropping the other materials
      // would lose whole panels of a model with no clue why.
      warn(`"${mesh.name}" has ${material.length} materials on one mesh; only the first is used`);
      material = material[0];
    }

    const piece = normalise(mesh.geometry, mesh.matrixWorld);
    const entry = byMaterial.get(material.uuid);
    if (entry) entry.pieces.push(piece);
    else byMaterial.set(material.uuid, { material, pieces: [piece] });
  });

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
    parts.push({ geometry, material: standardise(material, warn) });
  }
  return parts;
}

/**
 * One mesh's geometry, in model space, with exactly the attributes every part
 * shares.
 *
 * `mergeGeometries` refuses inputs whose attribute sets, item sizes or array
 * types differ, and files exported from different tools -- or from the same
 * tool on different days -- disagree about all three. So everything is made
 * the same here: un-indexed, float, and carrying position, normal, uv, colour
 * and team mask whether or not the source had them.
 */
export function normalise(
  source: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  keepSkin = false,
): THREE.BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source.clone();

  // Skin weights survive only for a skinned model. On anything else they would
  // be attributes no shader reads, and attributes that make otherwise identical
  // parts refuse to merge.
  const kept = ["position", "normal", "uv", "color", GLTF_TEAM_MASK];
  if (keepSkin) kept.push("skinIndex", "skinWeight");
  for (const name of Object.keys(geometry.attributes)) {
    if (!kept.includes(name)) geometry.deleteAttribute(name);
  }
  for (const name of Object.keys(geometry.attributes)) {
    geometry.setAttribute(name, toFloat(geometry.getAttribute(name)));
  }

  geometry.applyMatrix4(matrix);
  // A mirrored transform turns every triangle inside out. Blender's mirror
  // *modifier* produces correct geometry, but an object scaled by -1 does not,
  // and the symptom -- a model that renders as its own inside -- looks like a
  // shader bug rather than a transform one.
  if (matrix.determinant() < 0) flipWinding(geometry);

  const count = geometry.getAttribute("position").count;
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  if (!geometry.getAttribute("uv")) {
    geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }

  const colour = geometry.getAttribute("color");
  if (!colour) {
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  } else if (colour.itemSize === 4) {
    const rgb = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      rgb[i * 3] = colour.getX(i);
      rgb[i * 3 + 1] = colour.getY(i);
      rgb[i * 3 + 2] = colour.getZ(i);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(rgb, 3));
  }

  const mask = geometry.getAttribute(GLTF_TEAM_MASK);
  const values = new Float32Array(count);
  if (mask) {
    for (let i = 0; i < count; i++) values[i] = mask.getX(i);
    geometry.deleteAttribute(GLTF_TEAM_MASK);
  }
  geometry.setAttribute(TEAM_MASK, new THREE.BufferAttribute(values, 1));

  return geometry;
}

/** Any attribute as plain `Float32Array`, denormalising packed integers. */
function toFloat(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const { count, itemSize } = attribute;
  const out = new Float32Array(count * itemSize);
  for (let i = 0; i < count; i++) {
    // `getComponent` applies the normalisation a packed attribute carries, which
    // reading the underlying array directly would not.
    for (let c = 0; c < itemSize; c++) out[i * itemSize + c] = attribute.getComponent(i, c);
  }
  return new THREE.BufferAttribute(out, itemSize);
}

function flipWinding(geometry: THREE.BufferGeometry): void {
  for (const attribute of Object.values(geometry.attributes)) {
    const size = attribute.itemSize;
    const array = attribute.array as Float32Array;
    for (let v = 0; v + 2 < attribute.count; v += 3) {
      for (let c = 0; c < size; c++) {
        const a = (v + 1) * size + c;
        const b = (v + 2) * size + c;
        const t = array[a];
        array[a] = array[b];
        array[b] = t;
      }
    }
  }
}

/**
 * Everything drawn as a physically based material, with the team shader on.
 *
 * glTF materials arrive as `MeshStandardMaterial` or its physical subclass, and
 * both are kept as they are. An unlit export is converted rather than refused:
 * a model that renders flat is a better problem to be told about than one that
 * does not render.
 */
export function standardise(
  material: THREE.Material,
  warn: (message: string) => void,
  skinning?: THREE.Texture,
): THREE.MeshStandardMaterial {
  let standard: THREE.MeshStandardMaterial;
  if ((material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
    standard = material as THREE.MeshStandardMaterial;
  } else {
    warn(`material "${material.name}" is not physically based; converted, and it will look different`);
    const basic = material as THREE.MeshBasicMaterial;
    standard = new THREE.MeshStandardMaterial({
      name: material.name,
      color: basic.color ?? new THREE.Color(0xffffff),
      map: basic.map ?? null,
      roughness: 0.8,
    });
  }
  // Every part carries a colour attribute after `normalise`, white where the
  // file had none, so turning vertex colours on is always safe.
  standard.vertexColors = true;
  applyTeamMask(standard, skinning);
  return standard;
}

// ---------------------------------------------------------------------------
// Team colour
// ---------------------------------------------------------------------------

/**
 * Paint team colour only where a model says it is painted.
 *
 * Before this, the owner's colour was multiplied into the whole model, which is
 * why every unit in the game was a teal blob. A real RTS unit is dark metal
 * with a stripe of team colour on it -- the stripe tells you whose it is, and
 * the metal tells you what it is.
 *
 * Three inputs, all per vertex or per instance so nothing here costs a draw
 * call:
 *
 *   - `teamMask` (per vertex, from the model) -- 0 is bare material, 1 is paint
 *   - `instanceTeam` (per instance) -- the owner's colour
 *   - `instanceShade` (per instance) -- fog and construction, which used to be
 *     multiplied into the instance colour and now cannot be, because the
 *     instance colour is no longer the whole of the surface colour
 *
 * The paint takes its brightness from the surface under it, so worn, dirty or
 * shadowed paint in a texture stays worn, dirty and shadowed in every team's
 * colour. Masked areas authored at about 45% grey come out as the pure team
 * colour; darker comes out darker.
 */
export function applyTeamMask(material: THREE.MeshStandardMaterial, skinning?: THREE.Texture): void {
  material.onBeforeCompile = (shader) => {
    if (skinning) shader.uniforms.rtsAnimation = { value: skinning };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float ${TEAM_MASK};
attribute vec3 instanceTeam;
attribute float instanceShade;
varying float vTeamMask;
varying vec3 vTeam;
varying float vShade;
${skinning ? SKINNING_DECLARATIONS : ""}`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vTeamMask = ${TEAM_MASK};
vTeam = instanceTeam;
vShade = instanceShade;`,
      );

    if (skinning) {
      // three.js's own skinning chunks sit exactly where this belongs -- after
      // the normal is read, and after the position is -- and do nothing unless
      // USE_SKINNING is defined, which it never is here. Replacing them keeps
      // the order of operations identical to a SkinnedMesh.
      shader.vertexShader = shader.vertexShader
        .replace("#include <skinbase_vertex>", SKINNING_POSE)
        .replace("#include <skinnormal_vertex>", "objectNormal = mat3( rtsSkin ) * objectNormal;")
        .replace("#include <skinning_vertex>", "transformed = ( rtsSkin * vec4( transformed, 1.0 ) ).xyz;");
    }

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying float vTeamMask;
varying vec3 vTeam;
varying float vShade;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  float paintLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 painted = vTeam * clamp(paintLuma * 2.2, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, painted, clamp(vTeamMask, 0.0, 1.0));
  diffuseColor.rgb *= vShade;
}`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
totalEmissiveRadiance *= vShade;`,
      );
  };
  // Every patched material compiles to one of two program shapes, and an unkeyed
  // patch would let three.js hand an unpatched cached program to it instead.
  const key = skinning ? "rts-team-mask-skinned" : "rts-team-mask";
  material.customProgramCacheKey = () => key;
}

/**
 * Skinning from a baked animation texture. See skinned-parts.ts for the layout.
 *
 * One row per baked frame, four texels per bone, each bone's matrix stored
 * column by column -- the same packing three.js uses for its own bone texture,
 * so `mat4( v1, v2, v3, v4 )` reads it back exactly.
 *
 * `instanceAnimation` is per instance: the frame to show (fractional, so it
 * blends to the next row), a second frame, and how far to blend toward that
 * second one. The second pose is what lets a unit that stops walking ease into
 * standing rather than snapping.
 */
const SKINNING_DECLARATIONS = `
uniform highp sampler2D rtsAnimation;
attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute vec3 instanceAnimation;

mat4 rtsBone( const in int bone, const in int row ) {
  int x = bone * 4;
  return mat4(
    texelFetch( rtsAnimation, ivec2( x, row ), 0 ),
    texelFetch( rtsAnimation, ivec2( x + 1, row ), 0 ),
    texelFetch( rtsAnimation, ivec2( x + 2, row ), 0 ),
    texelFetch( rtsAnimation, ivec2( x + 3, row ), 0 )
  );
}

mat4 rtsPose( const in float frame ) {
  int row = int( floor( frame ) );
  float t = fract( frame );
  mat4 pose = mat4( 0.0 );
  for ( int k = 0; k < 4; k++ ) {
    int bone = int( skinIndex[ k ] );
    // Every clip is baked with one extra row, so row + 1 always exists.
    pose += skinWeight[ k ] * ( rtsBone( bone, row ) * ( 1.0 - t ) + rtsBone( bone, row + 1 ) * t );
  }
  return pose;
}
`;

const SKINNING_POSE = `
mat4 rtsSkin = rtsPose( instanceAnimation.x );
if ( instanceAnimation.z > 0.0 ) {
  rtsSkin = rtsSkin * ( 1.0 - instanceAnimation.z ) + rtsPose( instanceAnimation.y ) * instanceAnimation.z;
}
`;

/**
 * The per-instance attributes the team shader reads, sized for `capacity`.
 *
 * Returned rather than attached, because every part of one model shares the
 * same pair: they are the same instances, and writing the team colour once per
 * part per unit per frame would be work for nothing.
 */
export function teamAttributes(capacity: number): {
  team: THREE.InstancedBufferAttribute;
  shade: THREE.InstancedBufferAttribute;
} {
  const team = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const shade = new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1);
  team.setUsage(THREE.DynamicDrawUsage);
  shade.setUsage(THREE.DynamicDrawUsage);
  return { team, shade };
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

/**
 * Triangles per model before a warning.
 *
 * Generous, because on this renderer triangles are the cheap axis and it is
 * worth spending them. Every copy of a model is one instanced draw call per
 * material whatever its detail, and the skinning is read from a baked texture
 * rather than solved per figure -- so a squad of three at six thousand
 * triangles costs the same number of calls as one at six hundred, and the
 * whole of Cinder Reach's unit cap fits inside a few million triangles.
 *
 * What is actually scarce is `PART_BUDGET` below: materials multiply draw
 * calls, and those are what fall over at four hundred units. So this exists
 * to catch a model that has gone somewhere absurd -- a bevelled sphere per
 * rivet -- and not to stop a unit being detailed.
 */
export const TRIANGLE_BUDGET: Record<ModelKind, number> = { unit: 36000, structure: 36000 };

/** Materials per model before a warning. Each one is a draw call per model on screen. */
export const PART_BUDGET = 4;

/**
 * Check a model against the rules in assets/models/README.md.
 *
 * Returns what is wrong in words an artist can act on, rather than throwing.
 * Every one of these produces a model that loads and looks broken in a specific
 * way, and the message says which way.
 */
export function checkContract(
  parts: readonly ModelPart[],
  kind: ModelKind,
  squad: ReadonlyArray<{ x: number; z: number }> = [{ x: 0, z: 0 }],
): string[] {
  const issues: string[] = [];
  if (parts.length === 0) return ["no meshes"];

  const bounds = new THREE.Box3();
  let triangles = 0;
  let painted = false;
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    bounds.union(part.geometry.boundingBox!);
    triangles += part.geometry.getAttribute("position").count / 3;
    const mask = part.geometry.getAttribute(TEAM_MASK);
    for (let i = 0; i < mask.count && !painted; i++) if (mask.getX(i) > 0.5) painted = true;
  }

  if (triangles > TRIANGLE_BUDGET[kind]) {
    issues.push(`${triangles} triangles, over the ${TRIANGLE_BUDGET[kind]} budget for a ${kind}`);
  }
  if (parts.length > PART_BUDGET) {
    issues.push(`${parts.length} materials, over the budget of ${PART_BUDGET}; merge some`);
  }
  if (bounds.min.y < -0.05) {
    issues.push(
      `extends ${(-bounds.min.y).toFixed(2)} below the origin; the base must sit on y = 0 or it sinks into the ground`,
    );
  }

  if (kind === "structure") {
    const overhang = Math.max(-bounds.min.x, bounds.max.x, -bounds.min.z, bounds.max.z);
    if (overhang > 0.55) {
      issues.push(
        `reaches ${overhang.toFixed(2)} from the centre; a structure is authored inside a 1 x 1 footprint (±0.5) and scaled to its size by the game`,
      );
    }
  } else {
    // A squad is as wide as its figures are spread, plus one figure's width.
    const xs = squad.map((s) => s.x);
    const zs = squad.map((s) => s.z);
    const extent = Math.max(
      Math.max(...xs) + bounds.max.x - (Math.min(...xs) + bounds.min.x),
      Math.max(...zs) + bounds.max.z - (Math.min(...zs) + bounds.min.z),
    );
    if (extent > 1.6) {
      issues.push(`${extent.toFixed(2)} world units across, larger than a unit can be and still fit through a gap`);
    }
  }

  if (!painted) {
    issues.push("no team-coloured area (_TEAMMASK); nobody will be able to tell whose it is");
  }
  return issues;
}
