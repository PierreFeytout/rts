/**
 * The Ashworks palette, in one place.
 *
 * UNIVERSE.md is where these values are decided and explained; this is where
 * the code reads them. Before this existed the team colours were written out
 * three separate times -- in the world renderer, the minimap and the interface
 * stylesheet -- and two of the three agreed.
 *
 * Numbers rather than strings, because three.js wants hex and the DOM wants
 * text, and converting one way is a function while converting the other is a
 * parser.
 */

export const PALETTE = {
  /** Sky, background, the bottom of everything. */
  void: 0x0a0806,
  /** Deepest surface tone, soot packed into crevices. */
  ash: 0x14100d,
  /** Unlit metal, structure shadow. */
  iron: 0x221b15,
  /** The buried ground, showing through thin ash. */
  rockcrete: 0x3a2a1c,
  /** Raised surfaces catching ambient, ash drifts. */
  dust: 0x5a483a,
  /** Corrosion, oxidised iron. */
  rust: 0x7a4a22,
  /** Furnace light, hot metal, the key light itself. */
  ember: 0xc46a28,
  /** Highlights only. Sparing, or it stops meaning heat. */
  flame: 0xe8a04a,
  /** Stencils, markings, bare ceramic. The only near-neutral. */
  bone: 0xb8a894,
  /** The Verdigris faction, and nothing else. */
  verdigris: 0x4a7a5e,
  /** Damage, alarms, hazard. Never decorative. */
  warning: 0xc4443a,
} as const;

/**
 * Team colours, indexed by owner id.
 *
 * The one place the palette's "no blues, no greens" rule is broken on purpose.
 * These are not materials in the world, they are **signal**: whose unit is
 * that, and is it shooting at me. Drawn from the warm palette they would be
 * unreadable, because the ground, the spoil and the light are all already
 * orange -- so they are deliberately the colours the world does not contain.
 *
 * Chosen for separation from each other *and* from ember terrain. A softer
 * orange in slot 1 vanished against the ground entirely.
 */
export const TEAM_COLOURS = [0x4ec9ff, 0xff5d47, 0xb77dff, 0x7de88a] as const;

/** Neutral scenery: ore seams and the ground they are in. */
export const NEUTRAL_COLOUR = 0x9a7c4a;
/** Vents, which are a hole with fire at the bottom. */
export const VENT_COLOUR = 0xd2702a;

export function teamColour(owner: number): number {
  return owner < 0 ? NEUTRAL_COLOUR : TEAM_COLOURS[owner % TEAM_COLOURS.length];
}

/** `0xc46a28` to `"#c46a28"`, for anywhere the value reaches CSS. */
export function css(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

/** The same, with an alpha channel. */
export function rgba(hex: number, alpha: number): string {
  return `rgba(${(hex >> 16) & 255}, ${(hex >> 8) & 255}, ${hex & 255}, ${alpha})`;
}
