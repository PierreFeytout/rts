import { CMD_MOVE, CMD_STOP, type Command } from "./commands.js";
import { spawnUnit, type EntityId } from "./entities.js";
import { fxFromFloat } from "./fixed.js";
import { TILE_BLOCKED } from "./grid.js";
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
 * normalisation), pathfinding around obstacles, and dense crowd separation
 * where tiny differences amplify fastest.
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

/** Build the fixture world. Same inputs must give the same world everywhere. */
export function buildScenarioWorld(mapTiles = 64, seed = 0x5ca1ab1e): {
  world: World;
  units: EntityId[];
} {
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

  const units: EntityId[] = [];
  for (let i = 0; i < 120; i++) {
    const player = i % 2;
    const x = 4 + (i % 10) * 0.7 + player * 2;
    const y = 4 + Math.floor(i / 10) * 0.7;
    if (world.grid.isBlocked(Math.floor(x), Math.floor(y))) continue;
    units.push(
      spawnUnit(world.entities, {
        x: fxFromFloat(x),
        y: fxFromFloat(y),
        radius: fxFromFloat(0.32),
        moveSpeed: fxFromFloat(0.17),
        turnRate: 3600,
        owner: player,
        typeId: 1,
        health: 100,
      }),
    );
  }

  return { world, units };
}

/** The scripted command stream. Pure function of tick. */
export function scenarioCommands(units: EntityId[], tick: number, mapTiles: number): Command[] {
  const of = (player: number): EntityId[] => units.filter((_, i) => i % 2 === player);
  const move = (player: number, x: number, y: number): Command => ({
    kind: CMD_MOVE,
    playerId: player,
    entities: of(player),
    targetX: fxFromFloat(x),
    targetY: fxFromFloat(y),
  });

  switch (tick) {
    case 2:
      return [move(0, mapTiles - 8, mapTiles - 8)];
    case 25:
      return [move(1, mapTiles - 8, 6)];
    case 90:
      // Send both to the same point: maximum crowd pressure, where any
      // arithmetic difference amplifies fastest.
      return [move(0, mapTiles / 2, mapTiles / 2), move(1, mapTiles / 2, mapTiles / 2)];
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

  const { world, units } = buildScenarioWorld(mapTiles, options.seed);
  const hashes: number[] = [];

  for (let t = 0; t < ticks; t++) {
    world.step(scenarioCommands(units, t, mapTiles));
    if (world.tick % sampleInterval === 0) hashes.push(world.hash());
  }

  return {
    hashes,
    finalHash: world.hash(),
    ticks: world.tick,
    unitCount: world.entities.count,
  };
}
