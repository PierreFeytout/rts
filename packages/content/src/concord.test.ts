import {
  CMD_ATTACK_MOVE,
  CMD_BUILD,
  CMD_GATHER,
  CMD_TRAIN,
  KIND_BUILDING,
  KIND_UNIT,
  NEUTRAL_PLAYER,
  World,
  applyDamageTable,
  entityIndex,
  fxFromFloat,
  recomputeSupplyAndDefeat,
  spawnTyped,
  type Command,
  type EntityId,
} from "@rts/sim";
import { describe, expect, it } from "vitest";
import { defaultContent } from "./index.js";

/**
 * Race #2 is the extensibility test.
 *
 * The plan's requirement was not "make it possible to add a race" -- everything
 * is possible -- it was that adding one should be **cheap**, meaning it touches
 * content and nothing else. This file checks that claim two ways:
 *
 *   1. **Structurally.** The Concord uses no behaviour, damage type or armour
 *      class the Vanguard did not already use, so it demonstrably required no
 *      new engine surface. If someone adds a race that needs a genuinely novel
 *      mechanic, this test fails and the README's claim has to be re-earned.
 *   2. **Behaviourally.** It actually plays: harvests, builds, trains and
 *      fights, including against the other race, through the same simulation
 *      with no special cases.
 *
 * A claim of extensibility that is never exercised is a claim worth doubting,
 * so this runs a real match rather than inspecting a table.
 */

const content = defaultContent;
const MAP = 64;

const CONCORD = content.race("concord");
const VANGUARD = content.race("vanguard");
const ALLOY_NODE = content.id("map.alloy-node");
const VENT = content.id("map.vent");

describe("adding a race costs no engine code", () => {
  it("uses only behaviours the engine already implemented for race #1", () => {
    const used = (typeIds: readonly number[]): number => {
      let mask = 0;
      for (const id of typeIds) mask |= content.types.get(id).abilities;
      return mask;
    };

    const vanguardAbilities = used(VANGUARD.typeIds);
    const concordAbilities = used(CONCORD.typeIds);

    // Subset test: every bit the Concord sets, the Vanguard already set.
    expect(concordAbilities & ~vanguardAbilities).toBe(0);
    // And it is not trivially empty -- it really does use the behaviours.
    expect(concordAbilities).toBe(vanguardAbilities);
  });

  it("picks its damage types and armour classes from the engine's matrix", () => {
    for (const id of CONCORD.typeIds) {
      const type = content.types.get(id);
      // A race that could invent its own multipliers could quietly make itself
      // immune to everything, so this is a real constraint rather than a
      // formality: `applyDamageTable` must have an entry for every pairing.
      for (const armour of [0, 1, 2]) {
        expect(applyDamageTable(10, type.damageType, armour)).toBeGreaterThan(0);
      }
    }
  });

  it("is a genuinely different faction, not a reskin", () => {
    // Guards against the other failure mode: a "second race" that proves
    // extensibility by being the first one with the names changed.
    const stats = (typeIds: readonly number[]) =>
      typeIds
        .map((id) => content.types.get(id))
        .filter((t) => t.kind === KIND_UNIT)
        .map((t) => `${t.maxHealth}/${t.damage}/${t.range}/${t.cooldown}/${t.moveSpeed}`)
        .sort();

    const overlap = stats(CONCORD.typeIds).filter((s) => stats(VANGUARD.typeIds).includes(s));
    expect(overlap).toEqual([]);
  });
});

/**
 * A small two-base map, built entirely from content lookups.
 *
 * Note what this function does *not* contain: any unit or building name. It
 * asks each race what it starts with, which is exactly how `match.ts` does it,
 * and is why a new race is playable the moment it is defined.
 */
function twoBaseWorld(raceIds: [string, string]): {
  world: World;
  bases: Array<[number, number]>;
  workers: EntityId[][];
} {
  const world = new World({ mapTiles: MAP, seed: 77, types: content.types });
  const bases: Array<[number, number]> = [
    [8, 8],
    [40, 40],
  ];
  const workers: EntityId[][] = [[], []];

  bases.forEach(([bx, by], player) => {
    const race = content.race(raceIds[player]);
    world.placeStructure(race.startBuilding, bx, by, player);
    world.placeStructure(ALLOY_NODE, bx + 7, by, NEUTRAL_PLAYER);
    world.placeStructure(VENT, bx, by + 7, NEUTRAL_PLAYER);
    for (let d = 0; d < 4; d++) {
      workers[player].push(
        spawnTyped(
          world.entities,
          world.types,
          race.startUnit,
          fxFromFloat(bx + 5 + (d % 2) * 0.8),
          fxFromFloat(by + 4 + Math.floor(d / 2) * 0.8),
          player,
        ),
      );
    }
    world.players.inPlay[player] = 1;
  });

  recomputeSupplyAndDefeat(world);
  return { world, bases, workers };
}

function run(world: World, ticks: number, commands: Command[] = []): void {
  world.step(commands);
  for (let i = 1; i < ticks; i++) world.step([]);
}

/** Live entities of a type belonging to a player. */
function count(world: World, typeId: number, owner: number): number {
  const e = world.entities;
  let n = 0;
  for (let i = 0; i < e.highWater; i++) {
    if (e.alive[i] === 1 && e.typeId[i] === typeId && e.owner[i] === owner) n++;
  }
  return n;
}

function firstOf(world: World, typeId: number, owner: number): number {
  const e = world.entities;
  for (let i = 0; i < e.highWater; i++) {
    if (e.alive[i] === 1 && e.typeId[i] === typeId && e.owner[i] === owner) return i;
  }
  return -1;
}

describe("the Concord plays a real match", () => {
  it("harvests, builds, and trains through the same simulation", () => {
    const { world, bases, workers } = twoBaseWorld(["concord", "concord"]);
    const e = world.entities;
    const node = firstOf(world, ALLOY_NODE, NEUTRAL_PLAYER);
    const heartwood = firstOf(world, CONCORD.startBuilding, 0);
    const [bx, by] = bases[0];

    const grove = content.id("concord.grove");
    const bloom = content.id("concord.bloom");
    const thornling = content.id("concord.thornling");

    const startingAlloy = world.players.alloy[0];

    run(world, 5, [
      { kind: CMD_GATHER, playerId: 0, entities: workers[0], target: e.idAt(node) },
      {
        kind: CMD_BUILD,
        playerId: 0,
        entities: [workers[0][0]],
        buildingType: bloom,
        tileX: bx - 4,
        tileY: by + 3,
      },
      {
        kind: CMD_BUILD,
        playerId: 0,
        entities: [workers[0][1]],
        buildingType: grove,
        tileX: bx + 5,
        tileY: by - 4,
      },
      { kind: CMD_TRAIN, playerId: 0, building: e.idAt(heartwood), unitType: CONCORD.startUnit },
    ]);
    run(world, 400);

    // Economy ran, buildings finished, the extra Sporeling popped.
    expect(world.players.alloy[0]).toBeGreaterThan(startingAlloy - 400);
    expect(count(world, bloom, 0)).toBe(1);
    expect(count(world, grove, 0)).toBe(1);
    expect(count(world, CONCORD.startUnit, 0)).toBe(5);

    // And the Grove trains a unit the Vanguard has never heard of.
    const groveIndex = firstOf(world, grove, 0);
    run(world, 5, [
      { kind: CMD_TRAIN, playerId: 0, building: e.idAt(groveIndex), unitType: thornling },
    ]);
    run(world, 120);
    expect(count(world, thornling, 0)).toBe(1);
  });

  it("taps a vent with its own structure, on the shared map resource", () => {
    const { world, bases, workers } = twoBaseWorld(["concord", "concord"]);
    const siphon = content.id("concord.siphon");
    const [bx, by] = bases[0];
    const plasmaBefore = world.players.plasma[0];

    run(world, 5, [
      {
        kind: CMD_BUILD,
        playerId: 0,
        entities: workers[0],
        buildingType: siphon,
        tileX: bx,
        tileY: by + 7,
      },
    ]);
    run(world, 400);

    expect(count(world, siphon, 0)).toBe(1);
    expect(world.entities.buildRemaining[firstOf(world, siphon, 0)]).toBe(0);
    // The Siphon produces 4/second where the Vanguard's Extractor produces 3.
    expect(world.players.plasma[0]).toBeGreaterThan(plasmaBefore);
  });
});

describe("the two races fight each other", () => {
  /**
   * One engagement between eight Troopers and eight Thornlings, started at a
   * chosen separation. Returns how many of each side lived.
   */
  function skirmish(separation: number): { blue: number; green: number } {
    const { world } = twoBaseWorld(["vanguard", "concord"]);
    const e = world.entities;
    const trooper = content.id("vanguard.trooper");
    const thornling = content.id("concord.thornling");

    const blue: EntityId[] = [];
    const green: EntityId[] = [];
    for (let i = 0; i < 8; i++) {
      blue.push(
        spawnTyped(e, content.types, trooper, fxFromFloat(24 + i * 0.7), fxFromFloat(24), 0),
      );
      green.push(
        spawnTyped(
          e,
          content.types,
          thornling,
          fxFromFloat(24 + i * 0.7),
          fxFromFloat(24 + separation),
          1,
        ),
      );
    }
    world.players.supplyCap[0] = 100;
    world.players.supplyCap[1] = 100;

    run(world, 5, [
      {
        kind: CMD_ATTACK_MOVE,
        playerId: 0,
        entities: blue,
        targetX: fxFromFloat(27),
        targetY: fxFromFloat(24 + separation),
      },
      {
        kind: CMD_ATTACK_MOVE,
        playerId: 1,
        entities: green,
        targetX: fxFromFloat(27),
        targetY: fxFromFloat(24),
      },
    ]);
    run(world, 700);

    return {
      blue: blue.filter((id) => e.isAlive(id)).length,
      green: green.filter((id) => e.isAlive(id)).length,
    };
  }

  it("resolves cross-race combat through the shared damage matrix", () => {
    const open = skirmish(6);
    const contact = skirmish(1.6);

    // Both engagements were real.
    expect(open.blue + open.green).toBeLessThan(16);
    expect(contact.blue + contact.green).toBeLessThan(16);

    // The mechanic under test is *range*, not the current balance numbers.
    // Thornlings out-damage Troopers roughly two to one but have to cross five
    // tiles to do it, so the same eight units win or lose on where the fight
    // starts. Asserting the direction of that swing tests the engine; asserting
    // exact survivor counts would just pin down this week's tuning.
    expect(open.blue).toBeGreaterThan(open.green);
    expect(contact.green).toBeGreaterThan(contact.blue);
  });

  it("lets each race build only its own structures", () => {
    const { world, bases, workers } = twoBaseWorld(["vanguard", "concord"]);
    const [bx, by] = bases[0];
    const grove = content.id("concord.grove");
    const before = world.players.alloy[0];

    // A Vanguard drone told to build a Concord Grove. The command names a
    // legitimate building type, so this is refused by the ownership of the
    // *build list*, not by the type table.
    run(world, 10, [
      {
        kind: CMD_BUILD,
        playerId: 0,
        entities: [workers[0][0]],
        buildingType: grove,
        tileX: bx + 5,
        tileY: by - 4,
      },
    ]);

    expect(world.players.alloy[0]).toBe(before);
    expect(count(world, grove, 0)).toBe(0);
  });

  it("keeps a race's units under its own supply rules", () => {
    // The Heartwood provides 12 supply where the Nexus provides 10, so the two
    // races legitimately have different opening caps -- a difference that must
    // come out of content rather than out of a branch in the engine.
    const nexus = content.types.get(VANGUARD.startBuilding);
    const heartwood = content.types.get(CONCORD.startBuilding);
    expect(heartwood.supplyProvided).not.toBe(nexus.supplyProvided);

    const { world } = twoBaseWorld(["vanguard", "concord"]);
    world.step([]);
    expect(world.players.supplyCap[0]).toBe(nexus.supplyProvided);
    expect(world.players.supplyCap[1]).toBe(heartwood.supplyProvided);
  });
});

describe("both races are stable in the same simulation", () => {
  it("produces identical hashes from an identical command stream", () => {
    const play = (): number[] => {
      const { world, workers, bases } = twoBaseWorld(["vanguard", "concord"]);
      const e = world.entities;
      const node = firstOf(world, ALLOY_NODE, NEUTRAL_PLAYER);
      const hashes: number[] = [];

      for (let t = 0; t < 400; t++) {
        const commands: Command[] = [];
        if (t === 2) {
          for (const player of [0, 1]) {
            commands.push({
              kind: CMD_GATHER,
              playerId: player,
              entities: workers[player],
              target: e.idAt(node),
            });
          }
        }
        if (t === 20) {
          for (const player of [0, 1]) {
            const race = player === 0 ? VANGUARD : CONCORD;
            const hq = firstOf(world, race.startBuilding, player);
            commands.push({
              kind: CMD_TRAIN,
              playerId: player,
              building: e.idAt(hq),
              unitType: race.startUnit,
            });
          }
        }
        if (t === 60) {
          const [bx, by] = bases[1];
          commands.push({
            kind: CMD_BUILD,
            playerId: 1,
            entities: [workers[1][0]],
            buildingType: content.id("concord.bloom"),
            tileX: bx - 4,
            tileY: by + 3,
          });
        }
        world.step(commands);
        if (t % 100 === 0) hashes.push(world.hash());
      }
      return hashes;
    };

    expect(play()).toEqual(play());
  });

  it("interns both races into one flat table with no collisions", () => {
    const seen = new Set<number>();
    for (const race of content.races) {
      for (const id of race.typeIds) {
        expect(seen.has(id), `type ${id} claimed twice`).toBe(false);
        seen.add(id);
      }
    }
    for (const id of content.resources) expect(seen.has(id)).toBe(false);

    // Every entry in the table is either a race's or the map's; nothing is
    // orphaned, which is how a half-removed race would show up.
    const accounted = seen.size + content.resources.length;
    expect(accounted).toBe(content.types.all.length);
  });
});

/** Sanity: the world helper itself is not quietly building nothing. */
describe("test scaffolding", () => {
  it("places a base for each race", () => {
    const { world } = twoBaseWorld(["vanguard", "concord"]);
    expect(count(world, VANGUARD.startBuilding, 0)).toBe(1);
    expect(count(world, CONCORD.startBuilding, 1)).toBe(1);
    expect(content.types.get(VANGUARD.startBuilding).kind).toBe(KIND_BUILDING);
    expect(entityIndex(world.entities.idAt(0))).toBe(0);
  });
});
