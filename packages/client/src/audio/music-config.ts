/**
 * What the music configuration says, and what it means.
 *
 * The configuration is `assets/music/music.json`, written by hand; its format
 * is documented beside it, in assets/music/README.md. This file reads it,
 * checks it, and answers the one question the player asks: for this slot, and
 * this race, which tracks may play?
 *
 * Pure: no DOM, no audio, so all of it runs under the test suite.
 */

/** Everywhere music can play. The names are what the configuration uses. */
export const SLOTS = [
  "menu",
  "menu.main",
  "menu.skirmish",
  "menu.multiplayer",
  "menu.join",
  "menu.lobby",
  "menu.replays",
  "menu.settings",
  "match",
  "match.calm",
  "match.tension",
  "match.combat",
  "match.peril",
  "match.victory",
  "match.defeat",
] as const;

export type Slot = (typeof SLOTS)[number];

/**
 * Where each slot looks when it has no tracks of its own.
 *
 * So a configuration can start with one menu track and one match track and be
 * refined later: a lobby with nothing assigned plays the main menu's music, a
 * battle with nothing assigned plays whatever tension or calm has.
 */
export const FALLBACK: Readonly<Record<Slot, Slot | null>> = {
  menu: null,
  "menu.main": "menu",
  "menu.skirmish": "menu.main",
  "menu.multiplayer": "menu.main",
  "menu.join": "menu.multiplayer",
  "menu.lobby": "menu.multiplayer",
  "menu.replays": "menu.main",
  "menu.settings": "menu.main",
  match: null,
  "match.calm": "match",
  "match.tension": "match.calm",
  "match.combat": "match.tension",
  "match.peril": "match.combat",
  "match.victory": "match.calm",
  "match.defeat": "match.calm",
};

export interface Track {
  /** File name inside assets/music. */
  readonly file: string;
  readonly slots: readonly Slot[];
  /** Race ids this track is for. Empty means any race. */
  readonly races: readonly string[];
  /** Relative level, 0 to 2. 1 is the file as mastered. */
  readonly volume: number;
}

/** When a match's mood moves up, and how long it waits before moving down. */
export interface MoodThresholds {
  /** Tension, 0..1, at which a match is no longer calm. */
  readonly tension: number;
  /** Tension at which it is a battle. */
  readonly combat: number;
  /** Peril, 0..1, at which it is going badly. */
  readonly peril: number;
  /** Seconds a mood must have been left behind before the music follows it down. */
  readonly calmAfter: number;
}

export interface MusicConfig {
  /** Seconds to cross from one track to the next. */
  readonly crossfade: number;
  /** Pick the next track at random, rather than in the order listed. */
  readonly shuffle: boolean;
  readonly moods: MoodThresholds;
  readonly tracks: readonly Track[];
}

export const DEFAULT_MOODS: MoodThresholds = { tension: 0.15, combat: 0.45, peril: 0.35, calmAfter: 20 };

export const EMPTY_CONFIG: MusicConfig = { crossfade: 3, shuffle: true, moods: DEFAULT_MOODS, tracks: [] };

/**
 * Read a configuration, keeping whatever is usable and saying what is not.
 *
 * Nothing here throws. A typo in one track costs that track, with a warning
 * naming it; a configuration nobody can parse costs the music, not the game.
 */
export function parseMusicConfig(
  raw: unknown,
  files: ReadonlySet<string>,
  races: readonly string[],
): { config: MusicConfig; warnings: string[] } {
  const warnings: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { config: EMPTY_CONFIG, warnings: ["music.json must be an object with a \"tracks\" list"] };
  }
  const input = raw as Record<string, unknown>;
  const known = new Set(["crossfade", "shuffle", "moods", "tracks"]);
  for (const key of Object.keys(input)) {
    if (!known.has(key)) warnings.push(`unknown setting "${key}"; expected ${[...known].join(", ")}`);
  }

  const crossfade = number(input.crossfade, EMPTY_CONFIG.crossfade, 0, 30, "crossfade", warnings);
  const shuffle = typeof input.shuffle === "boolean" ? input.shuffle : EMPTY_CONFIG.shuffle;
  if (input.shuffle !== undefined && typeof input.shuffle !== "boolean") warnings.push("shuffle must be true or false");

  const moodsIn = (typeof input.moods === "object" && input.moods !== null ? input.moods : {}) as Record<string, unknown>;
  const moods: MoodThresholds = {
    tension: number(moodsIn.tension, DEFAULT_MOODS.tension, 0, 1, "moods.tension", warnings),
    combat: number(moodsIn.combat, DEFAULT_MOODS.combat, 0, 1, "moods.combat", warnings),
    peril: number(moodsIn.peril, DEFAULT_MOODS.peril, 0, 1, "moods.peril", warnings),
    calmAfter: number(moodsIn.calmAfter, DEFAULT_MOODS.calmAfter, 0, 600, "moods.calmAfter", warnings),
  };

  const tracks: Track[] = [];
  const list = Array.isArray(input.tracks) ? input.tracks : [];
  if (input.tracks !== undefined && !Array.isArray(input.tracks)) warnings.push("tracks must be a list");

  list.forEach((entry: unknown, index) => {
    const where = `tracks[${index}]`;
    if (typeof entry !== "object" || entry === null) {
      warnings.push(`${where} is not an object`);
      return;
    }
    const t = entry as Record<string, unknown>;
    const file = typeof t.file === "string" ? t.file : "";
    const name = file ? `"${file}"` : where;
    if (!file) {
      warnings.push(`${where} has no "file"`);
      return;
    }
    if (!files.has(file)) {
      warnings.push(`${name}: no such file in assets/music`);
      return;
    }

    const play = Array.isArray(t.play) ? t.play : typeof t.play === "string" ? [t.play] : [];
    const slots: Slot[] = [];
    for (const slot of play) {
      if ((SLOTS as readonly unknown[]).includes(slot)) slots.push(slot as Slot);
      else warnings.push(`${name}: "${String(slot)}" is not a slot; see assets/music/README.md`);
    }
    if (slots.length === 0) {
      warnings.push(`${name}: "play" names no slot, so it never plays`);
      return;
    }

    const raceList = Array.isArray(t.races) ? t.races : t.races === undefined ? [] : [t.races];
    const trackRaces: string[] = [];
    for (const race of raceList) {
      if (typeof race === "string" && races.includes(race)) trackRaces.push(race);
      else warnings.push(`${name}: "${String(race)}" is not a race; races are ${races.join(", ")}`);
    }

    tracks.push({
      file,
      slots,
      races: trackRaces,
      volume: number(t.volume, 1, 0, 2, `${name} volume`, warnings),
    });
  });

  return { config: { crossfade, shuffle, moods, tracks }, warnings };
}

/**
 * The tracks that may play in a slot, for a race.
 *
 * Walks the slot's fallback chain to the first slot with anything eligible. A
 * track is eligible if it names no race or names this one; when some of the
 * eligible tracks name this race, only those are used, so a race's own music
 * always wins over music for everyone.
 */
export function tracksFor(config: MusicConfig, slot: Slot, race: string | null): Track[] {
  for (let at: Slot | null = slot; at !== null; at = FALLBACK[at]) {
    const here = config.tracks.filter(
      (t) => t.slots.includes(at!) && (t.races.length === 0 || (race !== null && t.races.includes(race))),
    );
    if (here.length === 0) continue;
    const own = here.filter((t) => race !== null && t.races.includes(race));
    return own.length > 0 ? own : here;
  }
  return [];
}

function number(value: unknown, fallback: number, min: number, max: number, name: string, warnings: string[]): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    warnings.push(`${name} must be a number from ${min} to ${max}`);
    return fallback;
  }
  return value;
}
