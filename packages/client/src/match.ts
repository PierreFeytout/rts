import { defaultContent } from "@rts/content";
import {
  MAX_PLAYERS,
  NEUTRAL_PLAYER,
  TILE_BLOCKED,
  World,
  fxFromFloat,
  recomputeSupplyAndDefeat,
  spawnTyped,
  tileCentre,
} from "@rts/sim";

/**
 * Match setup.
 *
 * Only the host runs this. Guests receive the finished world as a snapshot in
 * their welcome message rather than generating it themselves -- two peers
 * independently building a world from the same seed is one more thing that can
 * silently disagree, and copying the bytes cannot.
 *
 * Nothing here names a unit or a building. It asks the content set which
 * structure a race starts with and which worker it starts several of, so a new
 * race is playable the moment it is defined -- this file is one of the places
 * that would otherwise quietly need editing per race, and does not.
 */

export const MAP_TILES = 128;

export { MAX_PLAYERS };

/** Race ids in a stable order, for the lobby's faction picker. */
export const RACE_IDS = defaultContent.races.map((race) => race.id);

/**
 * How the four slots are populated.
 *
 * "mixed" alternates through the available races, which means a guest joining
 * slot 1 is playing race #2 without anyone having to configure anything. That
 * is deliberate: an extensibility claim nobody ever sees exercised is a claim
 * worth doubting.
 */
export type FactionMode = "mixed" | string;

const ALLOY_NODE = defaultContent.id("map.alloy-node");
const VENT = defaultContent.id("map.vent");

/**
 * Player slots are allocated up front rather than when someone joins.
 *
 * Every slot gets a base at tick zero, whether or not a human ever occupies it.
 * That is what lets someone join a match already in progress and immediately
 * have something to play -- spawning a base on join would be a simulation event
 * that has to be scheduled through the arbiter, and a guest arriving mid-battle
 * would be building from nothing.
 *
 * The cost is that an unoccupied slot leaves an idle base on the map. It counts
 * toward the victory condition, so a two-player game is technically a
 * four-player free-for-all where two of them never move.
 */
const WORKERS_PER_PLAYER = 5;

/** Distance from the map edge to each base's anchor tile. */
const BASE_INSET = 14;

/**
 * Base layout, as tile offsets from the player's anchor.
 *
 * Identical for every player rather than mirrored per corner. A mirrored layout
 * looks nicer but makes the two diagonal players play a measurably different
 * opening, and asymmetry is not something to introduce by accident.
 */
const ORE_OFFSETS: Array<[number, number]> = [
  [7, 0],
  [0, 7],
  [7, 7],
];
const VENT_OFFSET: [number, number] = [-4, 3];

/** Which race each slot plays, given the host's choice. */
export function raceLineup(mode: FactionMode): string[] {
  const lineup: string[] = [];
  for (let player = 0; player < MAX_PLAYERS; player++) {
    lineup.push(mode === "mixed" ? RACE_IDS[player % RACE_IDS.length] : mode);
  }
  return lineup;
}

export function createMatchWorld(seed: number, mode: FactionMode = "mixed"): World {
  const world = new World({ mapTiles: MAP_TILES, seed, types: defaultContent.types });
  const lineup = raceLineup(mode);
  const far = MAP_TILES - BASE_INSET - 8;

  /** Anchor tile per player slot, one per corner. */
  const origins: Array<[number, number]> = [
    [BASE_INSET, BASE_INSET],
    [far, far],
    [far, BASE_INSET],
    [BASE_INSET, far],
  ];

  // Obstacles come from the world's own seeded rng, so the layout is part of
  // the simulation state that gets snapshotted rather than something a peer has
  // to reproduce. Confined to the middle of the map: an obstacle rolled on top
  // of a starting base would wall a player in before the match began.
  const margin = BASE_INSET + 16;
  for (let i = 0; i < 22; i++) {
    const w = world.rng.nextRange(2, 7);
    const h = world.rng.nextRange(2, 7);
    const x = world.rng.nextRange(margin, MAP_TILES - margin - w);
    const y = world.rng.nextRange(margin, MAP_TILES - margin - h);
    world.grid.fillRect(x, y, w, h, TILE_BLOCKED);
  }

  // Contested expansions. Worth fighting over precisely because they are not
  // inside anybody's base.
  for (let i = 0; i < 8; i++) {
    const x = world.rng.nextRange(margin, MAP_TILES - margin - 2);
    const y = world.rng.nextRange(margin, MAP_TILES - margin - 2);
    if (!areaFree(world, x, y, 2)) continue;
    world.placeStructure(ALLOY_NODE, x, y, NEUTRAL_PLAYER);
  }

  for (let player = 0; player < MAX_PLAYERS; player++) {
    const [originX, originY] = origins[player];
    const race = defaultContent.race(lineup[player]);

    world.placeStructure(race.startBuilding, originX, originY, player);
    for (const [dx, dy] of ORE_OFFSETS) {
      world.placeStructure(ALLOY_NODE, originX + dx, originY + dy, NEUTRAL_PLAYER);
    }
    world.placeStructure(VENT, originX + VENT_OFFSET[0], originY + VENT_OFFSET[1], NEUTRAL_PLAYER);

    // Workers start in the gap between the headquarters and the nearest ore, so
    // the opening move is obvious rather than a scavenger hunt.
    for (let d = 0; d < WORKERS_PER_PLAYER; d++) {
      spawnTyped(
        world.entities,
        world.types,
        race.startUnit,
        tileCentre(originX + 5) + fxFromFloat((d % 3) * 0.7),
        tileCentre(originY + 4) + fxFromFloat(Math.floor(d / 3) * 0.7),
        player,
      );
    }

    world.players.inPlay[player] = 1;
  }

  // Supply is a derived total, normally refreshed at the end of each tick.
  // Priming it here means tick 0 is a playable tick: without it the first
  // orders a player issues are rejected against a supply cap of zero.
  recomputeSupplyAndDefeat(world);

  return world;
}

/** Every tile of a prospective footprint is in bounds and unoccupied. */
function areaFree(world: World, tileX: number, tileY: number, span: number): boolean {
  for (let y = tileY; y < tileY + span; y++) {
    for (let x = tileX; x < tileX + span; x++) {
      if (!world.grid.inBounds(x, y) || world.grid.isBlocked(x, y)) return false;
    }
  }
  return true;
}

/** An empty world of the right shape, for a guest to restore a snapshot into. */
export function createEmptyWorld(): World {
  return new World({ mapTiles: MAP_TILES, seed: 1, types: defaultContent.types });
}
