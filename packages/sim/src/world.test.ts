import { beforeAll, describe, expect, it } from "vitest";
import { CMD_MOVE, CMD_STOP, type Command } from "./commands.js";
import { ORDER_MOVE, ORDER_NONE, entityIndex, spawnUnit, type EntityId } from "./entities.js";
import { enableDevChecks, fxFromFloat, fxLength, fxToFloat } from "./fixed.js";
import { fixtureTypes } from "./fixture-types.js";
import { TILE_BLOCKED } from "./grid.js";
import { World } from "./world.js";

beforeAll(() => {
  enableDevChecks(true);
});

function makeWorld(mapTiles = 32, seed = 1234): World {
  return new World({ mapTiles, seed, types: fixtureTypes });
}

function addUnit(w: World, x: number, y: number, owner = 0): EntityId {
  return spawnUnit(w.entities, {
    x: fxFromFloat(x),
    y: fxFromFloat(y),
    radius: fxFromFloat(0.35),
    moveSpeed: fxFromFloat(0.2),
    turnRate: 4096,
    owner,
    typeId: 1,
    health: 100,
  });
}

function moveCmd(ids: EntityId[], x: number, y: number, playerId = 0): Command {
  return {
    kind: CMD_MOVE,
    playerId,
    entities: ids,
    targetX: fxFromFloat(x),
    targetY: fxFromFloat(y),
  };
}

function posOf(w: World, id: EntityId): { x: number; y: number } {
  const i = entityIndex(id);
  return { x: fxToFloat(w.entities.posX[i]), y: fxToFloat(w.entities.posY[i]) };
}

function run(w: World, ticks: number, commands: Command[] = []): void {
  w.step(commands);
  for (let t = 1; t < ticks; t++) w.step([]);
}

describe("World movement", () => {
  it("advances the tick counter", () => {
    const w = makeWorld();
    expect(w.tick).toBe(0);
    w.step([]);
    expect(w.tick).toBe(1);
  });

  it("moves a unit to its destination and stops", () => {
    const w = makeWorld();
    const u = addUnit(w, 4, 4);
    run(w, 200, [moveCmd([u], 20, 4)]);

    const p = posOf(w, u);
    expect(p.x).toBeCloseTo(20, 0);
    expect(p.y).toBeCloseTo(4, 0);
    expect(w.entities.orderKind[entityIndex(u)]).toBe(ORDER_NONE);
    expect(w.entities.settled[entityIndex(u)]).toBe(1);
  });

  it("does not overshoot the destination", () => {
    // A unit that steps a fixed distance every tick will oscillate around the
    // goal forever unless the final step is clamped to the remaining distance.
    const w = makeWorld();
    const u = addUnit(w, 4, 4);
    run(w, 400, [moveCmd([u], 9, 4)]);

    const i = entityIndex(u);
    const dist = fxLength(w.entities.posX[i] - fxFromFloat(9), w.entities.posY[i] - fxFromFloat(4));
    expect(fxToFloat(dist)).toBeLessThan(0.35);
  });

  it("stays inside the map", () => {
    const w = makeWorld(16);
    const u = addUnit(w, 2, 2);
    run(w, 300, [moveCmd([u], 100, 100)]);
    const p = posOf(w, u);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.x).toBeLessThanOrEqual(16);
    expect(p.y).toBeLessThanOrEqual(16);
  });

  it("paths around an obstacle", () => {
    const w = makeWorld(32);
    // Wall across the middle with a gap at the top.
    for (let y = 6; y < 32; y++) w.grid.set(16, y, TILE_BLOCKED);

    const u = addUnit(w, 8, 20);
    run(w, 600, [moveCmd([u], 24, 20)]);

    const p = posOf(w, u);
    expect(p.x).toBeGreaterThan(20);
    expect(p.y).toBeCloseTo(20, 0);
  });

  it("never ends a tick inside a blocked tile", () => {
    const w = makeWorld(32);
    w.grid.fillRect(10, 10, 8, 8, TILE_BLOCKED);

    const ids = [addUnit(w, 4, 14), addUnit(w, 14, 4), addUnit(w, 25, 14)];
    w.step([moveCmd(ids, 14, 25)]);
    for (let t = 0; t < 400; t++) {
      w.step([]);
      for (const id of ids) {
        const i = entityIndex(id);
        expect(
          w.grid.isBlocked(w.entities.posX[i] >> 16, w.entities.posY[i] >> 16),
          `unit ${id} entered a wall at tick ${t}`,
        ).toBe(false);
      }
    }
  });

  it("nudges an order aimed at a blocked tile to a reachable one", () => {
    const w = makeWorld(32);
    w.grid.fillRect(20, 20, 4, 4, TILE_BLOCKED);
    const u = addUnit(w, 5, 5);
    run(w, 500, [moveCmd([u], 22, 22)]);

    const p = posOf(w, u);
    // Should end up adjacent to the block, not stuck at the start.
    expect(p.x).toBeGreaterThan(15);
    expect(p.y).toBeGreaterThan(15);
    expect(w.grid.isBlocked(Math.floor(p.x), Math.floor(p.y))).toBe(false);
  });

  it("ignores orders for units the player does not own", () => {
    // The host is another player's browser, so ownership cannot be trusted
    // from the sender and has to be re-checked in the simulation.
    //
    // Asserted on order state rather than position: an enemy unit standing in
    // the way legitimately gets shoved aside by separation, so position alone
    // cannot distinguish "obeyed a command" from "was pushed".
    const w = makeWorld();
    const mine = addUnit(w, 4, 4, 0);
    const theirs = addUnit(w, 6, 20, 1);

    w.step([moveCmd([mine, theirs], 20, 4, 0)]);

    expect(w.entities.orderKind[entityIndex(mine)]).toBe(ORDER_MOVE);
    expect(w.entities.orderKind[entityIndex(theirs)]).toBe(ORDER_NONE);

    run(w, 100);
    expect(posOf(w, mine).x).toBeGreaterThan(10);
    // The unowned unit was never ordered, so it stays put.
    expect(posOf(w, theirs).y).toBeCloseTo(20, 0);
  });

  it("stops units on a stop command", () => {
    const w = makeWorld();
    const u = addUnit(w, 4, 4);
    run(w, 5, [moveCmd([u], 28, 4)]);
    const moved = posOf(w, u).x;

    w.step([{ kind: CMD_STOP, playerId: 0, entities: [u] }]);
    run(w, 50);

    expect(w.entities.orderKind[entityIndex(u)]).toBe(ORDER_NONE);
    expect(posOf(w, u).x).toBeCloseTo(moved, 0);
  });

  it("ignores commands referencing dead entities", () => {
    const w = makeWorld();
    const u = addUnit(w, 4, 4);
    w.entities.despawn(u);
    expect(() => run(w, 5, [moveCmd([u], 20, 20)])).not.toThrow();
  });
});

describe("separation", () => {
  it("pushes coincident units apart", () => {
    // Two units spawned on the exact same tile is a degenerate case: the
    // direction between them is the zero vector, so there is no natural way to
    // separate. Without an explicit tie-break they stay fused forever.
    const w = makeWorld();
    const a = addUnit(w, 10, 10);
    const b = addUnit(w, 10, 10);
    run(w, 60);

    const pa = posOf(w, a);
    const pb = posOf(w, b);
    expect(Math.hypot(pa.x - pb.x, pa.y - pb.y)).toBeGreaterThan(0.5);
  });

  it("keeps a crowd from stacking on one point", () => {
    const w = makeWorld(48);
    const ids: EntityId[] = [];
    for (let i = 0; i < 24; i++) ids.push(addUnit(w, 6 + (i % 6), 6 + Math.floor(i / 6)));

    run(w, 400, [moveCmd(ids, 30, 30)]);

    // Every pair must be at least mostly separated; some overlap is acceptable
    // but units must not be sitting on top of each other.
    let tooClose = 0;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const pa = posOf(w, ids[i]);
        const pb = posOf(w, ids[j]);
        if (Math.hypot(pa.x - pb.x, pa.y - pb.y) < 0.3) tooClose++;
      }
    }
    expect(tooClose).toBe(0);
  });

  it("never leaves units nearly fused, even in a large pile-up", () => {
    // Regression. Settling let a unit come to rest while already deeply
    // overlapping a neighbour, and settled units damp their separation -- so
    // the pair could never pull apart and stayed stacked permanently.
    //
    // Only shows up at scale: 24 units have room to spread, 100 ordered onto a
    // single point do not. The bug was invisible until the unit count was
    // realistic, which is why this test uses 100.
    const w = makeWorld(64, 31337);
    const ids: EntityId[] = [];
    for (let i = 0; i < 100; i++) ids.push(addUnit(w, 6 + (i % 12) * 0.8, 6 + Math.floor(i / 12) * 0.8));

    run(w, 700, [moveCmd(ids, 40, 40)]);

    const radius = 0.35;
    let worst = Infinity;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const pa = posOf(w, ids[i]);
        const pb = posOf(w, ids[j]);
        worst = Math.min(worst, Math.hypot(pa.x - pb.x, pa.y - pb.y));
      }
    }
    // Some overlap is expected and fine in a dense crowd; being on top of one
    // another is not. Half the minimum separation is the line.
    expect(worst, `closest pair ${worst.toFixed(3)}`).toBeGreaterThan(radius);

    // The root cause was a silently truncated neighbour query. Assert directly
    // on it, so a future density increase fails here with an obvious reason
    // rather than as a mysterious pair of fused units.
    expect(w.spatial.overflows, "neighbour query overflowed").toBe(0);
  });

  it("settles rather than jittering forever", () => {
    // Arrived units that keep shoving each other never come to rest, which
    // looks broken and burns CPU. Settled units resist being pushed.
    const w = makeWorld(48);
    const ids: EntityId[] = [];
    for (let i = 0; i < 16; i++) ids.push(addUnit(w, 8 + (i % 4), 8 + Math.floor(i / 4)));

    run(w, 500, [moveCmd(ids, 28, 28)]);

    const before = ids.map((id) => posOf(w, id));
    for (let t = 0; t < 40; t++) w.step([]);
    const after = ids.map((id) => posOf(w, id));

    let totalDrift = 0;
    for (let i = 0; i < ids.length; i++) {
      totalDrift += Math.hypot(after[i].x - before[i].x, after[i].y - before[i].y);
    }
    expect(totalDrift / ids.length).toBeLessThan(0.05);
  });
});

describe("determinism", () => {
  it("two worlds fed the same commands stay hash-identical", () => {
    // The property the entire netcode rests on.
    const a = makeWorld(48, 99);
    const b = makeWorld(48, 99);

    for (const w of [a, b]) {
      w.grid.fillRect(20, 10, 6, 20, TILE_BLOCKED);
      for (let i = 0; i < 40; i++) addUnit(w, 4 + (i % 8), 4 + Math.floor(i / 8), i % 2);
    }
    expect(a.hash()).toBe(b.hash());

    const idsP0 = [];
    const idsP1 = [];
    for (let i = 0; i < 40; i++) {
      const id = a.entities.idAt(i);
      (i % 2 === 0 ? idsP0 : idsP1).push(id);
    }

    for (let t = 0; t < 300; t++) {
      const commands: Command[] = [];
      if (t === 0) commands.push(moveCmd(idsP0, 40, 40, 0));
      if (t === 10) commands.push(moveCmd(idsP1, 40, 6, 1));
      if (t === 150) commands.push(moveCmd(idsP0, 6, 30, 0));

      a.step(commands);
      b.step(commands);
      expect(b.hash(), `desync at tick ${t}`).toBe(a.hash());
    }
  });

  it("detects divergence from a single-unit perturbation", () => {
    // A hash that cannot see a one-LSB difference is not a desync detector.
    const a = makeWorld(32, 7);
    const b = makeWorld(32, 7);
    for (const w of [a, b]) addUnit(w, 5, 5);
    expect(a.hash()).toBe(b.hash());

    b.entities.posX[0] += 1;
    expect(a.hash()).not.toBe(b.hash());
  });

  it("includes the cost grid in the hash", () => {
    // A peer that missed a building placement would path differently while
    // reporting a matching hash, which is the worst kind of desync: invisible.
    const a = makeWorld(32, 7);
    const b = makeWorld(32, 7);
    expect(a.hash()).toBe(b.hash());
    b.grid.set(4, 4, TILE_BLOCKED);
    expect(a.hash()).not.toBe(b.hash());
  });

  it("produces byte-identical trajectories on replay", () => {
    const record = (): number[] => {
      const w = makeWorld(48, 2024);
      w.grid.fillRect(18, 8, 4, 24, TILE_BLOCKED);
      const ids: EntityId[] = [];
      for (let i = 0; i < 30; i++) ids.push(addUnit(w, 4 + (i % 6), 4 + Math.floor(i / 6)));

      const hashes: number[] = [];
      for (let t = 0; t < 200; t++) {
        w.step(t === 0 ? [moveCmd(ids, 40, 30)] : []);
        hashes.push(w.hash());
      }
      return hashes;
    };
    expect(record()).toEqual(record());
  });

  it("keeps all state integral", () => {
    // Any float leaking into position or facing means fixed point has been
    // bypassed somewhere, and the hash would stop being portable.
    const w = makeWorld(32, 5);
    const ids: EntityId[] = [];
    for (let i = 0; i < 20; i++) ids.push(addUnit(w, 5 + (i % 5), 5 + Math.floor(i / 5)));
    run(w, 150, [moveCmd(ids, 25, 25)]);

    for (let i = 0; i < w.entities.highWater; i++) {
      expect(Number.isInteger(w.entities.posX[i])).toBe(true);
      expect(Number.isInteger(w.entities.posY[i])).toBe(true);
      expect(Number.isInteger(w.entities.facing[i])).toBe(true);
      expect(Object.is(w.entities.posX[i], -0)).toBe(false);
    }
  });
});

describe("scale", () => {
  it("handles 400 units on a 256 map within the tick budget", () => {
    // The stated target. Not a precise benchmark -- it exists to catch an
    // accidental O(n^2) regression, which at this size is unmissable.
    const w = makeWorld(256, 42);
    const ids: EntityId[] = [];
    for (let i = 0; i < 400; i++) ids.push(addUnit(w, 20 + (i % 20) * 0.6, 20 + Math.floor(i / 20) * 0.6));

    w.step([moveCmd(ids, 200, 200)]);
    const start = Date.now();
    for (let t = 0; t < 100; t++) w.step([]);
    const msPerTick = (Date.now() - start) / 100;

    // 50 ms is the real budget; 15 ms leaves ample room for combat and
    // rendering later while still failing loudly on a quadratic regression.
    expect(msPerTick, `${msPerTick.toFixed(2)} ms/tick`).toBeLessThan(15);
    expect(w.spatial.overflows, "neighbour query overflowed").toBe(0);
  });
});
