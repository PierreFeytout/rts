import {
  CMD_ATTACK_MOVE,
  CMD_BUILD,
  CMD_GATHER,
  CMD_TRAIN,
  T_ALLOY_NODE,
  T_DRONE,
  T_FOUNDRY,
  T_NEXUS,
  T_PYLON,
  T_TROOPER,
  TICK_MS,
  World,
  enableDevChecks,
  entityIndex,
  fxFromFloat,
  recomputeSupplyAndDefeat,
  spawnTyped,
  type Command,
  type EntityId,
} from "@rts/sim";
import { VirtualNetwork } from "@rts/transport";
import { beforeAll, describe, expect, it } from "vitest";
import { GuestSession } from "./guest.js";
import { HostSession } from "./host.js";

/**
 * A whole match -- economy, construction, production and combat -- played over
 * the virtual network, asserting the peers never diverge.
 *
 * This is the test that would have caught every M4 bug that mattered. The sim's
 * own determinism tests prove that one world replays identically; this proves
 * that two *independently running* peers, exchanging only commands over a laggy
 * link, stay bit-identical while the gameplay systems are doing real work.
 *
 * It runs in milliseconds and needs no browser, which is the entire reason
 * `transport` is its own package: the whole lockstep layer is CI-testable
 * without any real networking.
 */

beforeAll(() => {
  enableDevChecks(true);
});

const MAP_TILES = 64;

/** Anchor tile of each player's Command Nexus. */
const BASES: Array<[number, number]> = [
  [8, 8],
  [40, 40],
];

/** Two facing bases with ore, close enough that the armies actually meet. */
function buildMatchWorld(seed: number): World {
  const world = new World({ mapTiles: MAP_TILES, seed });

  BASES.forEach(([bx, by], player) => {
    world.placeStructure(T_NEXUS, bx, by, player);
    world.placeStructure(T_ALLOY_NODE, bx + 7, by, -1);
    world.placeStructure(T_ALLOY_NODE, bx, by + 7, -1);
    for (let d = 0; d < 4; d++) {
      spawnTyped(
        world.entities,
        world.types,
        T_DRONE,
        fxFromFloat(bx + 5 + (d % 2) * 0.8),
        fxFromFloat(by + 4 + Math.floor(d / 2) * 0.8),
        player,
      );
    }
    world.players.inPlay[player] = 1;
  });

  recomputeSupplyAndDefeat(world);
  return world;
}

interface Harness {
  host: HostSession;
  guest: GuestSession;
  tick(count: number): void;
  drain(): void;
}

function makeHarness(latencyMs = 45, jitterMs = 12): Harness {
  const net = new VirtualNetwork(0x5111);
  const hostTransport = net.addPeer(0);
  const guestTransport = net.addPeer(1);
  net.setSymmetricLink(0, 1, { latencyMs, jitterMs });

  const host = new HostSession({
    world: buildMatchWorld(9001),
    transport: hostTransport,
    inputDelay: 4,
    hashInterval: 20,
  });
  // The guest starts from an EMPTY world; everything arrives in the snapshot.
  const guest = new GuestSession({
    world: new World({ mapTiles: MAP_TILES, seed: 1 }),
    transport: guestTransport,
    hashInterval: 20,
    name: "guest",
  });
  guest.connect();
  net.advance(latencyMs * 3 + jitterMs + 10);

  return {
    host,
    guest,
    tick(count: number) {
      for (let i = 0; i < count; i++) {
        host.update(TICK_MS);
        net.advance(TICK_MS / 2);
        guest.update(TICK_MS);
        net.advance(TICK_MS / 2);
      }
    },
    // A guest is always a tick or two behind, so hashes are only comparable
    // once it has caught up to the host's tick number.
    drain() {
      const target = host.world.tick;
      for (let i = 0; i < 400; i++) {
        net.advance(TICK_MS);
        guest.update(TICK_MS);
        if (guest.world.tick >= target) return;
      }
      throw new Error(`guest failed to reach tick ${target}`);
    },
  };
}

/** Slot indices of a player's entities of a given type, in the host's world. */
function find(world: World, typeId: number, owner: number): number[] {
  const out: number[] = [];
  const e = world.entities;
  for (let i = 0; i < e.highWater; i++) {
    if (e.alive[i] !== 1 || e.typeId[i] !== typeId || e.owner[i] !== owner) continue;
    out.push(i);
  }
  return out;
}

function ids(world: World, indices: number[]): EntityId[] {
  return indices.map((i) => world.entities.idAt(i));
}

describe("a full match over the network", () => {
  it("keeps both peers bit-identical through economy, building and combat", () => {
    const h = makeHarness();
    const hostWorld = h.host.world;

    expect(h.guest.isJoined).toBe(true);
    expect(h.guest.world.hash()).toBe(hostWorld.hash());

    // -- both players open with a harvest and a supply pylon ----------------
    const openings: Command[] = [];
    for (const player of [0, 1]) {
      const drones = ids(hostWorld, find(hostWorld, T_DRONE, player));
      const nodes = find(hostWorld, T_ALLOY_NODE, -1);
      const nexus = find(hostWorld, T_NEXUS, player)[0];
      // Nearest patch to this player's own base.
      let best = nodes[0];
      let bestD = Infinity;
      for (const n of nodes) {
        const d =
          (hostWorld.entities.posX[n] - hostWorld.entities.posX[nexus]) ** 2 +
          (hostWorld.entities.posY[n] - hostWorld.entities.posY[nexus]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      // Build sites are placed from the base's ANCHOR tile, not from the
      // Nexus's world position -- a building is positioned by its centre, so
      // deriving tiles from `posX` lands the footprint two tiles off and
      // silently overlaps the ore patch.
      const [bx, by] = BASES[player];

      openings.push({ kind: CMD_GATHER, playerId: player, entities: drones, target: hostWorld.entities.idAt(best) });
      openings.push({
        kind: CMD_BUILD,
        playerId: player,
        entities: [drones[0]],
        buildingType: T_PYLON,
        tileX: bx - 4,
        tileY: by + 3,
      });
      openings.push({
        kind: CMD_BUILD,
        playerId: player,
        entities: [drones[1]],
        buildingType: T_FOUNDRY,
        tileX: bx + 3,
        tileY: by - 4,
      });
      openings.push({
        kind: CMD_TRAIN,
        playerId: player,
        building: hostWorld.entities.idAt(nexus),
        unitType: T_DRONE,
      });
    }

    // Player 0's orders come from the host, player 1's from the guest, so both
    // command paths are exercised -- local submission and a network round trip.
    for (const command of openings) {
      if (command.playerId === 0) h.host.submitLocal(command);
      else h.guest.submitLocal(command);
    }

    h.tick(400);
    h.drain();
    expect(h.guest.world.hash()).toBe(hostWorld.hash());
    expect(h.host.desyncs).toBe(0);

    // The economy actually ran, on both peers, to the same number.
    expect(hostWorld.players.alloy[0]).toBeGreaterThan(0);
    expect(h.guest.world.players.alloy[1]).toBe(hostWorld.players.alloy[1]);
    expect(find(hostWorld, T_PYLON, 0).length).toBe(1);
    expect(find(hostWorld, T_FOUNDRY, 1).length).toBe(1);

    // -- both build an army and send it at the other ------------------------
    for (const player of [0, 1]) {
      const foundry = find(hostWorld, T_FOUNDRY, player)[0];
      const session = player === 0 ? h.host : h.guest;
      for (let k = 0; k < 4; k++) {
        session.submitLocal({
          kind: CMD_TRAIN,
          playerId: player,
          building: hostWorld.entities.idAt(foundry),
          unitType: T_TROOPER,
        });
      }
    }

    h.tick(400);
    h.drain();
    expect(h.guest.world.hash()).toBe(hostWorld.hash());

    const armies = [find(hostWorld, T_TROOPER, 0), find(hostWorld, T_TROOPER, 1)];
    expect(armies[0].length).toBeGreaterThan(0);
    expect(armies[1].length).toBeGreaterThan(0);

    for (const player of [0, 1]) {
      const enemyNexus = find(hostWorld, T_NEXUS, 1 - player)[0];
      const session = player === 0 ? h.host : h.guest;
      session.submitLocal({
        kind: CMD_ATTACK_MOVE,
        playerId: player,
        entities: ids(hostWorld, armies[player]),
        targetX: hostWorld.entities.posX[enemyNexus],
        targetY: hostWorld.entities.posY[enemyNexus],
      });
    }

    // -- fight, checking agreement all the way through ----------------------
    const before = armies[0].length + armies[1].length;
    for (let round = 0; round < 12; round++) {
      h.tick(100);
      h.drain();
      expect(h.guest.world.hash()).toBe(hostWorld.hash());
    }
    const after =
      find(hostWorld, T_TROOPER, 0).length + find(hostWorld, T_TROOPER, 1).length;
    const deaths = before - after;

    // Something actually died: a "no desync" result from a match where nothing
    // happened would be worthless.
    expect(deaths).toBeGreaterThan(0);
    expect(h.host.desyncs).toBe(0);
    expect(h.guest.resyncs).toBe(0);
    expect(hostWorld.spatial.overflows).toBe(0);
  });

  it("agrees on a resource node running dry", () => {
    const h = makeHarness(20, 0);
    const hostWorld = h.host.world;
    const node = find(hostWorld, T_ALLOY_NODE, -1)[0];
    // Nearly exhausted, so it depletes and despawns mid-match on both peers.
    hostWorld.entities.resource[node] = 20;

    const drones = ids(hostWorld, find(hostWorld, T_DRONE, 0));
    h.host.submitLocal({
      kind: CMD_GATHER,
      playerId: 0,
      entities: drones,
      target: hostWorld.entities.idAt(node),
    });

    h.tick(500);
    h.drain();

    expect(hostWorld.entities.alive[node]).toBe(0);
    expect(h.guest.world.entities.alive[node]).toBe(0);
    expect(h.guest.world.hash()).toBe(hostWorld.hash());
    // The tiles it occupied are walkable again on both peers, which is what the
    // grid hash is there to prove.
    expect(h.guest.world.grid.version).toBe(hostWorld.grid.version);
  });

  it("refuses a guest's order against another player's units", () => {
    const h = makeHarness(20, 0);
    const hostWorld = h.host.world;
    const victim = find(hostWorld, T_DRONE, 0)[0];
    const nexus = find(hostWorld, T_NEXUS, 0)[0];
    const before = hostWorld.players.alloy[0];

    // A modified client claiming player 0's slot. The host stamps the real
    // sender id, and the simulation re-checks ownership regardless.
    h.guest.submitLocal({
      kind: CMD_TRAIN,
      playerId: 0,
      building: hostWorld.entities.idAt(nexus),
      unitType: T_DRONE,
    });

    h.tick(40);
    h.drain();

    expect(hostWorld.entities.queueLen[nexus]).toBe(0);
    expect(hostWorld.players.alloy[0]).toBe(before);
    expect(hostWorld.entities.alive[entityIndex(hostWorld.entities.idAt(victim))]).toBe(1);
    expect(h.guest.world.hash()).toBe(hostWorld.hash());
  });
});
