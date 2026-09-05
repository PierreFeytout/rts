import {
  CMD_MOVE,
  TILE_BLOCKED,
  World,
  enableDevChecks,
  fxFromFloat,
  spawnUnit,
  type Command,
  type EntityId,
} from "@rts/sim";
import { beforeAll, describe, expect, it } from "vitest";
import { ReplayRecorder, playReplay, type Replay } from "./replay.js";

beforeAll(() => {
  enableDevChecks(true);
});

function buildMatch(seed = 909): { world: World; units: EntityId[] } {
  const world = new World({ mapTiles: 48, seed });
  world.grid.fillRect(18, 10, 5, 22, TILE_BLOCKED);
  const units: EntityId[] = [];
  for (let i = 0; i < 40; i++) {
    units.push(
      spawnUnit(world.entities, {
        x: fxFromFloat(4 + (i % 8) * 0.9),
        y: fxFromFloat(4 + Math.floor(i / 8) * 0.9),
        radius: fxFromFloat(0.32),
        moveSpeed: fxFromFloat(0.18),
        turnRate: 3600,
        owner: i % 2,
        typeId: 1,
        health: 100,
      }),
    );
  }
  return { world, units };
}

function scriptedCommands(units: EntityId[], tick: number): Command[] {
  const move = (playerId: number, x: number, y: number): Command => ({
    kind: CMD_MOVE,
    playerId,
    entities: units.filter((_, i) => i % 2 === playerId),
    targetX: fxFromFloat(x),
    targetY: fxFromFloat(y),
  });

  if (tick === 3) return [move(0, 40, 40)];
  if (tick === 40) return [move(1, 40, 6)];
  if (tick === 120) return [move(0, 6, 40)];
  if (tick === 260) return [move(1, 24, 24)];
  return [];
}

function recordMatch(ticks = 400, seed = 909): { replay: Replay; finalHash: number } {
  const { world, units } = buildMatch(seed);
  const recorder = new ReplayRecorder(world);
  for (let t = 0; t < ticks; t++) {
    const commands = scriptedCommands(units, t);
    world.step(commands);
    recorder.record(world, commands);
  }
  return { replay: recorder.finish(world), finalHash: world.hash() };
}

describe("replay", () => {
  it("reproduces a match exactly", () => {
    // The sharpest determinism test available: replay is free under lockstep,
    // and a replay that fails to reproduce means the simulation has a
    // non-determinism -- far easier to find here than from a friend's desync.
    const { replay, finalHash } = recordMatch();
    const fresh = new World({ mapTiles: 48, seed: 1 });
    const result = playReplay(fresh, replay);

    expect(result.ok).toBe(true);
    expect(result.divergedAtTick).toBeNull();
    expect(result.finalHash).toBe(finalHash);
    expect(fresh.hash()).toBe(finalHash);
  });

  it("restores everything from the snapshot, needing no matching construction", () => {
    // The replay world is built with a different seed and no obstacles. If
    // playback still matches, the initial snapshot really does carry all state.
    const { replay, finalHash } = recordMatch();
    const differentWorld = new World({ mapTiles: 48, seed: 0x1234 });
    expect(playReplay(differentWorld, replay).finalHash).toBe(finalHash);
  });

  it("is reproducible across repeated playback", () => {
    const { replay } = recordMatch();
    const a = playReplay(new World({ mapTiles: 48, seed: 5 }), replay);
    const b = playReplay(new World({ mapTiles: 48, seed: 9 }), replay);
    expect(a.finalHash).toBe(b.finalHash);
  });

  it("reports the first diverging checkpoint, not just failure", () => {
    // "The replay ended wrong" is nearly useless. "It went wrong between tick
    // 200 and 300" narrows the search enormously.
    const { replay } = recordMatch();
    const corrupted: Replay = {
      ...replay,
      checkpoints: replay.checkpoints.map((c, i) =>
        i === 1 ? { tick: c.tick, hash: c.hash ^ 0xff } : c,
      ),
    };

    const result = playReplay(new World({ mapTiles: 48, seed: 3 }), corrupted);
    expect(result.ok).toBe(false);
    expect(result.divergedAtTick).toBe(corrupted.checkpoints[1].tick);
  });

  it("detects a tampered command stream", () => {
    const { replay } = recordMatch();
    const tampered: Replay = {
      ...replay,
      commands: replay.commands.map((commands, tick) =>
        tick === 200
          ? [
              {
                kind: CMD_MOVE,
                playerId: 0,
                entities: [0],
                targetX: fxFromFloat(2),
                targetY: fxFromFloat(2),
              } satisfies Command,
            ]
          : commands,
      ),
    };
    expect(playReplay(new World({ mapTiles: 48, seed: 3 }), tampered).ok).toBe(false);
  });

  it("records every tick, including empty ones", () => {
    // Tick indices must line up exactly. Skipping empty ticks would shift every
    // later command by however many were skipped.
    const { replay } = recordMatch(120);
    expect(replay.commands).toHaveLength(120);
    expect(replay.commands.filter((c) => c.length === 0).length).toBeGreaterThan(100);
  });

  it("stays small, because only intent is stored", () => {
    // A 400-tick match with 40 units. State-based recording would be megabytes;
    // command-based is dominated by the one-off initial snapshot.
    const { replay } = recordMatch(400);
    const commandBytes = JSON.stringify(replay.commands).length;
    expect(commandBytes, `${commandBytes} bytes of commands`).toBeLessThan(4096);
  });
});
