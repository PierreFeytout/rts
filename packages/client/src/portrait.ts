import type { EntityType } from "@rts/sim";
import * as THREE from "three";
import type { ModelLibrary } from "./model-library.js";
import { teamAttributes } from "./model-parts.js";
import { frameAt } from "./skinned-parts.js";

/**
 * Portraits and command icons, rendered from the unit's own model.
 *
 * StarCraft paints a bust for every unit. There is nobody here to paint one, and
 * more importantly there must not need to be: the whole content system is built
 * so that adding a race costs one data file and no art. A hand-drawn icon set
 * would be the first thing to break that promise.
 *
 * So a portrait is a render of the same model that is standing on the map, in a
 * small lit box of its own, and a command icon is the same thing at a third of
 * the size. It draws whatever the model library draws -- an authored `.glb` when
 * one exists, the built-in silhouette when it does not -- so a new model shows
 * up in the command card the moment its file does.
 *
 * Rendered once per (model, team colour, size) and cached as a data URL. There
 * is no per-frame cost at all -- the results are `background-image` on ordinary
 * DOM buttons.
 */

/** Rendered size in device pixels. CSS scales them down, so they stay crisp. */
const PORTRAIT_PX = 192;
const ICON_PX = 96;

/**
 * A second WebGL context, deliberately.
 *
 * The alternative is rendering into a target on the main renderer and reading
 * it back, which means either stalling the pipeline on a `readPixels` or
 * threading a render-target lifetime through the match screen. This renderer is
 * tiny, draws perhaps twenty frames across an entire match, and outlives every
 * match -- so it is created once and never torn down.
 */
interface Studio {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  stage: THREE.Group;
}

let studio: Studio | null = null;

function open(): Studio {
  if (studio) return studio;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    // `toDataURL` reads the drawing buffer, which the browser is otherwise free
    // to discard the moment the draw call returns. Without this the portraits
    // come out blank on some machines and not others, which is the worst kind
    // of bug to be told about second-hand.
    preserveDrawingBuffer: true,
  });
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();

  // The same light language as the world, so a portrait looks like the thing it
  // is a portrait of: a low warm key, and one cold rim to lift the silhouette
  // off a background that is nearly the same value. See UNIVERSE.md.
  scene.add(new THREE.AmbientLight(0x3a2c22, 1.3));
  const key = new THREE.DirectionalLight(0xe8a04a, 2.6);
  key.position.set(-3, 2.4, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6a8ab0, 1.2);
  rim.position.set(2.5, 3, -2.5);
  scene.add(rim);

  const stage = new THREE.Group();
  scene.add(stage);

  // Three-quarter view from slightly above. Straight on reads as an elevation
  // drawing; from directly above, every silhouette in the game is a blob.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(4, 3.2, 5);
  camera.lookAt(0, 0, 0);

  studio = { renderer, scene, camera, stage };
  return studio;
}

const cache = new Map<string, string>();

/**
 * A portrait of `type` in `colour`, as a data URL.
 *
 * `colour` is the owning player's team colour, so a portrait says whose unit it
 * is at a glance -- which matters most in exactly the case a portrait is least
 * useful otherwise, an enemy unit selected by clicking on it.
 */
export function portraitFor(
  library: ModelLibrary,
  type: EntityType,
  colour: number,
  size = PORTRAIT_PX,
): string {
  const model = library.forType(type);
  const cacheKey = `${model.key}:${colour}:${size}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  const s = open();
  const tint = new THREE.Color().setHex(colour);

  // Frame the model from its own bounds rather than from a constant. Models
  // range from a worker to a headquarters, and one camera distance for both
  // leaves one filling the frame and the other a speck in it.
  const box = new THREE.Box3();
  const meshes: THREE.InstancedMesh[] = [];
  for (const part of model.parts) {
    // A clone, because the per-instance buffers go on the geometry and the
    // world renderer draws the same library geometry with buffers of its own.
    const geometry = part.geometry.clone();
    const { team, shade } = teamAttributes(1);
    team.setXYZ(0, tint.r, tint.g, tint.b);
    geometry.setAttribute("instanceTeam", team);
    geometry.setAttribute("instanceShade", shade);
    if (model.animation) {
      // A rigged model is shown standing at ease, whatever the unit is doing --
      // a portrait frozen mid-stride reads as a rendering glitch. A squad is
      // shown as one of its figures: at portrait size, one soldier is a soldier,
      // three are a smudge.
      const rest = model.animation.clips.get("idle") ?? model.animation.clips.values().next().value!;
      const pose = new THREE.InstancedBufferAttribute(new Float32Array([frameAt(rest, 0), 0, 0]), 3);
      geometry.setAttribute("instanceAnimation", pose);
    }
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox!);

    // Instanced even for one copy: the team shader reads per-instance
    // attributes, and a plain mesh would feed it zeros and draw a black unit.
    const mesh = new THREE.InstancedMesh(geometry, part.material, 1);
    mesh.setMatrixAt(0, new THREE.Matrix4());
    mesh.frustumCulled = false;
    meshes.push(mesh);
    s.stage.add(mesh);
  }

  const extent = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z, 0.001);
  // A little air around it, so nothing touches the frame.
  const half = extent * 0.72;
  s.camera.left = -half;
  s.camera.right = half;
  s.camera.top = half;
  s.camera.bottom = -half;
  s.camera.updateProjectionMatrix();

  // Centre on the model's middle, not its origin: models sit with their base on
  // y = 0 so they stand correctly on the ground, which puts a tall building
  // entirely in the top half of the frame.
  const centre = new THREE.Vector3();
  box.getCenter(centre);
  s.stage.position.set(-centre.x, -centre.y, -centre.z);

  s.renderer.setSize(size, size, false);
  s.renderer.render(s.scene, s.camera);
  const url = s.renderer.domElement.toDataURL("image/png");

  for (const mesh of meshes) {
    s.stage.remove(mesh);
    mesh.geometry.dispose();
  }

  cache.set(cacheKey, url);
  return url;
}

/** The same thing at command-card size. */
export function iconFor(library: ModelLibrary, type: EntityType, colour: number): string {
  return portraitFor(library, type, colour, ICON_PX);
}
