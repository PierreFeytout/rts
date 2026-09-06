import {
  CAN_ATTACK,
  CAN_GATHER,
  CAN_PRODUCE,
  IS_DROPOFF,
  KIND_BUILDING,
  KIND_RESOURCE,
  KIND_UNIT,
  NEEDS_VENT,
} from "@rts/sim";
import { describe, expect, it } from "vitest";
import { fixtureMap } from "./fixture-map.js";
import { buildContent, defaultContent } from "./index.js";
import { mapResources } from "./races/map-resources.js";
import { vanguard } from "./races/vanguard.js";
import { parseRace } from "./schema.js";

/**
 * Content-system tests.
 *
 * Two very different jobs here, and it is worth keeping them apart:
 *
 *   - The *loader* must reject broken content clearly. Those tests feed it
 *     deliberately wrong input.
 *   - The *shipped* content must be coherent. Those tests assert properties
 *     that must hold for every race, now and for every race added later, and
 *     are therefore written as loops over `defaultContent` rather than as a
 *     list of facts about the Vanguard.
 */

/** A deep copy of the Vanguard, to mutate freely in failure tests. */
function draft(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(vanguard)) as Record<string, unknown>;
}

describe("schema", () => {
  it("accepts content that arrived as JSON, not just as a TypeScript literal", () => {
    // The shipped races are literals today and could be files tomorrow. If the
    // schema only ever saw already-typed data it would be proving nothing, so
    // this pushes the real definition through a JSON round trip first.
    const asJson: unknown = JSON.parse(JSON.stringify(vanguard));
    const parsed = parseRace(asJson);
    expect(parsed.id).toBe("vanguard");
    expect(parsed.units.length).toBeGreaterThan(0);
  });

  it("fills in the optional fields a definition left out", () => {
    const parsed = parseRace(vanguard);
    const trooper = parsed.units.find((u) => u.id === "vanguard.trooper")!;
    expect(trooper.costPlasma).toBe(0);
    expect(trooper.builds).toEqual([]);
  });

  it("names the offending field when a stat is the wrong type", () => {
    const bad = draft();
    (bad.units as Array<Record<string, unknown>>)[0].maxHealth = "lots";
    expect(() => parseRace(bad)).toThrow(/maxHealth/);
  });

  it("rejects an unknown behaviour rather than ignoring it", () => {
    // Silently accepting this would give the unit an ability nothing reads,
    // which looks like a balance problem rather than a typo.
    const bad = draft();
    (bad.units as Array<Record<string, unknown>>)[0].behaviours = ["teleport"];
    expect(() => parseRace(bad)).toThrow(/behaviours/);
  });

  it("rejects an unknown field, so a misspelling is not silently dropped", () => {
    const bad = draft();
    (bad.units as Array<Record<string, unknown>>)[0].maxHelth = 999;
    expect(() => parseRace(bad)).toThrow();
  });

  it("requires namespaced ids", () => {
    const bad = draft();
    (bad.units as Array<Record<string, unknown>>)[0].id = "drone";
    expect(() => parseRace(bad)).toThrow(/race.thing/);
  });
});

describe("coherence checks", () => {
  const build = (race: unknown) => () => buildContent([race], mapResources, [fixtureMap]);

  it("rejects a producer that produces something undefined", () => {
    const bad = draft();
    (bad.buildings as Array<Record<string, unknown>>)[0].produces = ["vanguard.ghost"];
    expect(build(bad)).toThrow(/unknown id 'vanguard.ghost'/);
  });

  it("rejects an attacker with no weapon", () => {
    const bad = draft();
    const pylon = (bad.buildings as Array<Record<string, unknown>>).find(
      (b) => b.id === "vanguard.pylon",
    )!;
    pylon.behaviours = ["attack"];
    expect(build(bad)).toThrow(/no weapon/);
  });

  it("rejects a weapon on something that cannot attack", () => {
    const bad = draft();
    const pylon = (bad.buildings as Array<Record<string, unknown>>).find(
      (b) => b.id === "vanguard.pylon",
    )!;
    pylon.weapon = { damage: 5, damageType: "kinetic", range: 3, cooldown: 1 };
    expect(build(bad)).toThrow(/lacks the 'attack' behaviour/);
  });

  it("rejects a harvester that cannot carry anything", () => {
    const bad = draft();
    (bad.units as Array<Record<string, unknown>>)[0].cargoCapacity = 0;
    expect(build(bad)).toThrow(/cargoCapacity/);
  });

  it("rejects a race with nowhere to deliver alloy", () => {
    // Mined but never banked: the drones walk home forever and the player
    // watches an economy that produces nothing.
    const bad = draft();
    for (const b of bad.buildings as Array<Record<string, unknown>>) {
      if (Array.isArray(b.behaviours)) b.behaviours = b.behaviours.filter((x) => x !== "dropoff");
    }
    expect(build(bad)).toThrow(/dropoff/);
  });

  it("rejects a race whose starting worker cannot build", () => {
    const bad = draft();
    const drone = (bad.units as Array<Record<string, unknown>>).find(
      (u) => u.id === "vanguard.drone",
    )!;
    drone.behaviours = ["gather"];
    drone.builds = [];
    delete drone.weapon;
    expect(build(bad)).toThrow(/cannot build/);
  });

  it("rejects duplicate ids across races", () => {
    expect(() => buildContent([vanguard, vanguard], mapResources, [fixtureMap])).toThrow(/duplicate id/);
  });
});

describe("interning", () => {
  it("assigns ids by sorted content id, so definition order cannot matter", () => {
    const forward = buildContent([vanguard], mapResources, [fixtureMap]);
    const shuffled = JSON.parse(JSON.stringify(vanguard)) as typeof vanguard;
    shuffled.units.reverse();
    shuffled.buildings.reverse();
    const backward = buildContent([shuffled], [...mapResources].reverse(), [fixtureMap]);

    expect(backward.id("vanguard.drone")).toBe(forward.id("vanguard.drone"));
    expect(backward.hash).toBe(forward.hash);
  });

  it("never assigns id 0, which a cleared entity slot reads back as", () => {
    for (const type of defaultContent.types.all) expect(type.id).toBeGreaterThan(0);
  });

  it("round-trips numeric ids back to content ids", () => {
    for (const type of defaultContent.types.all) {
      expect(defaultContent.id(defaultContent.contentIdOf(type.id))).toBe(type.id);
    }
  });

  it("converts seconds and tiles into ticks and fixed-point", () => {
    const drone = defaultContent.types.get(defaultContent.id("vanguard.drone"));
    // 2.6 tiles/second at 20 ticks/second.
    expect(drone.moveSpeed).toBe(Math.round(0.13 * 65536));
    // 1.2 seconds of build time.
    expect(drone.buildTime).toBe(24);
    expect(drone.cooldown).toBe(22);
  });

  it("never rounds a real duration away to nothing", () => {
    // A 0.05s cooldown is 1 tick, not 0 -- a zero would make the weapon fire
    // every tick forever.
    const bad = draft();
    (bad.units as Array<Record<string, unknown>>)[1].weapon = {
      damage: 1,
      damageType: "kinetic",
      range: 1,
      cooldown: 0.05,
    };
    const set = buildContent([bad], mapResources, [fixtureMap]);
    expect(set.types.get(set.id("vanguard.trooper")).cooldown).toBeGreaterThanOrEqual(1);
  });
});

describe("content hash", () => {
  it("is stable across rebuilds of the same content", () => {
    expect(buildContent([vanguard], mapResources, [fixtureMap]).hash).toBe(
      buildContent([vanguard], mapResources, [fixtureMap]).hash,
    );
  });

  it("changes when a single stat changes by one", () => {
    // This is the whole point of the handshake: two peers whose content differs
    // by one number diverge on the first purchase, and the desync report then
    // blames the simulation.
    const tweaked = draft();
    const trooper = (tweaked.units as Array<Record<string, unknown>>).find(
      (u) => u.id === "vanguard.trooper",
    )!;
    trooper.maxHealth = (trooper.maxHealth as number) + 1;

    expect(buildContent([tweaked], mapResources, [fixtureMap]).hash).not.toBe(
      buildContent([vanguard], mapResources, [fixtureMap]).hash,
    );
  });

  it("changes when a unit is renamed, even though behaviour is unaffected", () => {
    // Two peers disagreeing about what a unit is *called* still disagree in
    // their UI, so a rename is worth refusing at the door even though it cannot
    // change how the simulation runs.
    const renamed = draft();
    const units = renamed.units as Array<Record<string, unknown>>;
    const buildings = renamed.buildings as Array<Record<string, unknown>>;
    units[0].id = "vanguard.worker";
    renamed.startUnit = "vanguard.worker";
    for (const building of buildings) {
      if (Array.isArray(building.produces)) {
        building.produces = building.produces.map((p) =>
          p === "vanguard.drone" ? "vanguard.worker" : p,
        );
      }
    }

    const before = buildContent([vanguard], mapResources, [fixtureMap]).hash;
    expect(buildContent([renamed], mapResources, [fixtureMap]).hash).not.toBe(before);
  });

  it("does not change when only presentation text changes", () => {
    // A blurb is lobby copy. Refusing a friend's connection because they have a
    // different marketing sentence would be absurd.
    const reworded = draft();
    reworded.blurb = "Completely different flavour text.";
    expect(buildContent([reworded], mapResources, [fixtureMap]).hash).toBe(
      buildContent([vanguard], mapResources, [fixtureMap]).hash,
    );
  });
});

describe("the shipped content", () => {
  it("defines at least two races", () => {
    expect(defaultContent.races.length).toBeGreaterThanOrEqual(2);
  });

  it("gives every race a complete, self-consistent kit", () => {
    // Written as a loop rather than a list of facts about the Vanguard, so a
    // race added tomorrow is held to the same standard without anyone
    // remembering to extend this test.
    for (const race of defaultContent.races) {
      const types = race.typeIds.map((id) => defaultContent.types.get(id));

      const workers = types.filter((t) => (t.abilities & CAN_GATHER) !== 0);
      const producers = types.filter((t) => (t.abilities & CAN_PRODUCE) !== 0);
      const dropoffs = types.filter((t) => (t.abilities & IS_DROPOFF) !== 0);
      const fighters = types.filter(
        (t) => (t.abilities & CAN_ATTACK) !== 0 && (t.abilities & CAN_GATHER) === 0,
      );

      expect(workers.length, `${race.id} has a harvester`).toBeGreaterThan(0);
      expect(dropoffs.length, `${race.id} has a drop-off`).toBeGreaterThan(0);
      expect(producers.length, `${race.id} can train units`).toBeGreaterThan(0);
      expect(fighters.length, `${race.id} has combat units`).toBeGreaterThanOrEqual(2);

      // Somewhere in the kit there must be a way to raise the supply cap, or
      // the race hard-stops at its opening army.
      const supply = types.filter((t) => t.supplyProvided > 0);
      expect(supply.length, `${race.id} can raise its supply cap`).toBeGreaterThan(0);

      // Everything a worker can build must be a building of that same race,
      // which is how a copy-pasted race is caught still pointing at the
      // original's structures.
      const worker = defaultContent.types.get(race.startUnit);
      for (const buildable of worker.builds) {
        expect(race.typeIds, `${race.id} builds only its own`).toContain(buildable);
        expect(defaultContent.types.get(buildable).kind).toBe(KIND_BUILDING);
      }
      for (const producer of producers) {
        for (const product of producer.produces) {
          expect(race.typeIds, `${race.id} trains only its own`).toContain(product);
          expect(defaultContent.types.get(product).kind).toBe(KIND_UNIT);
        }
      }
    }
  });

  it("prices everything, so nothing is free", () => {
    for (const type of defaultContent.types.all) {
      if (type.kind === KIND_RESOURCE) continue;
      expect(type.costAlloy + type.costPlasma, `${type.name} has a cost`).toBeGreaterThan(0);
      expect(type.buildTime, `${type.name} takes time to make`).toBeGreaterThan(0);
      expect(type.maxHealth, `${type.name} has health`).toBeGreaterThan(0);
    }
  });

  it("gives every mobile unit a speed and every building a footprint", () => {
    for (const type of defaultContent.types.all) {
      if (type.kind === KIND_UNIT) {
        expect(type.moveSpeed, `${type.name} moves`).toBeGreaterThan(0);
        expect(type.footprint).toBe(0);
      } else {
        expect(type.moveSpeed).toBe(0);
        expect(type.footprint, `${type.name} occupies tiles`).toBeGreaterThan(0);
      }
    }
  });

  it("provides a vent for every race that needs one", () => {
    const needsVent = defaultContent.types.all.filter((t) => (t.abilities & NEEDS_VENT) !== 0);
    expect(needsVent.length).toBeGreaterThan(0);
    const markers = defaultContent.resources.filter(
      (id) => defaultContent.types.get(id).resourceAmount === 0,
    );
    expect(markers.length).toBeGreaterThan(0);
  });
});
