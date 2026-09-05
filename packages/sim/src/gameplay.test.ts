import { describe, expect, it } from "vitest";
import {
  ARMOUR_HEAVY,
  ARMOUR_LIGHT,
  ARMOUR_STRUCTURE,
  CMD_ATTACK,
  CMD_BUILD,
  CMD_CANCEL_TRAIN,
  CMD_GATHER,
  CMD_MOVE,
  CMD_RALLY,
  CMD_TRAIN,
  DAMAGE_EXPLOSIVE,
  DAMAGE_KINETIC,
  DAMAGE_PLASMA,
  EV_BLOCKED,
  EV_DEATH,
  EV_UNIT_TRAINED,
  BLOCKED_RESOURCES,
  BLOCKED_SUPPLY,
  ORDER_GATHER,
  ORDER_NONE,
  ORDER_RETURN,
  T_ALLOY_NODE,
  T_DRONE,
  T_EXTRACTOR,
  T_FOUNDRY,
  T_HOVERTANK,
  T_NEXUS,
  T_PYLON,
  T_TROOPER,
  T_VENT,
  World,
  applyDamageTable,
  decodeSnapshot,
  encodeSnapshot,
  entityIndex,
  fxFromFloat,
  fxToFloat,
  killEntity,
  recomputeSupplyAndDefeat,
  spawnTyped,
  type Command,
  type EntityId,
} from "./index.js";

/**
 * Gameplay system tests.
 *
 * These are written against observable outcomes -- "the player has more alloy
 * than they started with", "the enemy building is gone" -- rather than against
 * internal counters. A test that asserts `buildRemaining === 37` passes right
 * up until the tuning changes, and tells you nothing about whether the game
 * works.
 */

function newWorld(): World {
  return new World({ mapTiles: 64, seed: 12345 });
}

/** Run n ticks with no commands. */
function run(world: World, ticks: number, commands: Command[] = []): void {
  world.step(commands);
  for (let i = 1; i < ticks; i++) world.step([]);
}

function pos(world: World, id: EntityId): [number, number] {
  const i = entityIndex(id);
  return [fxToFloat(world.entities.posX[i]), fxToFloat(world.entities.posY[i])];
}

function health(world: World, id: EntityId): number {
  const i = world.entities.indexOfLive(id);
  return i < 0 ? 0 : world.entities.health[i];
}

// ---------------------------------------------------------------------------

describe("damage table", () => {
  it("applies the armour matrix as integer percentages", () => {
    expect(applyDamageTable(100, DAMAGE_KINETIC, ARMOUR_LIGHT)).toBe(100);
    expect(applyDamageTable(100, DAMAGE_KINETIC, ARMOUR_HEAVY)).toBe(65);
    expect(applyDamageTable(100, DAMAGE_EXPLOSIVE, ARMOUR_STRUCTURE)).toBe(160);
    expect(applyDamageTable(100, DAMAGE_PLASMA, ARMOUR_HEAVY)).toBe(135);
  });

  it("gives every attacker a floor of 1, so nothing is immune", () => {
    // 1 damage at 60% rounds to 0, which would make a Plasma weapon literally
    // unable to ever destroy a structure no matter how long it fired.
    expect(applyDamageTable(1, DAMAGE_PLASMA, ARMOUR_STRUCTURE)).toBe(1);
  });

  it("rounds down rather than to nearest, so damage never exceeds the table", () => {
    expect(applyDamageTable(9, DAMAGE_KINETIC, ARMOUR_HEAVY)).toBe(5); // 5.85
  });
});

describe("combat", () => {
  it("auto-acquires a hostile in range without any order", () => {
    const world = newWorld();
    const a = spawnTyped(world.entities, world.types, T_TROOPER, fxFromFloat(20), fxFromFloat(20), 0);
    const b = spawnTyped(world.entities, world.types, T_TROOPER, fxFromFloat(23), fxFromFloat(20), 1);

    run(world, 20);
    expect(health(world, b)).toBeLessThan(90);
    expect(health(world, a)).toBeLessThan(90);
  });

  it("does not fire on a unit out of range", () => {
    const world = newWorld();
    spawnTyped(world.entities, world.types, T_TROOPER, fxFromFloat(20), fxFromFloat(20), 0);
    const b = spawnTyped(world.entities, world.types, T_TROOPER, fxFromFloat(40), fxFromFloat(20), 1);

    run(world, 40);
    expect(health(world, b)).toBe(90);
  });

  it("does not chase an auto-acquired target", () => {
    const world = newWorld();
    const a = spawnTyped(world.entities, world.types, T_TROOPER, fxFromFloat(20), fxFromFloat(20), 0);
    // Just outside range, so it is seen only if the leash lets it wander.
    spawnTyped(world.entities, world.types, T_TROOPER, fxFromFloat(28), fxFromFloat(20), 1);

    const before = pos(world, a);
    run(world, 60);
    const after = pos(world, a);
    expect(Math.abs(after[0] - before[0])).toBeLessThan(0.05);
  });

  it("chases and kills on an explicit attack order", () => {
    const world = newWorld();
    const a = spawnTyped(world.entities, world.types, T_TROOPER, fxFromFloat(20), fxFromFloat(20), 0);
    const b = spawnTyped(world.entities, world.types, T_DRONE, fxFromFloat(34), fxFromFloat(20), 1);

    run(world, 400, [{ kind: CMD_ATTACK, playerId: 0, entities: [a], target: b }]);
    expect(world.entities.isAlive(b)).toBe(false);
    expect(world.entities.isAlive(a)).toBe(true);
  });

  it("emits a death event carrying the position, for the effects layer", () => {
    const world = newWorld();
    const a = spawnTyped(world.entities, world.types, T_HOVERTANK, fxFromFloat(20), fxFromFloat(20), 0);
    const b = spawnTyped(world.entities, world.types, T_DRONE, fxFromFloat(23), fxFromFloat(20), 1);
    void a;

    let death: { x: number; y: number; owner: number } | null = null;
    for (let i = 0; i < 200 && death === null; i++) {
      world.step([]);
      for (const event of world.events.all) {
        if (event.kind === EV_DEATH && event.entity === b) {
          death = { x: fxToFloat(event.x), y: fxToFloat(event.y), owner: event.owner };
        }
      }
    }
    expect(death).not.toBeNull();
    expect(death!.owner).toBe(1);
    expect(death!.x).toBeGreaterThan(20);
  });

  it("clears a destroyed building's footprint so the tiles are walkable again", () => {
    const world = newWorld();
    const pylon = world.placeStructure(T_PYLON, 30, 30, 1);
    expect(world.grid.isBlocked(30, 30)).toBe(true);

    const i = entityIndex(pylon);
    world.entities.health[i] = 1;
    spawnTyped(world.entities, world.types, T_HOVERTANK, fxFromFloat(28), fxFromFloat(31), 0);

    run(world, 60);
    expect(world.entities.isAlive(pylon)).toBe(false);
    expect(world.grid.isBlocked(30, 30)).toBe(false);
  });

  it("never targets a resource node", () => {
    const world = newWorld();
    const node = world.placeStructure(T_ALLOY_NODE, 24, 24, -1);
    spawnTyped(world.entities, world.types, T_TROOPER, fxFromFloat(22), fxFromFloat(25), 0);

    run(world, 80);
    expect(world.entities.isAlive(node)).toBe(true);
  });
});

describe("harvesting", () => {
  /** A Nexus, an ore patch beside it, and one drone in between. */
  function economyWorld(): { world: World; drone: EntityId; node: EntityId } {
    const world = newWorld();
    world.placeStructure(T_NEXUS, 10, 10, 0);
    const node = world.placeStructure(T_ALLOY_NODE, 16, 10, -1);
    const drone = spawnTyped(
      world.entities,
      world.types,
      T_DRONE,
      fxFromFloat(14.5),
      fxFromFloat(11.5),
      0,
    );
    return { world, drone, node };
  }

  it("completes a round trip and banks the alloy", () => {
    const { world, drone, node } = economyWorld();
    const before = world.players.alloy[0];

    run(world, 90, [{ kind: CMD_GATHER, playerId: 0, entities: [drone], target: node }]);

    expect(world.players.alloy[0]).toBeGreaterThan(before);
    // A full load is 10; anything less means the drone deposited a partial
    // load, which would mean the mining timer and the cargo cap disagree.
    expect((world.players.alloy[0] - before) % 10).toBe(0);
  });

  it("loops back to the same patch after depositing", () => {
    const { world, drone, node } = economyWorld();
    run(world, 200, [{ kind: CMD_GATHER, playerId: 0, entities: [drone], target: node }]);

    const i = entityIndex(drone);
    expect([ORDER_GATHER, ORDER_RETURN]).toContain(world.entities.orderKind[i]);
    expect(world.entities.targetId[i]).toBe(node);
  });

  it("removes an exhausted patch and stops the drone cleanly", () => {
    const { world, drone, node } = economyWorld();
    world.entities.resource[entityIndex(node)] = 10;

    run(world, 200, [{ kind: CMD_GATHER, playerId: 0, entities: [drone], target: node }]);

    expect(world.entities.isAlive(node)).toBe(false);
    expect(world.grid.isBlocked(16, 10)).toBe(false);
    expect(world.entities.orderKind[entityIndex(drone)]).toBe(ORDER_NONE);
  });

  it("holds the cargo rather than losing it when the drop-off is destroyed", () => {
    const { world, drone, node } = economyWorld();
    run(world, 30, [{ kind: CMD_GATHER, playerId: 0, entities: [drone], target: node }]);

    // Wait for a full load, then take the base away mid-return.
    for (let i = 0; i < 60 && world.entities.cargo[entityIndex(drone)] === 0; i++) world.step([]);
    expect(world.entities.cargo[entityIndex(drone)]).toBeGreaterThan(0);

    const banked = world.players.alloy[0];
    // Removed through the real death path, so the footprint is cleared exactly
    // as it would be if a hovertank had shot it.
    for (let i = 0; i < world.entities.highWater; i++) {
      if (world.entities.alive[i] === 1 && world.entities.typeId[i] === T_NEXUS) {
        killEntity(world, i);
      }
    }
    run(world, 20);

    expect(world.players.alloy[0]).toBe(banked);
    expect(world.entities.cargo[entityIndex(drone)]).toBeGreaterThan(0);
  });

  it("refuses a gather order from a unit that cannot harvest", () => {
    const world = newWorld();
    const node = world.placeStructure(T_ALLOY_NODE, 16, 10, -1);
    const trooper = spawnTyped(
      world.entities,
      world.types,
      T_TROOPER,
      fxFromFloat(14),
      fxFromFloat(11),
      0,
    );
    run(world, 5, [{ kind: CMD_GATHER, playerId: 0, entities: [trooper], target: node }]);
    expect(world.entities.orderKind[entityIndex(trooper)]).toBe(ORDER_NONE);
  });
});

describe("extractors", () => {
  it("trickles plasma at exactly the advertised rate", () => {
    const world = newWorld();
    world.placeStructure(T_VENT, 20, 20, -1);
    // Placed directly rather than built, so the test measures the trickle and
    // not the construction time.
    world.placeStructure(T_EXTRACTOR, 30, 30, 0);
    const before = world.players.plasma[0];

    run(world, 200); // ten seconds at 20 Hz
    expect(world.players.plasma[0] - before).toBe(30); // 3/second
  });

  it("produces nothing while still under construction", () => {
    const world = newWorld();
    const site = world.placeStructure(T_EXTRACTOR, 30, 30, 0, false);
    expect(world.entities.buildRemaining[entityIndex(site)]).toBeGreaterThan(0);
    const before = world.players.plasma[0];
    run(world, 100);
    expect(world.players.plasma[0]).toBe(before);
  });
});

describe("construction", () => {
  function builderWorld(): { world: World; drone: EntityId } {
    const world = newWorld();
    const drone = spawnTyped(
      world.entities,
      world.types,
      T_DRONE,
      fxFromFloat(20.5),
      fxFromFloat(20.5),
      0,
    );
    world.players.inPlay[0] = 1;
    return { world, drone };
  }

  const buildPylon = (drone: EntityId): Command => ({
    kind: CMD_BUILD,
    playerId: 0,
    entities: [drone],
    buildingType: T_PYLON,
    tileX: 24,
    tileY: 24,
  });

  it("charges on placement, then finishes when the builder arrives", () => {
    const { world, drone } = builderWorld();
    const before = world.players.alloy[0];

    world.step([buildPylon(drone)]);
    expect(world.players.alloy[0]).toBe(before - 80);
    expect(world.grid.isBlocked(24, 24)).toBe(true);

    run(world, 160);

    let finished = false;
    for (let i = 0; i < world.entities.highWater; i++) {
      if (world.entities.alive[i] !== 1 || world.entities.typeId[i] !== T_PYLON) continue;
      finished = world.entities.buildRemaining[i] === 0;
      expect(world.entities.health[i]).toBe(400);
    }
    expect(finished).toBe(true);
    // A completed Pylon is what raises the supply cap.
    expect(world.players.supplyCap[0]).toBe(8);
  });

  it("refuses to place on occupied ground and charges nothing", () => {
    const { world, drone } = builderWorld();
    world.placeStructure(T_ALLOY_NODE, 24, 24, -1);
    const before = world.players.alloy[0];

    world.step([buildPylon(drone)]);
    expect(world.players.alloy[0]).toBe(before);
    expect(world.events.all.some((e) => e.kind === EV_BLOCKED)).toBe(true);
  });

  it("refuses to place without the alloy, and says why", () => {
    const { world, drone } = builderWorld();
    world.players.alloy[0] = 10;

    world.step([buildPylon(drone)]);
    expect(world.players.alloy[0]).toBe(10);
    const blocked = world.events.all.find((e) => e.kind === EV_BLOCKED);
    expect(blocked).toBeDefined();
    expect(blocked!.kind === EV_BLOCKED && blocked!.reason).toBe(BLOCKED_RESOURCES);
  });

  it("refuses a build command that names no builder the player controls", () => {
    const { world } = builderWorld();
    const enemyDrone = spawnTyped(
      world.entities,
      world.types,
      T_DRONE,
      fxFromFloat(20),
      fxFromFloat(20),
      1,
    );
    const before = world.players.alloy[0];
    world.step([buildPylon(enemyDrone)]);
    expect(world.players.alloy[0]).toBe(before);
    expect(world.grid.isBlocked(24, 24)).toBe(false);
  });

  it("builds an Extractor only on a vent, consuming it", () => {
    const { world, drone } = builderWorld();
    const vent = world.placeStructure(T_VENT, 24, 24, -1);
    const before = world.players.alloy[0];

    world.step([
      { kind: CMD_BUILD, playerId: 0, entities: [drone], buildingType: T_EXTRACTOR, tileX: 24, tileY: 24 },
    ]);

    expect(world.entities.isAlive(vent)).toBe(false);
    expect(world.players.alloy[0]).toBe(before - 100);
  });

  it("refuses an Extractor on bare ground, leaving the alloy alone", () => {
    const { world, drone } = builderWorld();
    const before = world.players.alloy[0];
    world.step([
      { kind: CMD_BUILD, playerId: 0, entities: [drone], buildingType: T_EXTRACTOR, tileX: 40, tileY: 40 },
    ]);
    expect(world.players.alloy[0]).toBe(before);
    expect(world.grid.isBlocked(40, 40)).toBe(false);
  });

  it("finishes roughly twice as fast with two builders", () => {
    function ticksToFinish(builders: number): number {
      const world = newWorld();
      const drones: EntityId[] = [];
      for (let d = 0; d < builders; d++) {
        drones.push(
          spawnTyped(
            world.entities,
            world.types,
            T_DRONE,
            fxFromFloat(22.5 + d * 0.8),
            fxFromFloat(21.5),
            0,
          ),
        );
      }
      world.step([
        { kind: CMD_BUILD, playerId: 0, entities: drones, buildingType: T_PYLON, tileX: 24, tileY: 24 },
      ]);
      for (let t = 1; t < 400; t++) {
        world.step([]);
        for (let i = 0; i < world.entities.highWater; i++) {
          if (world.entities.alive[i] !== 1) continue;
          if (world.entities.typeId[i] !== T_PYLON) continue;
          if (world.entities.buildRemaining[i] === 0) return t;
        }
      }
      return -1;
    }

    const one = ticksToFinish(1);
    const two = ticksToFinish(2);
    expect(one).toBeGreaterThan(0);
    expect(two).toBeGreaterThan(0);
    expect(two).toBeLessThan(one);
  });
});

describe("production", () => {
  function factoryWorld(): { world: World; nexus: EntityId } {
    const world = newWorld();
    const nexus = world.placeStructure(T_NEXUS, 20, 20, 0);
    world.players.inPlay[0] = 1;
    // Supply is a derived total, recomputed at the end of each tick. Priming it
    // here mirrors what match setup does, so tick 0 is not a dead tick where
    // nothing can be trained.
    recomputeSupplyAndDefeat(world);
    return { world, nexus };
  }

  it("charges on queue and delivers a unit next to the building", () => {
    const { world, nexus } = factoryWorld();
    const before = world.players.alloy[0];

    world.step([{ kind: CMD_TRAIN, playerId: 0, building: nexus, unitType: T_DRONE }]);
    expect(world.players.alloy[0]).toBe(before - 50);
    expect(world.entities.queueLen[entityIndex(nexus)]).toBe(1);

    run(world, 40);

    let drones = 0;
    for (let i = 0; i < world.entities.highWater; i++) {
      if (world.entities.alive[i] === 1 && world.entities.typeId[i] === T_DRONE) drones++;
    }
    expect(drones).toBe(1);
    expect(world.entities.queueLen[entityIndex(nexus)]).toBe(0);
  });

  it("counts queued units against supply before they exist", () => {
    const { world, nexus } = factoryWorld();
    world.step([{ kind: CMD_TRAIN, playerId: 0, building: nexus, unitType: T_DRONE }]);
    // The order was accepted this tick; the recompute at the end of it must
    // already reflect the queued drone, or a player could queue past their cap.
    expect(world.players.supplyUsed[0]).toBe(1);
  });

  it("refuses to queue past the supply cap without charging", () => {
    const { world, nexus } = factoryWorld();
    world.players.supplyCap[0] = 0;
    const before = world.players.alloy[0];

    world.step([{ kind: CMD_TRAIN, playerId: 0, building: nexus, unitType: T_DRONE }]);

    expect(world.players.alloy[0]).toBe(before);
    const blocked = world.events.all.find((e) => e.kind === EV_BLOCKED);
    expect(blocked!.kind === EV_BLOCKED && blocked!.reason).toBe(BLOCKED_SUPPLY);
  });

  it("refuses a unit the building cannot make", () => {
    const { world, nexus } = factoryWorld();
    const before = world.players.alloy[0];
    world.step([{ kind: CMD_TRAIN, playerId: 0, building: nexus, unitType: T_HOVERTANK }]);
    expect(world.players.alloy[0]).toBe(before);
    expect(world.entities.queueLen[entityIndex(nexus)]).toBe(0);
  });

  it("refunds a cancelled item", () => {
    const { world, nexus } = factoryWorld();
    const before = world.players.alloy[0];

    world.step([{ kind: CMD_TRAIN, playerId: 0, building: nexus, unitType: T_DRONE }]);
    world.step([{ kind: CMD_CANCEL_TRAIN, playerId: 0, building: nexus, position: 0 }]);

    expect(world.players.alloy[0]).toBe(before);
    expect(world.entities.queueLen[entityIndex(nexus)]).toBe(0);
  });

  it("sends finished units to the rally point", () => {
    const { world, nexus } = factoryWorld();
    world.step([
      { kind: CMD_RALLY, playerId: 0, entities: [nexus], targetX: fxFromFloat(34), targetY: fxFromFloat(34) },
      { kind: CMD_TRAIN, playerId: 0, building: nexus, unitType: T_DRONE },
    ]);

    let trained: EntityId = -1;
    for (let t = 0; t < 60 && trained < 0; t++) {
      world.step([]);
      for (const event of world.events.all) {
        if (event.kind === EV_UNIT_TRAINED) trained = event.entity;
      }
    }
    expect(trained).toBeGreaterThanOrEqual(0);

    const start = pos(world, trained);
    run(world, 60);
    const end = pos(world, trained);
    // Moving toward (34, 34) means both coordinates increase.
    expect(end[0]).toBeGreaterThan(start[0]);
    expect(end[1]).toBeGreaterThan(start[1]);
  });

  it("keeps the queue paid-for when the exit is blocked", () => {
    const world = newWorld();
    const foundry = world.placeStructure(T_FOUNDRY, 20, 20, 0);
    world.players.inPlay[0] = 1;
    recomputeSupplyAndDefeat(world);
    world.players.supplyCap[0] = 50;

    world.step([{ kind: CMD_TRAIN, playerId: 0, building: foundry, unitType: T_TROOPER }]);
    // Wall the factory in completely, all the way out past the search radius.
    world.grid.fillRect(13, 13, 17, 17, 1);
    world.grid.fillRect(20, 20, 3, 3, 1);

    run(world, 120);
    // Still queued, still paid for -- not silently cancelled and not duplicated.
    expect(world.entities.queueLen[entityIndex(foundry)]).toBe(1);
  });
});

describe("ownership", () => {
  it("ignores orders aimed at another player's units", () => {
    const world = newWorld();
    const mine = spawnTyped(world.entities, world.types, T_TROOPER, fxFromFloat(20), fxFromFloat(20), 0);
    const before = pos(world, mine);

    run(world, 40, [
      { kind: CMD_MOVE, playerId: 1, entities: [mine], targetX: fxFromFloat(40), targetY: fxFromFloat(40) },
    ]);

    const after = pos(world, mine);
    expect(Math.abs(after[0] - before[0])).toBeLessThan(0.05);
  });

  it("ignores a train order issued against someone else's building", () => {
    const world = newWorld();
    const nexus = world.placeStructure(T_NEXUS, 20, 20, 0);
    recomputeSupplyAndDefeat(world);
    const before = world.players.alloy[1];

    world.step([{ kind: CMD_TRAIN, playerId: 1, building: nexus, unitType: T_DRONE }]);

    expect(world.entities.queueLen[entityIndex(nexus)]).toBe(0);
    expect(world.players.alloy[1]).toBe(before);
  });
});

describe("victory", () => {
  it("eliminates a player who owns nothing and crowns the survivor", () => {
    const world = newWorld();
    world.players.inPlay[0] = 1;
    world.players.inPlay[1] = 1;

    spawnTyped(world.entities, world.types, T_TROOPER, fxFromFloat(10), fxFromFloat(10), 0);
    const doomed = spawnTyped(world.entities, world.types, T_DRONE, fxFromFloat(40), fxFromFloat(40), 1);

    world.step([]);
    expect(world.players.winner).toBe(-1);

    world.entities.despawn(doomed);
    world.step([]);

    expect(world.players.defeated[1]).toBe(1);
    expect(world.players.defeatedTick[1]).toBeGreaterThanOrEqual(0);
    expect(world.players.winner).toBe(0);
  });

  it("does not crown anyone while empty slots sit idle", () => {
    const world = newWorld();
    // Only slot 0 is contesting; the other three slots exist but are not in play.
    world.players.inPlay[0] = 1;
    spawnTyped(world.entities, world.types, T_TROOPER, fxFromFloat(10), fxFromFloat(10), 0);

    run(world, 10);
    expect(world.players.winner).toBe(-1);
    expect(world.players.defeated[1]).toBe(0);
  });
});

describe("snapshots", () => {
  it("round-trips economy, combat and queue state exactly", () => {
    const world = newWorld();
    world.players.inPlay[0] = 1;
    world.players.inPlay[1] = 1;
    const nexus = world.placeStructure(T_NEXUS, 10, 10, 0);
    const node = world.placeStructure(T_ALLOY_NODE, 16, 10, -1);
    const drone = spawnTyped(world.entities, world.types, T_DRONE, fxFromFloat(14.5), fxFromFloat(11.5), 0);
    world.placeStructure(T_PYLON, 30, 30, 0, false);
    spawnTyped(world.entities, world.types, T_TROOPER, fxFromFloat(40), fxFromFloat(40), 1);
    recomputeSupplyAndDefeat(world);

    run(world, 80, [
      { kind: CMD_GATHER, playerId: 0, entities: [drone], target: node },
      { kind: CMD_TRAIN, playerId: 0, building: nexus, unitType: T_DRONE },
    ]);

    const restored = newWorld();
    decodeSnapshot(restored, encodeSnapshot(world));

    expect(restored.hash()).toBe(world.hash());
    expect(restored.players.alloy[0]).toBe(world.players.alloy[0]);
    expect(restored.players.inPlay[1]).toBe(1);

    // And it must keep agreeing: a snapshot that restores the visible fields
    // but misses a timer diverges a few ticks later, not immediately.
    for (let i = 0; i < 60; i++) {
      world.step([]);
      restored.step([]);
    }
    expect(restored.hash()).toBe(world.hash());
  });
});

describe("determinism", () => {
  it("produces identical hashes from an identical command stream", () => {
    function play(): number[] {
      const world = newWorld();
      world.players.inPlay[0] = 1;
      world.players.inPlay[1] = 1;
      const nexus = world.placeStructure(T_NEXUS, 10, 10, 0);
      const node = world.placeStructure(T_ALLOY_NODE, 16, 10, -1);
      world.placeStructure(T_NEXUS, 44, 44, 1);
      recomputeSupplyAndDefeat(world);

      const drones: EntityId[] = [];
      for (let d = 0; d < 6; d++) {
        drones.push(
          spawnTyped(
            world.entities,
            world.types,
            T_DRONE,
            fxFromFloat(14.5 + (d % 3) * 0.7),
            fxFromFloat(11.5 + Math.floor(d / 3) * 0.7),
            0,
          ),
        );
      }
      for (let d = 0; d < 6; d++) {
        spawnTyped(
          world.entities,
          world.types,
          T_TROOPER,
          fxFromFloat(30 + d * 0.6),
          fxFromFloat(30),
          1,
        );
      }

      const hashes: number[] = [];
      for (let t = 0; t < 300; t++) {
        const commands: Command[] = [];
        if (t === 1) commands.push({ kind: CMD_GATHER, playerId: 0, entities: drones, target: node });
        if (t === 5) commands.push({ kind: CMD_TRAIN, playerId: 0, building: nexus, unitType: T_DRONE });
        if (t === 40) {
          commands.push({
            kind: CMD_BUILD,
            playerId: 0,
            entities: [drones[0]],
            buildingType: T_PYLON,
            tileX: 20,
            tileY: 14,
          });
        }
        if (t === 60) {
          commands.push({
            kind: CMD_MOVE,
            playerId: 0,
            entities: drones.slice(1, 3),
            targetX: fxFromFloat(30),
            targetY: fxFromFloat(30),
          });
        }
        world.step(commands);
        if (t % 30 === 0) hashes.push(world.hash());
      }
      return hashes;
    }

    expect(play()).toEqual(play());
  });
});
