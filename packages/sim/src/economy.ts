import { killEntity } from "./combat.js";
import {
  NULL_ENTITY,
  ORDER_GATHER,
  ORDER_NONE,
  ORDER_RETURN,
  type EntityId,
} from "./entities.js";
import { EV_DEPOSIT } from "./events.js";
import { fxFromFloat, fxLengthSq } from "./fixed.js";
import { worldToTile } from "./grid.js";
import { CAN_GATHER, IS_DROPOFF, KIND_RESOURCE, NEUTRAL_PLAYER } from "./types.js";
import type { World } from "./world.js";

/**
 * The harvesting loop.
 *
 * Alloy is a round trip -- walk to a patch, mine for a second, walk the load
 * back to a drop-off -- while plasma is a passive trickle from Extractors. Two
 * genuinely different acquisition loops rather than the same loop with a
 * different colour, which is what stops the content system from being
 * accidentally specialised to one shape of economy.
 *
 * A harvester's whole state fits in fields it already has: `targetId` holds the
 * ore patch for the entire cycle, including the walk home, and `orderKind`
 * distinguishes the outbound leg from the return. Keeping the patch in
 * `targetId` throughout is what makes a drone resume the *same* patch after
 * depositing, instead of re-deciding and drifting across the map.
 */

/** How close a harvester must be to a patch (edge to centre) to mine it. */
const GATHER_REACH = fxFromFloat(0.9);
/** How close a loaded harvester must get to a drop-off to unload. */
const DEPOSIT_REACH = fxFromFloat(1.1);
/**
 * How far a drone will look for a replacement patch when its own runs dry.
 *
 * Bounded rather than global: a drone whose patch is exhausted should walk to
 * the next patch in the same expansion, not set off across the map into an
 * enemy base because that happened to be the only ore left.
 */
const REACQUIRE_TILES = 18;

export function runEconomy(world: World): void {
  const store = world.entities;
  const types = world.types;
  const { posX, posY, orderKind, orderX, orderY, flowGoal, settled, targetId, cargo, gatherTimer } =
    store;

  for (let i = 0; i < store.highWater; i++) {
    if (store.alive[i] !== 1) continue;

    const order = orderKind[i];
    if (order !== ORDER_GATHER && order !== ORDER_RETURN) continue;

    const type = types.get(store.typeId[i]);
    if ((type.abilities & CAN_GATHER) === 0) {
      // A non-harvester can be handed a gather order by a bad client. Drop it
      // rather than letting it sit in a state nothing will ever advance.
      orderKind[i] = ORDER_NONE;
      continue;
    }

    if (order === ORDER_GATHER) {
      const ni = store.indexOfLive(targetId[i]);
      if (ni < 0 || store.resource[ni] <= 0) {
        const replacement = nearestPatch(world, i);
        if (replacement < 0) {
          // Nothing left in reach. Stop cleanly, still holding any partial
          // load, rather than looping on a target that will never exist.
          orderKind[i] = ORDER_NONE;
          targetId[i] = NULL_ENTITY;
          gatherTimer[i] = 0;
          settled[i] = 1;
          continue;
        }
        targetId[i] = store.idAt(replacement);
        gatherTimer[i] = 0;
        continue;
      }

      const reach = store.radius[ni] + GATHER_REACH;
      const dsq = fxLengthSq(posX[ni] - posX[i], posY[ni] - posY[i]);

      if (dsq > reach * reach) {
        gatherTimer[i] = 0;
        walkTo(world, i, posX[ni], posY[ni]);
        continue;
      }

      // In contact. Stand still and mine.
      orderX[i] = posX[i];
      orderY[i] = posY[i];
      flowGoal[i] = -1;
      settled[i] = 1;

      if (gatherTimer[i] === 0) gatherTimer[i] = type.gatherTime;
      gatherTimer[i]--;
      if (gatherTimer[i] > 0) continue;

      const wanted = type.cargoCapacity - cargo[i];
      const taken = store.resource[ni] < wanted ? store.resource[ni] : wanted;
      cargo[i] += taken;
      store.resource[ni] -= taken;

      // An exhausted patch is removed rather than left as an empty marker, so
      // it stops attracting drones and stops blocking the tiles it sat on.
      if (store.resource[ni] <= 0) killEntity(world, ni);

      orderKind[i] = ORDER_RETURN;
      settled[i] = 0;
      const dropoff = nearestDropoff(world, i);
      if (dropoff >= 0) walkTo(world, i, posX[dropoff], posY[dropoff]);
      continue;
    }

    // ORDER_RETURN: carrying a load home.
    const di = nearestDropoff(world, i);
    if (di < 0) {
      // Base destroyed mid-trip. Hold the cargo and stop; the load is not lost,
      // and rebuilding a Nexus lets the drone resume.
      orderKind[i] = ORDER_NONE;
      settled[i] = 1;
      continue;
    }

    const reach = store.radius[di] + DEPOSIT_REACH;
    const dsq = fxLengthSq(posX[di] - posX[i], posY[di] - posY[i]);
    if (dsq > reach * reach) {
      walkTo(world, i, posX[di], posY[di]);
      continue;
    }

    const amount = cargo[i];
    if (amount > 0) {
      world.players.refund(store.owner[i], amount, 0);
      world.events.push({
        kind: EV_DEPOSIT,
        player: store.owner[i],
        amount,
        x: posX[i],
        y: posY[i],
      });
      cargo[i] = 0;
    }

    // Back to the patch this drone was working, if it still exists.
    if (store.indexOfLive(targetId[i]) >= 0) {
      orderKind[i] = ORDER_GATHER;
      gatherTimer[i] = 0;
      settled[i] = 0;
    } else {
      orderKind[i] = ORDER_NONE;
      targetId[i] = NULL_ENTITY;
      settled[i] = 1;
    }
  }

  runExtractors(world);
}

/**
 * Plasma trickle from completed Extractors.
 *
 * Accumulated in twentieths of a unit so that a rate below 20 per second is not
 * silently rounded away to nothing every tick. The remainder is real simulation
 * state, hashed and snapshotted, because a resynced peer that restarted its
 * accumulator from zero would drift a fraction of a plasma behind forever --
 * small, permanent, and eventually a desync.
 */
function runExtractors(world: World): void {
  const store = world.entities;
  const players = world.players;

  for (let i = 0; i < store.highWater; i++) {
    if (store.alive[i] !== 1) continue;
    if (store.buildRemaining[i] > 0) continue;
    const owner = store.owner[i];
    if (!players.isValid(owner)) continue;
    const rate = world.types.get(store.typeId[i]).plasmaPerSecond;
    if (rate === 0) continue;
    players.plasmaFraction[owner] += rate;
  }

  for (let p = 0; p < players.plasmaFraction.length; p++) {
    const whole = Math.floor(players.plasmaFraction[p] / 20);
    if (whole === 0) continue;
    players.plasma[p] += whole;
    players.plasmaFraction[p] -= whole * 20;
  }
}

/** Point an entity at a world position, re-pathing only when the tile changes. */
export function walkTo(world: World, i: number, x: number, y: number): void {
  const store = world.entities;
  store.orderX[i] = x;
  store.orderY[i] = y;
  store.settled[i] = 0;

  const tx = worldToTile(x);
  const ty = worldToTile(y);
  if (!world.grid.inBounds(tx, ty)) return;

  // A drop-off or ore patch sits on blocked tiles -- it *is* the obstacle. Path
  // to the nearest open tile beside it instead, or the flow field would have no
  // reachable goal and every drone would stand still at the edge of the base.
  const cell = world.grid.isBlocked(tx, ty)
    ? world.nearestOpenCell(tx, ty)
    : world.grid.index(tx, ty);
  if (cell >= 0) store.flowGoal[i] = cell;
}

/** Nearest live ore patch within reacquire range, or -1. */
function nearestPatch(world: World, i: number): number {
  return nearestMatching(world, i, REACQUIRE_TILES, (j) => {
    const store = world.entities;
    if (store.resource[j] <= 0) return false;
    return world.types.get(store.typeId[j]).kind === KIND_RESOURCE;
  });
}

/**
 * Nearest completed drop-off belonging to this entity's owner, or -1.
 *
 * A linear scan rather than a spatial query, deliberately: a drone must find
 * its base even when the base is on the far side of the map, and a query radius
 * large enough to guarantee that is a scan in all but name.
 */
function nearestDropoff(world: World, i: number): number {
  const store = world.entities;
  const owner = store.owner[i];
  let best = -1;
  let bestDsq = Infinity;

  for (let j = 0; j < store.highWater; j++) {
    if (store.alive[j] !== 1) continue;
    if (store.owner[j] !== owner) continue;
    if (store.buildRemaining[j] > 0) continue;
    if ((world.types.get(store.typeId[j]).abilities & IS_DROPOFF) === 0) continue;

    const dsq = fxLengthSq(store.posX[j] - store.posX[i], store.posY[j] - store.posY[i]);
    if (dsq < bestDsq || (dsq === bestDsq && j < best)) {
      bestDsq = dsq;
      best = j;
    }
  }
  return best;
}

/** Shared nearest-entity search over a bounded tile radius. */
function nearestMatching(
  world: World,
  i: number,
  radiusTiles: number,
  accept: (j: number) => boolean,
): number {
  const store = world.entities;
  const count = world.spatial.queryInto(
    store.posX[i],
    store.posY[i],
    radiusTiles,
    world.queryScratch,
  );

  let best = -1;
  let bestDsq = Infinity;
  for (let k = 0; k < count; k++) {
    const j = world.queryScratch[k];
    if (j === i || store.alive[j] !== 1) continue;
    if (!accept(j)) continue;
    const dsq = fxLengthSq(store.posX[j] - store.posX[i], store.posY[j] - store.posY[i]);
    if (dsq < bestDsq || (dsq === bestDsq && j < best)) {
      bestDsq = dsq;
      best = j;
    }
  }
  return best;
}

/** Whether an entity is a resource node any harvester could work. */
export function isResourceNode(world: World, id: EntityId): boolean {
  const i = world.entities.indexOfLive(id);
  if (i < 0) return false;
  const type = world.types.get(world.entities.typeId[i]);
  return type.kind === KIND_RESOURCE && world.entities.owner[i] === NEUTRAL_PLAYER;
}
