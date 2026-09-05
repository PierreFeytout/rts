import {
  MAX_PLAYERS,
  T_ALLOY_NODE,
  T_DRONE,
  T_NEXUS,
  T_VENT,
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
 */

export const MAP_TILES = 128;

export { MAX_PLAYERS };

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
 * four-player free-for-all where two of them never move. Proper lobby slots
 * arrive with the content system in M5.
 */
const DRONES_PER_PLAYER = 5;

/** Distance from the map edge to each base's anchor tile. */
const BASE_INSET = 14;

/**
 * Base layout, as tile offsets from the player's anchor.
 *
 * Identical for every player rather than mirrored per corner. A mirrored layout
 * looks nicer but makes the two diagonal players play a measurably different
 * opening, and asymmetry is not something to introduce by accident.
 */
const BASE_PIECES: Array<{ type: number; dx: number; dy: number }> = [
  { type: T_NEXUS, dx: 0, dy: 0 },
  { type: T_ALLOY_NODE, dx: 7, dy: 0 },
  { type: T_ALLOY_NODE, dx: 0, dy: 7 },
  { type: T_ALLOY_NODE, dx: 7, dy: 7 },
  { type: T_VENT, dx: -4, dy: 3 },
];

export function createMatchWorld(seed: number): World {
  const world = new World({ mapTiles: MAP_TILES, seed });
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
    world.placeStructure(T_ALLOY_NODE, x, y, -1);
  }

  for (let player = 0; player < MAX_PLAYERS; player++) {
    const [originX, originY] = origins[player];

    for (const piece of BASE_PIECES) {
      const owner = piece.type === T_NEXUS ? player : -1;
      world.placeStructure(piece.type, originX + piece.dx, originY + piece.dy, owner);
    }

    // Drones start in the gap between the Nexus and the nearest ore, so the
    // opening move is obvious rather than a scavenger hunt.
    for (let d = 0; d < DRONES_PER_PLAYER; d++) {
      spawnTyped(
        world.entities,
        world.types,
        T_DRONE,
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
  return new World({ mapTiles: MAP_TILES, seed: 1 });
}
