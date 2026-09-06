import { defaultContent } from "@rts/content";
import { KIND_BUILDING, KIND_RESOURCE, MAX_PLAYERS, recomputeSupplyAndDefeat } from "@rts/sim";
import { describe, expect, it } from "vitest";
import {
  contenders,
  createMatchWorld,
  emptySlots,
  type MatchConfig,
  type SlotKind,
} from "./match.js";

/**
 * Building a world from a lobby configuration.
 *
 * The case worth the most attention is the empty slot. Player slots used to be
 * populated unconditionally -- all four got a base whether or not anyone was in
 * them -- so a two-player game was really a four-player free-for-all with two
 * players who never moved. The lobby makes that unnecessary, and the failure
 * mode of getting it wrong is spectacular: a slot that is `inPlay` with nothing
 * on the field is instantly eliminated, and the match declares a winner on
 * tick 0.
 */

function config(kinds: SlotKind[], mapId = "rift-basin"): MatchConfig {
  return {
    mapId,
    seed: 1234,
    slots: emptySlots().map((slot, player) => ({ ...slot, kind: kinds[player] ?? "empty" })),
  };
}

/** Entities owned by a player, by kind. */
function owned(world: ReturnType<typeof createMatchWorld>, player: number) {
  const e = world.entities;
  let buildings = 0;
  let units = 0;
  for (let i = 0; i < e.highWater; i++) {
    if (e.alive[i] !== 1 || e.owner[i] !== player) continue;
    if (world.types.get(e.typeId[i]).kind === KIND_BUILDING) buildings++;
    else units++;
  }
  return { buildings, units };
}

describe("createMatchWorld", () => {
  it("takes its size from the chosen map", () => {
    expect(createMatchWorld(config(["human", "computer"])).mapTiles).toBe(256);
    expect(createMatchWorld(config(["human", "computer"], "sprawl")).mapTiles).toBe(1024);
  });

  it("gives every occupied slot a base and workers", () => {
    const world = createMatchWorld(config(["human", "computer", "computer", "human"]));
    for (let player = 0; player < MAX_PLAYERS; player++) {
      expect(owned(world, player), `player ${player}`).toEqual({ buildings: 1, units: 5 });
      expect(world.players.inPlay[player]).toBe(1);
    }
  });

  it("puts nothing at all on an empty slot", () => {
    const world = createMatchWorld(config(["human", "computer"]));
    expect(owned(world, 2)).toEqual({ buildings: 0, units: 0 });
    expect(owned(world, 3)).toEqual({ buildings: 0, units: 0 });
    expect(world.players.inPlay[2]).toBe(0);
    expect(world.players.inPlay[3]).toBe(0);
  });

  it("does not declare a winner on tick zero in a two-player match", () => {
    // The exact failure `PlayerState.inPlay` exists to prevent: an unoccupied
    // slot owning nothing looks identical to a defeated player.
    const world = createMatchWorld(config(["human", "computer"]));
    recomputeSupplyAndDefeat(world);
    expect(world.players.winner).toBe(-1);
    expect([...world.players.defeated]).toEqual([0, 0, 0, 0]);
  });

  it("treats a computer slot exactly like a human one", () => {
    // The AI is an idle placeholder, but the *slot* is a real player: it owns a
    // base, contests the victory condition, and can be beaten.
    const world = createMatchWorld(config(["human", "computer"]));
    expect(owned(world, 1)).toEqual(owned(world, 0));
    expect(world.players.inPlay[1]).toBe(1);
  });

  it("gives each slot the race the lobby chose for it", () => {
    const chosen: MatchConfig = {
      ...config(["human", "human"]),
      slots: emptySlots().map((slot, player) => ({
        ...slot,
        kind: player < 2 ? ("human" as SlotKind) : ("empty" as SlotKind),
        raceId: "concord",
      })),
    };
    const world = createMatchWorld(chosen);
    const heartwood = defaultContent.race("concord").startBuilding;
    for (let player = 0; player < 2; player++) {
      const e = world.entities;
      const found: number[] = [];
      for (let i = 0; i < e.highWater; i++) {
        if (e.alive[i] === 1 && e.owner[i] === player) found.push(e.typeId[i]);
      }
      expect(found).toContain(heartwood);
    }
  });

  it("lays out the map's terrain and scenery", () => {
    const world = createMatchWorld(config(["human", "computer"]));
    const map = defaultContent.map("rift-basin");

    let scenery = 0;
    const e = world.entities;
    for (let i = 0; i < e.highWater; i++) {
      if (e.alive[i] === 1 && world.types.get(e.typeId[i]).kind === KIND_RESOURCE) scenery++;
    }
    expect(scenery).toBe(map.resources.length);
  });

  it("reports which slots are actually contesting", () => {
    expect(contenders(config(["human", "computer"]))).toEqual([0, 1]);
    expect(contenders(config(["human", "empty", "computer"]))).toEqual([0, 2]);
  });
});
