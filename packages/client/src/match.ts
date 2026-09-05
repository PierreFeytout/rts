import { TILE_BLOCKED, World, fxFromFloat, spawnUnit } from "@rts/sim";

/**
 * Match setup.
 *
 * Only the host runs this. Guests receive the finished world as a snapshot in
 * their welcome message rather than generating it themselves -- two peers
 * independently building a world from the same seed is one more thing that can
 * silently disagree, and copying the bytes cannot.
 */

export const MAP_TILES = 64;

/**
 * Player slots are allocated up front rather than when someone joins.
 *
 * Spawning units for a player who connects later would be a simulation event
 * that has to be scheduled through the arbiter, which is real work for no gain
 * at this stage. Unclaimed slots simply sit idle. Proper lobby slots arrive
 * with the content system in M5.
 */
export const MAX_PLAYERS = 4;
const UNITS_PER_PLAYER = 40;

/** Corner-ish spawn origins, one per player slot. */
const SPAWN_ORIGINS: Array<[number, number]> = [
  [5, 5],
  [MAP_TILES - 12, MAP_TILES - 12],
  [MAP_TILES - 12, 5],
  [5, MAP_TILES - 12],
];

export function createMatchWorld(seed: number): World {
  const world = new World({ mapTiles: MAP_TILES, seed });

  // Obstacles come from the world's own seeded rng, so the layout is part of
  // the simulation state that gets snapshotted rather than something a peer has
  // to reproduce.
  for (let i = 0; i < 14; i++) {
    const w = world.rng.nextRange(2, 6);
    const h = world.rng.nextRange(2, 6);
    const x = world.rng.nextRange(14, MAP_TILES - 14 - w);
    const y = world.rng.nextRange(14, MAP_TILES - 14 - h);
    world.grid.fillRect(x, y, w, h, TILE_BLOCKED);
  }

  for (let player = 0; player < MAX_PLAYERS; player++) {
    const [originX, originY] = SPAWN_ORIGINS[player];
    let placed = 0;
    let attempt = 0;
    while (placed < UNITS_PER_PLAYER && attempt < UNITS_PER_PLAYER * 40) {
      attempt++;
      const x = originX + (placed % 8) * 0.8;
      const y = originY + Math.floor(placed / 8) * 0.8;
      if (world.grid.isBlocked(Math.floor(x), Math.floor(y))) continue;
      spawnUnit(world.entities, {
        x: fxFromFloat(x),
        y: fxFromFloat(y),
        radius: fxFromFloat(0.32),
        moveSpeed: fxFromFloat(0.16),
        turnRate: 3600,
        owner: player,
        typeId: 1,
        health: 100,
      });
      placed++;
    }
  }

  return world;
}

/** An empty world of the right shape, for a guest to restore a snapshot into. */
export function createEmptyWorld(): World {
  return new World({ mapTiles: MAP_TILES, seed: 1 });
}
