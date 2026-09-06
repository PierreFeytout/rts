import { defaultContent, type MapInfo } from "@rts/content";
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
 * independently building a world from the same configuration is one more thing
 * that can silently disagree, and copying the bytes cannot.
 *
 * Nothing here names a unit, a building or a piece of terrain. It asks the
 * content set which structure a race starts with, which worker it starts
 * several of, and what the chosen map contains. This file is one of the places
 * that would otherwise quietly need editing per race and per map, and does not.
 */

export { MAX_PLAYERS };

/** Race ids in a stable order, for the setup screen's pickers. */
export const RACE_IDS = defaultContent.races.map((race) => race.id);

/** Map ids in a stable order, for the setup screen's map list. */
export const MAP_IDS = defaultContent.maps.map((map) => map.id);

/**
 * What occupies a player slot.
 *
 * `"empty"` is a real option rather than a shorter slot array, because a slot's
 * index *is* its player id: the second slot is player 1 whether or not the
 * first three are filled. Compacting the array would renumber everyone.
 */
export type SlotKind = "human" | "computer" | "empty";

export interface Slot {
  kind: SlotKind;
  raceId: string;
  name: string;
}

export interface MatchConfig {
  mapId: string;
  /**
   * Seed for `world.rng`.
   *
   * No longer decides the layout -- the map file does. It still exists because
   * the rng is live simulation state that later systems may draw from, and a
   * world whose randomness started from the same number every match would be
   * a surprise waiting to happen.
   */
  seed: number;
  /** One entry per player id, `slots[2]` being player 2. */
  slots: Slot[];
}

/**
 * How many workers a player opens with.
 *
 * Content decides everything about *what* they are; this is a rule of the match
 * rather than a property of a race, which is why it lives here.
 */
const WORKERS_PER_PLAYER = 5;

/** Where the opening workers stand, as tile offsets from the start anchor. */
const WORKER_OFFSET: [number, number] = [5, 4];

/**
 * A default match: you against one computer, on the first map.
 *
 * Used to seed the setup screen so it opens on something playable rather than
 * on a form to fill in.
 */
export function defaultConfig(name: string): MatchConfig {
  const map = defaultContent.maps[0];
  return {
    mapId: map.id,
    seed: randomSeed(),
    slots: emptySlots().map((slot, player) => {
      if (player === 0) return { ...slot, kind: "human", name };
      if (player === 1 && map.maxPlayers > 1) return { ...slot, kind: "computer" };
      return slot;
    }),
  };
}

/** Every slot vacant, each pre-assigned a race so switching one on is one click. */
export function emptySlots(): Slot[] {
  const slots: Slot[] = [];
  for (let player = 0; player < MAX_PLAYERS; player++) {
    slots.push({
      kind: "empty",
      // Alternating rather than all-the-same, so a default match is a match
      // between two different races. An extensibility claim nobody ever sees
      // exercised is a claim worth doubting.
      raceId: RACE_IDS[player % RACE_IDS.length],
      name: `Computer ${player + 1}`,
    });
  }
  return slots;
}

export function randomSeed(): number {
  return (Math.random() * 0x7fffffff) | 0;
}

/** Slots that will actually contest the match, in player-id order. */
export function contenders(config: MatchConfig): number[] {
  const out: number[] = [];
  config.slots.forEach((slot, player) => {
    if (slot.kind !== "empty") out.push(player);
  });
  return out;
}

/**
 * Player slots are populated from the lobby's configuration.
 *
 * Historically every slot got a base whether or not anyone occupied it, so that
 * someone joining a match already in progress had something to play. The lobby
 * closes when the match starts, so there is no longer anyone to join mid-match
 * except a player returning to a slot they already own -- and an unoccupied
 * slot can now simply not exist.
 *
 * An `"empty"` slot leaves `inPlay` at 0. Without that it would count as
 * instantly eliminated and a two-player game would declare a winner on the
 * first tick; see the comment on `PlayerState.inPlay`.
 */
export function createMatchWorld(config: MatchConfig): World {
  const map = defaultContent.map(config.mapId);
  const world = new World({ mapTiles: map.size, seed: config.seed, types: defaultContent.types });

  applyTerrain(world, map);

  config.slots.forEach((slot, player) => {
    if (slot.kind === "empty") return;
    const start = map.starts[player];
    // A map may seat fewer players than a match can hold. The setup screen
    // bounds the choice, so reaching this is a bug rather than a user error --
    // but silently spawning nothing would look like the slot never worked.
    if (start === undefined) {
      throw new Error(`match: ${config.mapId} has no start position for player ${player}`);
    }

    const race = defaultContent.race(slot.raceId);
    world.placeStructure(race.startBuilding, start.x, start.y, player);

    // Workers start in the gap between the headquarters and the nearest ore, so
    // the opening move is obvious rather than a scavenger hunt.
    for (let d = 0; d < WORKERS_PER_PLAYER; d++) {
      spawnTyped(
        world.entities,
        world.types,
        race.startUnit,
        tileCentre(start.x + WORKER_OFFSET[0]) + fxFromFloat((d % 3) * 0.7),
        tileCentre(start.y + WORKER_OFFSET[1]) + fxFromFloat(Math.floor(d / 3) * 0.7),
        player,
      );
    }

    world.players.inPlay[player] = 1;
  });

  // Supply is a derived total, normally refreshed at the end of each tick.
  // Priming it here means tick 0 is a playable tick: without it the first
  // orders a player issues are rejected against a supply cap of zero.
  recomputeSupplyAndDefeat(world);

  return world;
}

/**
 * Terrain and scenery, straight from the map file.
 *
 * Placed before any player, so a base can never land on top of an ore patch
 * that had not been created yet. The map loader has already checked that they
 * do not overlap; this ordering means a future map that slips through produces
 * a visibly missing rock rather than a missing headquarters.
 */
function applyTerrain(world: World, map: MapInfo): void {
  for (const [x, y, w, h] of map.blocks) {
    world.grid.fillRect(x, y, w, h, TILE_BLOCKED);
  }
  for (const resource of map.resources) {
    world.placeStructure(resource.typeId, resource.x, resource.y, NEUTRAL_PLAYER);
  }
}

/**
 * An empty world of the right shape, for a guest to restore a snapshot into.
 *
 * The size has to match the host's exactly -- `decodeSnapshot` refuses a
 * mismatch rather than reading past the end of a grid. The guest learns it from
 * the lobby's start message before this is called.
 */
export function createEmptyWorld(mapTiles: number): World {
  return new World({ mapTiles, seed: 1, types: defaultContent.types });
}

/** Tiles on a named map, for sizing a world before its snapshot arrives. */
export function mapSize(mapId: string): number {
  return defaultContent.map(mapId).size;
}
