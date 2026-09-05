import { beforeAll, describe, expect, it } from "vitest";
import { CMD_MOVE, type Command } from "./commands.js";
import { entityIndex, spawnUnit, type EntityId } from "./entities.js";
import { enableDevChecks, fxFromFloat } from "./fixed.js";
import { TILE_BLOCKED } from "./grid.js";
import { SNAPSHOT_VERSION, decodeSnapshot, encodeSnapshot } from "./snapshot.js";
import { World } from "./world.js";

beforeAll(() => {
  enableDevChecks(true);
});

function makeWorld(mapTiles = 32, seed = 1234): World {
  return new World({ mapTiles, seed });
}

function addUnit(w: World, x: number, y: number, owner = 0): EntityId {
  return spawnUnit(w.entities, {
    x: fxFromFloat(x),
    y: fxFromFloat(y),
    radius: fxFromFloat(0.32),
    moveSpeed: fxFromFloat(0.18),
    turnRate: 3600,
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

function populate(w: World): EntityId[] {
  w.grid.fillRect(12, 8, 5, 12, TILE_BLOCKED);
  const ids: EntityId[] = [];
  for (let i = 0; i < 30; i++) ids.push(addUnit(w, 3 + (i % 6), 3 + Math.floor(i / 6), i % 2));
  return ids;
}

describe("snapshot", () => {
  it("round-trips to an identical hash", () => {
    const a = makeWorld();
    const ids = populate(a);
    for (let t = 0; t < 40; t++) a.step(t === 0 ? [moveCmd(ids, 26, 26)] : []);

    const b = makeWorld();
    decodeSnapshot(b, encodeSnapshot(a));
    expect(b.hash()).toBe(a.hash());
    expect(b.tick).toBe(a.tick);
    expect(b.entities.count).toBe(a.entities.count);
  });

  it("restores a world that continues identically", () => {
    // The property that actually matters for resync: it is not enough for the
    // restored state to match right now, it must keep matching as the
    // simulation runs on.
    const a = makeWorld(40, 77);
    const ids = populate(a);
    a.step([moveCmd(ids, 30, 30)]);
    for (let t = 0; t < 25; t++) a.step([]);

    const b = makeWorld(40, 77);
    decodeSnapshot(b, encodeSnapshot(a));

    for (let t = 0; t < 200; t++) {
      const commands = t === 50 ? [moveCmd(ids, 5, 30)] : [];
      a.step(commands);
      b.step(commands);
      expect(b.hash(), `diverged ${t} ticks after restore`).toBe(a.hash());
    }
  });

  it("restores rng state, so future randomness matches", () => {
    const a = makeWorld();
    populate(a);
    for (let i = 0; i < 17; i++) a.rng.next();

    const b = makeWorld();
    decodeSnapshot(b, encodeSnapshot(a));
    expect(b.rng.state).toBe(a.rng.state);
    expect(b.rng.next()).toBe(a.rng.next());
  });

  it("restores the cost grid", () => {
    const a = makeWorld();
    a.grid.fillRect(4, 4, 6, 6, TILE_BLOCKED);
    const b = makeWorld();
    decodeSnapshot(b, encodeSnapshot(a));
    expect(Array.from(b.grid.tiles)).toEqual(Array.from(a.grid.tiles));
    expect(b.grid.version).toBe(a.grid.version);
  });

  it("discards cached flow fields belonging to the old grid", () => {
    // A restored peer holding fields built for its previous grid would path
    // units straight into newly-placed buildings.
    const a = makeWorld();
    const ids = populate(a);
    a.step([moveCmd(ids, 26, 26)]);

    const b = makeWorld();
    const otherIds = populate(b);
    b.step([moveCmd(otherIds, 2, 2)]);
    const buildsBefore = b.flowFields.builds;

    decodeSnapshot(b, encodeSnapshot(a));
    b.step([]);
    expect(b.flowFields.builds).toBeGreaterThan(buildsBefore);
  });

  it("keeps spawning in lockstep after a restore", () => {
    // The subtle one. Slot allocation must depend only on the `alive` bitmap.
    // If it carried hidden ordering state, a restored peer would allocate
    // different slots from an unrestored one and desync on the next spawn --
    // making the resync look like it silently failed.
    const a = makeWorld();
    const ids = populate(a);
    for (let t = 0; t < 20; t++) a.step([]);

    // Punch holes so there are recycled slots to contend over.
    a.entities.despawn(ids[3]);
    a.entities.despawn(ids[11]);
    a.entities.despawn(ids[4]);

    const b = makeWorld();
    decodeSnapshot(b, encodeSnapshot(a));
    expect(b.hash()).toBe(a.hash());

    for (let k = 0; k < 5; k++) {
      const ea = addUnit(a, 10 + k, 20);
      const eb = addUnit(b, 10 + k, 20);
      expect(entityIndex(eb), `spawn ${k} landed in a different slot`).toBe(entityIndex(ea));
    }
    expect(b.hash()).toBe(a.hash());
  });

  it("survives a non-aligned buffer, as arrives from the wire", () => {
    // Network payloads carry no alignment guarantee, and an Int32Array view
    // over a misaligned offset throws.
    const a = makeWorld();
    populate(a);
    const snap = encodeSnapshot(a);

    const padded = new Uint8Array(snap.length + 3);
    padded.set(snap, 3);
    const misaligned = padded.subarray(3);
    expect(misaligned.byteOffset % 4).not.toBe(0);

    const b = makeWorld();
    expect(() => decodeSnapshot(b, misaligned)).not.toThrow();
    expect(b.hash()).toBe(a.hash());
  });

  it("rejects a corrupt or foreign payload", () => {
    const w = makeWorld();
    expect(() => decodeSnapshot(w, new Uint8Array(64))).toThrow(/magic/);
  });

  it("rejects a mismatched map size", () => {
    const a = makeWorld(32);
    populate(a);
    const b = makeWorld(64);
    expect(() => decodeSnapshot(b, encodeSnapshot(a))).toThrow(/map/);
  });

  it("rejects a snapshot from a different format version", () => {
    const a = makeWorld();
    populate(a);
    const snap = encodeSnapshot(a);
    new Int32Array(snap.buffer, snap.byteOffset, 2)[1] = SNAPSHOT_VERSION + 1;
    expect(() => decodeSnapshot(makeWorld(), snap)).toThrow(/version/);
  });

  it("stays a reasonable size for 400 units", () => {
    // Resync payloads travel over a DataChannel to a player who is already
    // struggling, so the size is worth watching.
    const w = makeWorld(256);
    for (let i = 0; i < 400; i++) addUnit(w, 10 + (i % 20) * 0.5, 10 + Math.floor(i / 20) * 0.5);
    const bytes = encodeSnapshot(w).byteLength;
    expect(bytes, `${(bytes / 1024).toFixed(1)} KiB`).toBeLessThan(128 * 1024);
  });
});
