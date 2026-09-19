/**
 * The sky, fog and lights a biome is seen under.
 *
 * A ground texture alone does not make two worlds look different: the scene's
 * one key light is by a wide margin the brightest thing in it, and a pale
 * blue-grey ashfield lit by Furnace Nine's warm orange furnace-light reads as
 * tan, not ice -- the light overwrites the material almost as much as the
 * material sets it. See UNIVERSE.md, "Other fronts": a world earns its own
 * palette by arguing what it is, what happened to it, and where the wear
 * collects; the same argument decides what its sky is doing, because the two
 * are not separable in what a player actually sees.
 *
 * Pure data, and synchronous -- unlike the textures in materials.ts, there is
 * nothing here to load, so this does not go through `loadTerrain`. Looked up
 * by the same biome id a map's `MapInfo.biome` carries.
 */

export interface BiomeLighting {
  /** The sky, and what a shot or an explosion fades into at the edge of sight. */
  readonly background: number;
  /** Colour and how far it reaches; see CAMERA_DISTANCE in game.ts for why the
   * range straddles it rather than starting near zero. */
  readonly fog: number;
  /** The scattered light with no direction, tinted toward what it bounces off. */
  readonly ambient: number;
  readonly ambientIntensity: number;
  /** The dominant light. Furnace Nine's own sun is below the horizon. */
  readonly key: number;
  readonly keyIntensity: number;
  /** The one light from the *other* temperature -- see UNIVERSE.md's palette
   * rules on why there is always exactly one. It exists so a silhouette
   * separates from the ground it stands on, which a single-temperature scene
   * cannot do when the unit and the floor are the same colour. */
  readonly rim: number;
  readonly rimIntensity: number;
}

/** Furnace Nine. See UNIVERSE.md, "Light". */
const ASHWORKS: BiomeLighting = {
  background: 0x0a0806,
  fog: 0x1a1209,
  ambient: 0x3a2c22,
  ambientIntensity: 1.3,
  key: 0xe8a04a,
  keyIntensity: 2.4,
  // The key is behind everything the camera looks at, so the faces it sees
  // -- a building's doors, decks and paint -- are lit by this and the
  // ambient alone. Strong enough for baked plate joints and hazard marking
  // to show on them; still the cold one, so steel stays cold against the
  // ground.
  rim: 0x5a7690,
  rimIntensity: 1.4,
};

/**
 * Cistern Four, "the Deepfreeze". See UNIVERSE.md, "Other fronts".
 *
 * The temperatures Furnace Nine assigns to key and rim are swapped, not just
 * recoloured: there the sun is the warm, dominant light and blue is the one
 * permitted accent. Here the sky itself is the cold light -- what little of it
 * gets through -- and the one warm accent is the reactor breaches the Alloy
 * Nodes and Geothermal Vents both stand in for, doing on this world what the
 * key light does on Furnace Nine: the only strongly saturated colour in the
 * frame, and now placed at the ground instead of overhead.
 */
const DEEPFREEZE: BiomeLighting = {
  background: 0x05080a,
  fog: 0x1c262c,
  ambient: 0x2c3a42,
  ambientIntensity: 1.2,
  key: 0xaebac2,
  keyIntensity: 1.7,
  rim: 0xc46a28,
  rimIntensity: 0.55,
};

const BIOMES: Record<string, BiomeLighting> = {
  ashworks: ASHWORKS,
  deepfreeze: DEEPFREEZE,
};

/** A biome's sky and lights, or Furnace Nine's own if the biome is unknown --
 * the same fallback `main.ts` gives a replay with no biome to name. */
export function lightingFor(biome: string): BiomeLighting {
  return BIOMES[biome] ?? ASHWORKS;
}
