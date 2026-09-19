import type { EntityType } from "@rts/sim";
import { KIND_BUILDING, KIND_RESOURCE } from "@rts/sim";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  checkContract,
  proceduralKey,
  resolveModelKey,
  toParts,
  type ModelKind,
  type ModelPart,
} from "./model-parts.js";
import { MODEL_COUNT, buildModels, isStructureRole, modelFor, roleName } from "./models.js";
import {
  NO_SMOKE,
  SINGLE,
  isSkinned,
  readSmoke,
  toSkinnedParts,
  type AnimationBake,
  type SmokePoint,
  type SquadSlot,
} from "./skinned-parts.js";

/**
 * Every model the game can draw, authored or procedural, loaded once.
 *
 * Authored models are `.glb` files in packages/client/assets/models/, named for
 * what they replace -- see the README there. Any that exist are picked up at
 * build time; none are required. Whatever has no file is drawn as its built-in
 * silhouette, so the game is always complete and art arrives one unit at a time.
 *
 * Loading is at startup, alongside the terrain textures,
 * rather than when a match begins. Parsing models takes long enough to be a
 * visible hitch, and the moment it would otherwise land is when the player has
 * just pressed Start.
 */

/**
 * The files, by name without extension, resolved to URLs by Vite at build time.
 *
 * A glob rather than a list, so adding a model is dropping a file in a folder:
 * nothing to register, and nothing that can drift out of step with what is on
 * disk. A folder with nothing in it is simply an empty map.
 */
const FILES = import.meta.glob<string>("../assets/models/*.glb", {
  eager: true,
  query: "?url",
  import: "default",
});

export interface Model {
  /** `vanguard.drone`, `vanguard@worker`, or `procedural@worker`. */
  readonly key: string;
  readonly parts: readonly ModelPart[];
  /** Authored in a unit box and scaled to its footprint by the renderer. */
  readonly structure: boolean;
  readonly authored: boolean;
  /** Present for a rigged model: its clips, baked. See skinned-parts.ts. */
  readonly animation?: AnimationBake;
  /** Where its figures stand. One figure at the centre unless the file says so. */
  readonly squad: readonly SquadSlot[];
  /** Where its stacks smoke. Nowhere unless the file says so. */
  readonly smoke: readonly SmokePoint[];
}

export interface ModelLibrary {
  /** The model a type is drawn with. Always succeeds. */
  forType(type: EntityType): Model;
  /** Every model that was loaded from a file, for diagnostics. */
  readonly authored: readonly string[];
}

let pending: Promise<ModelLibrary> | null = null;

/**
 * Load the models once, for the life of the process.
 *
 * `contentIdOf` turns a type id back into its content id -- `vanguard.drone` --
 * which is what an authored file is named after. Passed in rather than imported
 * so this file does not decide which content set the game is running.
 */
export function loadModels(contentIdOf: (typeId: number) => string): Promise<ModelLibrary> {
  pending ??= build(contentIdOf);
  return pending;
}

async function build(contentIdOf: (typeId: number) => string): Promise<ModelLibrary> {
  const models = new Map<string, Model>();

  // The floor: every role has a silhouette before a single file is read.
  const procedural = buildModels();
  for (let role = 0; role < MODEL_COUNT; role++) {
    const key = proceduralKey(roleName(role));
    models.set(key, {
      key,
      parts: procedural[role],
      structure: isStructureRole(role),
      authored: false,
      squad: SINGLE,
      smoke: NO_SMOKE,
    });
  }

  const loader = new GLTFLoader();
  const entries = Object.entries(FILES).map(([path, url]) => ({
    key: path.slice(path.lastIndexOf("/") + 1, -".glb".length),
    url,
  }));

  await Promise.all(
    entries.map(async ({ key, url }) => {
      try {
        const gltf = await loader.loadAsync(url);
        if (gltf.scenes.length > 1) {
          // Blender writes one glTF scene per Blender scene that has anything
          // selected, and only the default one is loaded. Which one that is was
          // never the artist's choice, so when it is wrong the wrong model loads
          // with no error -- this is the only place it can be noticed.
          console.warn(
            `[rts] model ${key}: file contains ${gltf.scenes.length} scenes; only the first ` +
              `("${gltf.scene.name}") is used. Export from a single scene.`,
          );
        }
        const warn = (message: string): void => console.warn(`[rts] model ${key}: ${message}`);

        if (isSkinned(gltf.scene)) {
          // Rigged: bake every clip into a texture now, once, rather than
          // animating skeletons on the CPU for every figure every frame.
          const skinned = toSkinnedParts(gltf.scene, gltf.animations, warn);
          models.set(key, {
            key,
            parts: skinned.parts,
            structure: false,
            authored: true,
            animation: skinned.bake,
            squad: skinned.squad,
            smoke: readSmoke(gltf.scene, warn),
          });
          console.info(
            `[rts] model ${key}: ${skinned.bake.bones} bones, clips ${[...skinned.bake.clips.keys()].join(", ")}` +
              (skinned.squad.length > 1 ? `, squad of ${skinned.squad.length}` : ""),
          );
          return;
        }

        const parts = toParts(gltf.scene, warn);
        if (parts.length === 0) {
          console.warn(`[rts] model ${key}: no meshes; using the built-in silhouette`);
          return;
        }
        models.set(key, {
          key,
          parts,
          structure: false,
          authored: true,
          squad: SINGLE,
          smoke: readSmoke(gltf.scene, warn),
        });
      } catch (error) {
        // A broken file costs its own model, not the game. The silhouette it
        // would have replaced is still there.
        console.warn(`[rts] model ${key}: failed to load; using the built-in silhouette`, error);
      }
    }),
  );

  const available = new Set(models.keys());
  const byType = new Map<number, Model>();
  /** Each authored model is checked once, against the first type drawn with it. */
  const checked = new Set<string>();

  const authored = [...models.values()].filter((m) => m.authored).map((m) => m.key).sort();
  console.info(
    authored.length > 0
      ? `[rts] models: ${authored.length} authored (${authored.join(", ")})`
      : "[rts] models: none authored, every type uses its built-in silhouette",
  );

  return {
    authored,

    forType(type: EntityType): Model {
      const hit = byType.get(type.id);
      if (hit) return hit;

      const role = modelFor(type);
      const key = resolveModelKey(contentIdOf(type.id), roleName(role), available);
      const found = models.get(key)!;

      // Whether a model is a structure is a property of what it is drawn *for*,
      // not of the file -- the same rules have to apply to a Directorate Bastion
      // and to the procedural HQ it replaced.
      const structure = type.kind === KIND_BUILDING || type.kind === KIND_RESOURCE;
      const model: Model = found.authored ? { ...found, structure } : found;

      if (model.authored && !checked.has(key)) {
        checked.add(key);
        const kind: ModelKind = structure ? "structure" : "unit";
        for (const issue of checkContract(model.parts, kind, model.squad)) {
          console.warn(`[rts] model ${key}: ${issue}`);
        }
      }

      byType.set(type.id, model);
      return model;
    },
  };
}
