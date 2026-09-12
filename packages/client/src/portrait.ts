import type { EntityType } from "@rts/sim";
import * as THREE from "three";
import { buildModels, modelFor } from "./models.js";

/**
 * Portraits and command icons, rendered from the unit's own model.
 *
 * StarCraft paints a bust for every unit. There is nobody here to paint one, and
 * more importantly there must not need to be: the whole content system is built
 * so that adding a race costs one data file and no art. A hand-drawn icon set
 * would be the first thing to break that promise.
 *
 * So a portrait is a render of the same mesh that is standing on the map, in a
 * small lit box of its own, and a command icon is the same thing at a third of
 * the size. Adding a race gets correct portraits for free, and the day the
 * procedural silhouettes are replaced by real models, every portrait and icon in
 * the game improves without this file changing.
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
let studio: Studio | null = null;

interface Studio {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  geometries: THREE.BufferGeometry[];
}

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

  const material = new THREE.MeshStandardMaterial({
    roughness: 0.55,
    metalness: 0.25,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  scene.add(mesh);

  // Three-quarter view from slightly above. Straight on reads as an elevation
  // drawing; from directly above, every silhouette in the game is a blob.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(4, 3.2, 5);
  camera.lookAt(0, 0, 0);

  studio = { renderer, scene, camera, mesh, material, geometries: buildModels() };
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
export function portraitFor(type: EntityType, colour: number, size = PORTRAIT_PX): string {
  const model = modelFor(type);
  const key = `${model}:${colour}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const s = open();
  const geometry = s.geometries[model];

  // Frame the model from its own bounds rather than from a constant. The
  // silhouettes range from a drone to a headquarters, and one camera distance
  // for both leaves one filling the frame and the other a speck in it.
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const extent = Math.max(
    box.max.x - box.min.x,
    box.max.y - box.min.y,
    box.max.z - box.min.z,
    0.001,
  );
  // A little air around it, so nothing touches the frame.
  const half = extent * 0.72;
  s.camera.left = -half;
  s.camera.right = half;
  s.camera.top = half;
  s.camera.bottom = -half;
  s.camera.updateProjectionMatrix();

  s.mesh.geometry = geometry;
  // Centre on the model's middle, not its origin: models sit with their base on
  // y = 0 so they stand correctly on the ground, which puts a tall building
  // entirely in the top half of the frame.
  const centre = new THREE.Vector3();
  box.getCenter(centre);
  s.mesh.position.set(-centre.x, -centre.y, -centre.z);
  s.material.color.setHex(colour);

  s.renderer.setSize(size, size, false);
  s.renderer.render(s.scene, s.camera);
  const url = s.renderer.domElement.toDataURL("image/png");

  cache.set(key, url);
  return url;
}

/** The same thing at command-card size. */
export function iconFor(type: EntityType, colour: number): string {
  return portraitFor(type, colour, ICON_PX);
}
