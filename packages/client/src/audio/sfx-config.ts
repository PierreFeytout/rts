/**
 * What the sound effects configuration says, and what it means.
 *
 * The configuration is `assets/sfx/sfx.json`, documented beside it in
 * assets/sfx/README.md. It names sounds by **key**, and the game asks for a
 * sound by a list of keys from the most specific to the most general -- a
 * Conscript's shot is `shot.vanguard.trooper`, then `shot.vanguard`, then
 * `shot.kinetic`, then `shot` -- and plays the first one the configuration
 * has. So one `shot` entry makes every gun in the game make a noise, and a
 * unit can be given its own sound later without anything else changing. The
 * same bargain as model file names.
 *
 * Pure: no DOM, no audio, so all of it runs under the test suite.
 */

export interface Sound {
  readonly key: string;
  /** Variations, chosen at random each time. File names inside assets/sfx. */
  readonly files: readonly string[];
  /** 0 to 2. */
  readonly volume: number;
  /** Random playback-rate spread either way, 0 to 0.5: 0.08 is +-8%. */
  readonly pitch: number;
  /** At most this many of this sound at once; more are dropped. */
  readonly voices: number;
  /** Seconds that must pass between two starts of this sound. */
  readonly gap: number;
}

export interface SfxConfig {
  /** Overall level of every effect, 0 to 2. */
  readonly volume: number;
  /** At most this many effects of all kinds at once. */
  readonly voices: number;
  readonly sounds: ReadonlyMap<string, Sound>;
}

export const EMPTY_SFX: SfxConfig = { volume: 1, voices: 32, sounds: new Map() };

/** The key families the game asks for. Anything else in the file is a typo. */
export const FAMILIES = [
  "shot",
  "impact",
  "death",
  "built",
  "trained",
  "deposit",
  "blocked",
  "order",
  "select",
  "ui",
] as const;

/**
 * Read a configuration, keeping whatever is usable and saying what is not.
 * Never throws: a mistake costs its entry, with a warning naming it.
 */
export function parseSfxConfig(raw: unknown, files: ReadonlySet<string>): { config: SfxConfig; warnings: string[] } {
  const warnings: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { config: EMPTY_SFX, warnings: ['sfx.json must be an object with a "sounds" map'] };
  }
  const input = raw as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!["volume", "voices", "sounds"].includes(key)) warnings.push(`unknown setting "${key}"`);
  }

  const sounds = new Map<string, Sound>();
  const entries = typeof input.sounds === "object" && input.sounds !== null ? Object.entries(input.sounds) : [];
  if (input.sounds !== undefined && entries.length === 0 && Object.keys(input.sounds as object).length !== 0) {
    warnings.push('"sounds" must be a map from key to sound');
  }

  for (const [key, value] of entries) {
    const family = key.split(".")[0];
    if (!(FAMILIES as readonly string[]).includes(family)) {
      warnings.push(`"${key}": no sound is ever asked for by that name; keys start with ${FAMILIES.join(", ")}`);
      continue;
    }
    const entry = (typeof value === "string" || Array.isArray(value) ? { files: value } : value) as Record<string, unknown>;
    if (typeof entry !== "object" || entry === null) {
      warnings.push(`"${key}" must be a file, a list of files, or an object`);
      continue;
    }
    const listed = typeof entry.files === "string" ? [entry.files] : Array.isArray(entry.files) ? entry.files : [];
    const found: string[] = [];
    for (const file of listed) {
      if (typeof file === "string" && files.has(file)) found.push(file);
      else warnings.push(`"${key}": ${JSON.stringify(file)} is not a file in assets/sfx`);
    }
    if (found.length === 0) {
      warnings.push(`"${key}" has no usable files, so it is silent`);
      continue;
    }
    sounds.set(key, {
      key,
      files: found,
      volume: number(entry.volume, 1, 0, 2, `"${key}" volume`, warnings),
      pitch: number(entry.pitch, 0.05, 0, 0.5, `"${key}" pitch`, warnings),
      voices: Math.round(number(entry.voices, 4, 1, 64, `"${key}" voices`, warnings)),
      gap: number(entry.gap, 0.03, 0, 10, `"${key}" gap`, warnings),
    });
  }

  return {
    config: {
      volume: number(input.volume, EMPTY_SFX.volume, 0, 2, "volume", warnings),
      voices: Math.round(number(input.voices, EMPTY_SFX.voices, 1, 256, "voices", warnings)),
      sounds,
    },
    warnings,
  };
}

/** The first sound the configuration has among `keys`, most specific first. */
export function resolveSound(config: SfxConfig, keys: readonly string[]): Sound | null {
  for (const key of keys) {
    const sound = config.sounds.get(key);
    if (sound) return sound;
  }
  return null;
}

/**
 * The keys to try for something a unit or building did: its own content id,
 * then its race, then whatever `general` says about it, then the family.
 *
 *   keysFor("shot", "vanguard.trooper", ["kinetic"])
 *   -> shot.vanguard.trooper, shot.vanguard, shot.kinetic, shot
 */
export function keysFor(family: string, contentId: string | null, general: readonly string[] = []): string[] {
  const keys: string[] = [];
  if (contentId) {
    keys.push(`${family}.${contentId}`);
    const dot = contentId.indexOf(".");
    if (dot > 0) keys.push(`${family}.${contentId.slice(0, dot)}`);
  }
  for (const g of general) keys.push(`${family}.${g}`);
  keys.push(family);
  return keys;
}

/**
 * How loud, and where in the stereo field, a sound at a point on the ground
 * is, heard from the camera.
 *
 * Full volume anywhere on screen -- `radius` is about half the view -- fading
 * to nothing over another radius and a half beyond it, so a battle just off
 * the edge of the screen is heard and one across the map is not. Panned by
 * where it is left to right on screen, never hard to one side.
 *
 * `rightX`/`rightZ` is the ground direction that points right on screen.
 */
export function spatial(
  dx: number,
  dz: number,
  radius: number,
  rightX: number,
  rightZ: number,
): { gain: number; pan: number } {
  const distance = Math.hypot(dx, dz);
  const gain = distance <= radius ? 1 : Math.max(0, 1 - (distance - radius) / (radius * 1.5));
  const across = (dx * rightX + dz * rightZ) / Math.max(1e-6, radius);
  return { gain, pan: Math.max(-0.7, Math.min(0.7, across * 0.7)) };
}

function number(value: unknown, fallback: number, min: number, max: number, name: string, warnings: string[]): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    warnings.push(`${name} must be a number from ${min} to ${max}`);
    return fallback;
  }
  return value;
}
