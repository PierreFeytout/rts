import { KIND_RESOURCE, VIS_HIDDEN, VIS_VISIBLE, type World } from "@rts/sim";
import * as THREE from "three";
import { simToWorld } from "./coords.js";
import { ALLOY_COLOUR, VENT_COLOUR } from "./palette.js";

/**
 * The light a resource node spills onto the ground around it.
 *
 * The first version of this was geometry: a flat emissive shape baked into the
 * Alloy Node's own model. It looked exactly like what it was -- a painted
 * shape with a hard edge, not a light -- because it was one. A glow is a
 * falloff, and a falloff is not something a baked material can be, however
 * bright: nothing here tone-maps or blooms (see game.ts), so a mesh can only
 * ever be as bright as its own surface, uniformly, right up to where the
 * surface ends.
 *
 * This draws the falloff instead, at the one place it can be cheap: resource
 * nodes number in the dozens, not the hundreds, so a plain textured quad per
 * node -- unbatched, alpha-faded from a soft radial texture, additively
 * blended into the ground -- costs nothing worth instancing. Additive
 * blending is what makes it read as light rather than paint: it brightens
 * whatever is already there instead of covering it, which is the one thing an
 * opaque material cannot do.
 *
 * **A flat decal, not a `THREE.Sprite`.** A sprite always turns to face the
 * camera, which is right for something meant to be looked at -- a health bar,
 * an icon -- and wrong for a light lying on the ground: on this isometric
 * camera it stood the glow up on its edge like a wall, most of it poking
 * through the terrain and clipped away by depth, which is the "hard cutoff
 * across the middle" the first version of this showed. The ground does not
 * turn to face the camera, and neither should light sitting on it.
 *
 * Presentation only, like the rally markers and the fog this shares its
 * visibility rule with.
 */

/** World units across, before scaling to a resource's own footprint. */
const BASE_SIZE = 1.0;
/** Multiple of the footprint the glow spreads beyond the model's own edge. */
const SPREAD = 1.3;
/** Just above the ground, clear of the terrain and the model's own base. */
const HEIGHT = 0.03;
/** How far the glow's scale breathes, and how fast -- offset per node so a
 * field of them never pulses in lockstep. */
const PULSE_AMOUNT = 0.08;
const PULSE_HZ = 0.55;
/** Remembered but not currently seen: dimmed like the resource mesh itself. */
const REMEMBERED_OPACITY = 0.35;

/** Flat in the XZ plane, facing up -- the ground's own orientation, once, shared. */
const GEOMETRY = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

interface Glow {
  mesh: THREE.Mesh;
  colour: number;
}

export class ResourceGlow {
  private readonly scene: THREE.Scene;
  private readonly glows: Glow[] = [];
  private readonly texture = radialTexture();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  update(world: World, seconds: number, localPlayer: number): void {
    const e = world.entities;
    const types = world.types;
    const vision = world.vision;
    let n = 0;

    for (let i = 0; i < e.highWater; i++) {
      if (e.alive[i] !== 1) continue;
      const type = types.get(e.typeId[i]);
      if (type.kind !== KIND_RESOURCE) continue;

      const tx = e.posX[i] >> 16;
      const ty = e.posY[i] >> 16;
      const level = vision.enabled ? vision.levelAt(localPlayer, tx, ty) : VIS_VISIBLE;
      if (level === VIS_HIDDEN) continue;

      if (n >= this.glows.length) this.glows.push(this.create());
      const glow = this.glows[n++];
      const material = glow.mesh.material as THREE.MeshBasicMaterial;

      const colour = type.resourceAmount > 0 ? ALLOY_COLOUR : VENT_COLOUR;
      if (glow.colour !== colour) {
        glow.colour = colour;
        material.color.setHex(colour);
      }

      const x = simToWorld(e.posX[i]);
      const z = simToWorld(e.posY[i]);
      glow.mesh.position.set(x, HEIGHT, z);

      const size = BASE_SIZE * type.footprint * SPREAD;
      // A slow breathing scale reads as "alive" without needing an opacity
      // change to carry it alone -- opacity alone on an additive decal looks
      // like flicker, where scale reads as pulse.
      const pulse = 1 + Math.sin(seconds * PULSE_HZ * Math.PI * 2 + i) * PULSE_AMOUNT;
      glow.mesh.scale.set(size * pulse, 1, size * pulse);
      material.opacity = level === VIS_VISIBLE ? 1 : REMEMBERED_OPACITY;
      glow.mesh.visible = true;
    }

    for (let k = n; k < this.glows.length; k++) this.glows[k].mesh.visible = false;
  }

  dispose(): void {
    for (const glow of this.glows) {
      this.scene.remove(glow.mesh);
      (glow.mesh.material as THREE.Material).dispose();
    }
    this.glows.length = 0;
    this.texture.dispose();
  }

  private create(): Glow {
    const mesh = new THREE.Mesh(
      GEOMETRY,
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    mesh.visible = false;
    // Above the terrain and the fog decal in draw order, but the additive
    // blend still lets whatever is under it show through untouched.
    mesh.renderOrder = 1;
    this.scene.add(mesh);
    return { mesh, colour: -1 };
  }
}

/**
 * A soft white disc, opaque at the centre and fully transparent by the edge --
 * tinted per instance by `MeshBasicMaterial.color`, so one texture serves
 * every colour a resource node needs.
 */
function radialTexture(size = 128): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const r = size / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  gradient.addColorStop(0, "rgba(255,255,255,0.9)");
  gradient.addColorStop(0.4, "rgba(255,255,255,0.45)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
