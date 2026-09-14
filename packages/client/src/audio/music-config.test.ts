import { describe, expect, it } from "vitest";
import { DEFAULT_MOODS, parseMusicConfig, tracksFor, type MusicConfig } from "./music-config.js";
import { MoodTracker } from "./mood.js";

const FILES = new Set(["theme.mp3", "lobby.mp3", "calm.mp3", "war.mp3", "directorate.mp3", "victory.mp3"]);
const RACES = ["vanguard", "concord"];

function parse(raw: unknown): { config: MusicConfig; warnings: string[] } {
  return parseMusicConfig(raw, FILES, RACES);
}

describe("parseMusicConfig", () => {
  it("reads tracks, settings and moods", () => {
    const { config, warnings } = parse({
      crossfade: 4,
      shuffle: false,
      moods: { combat: 0.6 },
      tracks: [
        { file: "theme.mp3", play: ["menu.main"], volume: 0.8 },
        { file: "war.mp3", play: "match.combat" },
        { file: "directorate.mp3", play: ["match.calm"], races: ["vanguard"] },
      ],
    });
    expect(warnings).toEqual([]);
    expect(config.crossfade).toBe(4);
    expect(config.shuffle).toBe(false);
    expect(config.moods).toEqual({ ...DEFAULT_MOODS, combat: 0.6 });
    expect(config.tracks).toEqual([
      { file: "theme.mp3", slots: ["menu.main"], races: [], volume: 0.8 },
      { file: "war.mp3", slots: ["match.combat"], races: [], volume: 1 },
      { file: "directorate.mp3", slots: ["match.calm"], races: ["vanguard"], volume: 1 },
    ]);
  });

  it("keeps what it can and names what it cannot", () => {
    const { config, warnings } = parse({
      crossfades: 2,
      tracks: [
        { file: "missing.mp3", play: ["menu.main"] },
        { file: "theme.mp3", play: ["menu.mian", "menu.main"] },
        { file: "war.mp3", play: [] },
        { file: "calm.mp3", play: ["match.calm"], races: ["directorate"], volume: 5 },
      ],
    });
    expect(config.tracks.map((t) => t.file)).toEqual(["theme.mp3", "calm.mp3"]);
    expect(config.tracks[1]).toMatchObject({ races: [], volume: 1 });
    expect(warnings).toHaveLength(6);
    expect(warnings.join("\n")).toMatch(/crossfades/);
    expect(warnings.join("\n")).toMatch(/missing\.mp3.*no such file/);
    expect(warnings.join("\n")).toMatch(/menu\.mian.*not a slot/);
    expect(warnings.join("\n")).toMatch(/war\.mp3.*never plays/);
    expect(warnings.join("\n")).toMatch(/directorate.*not a race.*vanguard, concord/);
  });

  it("is silence, not an error, for something that is not a configuration", () => {
    expect(parse("tracks").config.tracks).toEqual([]);
    expect(parse(null).warnings).toHaveLength(1);
  });
});

describe("tracksFor", () => {
  const { config } = parse({
    tracks: [
      { file: "theme.mp3", play: ["menu"] },
      { file: "lobby.mp3", play: ["menu.lobby"] },
      { file: "calm.mp3", play: ["match.calm"] },
      { file: "war.mp3", play: ["match.combat"] },
      { file: "directorate.mp3", play: ["match.calm", "match.tension"], races: ["vanguard"] },
      { file: "victory.mp3", play: ["match.victory"] },
    ],
  });
  const files = (slot: Parameters<typeof tracksFor>[1], race: string | null = null): string[] =>
    tracksFor(config, slot, race).map((t) => t.file);

  it("plays a slot's own tracks", () => {
    expect(files("menu.lobby")).toEqual(["lobby.mp3"]);
    expect(files("match.combat", "vanguard")).toEqual(["war.mp3"]);
    expect(files("match.victory", "concord")).toEqual(["victory.mp3"]);
  });

  it("falls back along the chain when a slot has nothing", () => {
    // skirmish -> main -> menu
    expect(files("menu.skirmish")).toEqual(["theme.mp3"]);
    // join -> multiplayer -> main -> menu; the lobby is not on that chain.
    expect(files("menu.join")).toEqual(["theme.mp3"]);
    // peril -> combat
    expect(files("match.peril", "concord")).toEqual(["war.mp3"]);
    // defeat -> calm
    expect(files("match.defeat", "concord")).toEqual(["calm.mp3"]);
  });

  it("prefers a race's own music, and never plays another race's", () => {
    expect(files("match.calm", "vanguard")).toEqual(["directorate.mp3"]);
    expect(files("match.calm", "concord")).toEqual(["calm.mp3"]);
    // Tension has only a Directorate track: the Verdigris falls back to calm.
    expect(files("match.tension", "vanguard")).toEqual(["directorate.mp3"]);
    expect(files("match.tension", "concord")).toEqual(["calm.mp3"]);
  });

  it("is empty when nothing anywhere on the chain will do", () => {
    expect(tracksFor(parse({ tracks: [] }).config, "match.peril", "vanguard")).toEqual([]);
  });
});

describe("MoodTracker", () => {
  const thresholds = { tension: 0.15, combat: 0.45, peril: 0.35, calmAfter: 10 };

  it("moves up as soon as a threshold is crossed", () => {
    const mood = new MoodTracker(0, thresholds);
    expect(mood.update(0.05)).toBe("calm");
    mood.tension = 0.2;
    expect(mood.update(0.05)).toBe("tension");
    mood.tension = 0.5;
    expect(mood.update(0.05)).toBe("combat");
    mood.peril = 0.4;
    expect(mood.update(0.05)).toBe("peril");
  });

  it("waits before following the fighting back down", () => {
    const mood = new MoodTracker(0, thresholds);
    mood.tension = 0.5;
    expect(mood.update(0.05)).toBe("combat");
    // Tension halves every six seconds; it drops below combat almost at once,
    // but the music holds until the lull has lasted `calmAfter`.
    let seconds = 0;
    while (mood.update(0.25) === "combat") seconds += 0.25;
    expect(seconds).toBeGreaterThanOrEqual(9.5);
    expect(mood.current).not.toBe("combat");
  });

  it("does not wait if the fighting picks up again first", () => {
    const mood = new MoodTracker(0, thresholds);
    mood.tension = 0.5;
    mood.update(0.05);
    mood.tension = 0.3;
    for (let k = 0; k < 20; k++) mood.update(0.25);
    mood.tension = 0.5;
    expect(mood.update(0.05)).toBe("combat");
    // The lull starts counting again from here.
    mood.tension = 0.2;
    for (let k = 0; k < 20; k++) expect(mood.update(0.25)).toBe("combat");
  });
});
