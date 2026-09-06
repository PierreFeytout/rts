import { MAX_PLAYERS } from "@rts/sim";
import { describe, expect, it } from "vitest";
import { fixtureMap } from "./fixture-map.js";
import { buildContent, defaultContent } from "./index.js";
import { mapResources } from "./races/map-resources.js";
import { vanguard } from "./races/vanguard.js";

/**
 * Map loading, in two halves like the content tests.
 *
 * The failure tests feed the loader maps that are wrong in one specific way
 * each. Every one of them describes a map that passes field validation and is
 * unplayable -- which is the only reason the coherence pass exists.
 *
 * The shipped-map tests are written as loops over `defaultContent.maps` rather
 * than as facts about Rift Basin, so a map added later is held to the same bar
 * without anybody remembering to add assertions for it.
 */

/** A deep copy of the fixture, to break in one place at a time. */
function draft(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(fixtureMap)) as Record<string, unknown>;
}

/** Load one map through the real door, so schema and coherence both run. */
const load = (map: unknown) => () => buildContent([vanguard], mapResources, [map]);

describe("map schema", () => {
  it("accepts the fixture", () => {
    expect(load(fixtureMap)).not.toThrow();
  });

  it("names the offending map rather than saying 'a map'", () => {
    const bad = draft();
    bad.size = 12;
    // A map set is loaded as an array. "invalid map" with no id sends whoever
    // is editing them to check all of them.
    expect(load(bad)).toThrow(/'fixture'/);
  });

  it("rejects an unknown field, so a typo is not silently ignored", () => {
    const bad = draft();
    bad.maxPlayers = 4;
    expect(load(bad)).toThrow(/invalid/);
  });

  it("refuses a map larger than the fixed-point bound allows", () => {
    // 1024 tiles is 2^26 in Q16.16, which is exactly FX_MAX_OPERAND. Beyond it
    // coordinate products stop being exact in float64, and the symptom is a
    // desync rather than a visual glitch.
    const bad = draft();
    bad.size = 2048;
    expect(load(bad)).toThrow(/invalid/);
  });

  it("accepts a map at exactly the bound", () => {
    const big = draft();
    big.size = 1024;
    expect(load(big)).not.toThrow();
  });
});

describe("map coherence", () => {
  it("refuses more starts than a match seats", () => {
    const bad = draft();
    bad.starts = [
      { x: 8, y: 8 },
      { x: 48, y: 8 },
      { x: 8, y: 48 },
      { x: 48, y: 48 },
      { x: 28, y: 28 },
    ];
    expect(load(bad)).toThrow(new RegExp(`seats ${MAX_PLAYERS}`));
  });

  it("refuses a start too close to the edge to fit a headquarters", () => {
    const bad = draft();
    bad.starts = [
      { x: 0, y: 0 },
      { x: 48, y: 48 },
    ];
    expect(load(bad)).toThrow(/too close to the edge/);
  });

  it("refuses two starts inside each other's opening", () => {
    const bad = draft();
    bad.starts = [
      { x: 8, y: 8 },
      { x: 20, y: 8 },
    ];
    expect(load(bad)).toThrow(/tiles apart/);
  });

  it("refuses terrain dropped on a start, which would wall that player in", () => {
    const bad = draft();
    bad.blocks = [[8, 8, 4, 4]];
    expect(load(bad)).toThrow(/would wall that player in/);
  });

  it("refuses a block that runs off the map", () => {
    const bad = draft();
    bad.blocks = [[60, 60, 10, 10]];
    expect(load(bad)).toThrow(/falls outside the map/);
  });

  it("refuses a resource off the map, footprint included", () => {
    const bad = draft();
    // x 63 with a footprint of 2 reaches tile 64, which does not exist.
    (bad.resources as Array<Record<string, unknown>>).push({
      type: "map.alloy-node",
      x: 63,
      y: 20,
    });
    expect(load(bad)).toThrow(/falls outside the map/);
  });

  it("refuses overlapping resources, which would silently drop one", () => {
    const bad = draft();
    (bad.resources as Array<Record<string, unknown>>).push({
      type: "map.alloy-node",
      x: 16,
      y: 9,
    });
    expect(load(bad)).toThrow(/overlap/);
  });

  it("refuses a resource buried under terrain", () => {
    const bad = draft();
    // Out in the middle, so this trips the resource check rather than the
    // clearance check around a start.
    (bad.resources as Array<Record<string, unknown>>).push({
      type: "map.alloy-node",
      x: 30,
      y: 20,
    });
    bad.blocks = [[30, 20, 2, 2]];
    expect(load(bad)).toThrow(/buried under terrain/);
  });

  it("refuses a start with nothing to mine", () => {
    const bad = draft();
    bad.resources = [
      { type: "map.vent", x: 4, y: 11 },
      { type: "map.alloy-node", x: 55, y: 48 },
      { type: "map.vent", x: 44, y: 51 },
    ];
    expect(load(bad)).toThrow(/no harvestable resource/);
  });

  it("refuses a start with no vent", () => {
    const bad = draft();
    bad.resources = [
      { type: "map.alloy-node", x: 15, y: 8 },
      { type: "map.alloy-node", x: 55, y: 48 },
      { type: "map.vent", x: 44, y: 51 },
    ];
    expect(load(bad)).toThrow(/no vent/);
  });

  it("refuses a resource whose content id does not exist", () => {
    const bad = draft();
    (bad.resources as Array<Record<string, unknown>>)[0] = {
      type: "map.gold",
      x: 15,
      y: 8,
    };
    expect(load(bad)).toThrow(/unknown id 'map.gold'/);
  });

  it("refuses two maps sharing an id", () => {
    expect(() => buildContent([vanguard], mapResources, [fixtureMap, fixtureMap])).toThrow(
      /duplicate map id/,
    );
  });

  it("refuses a content set with no maps at all", () => {
    // Not pedantry: the lobby's map picker would be empty and nothing could be
    // started, which reads as a broken lobby rather than as missing content.
    expect(() => buildContent([vanguard], mapResources, [])).toThrow(/no maps defined/);
  });
});

describe("the shipped maps", () => {
  it("ships the two the lobby offers", () => {
    expect(defaultContent.maps.map((m) => m.id)).toEqual(["rift-basin", "sprawl"]);
  });

  it("seats at least two players on every map", () => {
    for (const map of defaultContent.maps) {
      expect(map.maxPlayers).toBe(map.starts.length);
      expect(map.maxPlayers).toBeGreaterThanOrEqual(2);
      expect(map.maxPlayers).toBeLessThanOrEqual(MAX_PLAYERS);
    }
  });

  it("gives every start an economy, on every map", () => {
    // The coherence pass already enforces this at load. Asserting it here is
    // what makes a *newly added* map fail in a test named for the problem
    // rather than at import time inside whichever suite ran first.
    for (const map of defaultContent.maps) {
      for (const start of map.starts) {
        const near = map.resources.filter(
          (r) => (r.x - start.x) ** 2 + (r.y - start.y) ** 2 <= 20 * 20,
        );
        expect(near.some((r) => defaultContent.types.get(r.typeId).resourceAmount > 0)).toBe(true);
        expect(near.some((r) => defaultContent.types.get(r.typeId).resourceAmount === 0)).toBe(true);
      }
    }
  });

  it("looks the two of them up by id", () => {
    expect(defaultContent.map("rift-basin").size).toBe(256);
    expect(defaultContent.map("sprawl").size).toBe(1024);
    expect(() => defaultContent.map("nowhere")).toThrow(/unknown map/);
  });
});

describe("the content hash", () => {
  it("changes when a map moves", () => {
    const moved = draft();
    moved.starts = [
      { x: 9, y: 8 },
      { x: 48, y: 48 },
    ];
    // Maps decide where every entity in the match begins. Two peers who picked
    // "Rift Basin" and got different ideas of it should be refused at the door
    // rather than desync on the first order.
    expect(buildContent([vanguard], mapResources, [moved]).hash).not.toBe(
      buildContent([vanguard], mapResources, [fixtureMap]).hash,
    );
  });

  it("does not change when only a map's presentation text changes", () => {
    const reworded = draft();
    reworded.name = "Somewhere Else";
    reworded.blurb = "Reworded.";
    expect(buildContent([vanguard], mapResources, [reworded]).hash).toBe(
      buildContent([vanguard], mapResources, [fixtureMap]).hash,
    );
  });
});
