import { walkTo } from "./economy.js";
import {
  MAX_ENTITIES,
  NULL_ENTITY,
  ORDER_BUILD,
  ORDER_MOVE,
  ORDER_NONE,
  entityIndex,
  spawnTyped,
  type EntityId,
} from "./entities.js";
import {
  BLOCKED_SPACE,
  EV_BLOCKED,
  EV_BUILD_COMPLETE,
  EV_PLAYER_DEFEATED,
  EV_UNIT_TRAINED,
} from "./events.js";
import { fxFromFloat, fxLengthSq } from "./fixed.js";
import { tileCentre, worldToTile } from "./grid.js";
import { MAX_PLAYERS } from "./players.js";
import { CAN_PRODUCE, KIND_BUILDING, MAX_SUPPLY } from "./types.js";
import type { World } from "./world.js";

/**
 * Construction, production queues, supply, and the victory check.
 *
 * These are grouped because they share one property: they all walk the entity
 * store once per tick and adjust per-player totals. Splitting them further
 * would mean three more full passes for no clarity gained.
 */

/** How close a builder must be to a site (edge to centre) to work on it. */
const BUILD_REACH = fxFromFloat(1.4);

/**
 * Build progress contributed to each site this tick, indexed by slot.
 *
 * Accumulated in a separate pass so that adding a second builder genuinely
 * doubles the rate. Decrementing `buildRemaining` directly from the builder
 * loop would work too, but it would make the building's health gain depend on
 * how many times it was visited, which is exactly the kind of thing that is
 * easy to get subtly wrong and hard to see.
 */
const contribution = new Int32Array(MAX_ENTITIES);

/** Live entity count per player, for the elimination check. Scratch, reused. */
const owned = new Int32Array(MAX_PLAYERS);

export function runConstruction(world: World): void {
  const store = world.entities;
  const types = world.types;

  contribution.fill(0, 0, store.highWater);

  // Pass 1: builders walk to their site and clock in.
  for (let i = 0; i < store.highWater; i++) {
    if (store.alive[i] !== 1) continue;
    if (store.orderKind[i] !== ORDER_BUILD) continue;

    const bi = store.indexOfLive(store.targetId[i]);
    if (bi < 0 || store.buildRemaining[bi] <= 0) {
      // Site finished or destroyed. Idle rather than standing in place with a
      // stale order, which would make the drone look busy while doing nothing.
      store.orderKind[i] = ORDER_NONE;
      store.targetId[i] = NULL_ENTITY;
      store.flowGoal[i] = -1;
      store.settled[i] = 1;
      continue;
    }

    const reach = store.radius[bi] + BUILD_REACH;
    const dsq = fxLengthSq(store.posX[bi] - store.posX[i], store.posY[bi] - store.posY[i]);
    if (dsq > reach * reach) {
      walkTo(world, i, store.posX[bi], store.posY[bi]);
      continue;
    }

    store.orderX[i] = store.posX[i];
    store.orderY[i] = store.posY[i];
    store.flowGoal[i] = -1;
    store.settled[i] = 1;
    contribution[bi]++;
  }

  // Pass 2: sites advance by however many builders reached them.
  for (let i = 0; i < store.highWater; i++) {
    if (store.alive[i] !== 1) continue;
    const remaining = store.buildRemaining[i];
    if (remaining <= 0) continue;

    const work = contribution[i];
    if (work === 0) continue;

    const type = types.get(store.typeId[i]);
    store.buildRemaining[i] = remaining - work > 0 ? remaining - work : 0;

    // Health rises with progress, but never past full and never *down* -- a
    // site that took damage keeps the damage and finishes at whatever it has.
    const gain = Math.ceil((type.maxHealth * work) / type.buildTime);
    const healed = store.health[i] + gain;
    store.health[i] = healed > type.maxHealth ? type.maxHealth : healed;

    if (store.buildRemaining[i] === 0) {
      store.health[i] = type.maxHealth;
      world.events.push({
        kind: EV_BUILD_COMPLETE,
        entity: store.idAt(i),
        typeId: store.typeId[i],
        owner: store.owner[i],
      });
    }
  }
}

/**
 * Advance production queues.
 *
 * Costs were already paid when the item was queued, so nothing here can fail
 * for lack of resources. It can fail for lack of *space*, which is deliberately
 * not an error: the building holds the finished unit and retries every tick
 * until the crowd around it thins out.
 */
export function runProduction(world: World): void {
  const store = world.entities;
  const types = world.types;

  for (let i = 0; i < store.highWater; i++) {
    if (store.alive[i] !== 1) continue;
    if (store.buildRemaining[i] > 0) continue;
    if (store.queueLen[i] === 0) continue;
    if (!types.can(store.typeId[i], CAN_PRODUCE)) continue;

    const unitType = store.queueAt(i, 0);
    if (!types.has(unitType)) {
      store.dequeueAt(i, 0);
      continue;
    }

    // produceRemaining encodes three states in one integer:
    //   0  -- nothing started yet
    //   >0 -- ticks left on the current item
    //   -1 -- item finished but there was nowhere to put it
    // The third state is why this cannot simply be a countdown: a factory
    // walled in by its own army must not silently restart the timer and
    // charge the player twice the build time.
    let remaining = store.produceRemaining[i];
    if (remaining === 0) {
      const buildTime = types.get(unitType).buildTime;
      remaining = buildTime > 0 ? buildTime : 1;
    }
    if (remaining > 0) {
      remaining--;
      store.produceRemaining[i] = remaining;
      if (remaining > 0) continue;
    }

    const spawned = spawnFromBuilding(world, i, unitType);
    if (spawned === NULL_ENTITY) {
      store.produceRemaining[i] = -1;
      world.events.push({
        kind: EV_BLOCKED,
        player: store.owner[i],
        reason: BLOCKED_SPACE,
        typeId: unitType,
      });
      continue;
    }

    store.produceRemaining[i] = 0;
    store.dequeueAt(i, 0);
    world.events.push({
      kind: EV_UNIT_TRAINED,
      entity: spawned,
      typeId: unitType,
      owner: store.owner[i],
      from: store.idAt(i),
    });
  }
}

/**
 * Place a finished unit on an open tile beside its factory.
 *
 * The search spirals outward in a fixed order, so every peer picks the same
 * tile. Returns NULL_ENTITY when the building is walled in, which the caller
 * treats as "try again next tick" rather than as a failure.
 */
function spawnFromBuilding(world: World, bi: number, unitType: number): EntityId {
  const store = world.entities;
  const type = world.types.get(store.typeId[bi]);
  const anchorX = worldToTile(store.posX[bi] - (((type.footprint - 1) << 16) >> 1));
  const anchorY = worldToTile(store.posY[bi] - (((type.footprint - 1) << 16) >> 1));
  const span = type.footprint > 0 ? type.footprint : 1;

  for (let ring = 1; ring <= 6; ring++) {
    for (let dy = -ring; dy < span + ring; dy++) {
      for (let dx = -ring; dx < span + ring; dx++) {
        // Perimeter of this ring only; the interior was covered by earlier ones.
        const onEdge =
          dx === -ring || dy === -ring || dx === span + ring - 1 || dy === span + ring - 1;
        if (!onEdge) continue;

        const tx = anchorX + dx;
        const ty = anchorY + dy;
        if (!world.grid.inBounds(tx, ty) || world.grid.isBlocked(tx, ty)) continue;

        const id = spawnTyped(
          store,
          world.types,
          unitType,
          tileCentre(tx),
          tileCentre(ty),
          store.owner[bi],
        );
        if (id === NULL_ENTITY) return NULL_ENTITY;

        // Walk to the rally point, unless it is still the factory itself.
        const ui = entityIndex(id);
        const rx = store.rallyX[bi];
        const ry = store.rallyY[bi];
        if (rx !== store.posX[bi] || ry !== store.posY[bi]) {
          store.orderKind[ui] = ORDER_MOVE;
          walkTo(world, ui, rx, ry);
        }
        return id;
      }
    }
  }
  return NULL_ENTITY;
}

/**
 * Recompute per-player supply and resolve elimination.
 *
 * Both are derived totals rather than incrementally maintained counters. That
 * is a deliberate trade: a full pass over the entity store costs microseconds,
 * while an incremental counter has to be adjusted correctly at every spawn,
 * death, cancellation and refund -- and the failure mode of missing one is a
 * player who can slowly no longer build anything, with no visible cause.
 */
export function recomputeSupplyAndDefeat(world: World): void {
  const store = world.entities;
  const types = world.types;
  const players = world.players;

  players.supplyUsed.fill(0);
  players.supplyCap.fill(0);
  owned.fill(0);

  for (let i = 0; i < store.highWater; i++) {
    if (store.alive[i] !== 1) continue;
    const owner = store.owner[i];
    if (!players.isValid(owner)) continue;

    owned[owner]++;
    const type = types.get(store.typeId[i]);
    players.supplyUsed[owner] += type.supplyCost;

    // Only finished buildings provide supply. Queueing four units against a
    // pylon that is still a foundation is not a thing.
    if (type.kind === KIND_BUILDING && store.buildRemaining[i] === 0) {
      players.supplyCap[owner] += type.supplyProvided;
    }

    // Units still in a production queue count against supply already, so a
    // player cannot queue twenty troopers into ten supply and discover the
    // problem when they pop.
    const queued = store.queueLen[i];
    for (let k = 0; k < queued; k++) {
      const queuedType = store.queueAt(i, k);
      if (types.has(queuedType)) players.supplyUsed[owner] += types.get(queuedType).supplyCost;
    }
  }

  for (let p = 0; p < MAX_PLAYERS; p++) {
    if (players.supplyCap[p] > MAX_SUPPLY) players.supplyCap[p] = MAX_SUPPLY;
  }

  // Elimination: a player in the match who owns nothing at all is out. Owning
  // "nothing at all" rather than "no buildings" avoids the classic stalemate
  // where a defeated player's last drone hides in a corner forever.
  let alive = 0;
  let lastAlive = -1;
  let contenders = 0;

  for (let p = 0; p < MAX_PLAYERS; p++) {
    if (players.inPlay[p] !== 1) continue;
    contenders++;
    if (players.defeated[p] === 1) continue;

    if (owned[p] === 0) {
      players.defeated[p] = 1;
      players.defeatedTick[p] = world.tick;
      world.events.push({ kind: EV_PLAYER_DEFEATED, player: p, winner: -1 });
      continue;
    }
    alive++;
    lastAlive = p;
  }

  // A single remaining contender wins. Zero remaining is a mutual kill and
  // stays undecided rather than crowning the last player to die.
  if (players.winner === -1 && contenders >= 2 && alive === 1) {
    players.winner = lastAlive;
    world.events.push({ kind: EV_PLAYER_DEFEATED, player: -1, winner: lastAlive });
  }
}
