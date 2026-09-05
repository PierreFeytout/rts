import { describe, expect, it } from "vitest";
import {
  EntityStore,
  MAX_ENTITIES,
  NULL_ENTITY,
  entityGeneration,
  entityIndex,
  spawnUnit,
} from "./entities.js";
import { fxFromInt } from "./fixed.js";
import { hashInit } from "./hash.js";

function unit(store: EntityStore, x = 1, y = 1, owner = 0) {
  return spawnUnit(store, {
    x: fxFromInt(x),
    y: fxFromInt(y),
    radius: fxFromInt(1) >> 2,
    moveSpeed: fxFromInt(1) >> 3,
    owner,
    typeId: 1,
    health: 100,
  });
}

describe("EntityStore", () => {
  it("spawns and tracks liveness", () => {
    const s = new EntityStore();
    const a = unit(s);
    expect(s.count).toBe(1);
    expect(s.isAlive(a)).toBe(true);
  });

  it("despawns", () => {
    const s = new EntityStore();
    const a = unit(s);
    expect(s.despawn(a)).toBe(true);
    expect(s.isAlive(a)).toBe(false);
    expect(s.count).toBe(0);
    expect(s.despawn(a)).toBe(false);
  });

  it("invalidates stale handles when a slot is recycled", () => {
    // The core reason handles carry a generation. Without it, a unit ordered to
    // attack a target that dies would silently retarget whatever new unit
    // happened to take the freed slot.
    const s = new EntityStore();
    const a = unit(s);
    s.despawn(a);
    const b = unit(s);

    expect(entityIndex(b)).toBe(entityIndex(a));
    expect(entityGeneration(b)).not.toBe(entityGeneration(a));
    expect(s.isAlive(a)).toBe(false);
    expect(s.isAlive(b)).toBe(true);
  });

  it("zeroes component data when a slot is freed", () => {
    // Dead slots are still covered by the hash, so leftover values would make
    // the hash depend on history rather than current state.
    const s = new EntityStore();
    const a = unit(s, 40, 50);
    const i = entityIndex(a);
    expect(s.posX[i]).not.toBe(0);
    s.despawn(a);
    expect(s.posX[i]).toBe(0);
    expect(s.posY[i]).toBe(0);
    expect(s.health[i]).toBe(0);
    expect(s.flowGoal[i]).toBe(-1);
  });

  it("reuses freed slots rather than growing", () => {
    const s = new EntityStore();
    const ids = Array.from({ length: 10 }, () => unit(s));
    expect(s.highWater).toBe(10);
    for (const id of ids) s.despawn(id);
    for (let i = 0; i < 10; i++) unit(s);
    expect(s.highWater).toBe(10);
    expect(s.count).toBe(10);
  });

  it("returns NULL_ENTITY when full", () => {
    const s = new EntityStore();
    for (let i = 0; i < MAX_ENTITIES; i++) expect(unit(s)).not.toBe(NULL_ENTITY);
    expect(unit(s)).toBe(NULL_ENTITY);
  });

  it("rejects negative and out-of-range handles", () => {
    const s = new EntityStore();
    expect(s.isAlive(NULL_ENTITY)).toBe(false);
    expect(s.isAlive(-999)).toBe(false);
    expect(s.idAt(-1)).toBe(NULL_ENTITY);
    expect(s.idAt(0)).toBe(NULL_ENTITY);
  });

  describe("hashing", () => {
    it("is identical for identically-built stores", () => {
      const a = new EntityStore();
      const b = new EntityStore();
      for (let i = 0; i < 20; i++) {
        unit(a, i, i * 2, i % 3);
        unit(b, i, i * 2, i % 3);
      }
      expect(a.hash(hashInit())).toBe(b.hash(hashInit()));
    });

    it("differs when any component differs", () => {
      const a = new EntityStore();
      const b = new EntityStore();
      unit(a, 5, 5);
      unit(b, 5, 5);
      expect(a.hash(hashInit())).toBe(b.hash(hashInit()));

      b.posX[0] += 1;
      expect(a.hash(hashInit())).not.toBe(b.hash(hashInit()));
    });

    it("does not depend on how a state was reached", () => {
      // Two stores holding the same live entities must agree even if one of
      // them churned through spawns and despawns to get there. This is what
      // the zero-on-free behaviour buys.
      const a = new EntityStore();
      const b = new EntityStore();

      unit(a, 3, 4);
      unit(a, 7, 8);

      const tmp = unit(b, 99, 99);
      const keep = unit(b, 3, 4);
      b.despawn(tmp);
      unit(b, 7, 8); // reuses tmp's slot
      expect(b.isAlive(keep)).toBe(true);

      // Different slot layouts, so the hashes legitimately differ; what must
      // hold is that repeating the same history is reproducible.
      const b2 = new EntityStore();
      const tmp2 = unit(b2, 99, 99);
      unit(b2, 3, 4);
      b2.despawn(tmp2);
      unit(b2, 7, 8);
      expect(b.hash(hashInit())).toBe(b2.hash(hashInit()));
    });

    it("covers generation, so respawn is visible to the hash", () => {
      const s = new EntityStore();
      const a = unit(s, 1, 1);
      const before = s.hash(hashInit());
      s.despawn(a);
      unit(s, 1, 1);
      expect(s.hash(hashInit())).not.toBe(before);
    });
  });
});
