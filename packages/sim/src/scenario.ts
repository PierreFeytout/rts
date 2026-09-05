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
import { TILE_BLOCKED } from "./grid.js";
import { recomputeSupplyAndDefeat } from "./production.js";
import { T_ALLOY_NODE, T_DRONE, T_NEXUS, T_PYLON, T_TROOPER } from "./types.js";
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
 * tiny differences amplify fastest, and -- since M4 -- the gameplay systems
 * that accumulate integer state over hundreds of ticks: the damage matrix and
 * death, harvesting round trips, construction, and production queues.
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
  /** Combat units, alternating owner by index. */
  units: EntityId[];
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
  const world = new World({ mapTiles, seed });

  // Obstacles from the seeded rng, so the layout is part of the fixture rather
  // than hardcoded geometry.
  for (let i = 0; i < 12; i++) {
    const w = world.rng.nextRange(2, 6);
    const h = world.rng.nextRange(2, 6);
    const x = world.rng.nextRange(8, mapTiles - 8 - w);
    const y = world.rng.nextRange(8, mapTiles - 8 - h);
    world.grid.fillRect(x, y, w, h, TILE_BLOCKED);
  }

  // An economy for player 0, in the far corner from where the fighting starts.
  const nexus = world.placeStructure(T_NEXUS, mapTiles - 14, mapTiles - 14, 0);
  const node = world.placeStructure(T_ALLOY_NODE, mapTiles - 7, mapTiles - 14, -1);

  const drones: EntityId[] = [];
  for (let i = 0; i < 6; i++) {
    drones.push(
      spawnTyped(
        world.entities,
        world.types,
        T_DRONE,
        fxFromFloat(mapTiles - 9 + (i % 3) * 0.7),
        fxFromFloat(mapTiles - 10 + Math.floor(i / 3) * 0.7),
        0,
      ),
    );
  }

  // Two armies of Troopers. Alternating ownership by index means the crowd is
  // interleaved rather than segregated, so the moment they are sent to the same
  // point they are already in contact -- which is where any arithmetic
  // difference amplifies fastest, and now where the damage matrix is exercised
  // hardest as well.
  const units: EntityId[] = [];
  for (let i = 0; i < 120; i++) {
    const player = i % 2;
    const x = 4 + (i % 10) * 0.7 + player * 2;
    const y = 4 + Math.floor(i / 10) * 0.7;
    if (world.grid.isBlocked(Math.floor(x), Math.floor(y))) continue;
    units.push(
      spawnTyped(world.entities, world.types, T_TROOPER, fxFromFloat(x), fxFromFloat(y), player),
    );
  }

  world.players.inPlay[0] = 1;
  world.players.inPlay[1] = 1;
  recomputeSupplyAndDefeat(world);

  return { world, actors: { units, drones, nexus, node } };
}

/** The scripted command stream. Pure function of tick. */
export function scenarioCommands(
  actors: ScenarioActors,
  tick: number,
  mapTiles: number,
): Command[] {
  const of = (player: number): EntityId[] => actors.units.filter((_, i) => i % 2 === player);
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
        { kind: CMD_TRAIN, playerId: 0, building: actors.nexus, unitType: T_DRONE },
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
          buildingType: T_PYLON,
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
