import { describe, expect, it } from "vitest";
import { keysFor, parseSfxConfig, resolveSound, spatial } from "./sfx-config.js";

const FILES = new Set(["rivet-1.ogg", "rivet-2.ogg", "boom.wav", "click.ogg", "death.ogg"]);

describe("parseSfxConfig", () => {
  it("reads sounds as a file, a list, or an object", () => {
    const { config, warnings } = parseSfxConfig(
      {
        volume: 0.8,
        voices: 24,
        sounds: {
          "ui.click": "click.ogg",
          death: ["death.ogg"],
          "shot.kinetic": { files: ["rivet-1.ogg", "rivet-2.ogg"], volume: 0.5, pitch: 0.1, voices: 6, gap: 0.05 },
        },
      },
      FILES,
    );
    expect(warnings).toEqual([]);
    expect(config.volume).toBe(0.8);
    expect(config.voices).toBe(24);
    expect(config.sounds.get("ui.click")).toMatchObject({ files: ["click.ogg"], volume: 1, voices: 4 });
    expect(config.sounds.get("death")).toMatchObject({ files: ["death.ogg"] });
    expect(config.sounds.get("shot.kinetic")).toEqual({
      key: "shot.kinetic",
      files: ["rivet-1.ogg", "rivet-2.ogg"],
      volume: 0.5,
      pitch: 0.1,
      voices: 6,
      gap: 0.05,
    });
  });

  it("keeps what it can and names what it cannot", () => {
    const { config, warnings } = parseSfxConfig(
      {
        sounds: {
          "shoot.kinetic": "rivet-1.ogg",
          "shot.plasma": ["missing.ogg", "boom.wav"],
          "impact.explosive": "nope.wav",
          "death.unit": { files: "death.ogg", volume: 9 },
        },
      },
      FILES,
    );
    expect([...config.sounds.keys()]).toEqual(["shot.plasma", "death.unit"]);
    expect(config.sounds.get("shot.plasma")!.files).toEqual(["boom.wav"]);
    expect(config.sounds.get("death.unit")!.volume).toBe(1);
    const text = warnings.join("\n");
    expect(text).toMatch(/shoot\.kinetic.*no sound is ever asked for/);
    expect(text).toMatch(/missing\.ogg.*not a file/);
    expect(text).toMatch(/impact\.explosive.*silent/);
    expect(text).toMatch(/death\.unit.*volume/);
  });
});

describe("keysFor and resolveSound", () => {
  it("goes from the unit to its race to what it is to the family", () => {
    expect(keysFor("shot", "vanguard.trooper", ["kinetic"])).toEqual([
      "shot.vanguard.trooper",
      "shot.vanguard",
      "shot.kinetic",
      "shot",
    ]);
    expect(keysFor("blocked", null, ["supply"])).toEqual(["blocked.supply", "blocked"]);
  });

  it("plays the most specific sound the configuration has", () => {
    const { config } = parseSfxConfig(
      { sounds: { shot: "rivet-1.ogg", "shot.plasma": "boom.wav", "shot.vanguard.turret": "rivet-2.ogg" } },
      FILES,
    );
    const file = (keys: string[]): string | undefined => resolveSound(config, keys)?.files[0];
    expect(file(keysFor("shot", "vanguard.turret", ["plasma"]))).toBe("rivet-2.ogg");
    expect(file(keysFor("shot", "concord.sporecaster", ["plasma"]))).toBe("boom.wav");
    expect(file(keysFor("shot", "vanguard.trooper", ["kinetic"]))).toBe("rivet-1.ogg");
    expect(resolveSound(config, keysFor("death", "vanguard.trooper", ["unit"]))).toBeNull();
  });
});

describe("spatial", () => {
  const right = Math.SQRT1_2;

  it("is full volume on screen and fades out beyond it", () => {
    expect(spatial(0, 0, 10, right, -right).gain).toBe(1);
    expect(spatial(10, 0, 10, right, -right).gain).toBe(1);
    expect(spatial(17.5, 0, 10, right, -right).gain).toBeCloseTo(0.5);
    expect(spatial(40, 0, 10, right, -right).gain).toBe(0);
  });

  it("pans by where the sound is across the screen, never hard over", () => {
    // Screen right is +X, -Z on the ground for this camera.
    expect(spatial(10 * right, -10 * right, 10, right, -right).pan).toBeCloseTo(0.7);
    expect(spatial(-10 * right, 10 * right, 10, right, -right).pan).toBeCloseTo(-0.7);
    // Straight up the screen is dead centre.
    expect(spatial(-5, -5, 10, right, -right).pan).toBeCloseTo(0);
    expect(spatial(100, -100, 10, right, -right).pan).toBe(0.7);
  });
});
