import { defaultContent } from "@rts/content";
import { KIND_BUILDING, KIND_RESOURCE } from "@rts/sim";
import * as THREE from "three";
import { GLTFLoader, type GLTF, type GLTFLoaderPlugin } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { ROLE_NAMES, checkContract, toParts, type ModelKind } from "./model-parts.js";

/**
 * Every model the game ships, checked the way the game checks it at load.
 *
 * At load the game only *warns*, because a slightly-off model is a better thing
 * to show than a missing unit. Here the same warnings fail the build, so a bad
 * export is caught by whoever made it rather than noticed weeks later by a
 * player squinting at a unit sunk halfway into the ground.
 *
 * It also catches the quietest failure a model can have: a file named after
 * something that does not exist. The game looks models up by content id, and a
 * file called `vanguard.servitor.glb` -- the display name rather than the id --
 * simply never matches anything, loads nothing and says nothing.
 */

const FILES = import.meta.glob<string>("../assets/models/*.glb", {
  eager: true,
  query: "?inline",
  import: "default",
});

/**
 * Textures are replaced with empty ones.
 *
 * Decoding an embedded image needs a browser, and nothing here looks at pixels
 * -- geometry, materials and the team mask are the whole of the contract. A
 * loader plugin that answers every texture request is how a model with textures
 * still loads under the test runner.
 */
const noTextures: (parser: unknown) => GLTFLoaderPlugin = () => ({
  name: "rts-test-no-textures",
  loadTexture: () => Promise.resolve(new THREE.Texture()),
});

function load(dataUrl: string): Promise<GLTF> {
  const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(",") + 1)), (c) => c.charCodeAt(0));
  const loader = new GLTFLoader();
  loader.register(noTextures as never);
  return new Promise((resolve, reject) => loader.parse(bytes.buffer, "", resolve, reject));
}

/** What a file's name says it is drawn for, or why the name matches nothing. */
function subject(key: string): { kind: ModelKind } | { error: string } {
  const at = key.indexOf("@");
  if (at > 0) {
    const role = key.slice(at + 1);
    const index = (ROLE_NAMES as readonly string[]).indexOf(role);
    if (index < 0) return { error: `"${role}" is not a role; see ROLE_NAMES` };
    const race = key.slice(0, at);
    if (!defaultContent.races.some((r) => r.id === race)) return { error: `no race "${race}"` };
    return { kind: index >= ROLE_NAMES.indexOf("hq") ? "structure" : "unit" };
  }

  let typeId: number;
  try {
    typeId = defaultContent.id(key);
  } catch {
    return {
      error:
        `no content id "${key}". Files are named after content ids, not display names -- ` +
        `see packages/content/src/races/`,
    };
  }
  const kind = defaultContent.types.get(typeId).kind;
  return { kind: kind === KIND_BUILDING || kind === KIND_RESOURCE ? "structure" : "unit" };
}

const entries = Object.entries(FILES).map(([path, url]) => ({
  key: path.slice(path.lastIndexOf("/") + 1, -".glb".length),
  url,
}));

describe("the shipped models", () => {
  it("are found", () => {
    // Guards the glob itself: a pattern that silently matched nothing would make
    // every test below pass by never running.
    expect(entries.length).toBeGreaterThan(0);
  });

  for (const { key, url } of entries) {
    describe(key, () => {
      it("is named after something the game draws", () => {
        const found = subject(key);
        expect("error" in found ? found.error : "ok").toBe("ok");
      });

      it("holds a single scene", async () => {
        // Blender writes one glTF scene per Blender scene with a selection, and
        // only the first is loaded. See assets/models/README.md.
        expect((await load(url)).scenes).toHaveLength(1);
      });

      it("follows the model contract", async () => {
        const found = subject(key);
        if ("error" in found) return;
        const parts = toParts((await load(url)).scene);
        expect(checkContract(parts, found.kind)).toEqual([]);
      });
    });
  }
});
