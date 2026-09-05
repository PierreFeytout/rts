import {
  MAX_ENTITIES,
  NULL_ENTITY,
  ORDER_ATTACK,
  ORDER_ATTACK_MOVE,
  ORDER_BUILD,
  ORDER_GATHER,
  ORDER_NONE,
  ORDER_RETURN,
} from "./entities.js";
import { EV_DEATH, EV_SHOT } from "./events.js";
import { fxLength, fxLengthSq, type Fx } from "./fixed.js";
import { worldToTile } from "./grid.js";
import { KIND_BUILDING, KIND_RESOURCE, CAN_ATTACK, NEUTRAL_PLAYER, applyDamageTable } from "./types.js";
import type { World } from "./world.js";

/**
 * Combat: cooldowns, target acquisition, firing, and death.
 *
 * Shots are instantaneous rather than travelling projectiles. Two reasons, and
 * the second is the one that decided it:
 *
 *   1. A projectile is an entity, and 400 units firing every second would churn
 *      through entity slots faster than the units themselves.
 *   2. In-flight projectiles are simulation state, which means they are hashed,
 *      snapshotted, and one more thing that can disagree between peers. A
 *      hitscan resolves entirely within one tick, so a resynced peer inherits
 *      no half-finished shots.
 *
 * The renderer still draws travelling tracers, interpolated from the shot
 * events -- the *appearance* of a projectile without the state.
 */

/**
 * Candidate buffer for target queries.
 *
 * Sized to the whole entity store rather than to some expected crowd size. A
 * long-ranged turret in the middle of a 400-unit brawl legitimately sees a lot
 * of neighbours, and a truncated query does not fail loudly -- it silently
 * makes the turret shoot at whichever enemy happened to be indexed first,
 * which is very hard to notice and impossible to explain.
 */
const candidates = new Int32Array(MAX_ENTITIES);

/**
 * How far past its weapon range a unit will chase an auto-acquired target
 * before giving up and returning to what it was doing.
 *
 * Without a leash, one scout wandering past a defensive line pulls the entire
 * line across the map after it. Explicit attack orders are not leashed: if a
 * player says kill that, the unit commits.
 */
const LEASH_MULTIPLIER = 2;

export function runCombat(world: World): void {
  const store = world.entities;
  const types = world.types;
  const { posX, posY, radius, owner, typeId, orderKind, orderX, orderY } = store;
  const { targetId, cooldown, flowGoal, settled, buildRemaining } = store;

  for (let i = 0; i < store.highWater; i++) {
    if (store.alive[i] !== 1) continue;
    if (cooldown[i] > 0) cooldown[i]--;

    const type = types.get(typeId[i]);
    if ((type.abilities & CAN_ATTACK) === 0) continue;
    // A half-built turret is a wall, not a weapon.
    if (buildRemaining[i] > 0) continue;

    const order = orderKind[i];
    // Harvesters and builders mind their own business. A drone that stopped to
    // trade shots with a passing trooper is a drone that stopped mining, and
    // the player did not ask for that trade.
    const busyWorking = order === ORDER_GATHER || order === ORDER_RETURN || order === ORDER_BUILD;

    // `targetId` is shared with the economy and construction systems: for a
    // harvester it holds the ore patch, for a builder the site. Combat must
    // therefore leave it completely alone for a working unit -- clearing it
    // here silently cancelled every gather and every build order, which
    // presented as drones that walked halfway to a patch and then forgot why.
    if (busyWorking) continue;

    let ti = store.indexOfLive(targetId[i]);

    if (ti >= 0) {
      const stillHostile = isHostile(owner[i], owner[ti]);
      if (order === ORDER_ATTACK) {
        // Committed. A player who said "kill that" gets exactly that, however
        // far it runs; only death or a change of ownership calls it off.
        if (!stillHostile) ti = -1;
      } else {
        // Auto-acquired targets are leashed, or one scout wandering past a
        // defensive line drags the whole line across the map after it.
        const leash = type.range * (1 + LEASH_MULTIPLIER) + radius[ti];
        const dsq = fxLengthSq(posX[ti] - posX[i], posY[ti] - posY[i]);
        if (!stillHostile || dsq > leash * leash) ti = -1;
      }
    }

    if (ti < 0) {
      // An explicit attack order whose target is gone reverts to idle rather
      // than silently re-targeting: the player aimed at something specific.
      if (order === ORDER_ATTACK) {
        orderKind[i] = ORDER_NONE;
        flowGoal[i] = -1;
        settled[i] = 1;
      }
      targetId[i] = NULL_ENTITY;

      ti = acquire(world, i, type.range);
      if (ti < 0) continue;
      targetId[i] = store.idAt(ti);
    }

    // Chase, if this unit is allowed to. Attack orders and attack-moves pursue;
    // an idle unit that spotted something shoots but holds its ground, and a
    // unit on Hold never moves at all.
    const dist = fxLength(posX[ti] - posX[i], posY[ti] - posY[i]);
    const reach = type.range + radius[ti] + radius[i];

    if (dist > reach) {
      // Only an explicit pursuit order closes the distance. An idle unit that
      // spotted something shoots if it can and otherwise holds its ground --
      // an army that drifted toward every distant contact would dissolve.
      const pursues = order === ORDER_ATTACK || order === ORDER_ATTACK_MOVE;
      if (pursues && type.moveSpeed > 0) chase(world, i, ti);
      continue;
    }

    // In range: an attack-mover stops advancing while it has something to shoot.
    if (order === ORDER_ATTACK_MOVE || order === ORDER_ATTACK) {
      orderX[i] = posX[i];
      orderY[i] = posY[i];
      settled[i] = 1;
    }

    if (cooldown[i] > 0) continue;
    fire(world, i, ti, type.damage, type.damageType);
    cooldown[i] = type.cooldown;
  }
}

/** Two entities are hostile if both are owned and by different players. */
export function isHostile(a: number, b: number): boolean {
  if (a === NEUTRAL_PLAYER || b === NEUTRAL_PLAYER) return false;
  return a !== b;
}

/**
 * Nearest hostile within `range`, or -1.
 *
 * Ties break on the lower slot index. That tie-break is not cosmetic: without
 * it, two units at exactly equal distance would be chosen by whichever the
 * spatial query happened to visit first, and while that is in fact
 * deterministic today, it would silently become a divergence the moment the
 * spatial hash's cell size changed.
 */
function acquire(world: World, i: number, range: Fx): number {
  const store = world.entities;
  const types = world.types;
  const { posX, posY, radius, owner, typeId, buildRemaining } = store;

  const queryTiles = worldToTile(range) + 2;
  const count = world.spatial.queryInto(posX[i], posY[i], queryTiles, candidates);

  let best = -1;
  let bestDsq = Infinity;

  for (let k = 0; k < count; k++) {
    const j = candidates[k];
    if (j === i || store.alive[j] !== 1) continue;
    if (!isHostile(owner[i], owner[j])) continue;
    // Fog gates acquisition, which is what makes scouting matter. An explicit
    // attack order is NOT gated -- the player saw the target when they issued
    // it, and having units abandon a chase the moment it entered fog would be
    // maddening.
    if (!world.vision.canSee(owner[i], store, j)) continue;

    const targetType = types.get(typeId[j]);
    // Ore patches and vents are terrain with hit points, not enemies.
    if (targetType.kind === KIND_RESOURCE) continue;

    const reach = range + radius[j];
    const dsq = fxLengthSq(posX[j] - posX[i], posY[j] - posY[i]);
    if (dsq > reach * reach) continue;

    // Prefer a real threat over scenery: an unfinished building is the least
    // interesting thing on the field, so it only wins if nothing else is close.
    const penalty = buildRemaining[j] > 0 || targetType.kind === KIND_BUILDING ? 1 : 0;
    const score = dsq + penalty * 0x40000000;

    if (score < bestDsq || (score === bestDsq && j < best)) {
      bestDsq = score;
      best = j;
    }
  }
  return best;
}

/** Walk toward a target, re-pathing only when it changes tile. */
function chase(world: World, i: number, ti: number): void {
  const store = world.entities;
  const { posX, posY, orderX, orderY, flowGoal, settled } = store;

  orderX[i] = posX[ti];
  orderY[i] = posY[ti];
  settled[i] = 0;

  const tx = worldToTile(posX[ti]);
  const ty = worldToTile(posY[ti]);
  if (!world.grid.inBounds(tx, ty)) return;
  const cell = world.grid.index(tx, ty);
  // Only re-key the flow field when the target actually changed tile. Units
  // chasing the same target then share one field, which is the entire reason
  // flow fields were chosen over per-unit A*.
  if (flowGoal[i] !== cell) flowGoal[i] = world.grid.isBlocked(tx, ty) ? flowGoal[i] : cell;
}

/** Resolve one shot: damage, event, and death if it lands the killing blow. */
function fire(world: World, i: number, ti: number, baseDamage: number, damageType: number): void {
  const store = world.entities;
  const types = world.types;
  const targetType = types.get(store.typeId[ti]);

  const damage = applyDamageTable(baseDamage, damageType, targetType.armour);
  const remaining = store.health[ti] - damage;
  store.health[ti] = remaining;

  world.events.push({
    kind: EV_SHOT,
    shooter: store.idAt(i),
    target: store.idAt(ti),
    fromX: store.posX[i],
    fromY: store.posY[i],
    toX: store.posX[ti],
    toY: store.posY[ti],
    damage,
    lethal: remaining <= 0,
  });

  // A unit that is shot at fights back, so an army walking into an ambush does
  // not calmly keep walking. Only if it is idle -- an explicit order wins.
  if (
    remaining > 0 &&
    store.targetId[ti] === NULL_ENTITY &&
    store.orderKind[ti] === ORDER_NONE &&
    types.can(store.typeId[ti], CAN_ATTACK) &&
    // Only if it can actually see who shot it. Return fire from an unseen
    // attacker would quietly hand out free vision.
    world.vision.canSee(store.owner[ti], store, i)
  ) {
    store.targetId[ti] = store.idAt(i);
  }

  if (remaining <= 0) killEntity(world, ti);
}

/**
 * Remove an entity that has run out of health.
 *
 * Exported because construction cancellation and resource depletion also need
 * to remove things, and both must go through the same footprint-clearing path.
 * A building removed without clearing its tiles leaves an invisible wall.
 */
export function killEntity(world: World, index: number): void {
  const store = world.entities;
  const id = store.idAt(index);
  if (id === NULL_ENTITY) return;

  const type = world.types.get(store.typeId[index]);

  world.events.push({
    kind: EV_DEATH,
    entity: id,
    typeId: store.typeId[index],
    owner: store.owner[index],
    x: store.posX[index],
    y: store.posY[index],
  });

  if (type.footprint > 0) {
    const anchorX = worldToTile(store.posX[index] - (((type.footprint - 1) << 16) >> 1));
    const anchorY = worldToTile(store.posY[index] - (((type.footprint - 1) << 16) >> 1));
    world.clearFootprint(anchorX, anchorY, type.footprint);
  }

  // Anything holding a handle to this entity resolves it through `isAlive`,
  // which now fails on the bumped generation -- so stale targets, gather
  // orders and build assignments all clean themselves up without a sweep.
  store.despawn(id);
}
