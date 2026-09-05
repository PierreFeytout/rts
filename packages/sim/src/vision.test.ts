import { beforeAll, describe, expect, it } from "vitest";
import { CMD_ATTACK, type Command } from "./commands.js";
import { NULL_ENTITY, entityIndex, spawnTyped, type EntityId } from "./entities.js";
import { enableDevChecks, fxFromFloat } from "./fixed.js";
import { FX_HQ, FX_SOLDIER, FX_WORKER, fixtureTypes } from "./fixture-types.js";
import { encodeSnapshot, decodeSnapshot } from "./snapshot.js";
import {
  ARMOUR_LIGHT,
  CAN_ATTACK,
  DAMAGE_KINETIC,
  KIND_UNIT,
  TypeTable,
} from "./types.js";
import { VIS_EXPLORED, VIS_HIDDEN, VIS_VISIBLE } from "./vision.js";
import { World } from "./world.js";

beforeAll(() => {
  enableDevChecks(true);
});

function newWorld(): World {
  return new World({ mapTiles: 64, seed: 4242, types: fixtureTypes });
}

function run(world: World, ticks: number, commands: Command[] = []): void {
  world.step(commands);
  for (let i = 1; i < ticks; i++) world.step([]);
}

describe("fog of war", () => {
  it("lights a circle around a unit and leaves the rest dark", () => {
    const world = newWorld();
    spawnTyped(world.entities, world.types, FX_SOLDIER, fxFromFloat(20.5), fxFromFloat(20.5), 0);
    world.step([]);

    // Soldier vision is 9 tiles.
    expect(world.vision.levelAt(0, 20, 20)).toBe(VIS_VISIBLE);
    expect(world.vision.levelAt(0, 28, 20)).toBe(VIS_VISIBLE);
    expect(world.vision.levelAt(0, 40, 20)).toBe(VIS_HIDDEN);
    // And the circle really is a circle, not a square.
    expect(world.vision.levelAt(0, 27, 27)).toBe(VIS_HIDDEN);
  });

  it("remembers where a unit has been after it moves on", () => {
    const world = newWorld();
    const scout = spawnTyped(
      world.entities,
      world.types,
      FX_SOLDIER,
      fxFromFloat(20.5),
      fxFromFloat(20.5),
      0,
    );
    world.step([]);
    expect(world.vision.levelAt(0, 20, 20)).toBe(VIS_VISIBLE);

    world.entities.despawn(scout);
    world.step([]);

    expect(world.vision.levelAt(0, 20, 20)).toBe(VIS_EXPLORED);
    expect(world.vision.levelAt(0, 40, 20)).toBe(VIS_HIDDEN);
  });

  it("gives each player its own fog", () => {
    const world = newWorld();
    spawnTyped(world.entities, world.types, FX_SOLDIER, fxFromFloat(10.5), fxFromFloat(10.5), 0);
    spawnTyped(world.entities, world.types, FX_SOLDIER, fxFromFloat(50.5), fxFromFloat(50.5), 1);
    world.step([]);

    expect(world.vision.isVisible(0, 10, 10)).toBe(true);
    expect(world.vision.isVisible(1, 10, 10)).toBe(false);
    expect(world.vision.isVisible(1, 50, 50)).toBe(true);
    expect(world.vision.isVisible(0, 50, 50)).toBe(false);
  });

  it("grants no sight to neutral scenery", () => {
    // An ore patch that lit the map around itself would hand every player free
    // vision of every expansion.
    const world = newWorld();
    world.placeStructure(FX_HQ, 30, 30, -1);
    world.step([]);
    expect(world.vision.isVisible(0, 30, 30)).toBe(false);
  });
});

/**
 * A table with a deliberately blind sniper: range 10, vision 4.
 *
 * Content validation forbids this pairing precisely because it makes a unit
 * useless -- but the ENGINE must still behave correctly given it, and building
 * it here is the only way to test the sight gate directly. Everywhere else,
 * vision comfortably exceeds range, so a target in weapon range is always
 * visible and the gate never fires.
 */
const SNIPER = 2;
const SPOTTER = 4;
const blindTypes = new TypeTable([
  {
    id: SNIPER,
    name: "Sniper",
    kind: KIND_UNIT,
    abilities: CAN_ATTACK,
    maxHealth: 100,
    armour: ARMOUR_LIGHT,
    radius: fxFromFloat(0.32),
    footprint: 0,
    moveSpeed: fxFromFloat(0.1),
    turnRate: 3600,
    damage: 10,
    damageType: DAMAGE_KINETIC,
    range: fxFromFloat(10),
    cooldown: 10,
    visionRange: 4,
    costAlloy: 100,
    costPlasma: 0,
    buildTime: 20,
    supplyCost: 1,
    supplyProvided: 0,
    produces: [],
    builds: [],
    cargoCapacity: 0,
    gatherTime: 0,
    resourceAmount: 0,
    plasmaPerSecond: 0,
  },
  {
    id: SPOTTER,
    name: "Spotter",
    kind: KIND_UNIT,
    abilities: 0,
    maxHealth: 100,
    armour: ARMOUR_LIGHT,
    radius: fxFromFloat(0.32),
    footprint: 0,
    moveSpeed: fxFromFloat(0.1),
    turnRate: 3600,
    damage: 0,
    damageType: DAMAGE_KINETIC,
    range: 0,
    cooldown: 20,
    visionRange: 14,
    costAlloy: 50,
    costPlasma: 0,
    buildTime: 20,
    supplyCost: 1,
    supplyProvided: 0,
    produces: [],
    builds: [],
    cargoCapacity: 0,
    gatherTime: 0,
    resourceAmount: 0,
    plasmaPerSecond: 0,
  },
]);

function blindWorld(): World {
  return new World({ mapTiles: 64, seed: 4242, types: blindTypes });
}

describe("fog and combat", () => {
  it("does not fire on a target that is in range but out of sight", () => {
    const world = blindWorld();
    const sniper = spawnTyped(
      world.entities,
      world.types,
      SNIPER,
      fxFromFloat(20.5),
      fxFromFloat(20.5),
      0,
    );
    // Seven tiles: well inside the sniper's range of 10, well outside its
    // sight of 4.
    const target = spawnTyped(
      world.entities,
      world.types,
      SPOTTER,
      fxFromFloat(27.5),
      fxFromFloat(20.5),
      1,
    );
    void sniper;

    run(world, 100);
    expect(world.vision.canSee(0, world.entities, entityIndex(target))).toBe(false);
    expect(world.entities.health[entityIndex(target)]).toBe(100);
  });

  it("fires the moment something else provides the sight", () => {
    // The same shot, with a friendly spotter parked near the target. This is
    // the pairing the gate exists for: sight and weapons on different units.
    const world = blindWorld();
    spawnTyped(world.entities, world.types, SNIPER, fxFromFloat(20.5), fxFromFloat(20.5), 0);
    const target = spawnTyped(
      world.entities,
      world.types,
      SPOTTER,
      fxFromFloat(27.5),
      fxFromFloat(20.5),
      1,
    );
    spawnTyped(world.entities, world.types, SPOTTER, fxFromFloat(26.5), fxFromFloat(20.5), 0);

    run(world, 100);
    expect(world.vision.canSee(0, world.entities, entityIndex(target))).toBe(true);
    expect(world.entities.health[entityIndex(target)]).toBeLessThan(100);
  });

  it("does not return fire on an attacker it cannot see", () => {
    // Being shot out of the dark must not hand out free vision. Both sides are
    // snipers, so each can shoot four tiles further than it can see; only the
    // one with a spotter can actually engage.
    const world = blindWorld();
    const attacker = spawnTyped(
      world.entities,
      world.types,
      SNIPER,
      fxFromFloat(20.5),
      fxFromFloat(20.5),
      0,
    );
    const victim = spawnTyped(
      world.entities,
      world.types,
      SNIPER,
      fxFromFloat(27.5),
      fxFromFloat(20.5),
      1,
    );
    // A spotter for player 0 only.
    spawnTyped(world.entities, world.types, SPOTTER, fxFromFloat(25.5), fxFromFloat(20.5), 0);

    run(world, 120);

    // The victim is being hit...
    expect(world.entities.health[entityIndex(victim)]).toBeLessThan(100);
    // ...and cannot shoot back, because it still cannot see who is shooting.
    expect(world.entities.targetId[entityIndex(victim)]).toBe(NULL_ENTITY);
    expect(world.entities.health[entityIndex(attacker)]).toBe(100);
  });

  it("lets an explicit attack order chase a target into fog", () => {
    // Auto-acquisition is gated by sight; a player's explicit order is not.
    // They saw the target when they issued it, and having units abandon a
    // chase the moment it entered fog would be maddening.
    const world = newWorld();
    const hunter = spawnTyped(
      world.entities,
      world.types,
      FX_SOLDIER,
      fxFromFloat(10.5),
      fxFromFloat(10.5),
      0,
    );
    const prey = spawnTyped(
      world.entities,
      world.types,
      FX_WORKER,
      fxFromFloat(40.5),
      fxFromFloat(10.5),
      1,
    );

    // 30 tiles away: far outside the hunter's 9-tile sight.
    expect(world.vision.canSee(0, world.entities, entityIndex(prey))).toBe(false);

    run(world, 900, [{ kind: CMD_ATTACK, playerId: 0, entities: [hunter], target: prey }]);
    expect(world.entities.isAlive(prey)).toBe(false);
  });
});

describe("fog is presentation state, not world state", () => {
  it("is excluded from the state hash", () => {
    // Two worlds identical except for where their units have BEEN must agree:
    // `explored` is map memory, and peers are expected to differ on it.
    const a = newWorld();
    const b = newWorld();
    for (const world of [a, b]) {
      spawnTyped(world.entities, world.types, FX_SOLDIER, fxFromFloat(20.5), fxFromFloat(20.5), 0);
    }
    a.step([]);
    b.step([]);
    expect(a.hash()).toBe(b.hash());

    // Now dirty one side's memory without touching anything the sim reads.
    b.vision.explored.fill(1);
    expect(b.hash()).toBe(a.hash());
  });

  it("is not carried in a snapshot, so a resync keeps its own map memory", () => {
    const host = newWorld();
    const guest = newWorld();
    spawnTyped(host.entities, host.types, FX_SOLDIER, fxFromFloat(50.5), fxFromFloat(50.5), 0);
    run(host, 5);

    // The guest has explored its own corner and knows nothing of the host's.
    spawnTyped(guest.entities, guest.types, FX_SOLDIER, fxFromFloat(8.5), fxFromFloat(8.5), 0);
    run(guest, 5);
    expect(guest.vision.isExplored(0, 8, 8)).toBe(true);

    decodeSnapshot(guest, encodeSnapshot(host));

    // Being handed the host's memory would show a player ground they never
    // scouted, so the snapshot deliberately does not carry it.
    expect(guest.vision.isExplored(0, 50, 50)).toBe(false);
    // And the guest's own memory survives the resync intact.
    expect(guest.vision.isExplored(0, 8, 8)).toBe(true);
    expect(guest.hash()).toBe(host.hash());
  });

  it("keeps the snapshot small on a big map", () => {
    const world = new World({ mapTiles: 256, seed: 1, types: fixtureTypes });
    const ids: EntityId[] = [];
    for (let i = 0; i < 400; i++) {
      ids.push(
        spawnTyped(
          world.entities,
          world.types,
          FX_SOLDIER,
          fxFromFloat(10 + (i % 20) * 0.5),
          fxFromFloat(10 + Math.floor(i / 20) * 0.5),
          i % 4,
        ),
      );
    }
    run(world, 3);
    const bytes = encodeSnapshot(world).byteLength;
    // Fog on a 256 map is 256 kB per player. Shipping it would have made a
    // resync five times larger than everything else combined.
    expect(bytes, `${(bytes / 1024).toFixed(1)} KiB`).toBeLessThan(128 * 1024);
  });
});

describe("performance", () => {
  it("recomputes vision for 400 units well inside the tick budget", () => {
    const world = new World({ mapTiles: 256, seed: 9, types: fixtureTypes });
    for (let i = 0; i < 400; i++) {
      spawnTyped(
        world.entities,
        world.types,
        FX_SOLDIER,
        fxFromFloat(40 + (i % 20) * 1.5),
        fxFromFloat(40 + Math.floor(i / 20) * 1.5),
        i % 4,
      );
    }
    world.step([]);

    const started = performance.now();
    for (let i = 0; i < 20; i++) world.vision.update(world.entities, world.types);
    const perUpdate = (performance.now() - started) / 20;

    // The whole tick budget is 50 ms; fog must be a rounding error in it.
    expect(perUpdate, `${perUpdate.toFixed(2)} ms`).toBeLessThan(6);
  });
});
