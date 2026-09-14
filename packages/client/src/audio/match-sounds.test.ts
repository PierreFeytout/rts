import { defaultContent } from "@rts/content";
import {
  BLOCKED_SUPPLY,
  CMD_MOVE,
  EV_BLOCKED,
  EV_BUILD_COMPLETE,
  EV_DEATH,
  EV_DEPOSIT,
  EV_SHOT,
  EV_UNIT_TRAINED,
  VIS_HIDDEN,
  VIS_VISIBLE,
  type World,
} from "@rts/sim";
import { beforeEach, describe, expect, it, vi } from "vitest";

const played: Array<{ keys: readonly string[]; at: { x: number; z: number } | undefined }> = [];
vi.mock("./sfx.js", () => ({
  sfx: { play: (keys: readonly string[], at?: { x: number; z: number }) => played.push({ keys, at }) },
}));

const { MatchSounds } = await import("./match-sounds.js");

const TROOPER = defaultContent.id("vanguard.trooper");
const NEXUS = defaultContent.id("vanguard.nexus");
const FX = 65536;

/**
 * Just enough of a world: entity 0 is the local player's Conscript at (10, 10),
 * entity 1 an enemy's Bastion at (40, 40); the local player sees x < 30 only.
 */
function world(events: unknown[]): World {
  const owner = [0, 1];
  const typeId = [TROOPER, NEXUS];
  const pos = [10 * FX, 40 * FX];
  return {
    events: { all: events },
    types: defaultContent.types,
    vision: {
      enabled: true,
      levelAt: (_player: number, tx: number) => (tx < 30 ? VIS_VISIBLE : VIS_HIDDEN),
    },
    entities: {
      indexOfLive: (id: number) => (id === 0 || id === 1 ? id : -1),
      owner,
      typeId,
      posX: pos,
      posY: pos,
    },
  } as unknown as World;
}

const keys = (): string[] => played.map((p) => p.keys[0]);

describe("MatchSounds", () => {
  beforeEach(() => {
    played.length = 0;
  });

  it("plays a shot at the shooter, by what fired it, and its impact at the target", () => {
    new MatchSounds(0).ingest(
      world([{ kind: EV_SHOT, shooter: 0, target: 9, fromX: 10 * FX, fromY: 10 * FX, toX: 12 * FX, toY: 11 * FX, damage: 9, lethal: false }]),
    );
    expect(played.map((p) => p.keys)).toEqual([
      ["shot.vanguard.trooper", "shot.vanguard", "shot.kinetic", "shot"],
      ["impact.kinetic", "impact"],
    ]);
    expect(played[0].at).toEqual({ x: 10, z: 10 });
    expect(played[1].at).toEqual({ x: 12, z: 11 });
  });

  it("plays nothing the local player cannot see", () => {
    new MatchSounds(0).ingest(
      world([
        { kind: EV_SHOT, shooter: 1, target: 9, fromX: 40 * FX, fromY: 40 * FX, toX: 41 * FX, toY: 40 * FX, damage: 5, lethal: true },
        { kind: EV_DEATH, entity: 5, typeId: TROOPER, owner: 1, x: 41 * FX, y: 40 * FX },
        { kind: EV_BUILD_COMPLETE, entity: 1, typeId: NEXUS, owner: 1 },
        { kind: EV_UNIT_TRAINED, entity: 7, typeId: TROOPER, owner: 1, from: 1 },
      ]),
    );
    expect(played).toEqual([]);
  });

  it("names deaths, finished buildings and training by what they were", () => {
    new MatchSounds(1).ingest(
      world([
        { kind: EV_DEATH, entity: 5, typeId: NEXUS, owner: 1, x: 20 * FX, y: 20 * FX },
        // The local player's own building, in its own fog: always heard.
        { kind: EV_BUILD_COMPLETE, entity: 1, typeId: NEXUS, owner: 1 },
        { kind: EV_UNIT_TRAINED, entity: 7, typeId: TROOPER, owner: 1, from: 1 },
      ]),
    );
    expect(played.map((p) => p.keys)).toEqual([
      ["death.vanguard.nexus", "death.vanguard", "death.building", "death"],
      ["built.vanguard.nexus", "built.vanguard", "built"],
      ["trained.vanguard.trooper", "trained.vanguard", "trained"],
    ]);
  });

  it("plays the local player's own deposits and refusals, and nobody else's", () => {
    new MatchSounds(0).ingest(
      world([
        { kind: EV_DEPOSIT, player: 0, amount: 10, x: 12 * FX, y: 12 * FX },
        { kind: EV_DEPOSIT, player: 1, amount: 10, x: 12 * FX, y: 12 * FX },
        { kind: EV_BLOCKED, player: 0, reason: BLOCKED_SUPPLY, typeId: TROOPER },
        { kind: EV_BLOCKED, player: 1, reason: BLOCKED_SUPPLY, typeId: TROOPER },
      ]),
    );
    expect(keys()).toEqual(["deposit", "blocked.supply"]);
    expect(played[1].at).toBeUndefined();
  });

  it("acknowledges orders, and speaks for a new selection once", () => {
    const sounds = new MatchSounds(0);
    sounds.order({ kind: CMD_MOVE, playerId: 0, entities: [0], targetX: 0, targetY: 0 });
    const w = world([]);
    sounds.select(w, new Set([0]));
    sounds.select(w, new Set([0]));
    sounds.select(w, new Set());
    sounds.select(w, new Set([1]));
    expect(played.map((p) => p.keys)).toEqual([
      ["order.move", "order"],
      ["select.vanguard.trooper", "select.vanguard", "select.unit", "select"],
      ["select.vanguard.nexus", "select.vanguard", "select.building", "select"],
    ]);
  });
});
