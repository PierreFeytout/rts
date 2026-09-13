import { CAN_PRODUCE, CMD_RALLY, KIND_BUILDING, fxFromFloat, type EntityId } from "@rts/sim";
import { describe, expect, it } from "vitest";
import { createMatchWorld, emptySlots } from "./match.js";
import { rallyPoints } from "./rally-markers.js";

/** A two-player match, and each player's headquarters. */
function match() {
  const world = createMatchWorld({
    mapId: "rift-basin",
    seed: 1234,
    slots: emptySlots().map((slot, player) => ({ ...slot, kind: player < 2 ? "human" : "empty" })),
  });
  const hq: EntityId[] = [];
  const e = world.entities;
  for (let i = 0; i < e.highWater; i++) {
    if (e.alive[i] !== 1) continue;
    const type = world.types.get(e.typeId[i]);
    if (type.kind === KIND_BUILDING && world.types.can(type.id, CAN_PRODUCE)) hq[e.owner[i]] = e.idAt(i);
  }
  return { world, hq };
}

describe("rallyPoints", () => {
  it("draws nothing for a producer whose rally point is still itself", () => {
    const { world, hq } = match();
    expect(rallyPoints(world, new Set([hq[0]]), 0)).toEqual([]);
  });

  it("draws a selected producer's rally point, from its centre", () => {
    const { world, hq } = match();
    world.step([{ kind: CMD_RALLY, playerId: 0, entities: [hq[0]], targetX: fxFromFloat(40), targetY: fxFromFloat(50) }]);
    const [point] = rallyPoints(world, new Set([hq[0]]), 0);
    const i = world.entities.indexOfLive(hq[0]);
    expect(point).toMatchObject({ building: hq[0], owner: 0, toX: 40, toZ: 50 });
    expect(point.fromX).toBe(world.entities.posX[i] / 65536);
    expect(point.fromZ).toBe(world.entities.posY[i] / 65536);
  });

  it("draws only what is selected, and only the local player's own", () => {
    const { world, hq } = match();
    world.step([
      { kind: CMD_RALLY, playerId: 0, entities: [hq[0]], targetX: fxFromFloat(40), targetY: fxFromFloat(50) },
      { kind: CMD_RALLY, playerId: 1, entities: [hq[1]], targetX: fxFromFloat(60), targetY: fxFromFloat(70) },
    ]);
    expect(rallyPoints(world, new Set(), 0)).toEqual([]);
    // An enemy's rally point is not something a player gets to see.
    expect(rallyPoints(world, new Set([hq[1]]), 0)).toEqual([]);
    expect(rallyPoints(world, new Set([hq[0], hq[1]]), 0)).toHaveLength(1);
  });
});
