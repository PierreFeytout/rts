import * as THREE from "three";

/**
 * The ground material: several terrain surfaces on one plane, blended by
 * height, chosen per tile by the map's paint layer.
 *
 * A map paints each of its tiles with one of up to five of its biome's
 * surfaces (see packages/content/src/paint.ts). This turns that into one
 * draw call: the surfaces live in three texture arrays, the paint lives in
 * one small texture with a texel per tile, and the fragment shader mixes
 * them.
 *
 * WHY THE BLEND FOLLOWS HEIGHT
 * ----------------------------
 * Cross-fading two surfaces over a tile looks like a cross-fade: a soft band
 * of neither material, which is the single clearest sign of a splat-mapped
 * terrain and the thing that makes it read as an engine rather than as
 * ground. Real materials interlock -- ash fills the gaps between crust
 * plates and leaves their tops proud, snow lies in the joints of a pad and
 * not on its slabs. So each surface's generator writes a height into its
 * normal map's alpha, and the blend compares heights: where two surfaces
 * meet, whichever is locally taller wins, and only within a narrow band do
 * both appear. The transition follows the crack pattern of the materials
 * themselves and cannot be seen as a line.
 *
 * WHY ARRAYS RATHER THAN FIVE SETS OF SAMPLERS
 * --------------------------------------------
 * Fifteen separate samplers would work and would need the shader recompiled
 * for every count; a texture array is one sampler and one uniform, indexed
 * by a loop, so the same program serves a map with two surfaces and a map
 * with five. It also makes the layer count a number rather than a shape:
 * adding a sixth is a constant here, not a new branch.
 *
 * WHY IT IS STILL A MeshStandardMaterial
 * --------------------------------------
 * Fog, shadows, tone mapping, lights, the vertex-colour macro tint: all of
 * three.js's own shading, patched at four chunk boundaries, rather than a
 * ShaderMaterial that would have to reimplement every one of them and then
 * keep up with them.
 */

/** The most surfaces one map can paint. Matches MAX_PAINT_LAYERS in @rts/content. */
export const MAX_LAYERS = 5;

/** One surface's three images, as the loader hands them over. */
export interface SurfaceImages {
  /** Colour, sRGB, 512. */
  readonly albedo: ImageData;
  /** Tangent-space normal in RGB, the surface's own height in A, 512. */
  readonly normal: ImageData;
  /** Occlusion, roughness, metalness, glow. 256. */
  readonly orm: ImageData;
  /** How many world tiles one repeat of this surface covers. */
  readonly repeat: number;
  /** How brightly the glow channel emits, 0 for a surface that does not. */
  readonly glow: number;
}

export interface GroundMaterialOptions {
  readonly layers: readonly SurfaceImages[];
  /** One layer index per tile, row-major from the top-left. */
  readonly paint: Uint8Array;
  readonly mapTiles: number;
}

/**
 * How wide the height blend is, in height units.
 *
 * Narrow. At 0.5 the transition is a visible gradient again; at 0.02 it is
 * an aliased edge that crawls when the camera moves. This is about two
 * texels of a typical surface's height range, which is one pixel on screen
 * at playing zoom -- enough for the mip chain and anisotropy to resolve.
 */
const BLEND_BAND = 0.12;

/**
 * How much the paint weight outranks the height.
 *
 * The weight has to win in the middle of a tile or the paint means nothing:
 * a tile painted as crust must be crust even where the ash beside it is
 * locally taller. It is only near a boundary, where two weights are close,
 * that the heights decide. This number is the ratio between the two, and
 * anything below about 2 lets tall surfaces bleed a tile deep into their
 * neighbours.
 */
const WEIGHT_AUTHORITY = 3.0;

export interface GroundMaterial {
  readonly material: THREE.MeshStandardMaterial;
  dispose(): void;
}

/**
 * Build the ground material for one map.
 *
 * Owns everything it creates: the arrays, the control texture and the
 * one-texel stand-ins. Each map gets its own -- the control texture is that
 * map's paint, and the arrays hold only the surfaces it actually uses.
 */
export function groundMaterial({ layers, paint, mapTiles }: GroundMaterialOptions): GroundMaterial {
  if (layers.length === 0) throw new Error("terrain: a map must paint with at least one surface");
  if (layers.length > MAX_LAYERS) {
    throw new Error(`terrain: ${layers.length} surfaces, but the ground shader blends ${MAX_LAYERS}`);
  }

  const albedoArray = arrayTexture(
    layers.map((l) => l.albedo),
    THREE.SRGBColorSpace,
  );
  const normalArray = arrayTexture(
    layers.map((l) => l.normal),
    THREE.NoColorSpace,
  );
  const ormArray = arrayTexture(
    layers.map((l) => l.orm),
    THREE.NoColorSpace,
  );
  const control = controlTexture(paint, mapTiles, layers.length);

  // How many times each surface repeats across the whole map, which is what
  // the shader multiplies the plane's own 0..1 uv by.
  const repeats = new Float32Array(MAX_LAYERS);
  const glows = new Float32Array(MAX_LAYERS);
  for (let i = 0; i < layers.length; i++) {
    repeats[i] = mapTiles / layers[i].repeat;
    glows[i] = layers[i].glow;
  }

  // Stand-ins, so three.js defines USE_MAP, USE_NORMALMAP_TANGENTSPACE,
  // USE_ROUGHNESSMAP, USE_METALNESSMAP, USE_AOMAP and USE_EMISSIVEMAP and
  // compiles in the varyings, the tangent frame and the emissive term. Every
  // one of the chunks that would read them is replaced below; these are
  // never sampled.
  const stub = stubTexture();

  const material = new THREE.MeshStandardMaterial({
    map: stub,
    normalMap: stub,
    roughnessMap: stub,
    metalnessMap: stub,
    aoMap: stub,
    emissiveMap: stub,
    roughness: 1,
    metalness: 1,
    // Emissive is the surfaces' own glow, written straight into the
    // radiance; white so the colour comes from the surface, not from here.
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 1,
    // The macro tint that breaks up the repeat lives in the geometry; see
    // `groundGeometry` in materials.ts.
    vertexColors: true,
  });

  const uniforms = {
    tAlbedo: { value: albedoArray },
    tNormal: { value: normalArray },
    tOrm: { value: ormArray },
    tControl: { value: control },
    uRepeat: { value: repeats },
    uGlow: { value: glows },
    uLayers: { value: layers.length },
    uNormalScale: { value: new THREE.Vector2(1.35, 1.35) },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        precision highp sampler2DArray;
        uniform sampler2DArray tAlbedo;
        uniform sampler2DArray tNormal;
        uniform sampler2DArray tOrm;
        uniform sampler2D tControl;
        uniform float uRepeat[${MAX_LAYERS}];
        uniform float uGlow[${MAX_LAYERS}];
        uniform int uLayers;
        uniform vec2 uNormalScale;

        vec4 gAlbedo;
        vec3 gNormal;
        vec4 gOrm;
        vec3 gGlow;

        void splat( vec2 uv ) {
          // The paint. Four channels carry layers 1..4 and the first layer
          // is whatever is left, so an unpainted map costs no texture at
          // all. Bilinear, so the weights already cross-fade over one tile
          // before the height blend sharpens them.
          vec4 control = texture2D( tControl, uv );
          float weight[${MAX_LAYERS}];
          weight[0] = max( 0.0, 1.0 - control.r - control.g - control.b - control.a );
          weight[1] = control.r;
          weight[2] = control.g;
          weight[3] = control.b;
          weight[4] = control.a;

          // Each surface's own height where it would sit, and how much it
          // wants this fragment: mostly its paint weight, nudged by height.
          float height[${MAX_LAYERS}];
          float claim[${MAX_LAYERS}];
          float best = -1.0;
          for ( int i = 0; i < ${MAX_LAYERS}; i++ ) {
            if ( i >= uLayers || weight[i] <= 0.001 ) { claim[i] = -1.0; continue; }
            vec2 tiled = uv * uRepeat[i];
            height[i] = texture( tNormal, vec3( tiled, float( i ) ) ).a;
            claim[i] = weight[i] * ${WEIGHT_AUTHORITY.toFixed(1)} + height[i];
            best = max( best, claim[i] );
          }

          // Only what is within a band of the tallest claim appears at all.
          // This is what makes ash fill the cracks of the crust beside it
          // rather than fade into it.
          float total = 0.0;
          float blend[${MAX_LAYERS}];
          for ( int i = 0; i < ${MAX_LAYERS}; i++ ) {
            blend[i] = claim[i] < 0.0 ? 0.0 : max( 0.0, claim[i] - best + ${BLEND_BAND.toFixed(2)} );
            total += blend[i];
          }

          gAlbedo = vec4( 0.0 );
          gNormal = vec3( 0.0 );
          gOrm = vec4( 0.0 );
          gGlow = vec3( 0.0 );
          float inv = 1.0 / max( total, 1e-4 );
          for ( int i = 0; i < ${MAX_LAYERS}; i++ ) {
            if ( blend[i] <= 0.0 ) continue;
            float w = blend[i] * inv;
            vec2 tiled = uv * uRepeat[i];
            vec3 coord = vec3( tiled, float( i ) );
            vec4 albedo = texture( tAlbedo, coord );
            vec4 orm = texture( tOrm, coord );
            gAlbedo += albedo * w;
            gNormal += ( texture( tNormal, coord ).xyz * 2.0 - 1.0 ) * w;
            gOrm += orm * w;
            // Glow is the surface's own colour emitting: a molten seam is
            // the colour it is painted, not white light on top of paint.
            gGlow += albedo.rgb * orm.a * uGlow[i] * w;
          }
        }
        `,
      )
      // The colour. `vMapUv` is the plane's own uv, 0..1 across the map,
      // which is both the paint lookup and the base for every tiling.
      .replace(
        "#include <map_fragment>",
        /* glsl */ `
        splat( vMapUv );
        diffuseColor *= gAlbedo;
        `,
      )
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = roughness * gOrm.g;")
      .replace("#include <metalnessmap_fragment>", "float metalnessFactor = metalness * gOrm.b;")
      .replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `
        vec3 mapN = gNormal;
        mapN.xy *= uNormalScale;
        normal = normalize( tbn * mapN );
        `,
      )
      .replace("#include <emissivemap_fragment>", "totalEmissiveRadiance = gGlow;")
      .replace(
        "#include <aomap_fragment>",
        /* glsl */ `
        float ambientOcclusion = ( gOrm.r - 1.0 ) * aoMapIntensity + 1.0;
        reflectedLight.indirectDiffuse *= ambientOcclusion;
        `,
      );
  };

  // Without this every ground material in the process shares one compiled
  // program, because the patch source is identical -- and the layer count is
  // baked into the loop bounds.
  material.customProgramCacheKey = () => `splat-${layers.length}`;

  return {
    material,
    dispose() {
      albedoArray.dispose();
      normalArray.dispose();
      ormArray.dispose();
      control.dispose();
      stub.dispose();
      material.dispose();
    },
  };
}

/**
 * Pack same-sized images into one array texture.
 *
 * Every layer of an array must agree on size, so each of the three arrays
 * holds one kind of map -- albedo at 512, ORM at 256 -- rather than one
 * array holding everything about one surface.
 */
function arrayTexture(images: readonly ImageData[], colorSpace: THREE.ColorSpace): THREE.DataArrayTexture {
  const { width, height } = images[0];
  for (const image of images) {
    if (image.width !== width || image.height !== height) {
      throw new Error(
        `terrain: surfaces disagree on texture size (${image.width}x${image.height} and ${width}x${height}) -- ` +
          "regenerate them all with scripts/generate-terrain.mjs",
      );
    }
  }

  const stride = width * height * 4;
  const data = new Uint8Array(stride * images.length);
  images.forEach((image, i) => data.set(image.data, stride * i));

  const texture = new THREE.DataArrayTexture(data, width, height, images.length);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  // The ground is seen at a shallow isometric angle, which is the exact case
  // trilinear filtering handles worst: without the mip chain and anisotropy
  // the floor boils into noise a third of the way up the screen.
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The paint, as a texture with one texel per tile.
 *
 * Four channels for layers 1..4; the first layer is what is left over, so a
 * map that paints nothing has a texture of zeroes and the shader still gets
 * a weight of one for its ground surface.
 *
 * Linear filtering is deliberate and is half of the look: it turns the hard
 * per-tile assignment into a weight that ramps across roughly one tile, and
 * the height blend then cuts that ramp into the shape of the materials. With
 * nearest filtering the paint would show its grid, which is the failure
 * every tile-based terrain has.
 */
function controlTexture(paint: Uint8Array, mapTiles: number, layers: number): THREE.DataTexture {
  const data = new Uint8Array(mapTiles * mapTiles * 4);
  for (let i = 0; i < paint.length; i++) {
    const layer = paint[i];
    if (layer === 0) continue;
    if (layer >= layers) continue;
    data[i * 4 + (layer - 1)] = 255;
  }

  const texture = new THREE.DataTexture(data, mapTiles, mapTiles, THREE.RGBAFormat);
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** One white texel, to turn on the shader features whose chunks are replaced. */
function stubTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}
