import { VIS_HIDDEN, VIS_VISIBLE, type World } from "@rts/sim";
import * as THREE from "three";

/**
 * Draws the fog of war as a translucent sheet over the ground.
 *
 * An overlay plane rather than a patched terrain shader. Patching
 * `MeshStandardMaterial` would give per-pixel fog on the ground and nothing
 * else -- every other thing in the scene (the grid helper, terrain blocks,
 * buildings) would need its own patch, each with the same uniforms wired in by
 * hand. One transparent quad covers all of the ground in a single draw, and the
 * few things that stand *above* it are dimmed by per-instance colour instead,
 * which they already support.
 *
 * The texture is one texel per map tile up to `MAX_TEXELS`, and coarser beyond
 * it, linearly filtered. That is deliberately soft: fog with hard tile edges
 * reads as a bug, and the exact boundary is not information the player is meant
 * to act on -- what matters is roughly where sight ends.
 *
 * The cap is not cosmetic. This texture is rebuilt and re-uploaded on every
 * simulation tick; at one texel per tile a 1024-tile map is four megabytes
 * twenty times a second, which is more bandwidth than everything else the
 * renderer does put together. Capped, the upload is the same on every map.
 *
 * The texture carries ALPHA ONLY; the colour lives on the material. That is not
 * tidiness. A `DataTexture` has no colour space, so three.js reads its RGB as
 * already-linear -- write the sRGB bytes of a near-black tone into it and they
 * render around four times brighter than intended, which for this palette
 * lands almost exactly on the unlit ground colour. The fog was drawing
 * perfectly and was invisible. Material colours go through the sRGB conversion
 * properly, so putting the colour there makes the tone mean what it says.
 */

/**
 * Widest fog texture, in texels.
 *
 * Beyond this the map is sampled at a stride. Safe because the smallest sight
 * radius in the content is 6 tiles, so any patch of visible ground is at least
 * a dozen tiles across and cannot slip between samples -- and because the
 * result is blurred by linear filtering anyway.
 */
const MAX_TEXELS = 256;

/** Darkness of never-seen ground. Fully opaque: there is nothing to show. */
const ALPHA_HIDDEN = 1;
/** Darkness of remembered ground. Terrain shows through, units do not. */
const ALPHA_EXPLORED = 0.55;

export class FogRenderer {
  private readonly texture: THREE.DataTexture;
  private readonly data: Uint8Array;
  private readonly mesh: THREE.Mesh;
  private readonly mapTiles: number;
  /** Map tiles per texel. 1 on any map at or below MAX_TEXELS. */
  private readonly stride: number;
  /** Texture extent, in texels. */
  private readonly texels: number;
  private readonly localPlayer: number;

  /** Tick the texture was last built from, so it is not rebuilt per frame. */
  private builtTick = -1;
  private wasEnabled = true;

  constructor(scene: THREE.Scene, mapTiles: number, localPlayer: number) {
    this.mapTiles = mapTiles;
    this.stride = Math.ceil(mapTiles / MAX_TEXELS);
    this.texels = Math.ceil(mapTiles / this.stride);
    this.localPlayer = localPlayer;

    // Luminance-alpha would be ideal; three.js dropped it, so RGBA it is.
    // RGB stays pure white so it cannot tint the material's colour, and only
    // the alpha channel carries any information.
    this.data = new Uint8Array(this.texels * this.texels * 4).fill(255);
    this.texture = new THREE.DataTexture(this.data, this.texels, this.texels, THREE.RGBAFormat);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;

    const geometry = new THREE.PlaneGeometry(mapTiles, mapTiles);
    geometry.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        map: this.texture,
        // Unlit ground. Given as a hex, so three.js applies the sRGB
        // conversion that a raw texture byte would not get. Warm-black rather
        // than blue-black: ash scatters the furnace light into everything, and
        // a cold shadow in this palette reads as a hole in the world.
        color: 0x0a0806,
        transparent: true,
        depthWrite: false,
        // Scene fog would blend this back toward the horizon tone, which is
        // brighter than the fog is meant to be -- unexplored map would lift to
        // a visible grey the further from the camera it sat.
        fog: false,
      }),
    );
    // Above the ground and the grid helper, below anything that stands up.
    this.mesh.position.set(mapTiles / 2, 0.08, mapTiles / 2);
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** Rebuild the texture if the simulation has advanced since the last one. */
  update(world: World): void {
    const vision = world.vision;
    if (world.tick === this.builtTick && vision.enabled === this.wasEnabled) return;
    this.builtTick = world.tick;
    this.wasEnabled = vision.enabled;

    if (!vision.enabled) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    const n = this.texels;
    // Sample the middle of each block rather than its corner, so a stride
    // wider than one tile does not bias the fog toward the map's origin.
    const offset = this.stride >> 1;
    for (let ty = 0; ty < n; ty++) {
      // Rows are written bottom-up. The plane's v axis runs from world south to
      // world north once it is laid flat, and `flipY` -- which exists for
      // exactly this -- has no effect on a DataTexture, because the data is
      // uploaded straight from a typed array rather than decoded from an
      // image. Getting this wrong mirrors the fog north to south, which looks
      // convincingly like fog right up until you notice the lit patch is over
      // the enemy's base rather than your own.
      let out = (n - 1 - ty) * n * 4;
      const sy = Math.min(ty * this.stride + offset, this.mapTiles - 1);
      for (let tx = 0; tx < n; tx++) {
        const sx = Math.min(tx * this.stride + offset, this.mapTiles - 1);
        const level = vision.levelAt(this.localPlayer, sx, sy);
        const alpha =
          level === VIS_VISIBLE ? 0 : level === VIS_HIDDEN ? ALPHA_HIDDEN : ALPHA_EXPLORED;
        this.data[out + 3] = (alpha * 255) | 0;
        out += 4;
      }
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
    this.mesh.removeFromParent();
  }
}
