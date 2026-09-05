import {
  CMD_ATTACK_MOVE,
  CMD_BUILD,
  CMD_GATHER,
  CMD_MOVE,
  CMD_STOP,
  CMD_TRAIN,
  type Command,
} from "./commands.js";
import { spawnTyped, type EntityId } from "./entities.js";
import { fxFromFloat } from "./fixed.js";
import {
  FX_DEPOT,
  FX_HQ,
  FX_ORE,
  FX_SOLDIER,
  FX_TAP,
  FX_VENT,
  FX_WORKER,
  fixtureTypes,
} from "./fixture-types.js";
import { TILE_BLOCKED } from "./grid.js";
import { recomputeSupplyAndDefeat } from "./production.js";
import { World } from "./world.js";

/**
 * Canonical determinism fixture.
 *
 * Shipped rather than kept in tests because its whole purpose is to be run in
 * DIFFERENT RUNTIMES and compared: Node against Chrome, Chrome against Firefox.
 * Tests proving the simulation is deterministic within one process are nearly
 * free and catch little -- the failure that actually ruins a match is two
 * players on different engines drifting apart, and only a cross-runtime
 * comparison can catch that.
 *
 * The scenario deliberately exercises the parts most likely to differ:
 * trigonometry (unit facing), square roots (distance), division (steering
 * normalisation), pathfinding around obstacles, dense crowd separation where
 * tiny differences amplify fastest, and the gameplay systems that accumulate
 * integer state over hundreds of ticks: the damage matrix and death, harvesting
 * round trips, construction, and production queues.
 *
 * It runs on `fixtureTypes`, not on shipped content. Tying the trace to real
 * balance would churn it on every tuning pass, and churn in a number people are
 * meant to compare by eye is how a genuine divergence gets waved through.
 *
 * Any change to simulation behaviour changes these hashes. That is intended --
 * the numbers are compared between runtimes at the same commit, never against
 * values baked in from an earlier one.
 */

export interface ScenarioResult {
  /** Hash sampled every `sampleInterval` ticks, so divergence can be bisected. */
  hashes: number[];
  finalHash: number;
  ticks: number;
  unitCount: number;
}

export interface ScenarioOptions {
  ticks?: number;
  sampleInterval?: number;
  mapTiles?: number;
  seed?: number;
}

/** Handles the command script needs to address. */
export interface ScenarioActors {
  /**
   * One army per player, kept as separate lists rather than filtered out of a
   * single one by index parity. A spawn that lands on an obstacle is skipped,
   * so parity drifts away from ownership -- and the resulting orders are
   * silently dropped by the ownership check, leaving half the fixture inert
   * while still looking busy.
   */
  armies: EntityId[][];
  /** Harvesters belonging to player 0. */
  drones: EntityId[];
  /** Player 0's headquarters. */
  nexus: EntityId;
  /** The ore patch player 0's drones work. */
  node: EntityId;
}

/** Build the fixture world. Same inputs must give the same world everywhere. */
export function buildScenarioWorld(
  mapTiles = 64,
  seed = 0x5ca1ab1e,
): { world: World; actors: ScenarioActors } {
  const world = new World({ mapTiles, seed, types: fixtureTypes });

  // Obstacles from the seeded rng, so the layout is part of the fixture rather
  // than hardcoded geometry. Kept clear of both spawn areas, so all 120 units
  // exist on every run -- a fixture whose unit count depends on a dice roll is
  // a fixture whose trace is harder to reason about than it needs to be.
  for (let i = 0; i < 12; i++) {
    const w = world.rng.nextRange(2, 6);
    const h = world.rng.nextRange(2, 6);
    const x = world.rng.nextRange(14, mapTiles - 20 - w);
    const y = world.rng.nextRange(14, mapTiles - 20 - h);
    world.grid.fillRect(x, y, w, h, TILE_BLOCKED);
  }

  // An economy for player 0, in the far corner from where the fighting starts.
  const nexus = world.placeStructure(FX_HQ, mapTiles - 14, mapTiles - 14, 0);
  const node = world.placeStructure(FX_ORE, mapTiles - 7, mapTiles - 14, -1);
  // A vent with a working tap on it, so the plasma accumulator -- which carries
  // a fractional remainder in integer state across every tick of the run -- is
  // inside the comparison too.
  world.placeStructure(FX_VENT, mapTiles - 20, mapTiles - 7, -1);
  world.placeStructure(FX_TAP, mapTiles - 16, mapTiles - 7, 0);

  const drones: EntityId[] = [];
  for (let i = 0; i < 6; i++) {
    drones.push(
      spawnTyped(
        world.entities,
        world.types,
        FX_WORKER,
        fxFromFloat(mapTiles - 9 + (i % 3) * 0.7),
        fxFromFloat(mapTiles - 10 + Math.floor(i / 3) * 0.7),
        0,
      ),
    );
  }

  // Two armies of 60, in separate blocks far enough apart that neither can see
  // the other at spawn. They are marched into each other later, so the fixture
  // covers an actual engagement -- formations closing, firing, losing units and
  // reforming -- rather than a mutual annihilation that is over in a hundred
  // ticks and leaves the rest of the run nearly static.
  const armies: EntityId[][] = [[], []];
  for (let player = 0; player < 2; player++) {
    for (let n = 0; n < 60; n++) {
      const x = 4 + (n % 8) * 0.75;
      const y = 4 + Math.floor(n / 8) * 0.75 + player * 16;
      armies[player].push(
        spawnTyped(world.entities, world.types, FX_SOLDIER, fxFromFloat(x), fxFromFloat(y), player),
      );
    }
  }

  world.players.inPlay[0] = 1;
  world.players.inPlay[1] = 1;
  recomputeSupplyAndDefeat(world);

  return { world, actors: { armies, drones, nexus, node } };
}

/** The scripted command stream. Pure function of tick. */
export function scenarioCommands(
  actors: ScenarioActors,
  tick: number,
  mapTiles: number,
): Command[] {
  const of = (player: number): EntityId[] => actors.armies[player];
  const move = (player: number, x: number, y: number): Command => ({
    kind: CMD_MOVE,
    playerId: player,
    entities: of(player),
    targetX: fxFromFloat(x),
    targetY: fxFromFloat(y),
  });

  switch (tick) {
    case 1:
      return [
        { kind: CMD_GATHER, playerId: 0, entities: actors.drones, target: actors.node },
        { kind: CMD_TRAIN, playerId: 0, building: actors.nexus, unitType: FX_WORKER },
      ];
    case 2:
      return [move(0, mapTiles - 8, mapTiles - 8)];
    case 25:
      return [move(1, mapTiles - 8, 6)];
    case 60:
      // A construction site, so build progress and the grid mutation it causes
      // are part of the hashed state for the rest of the run.
      return [
        {
          kind: CMD_BUILD,
          playerId: 0,
          entities: [actors.drones[0]],
          buildingType: FX_DEPOT,
          tileX: mapTiles - 18,
          tileY: mapTiles - 12,
        },
      ];
    case 90:
      // Send both armies to the same point: maximum crowd pressure, and the
      // two sides are now hostile, so this is also where combat resolves.
      return [
        {
          kind: CMD_ATTACK_MOVE,
          playerId: 0,
          entities: of(0),
          targetX: fxFromFloat(mapTiles / 2),
          targetY: fxFromFloat(mapTiles / 2),
        },
        {
          kind: CMD_ATTACK_MOVE,
          playerId: 1,
          entities: of(1),
          targetX: fxFromFloat(mapTiles / 2),
          targetY: fxFromFloat(mapTiles / 2),
        },
      ];
    case 200:
      return [{ kind: CMD_STOP, playerId: 0, entities: of(0) }];
    case 240:
      return [move(0, 6, mapTiles - 6)];
    case 330:
      return [move(1, 6, 6)];
    default:
      return [];
  }
}

/** Run the fixture and return its hash trace. */
export function runDeterminismScenario(options: ScenarioOptions = {}): ScenarioResult {
  const ticks = options.ticks ?? 600;
  const sampleInterval = options.sampleInterval ?? 50;
  const mapTiles = options.mapTiles ?? 64;

  const { world, actors } = buildScenarioWorld(mapTiles, options.seed);
  const hashes: number[] = [];

  for (let t = 0; t < ticks; t++) {
    world.step(scenarioCommands(actors, t, mapTiles));
    if (world.tick % sampleInterval === 0) hashes.push(world.hash());
  }

  return {
    hashes,
    finalHash: world.hash(),
    ticks: world.tick,
    unitCount: world.entities.count,
  };
}
