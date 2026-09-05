import { CMD_MOVE, CMD_STOP, type Command } from "./commands.js";
import {
  entityIndex,
  EntityStore,
  MAX_ENTITIES,
  ORDER_MOVE,
  ORDER_NONE,
} from "./entities.js";
import {
  FX_ONE,
  fxAtan2,
  fxAngleDelta,
  fxClamp,
  fxDiv,
  fxFromFloat,
  fxLength,
  fxMul,
  type Fx,
} from "./fixed.js";
import { DIR_X, DIR_Y, FlowFieldCache } from "./flowfield.js";
import { CostGrid, worldToTile } from "./grid.js";
import { hashFinish, hashInit, hashNumber } from "./hash.js";
import { Rng } from "./rng.js";
import { SpatialHash } from "./spatial.js";

/**
 * The simulation world.
 *
 * `step()` is the single entry point and the only thing that mutates state. Its
 * contract is the whole basis of the netcode: given an identical world and an
 * identical command list, every peer must reach an identical world. Anything
 * that would break that -- wall-clock time, unseeded randomness, iteration over
 * hash-ordered collections -- is banned by lint inside this package.
 */

/** How close a unit must get before it counts as arrived. */
const ARRIVAL_RADIUS = fxFromFloat(0.3);
/**
 * Largest radius any unit type may have. Used to size neighbour queries so
 * that no overlapping pair can be missed. Raise this if a bigger unit is added.
 */
const MAX_UNIT_RADIUS = fxFromFloat(1.5);
/** How hard overlapping units shove each other apart, as a fraction of overlap. */
const SEPARATION_STRENGTH = fxFromFloat(0.5);
/** Settled units resist being shoved, so arrived formations stop churning. */
const SETTLED_RESISTANCE = fxFromFloat(0.15);
/**
 * How close to its goal a unit must be before contact with a settled unit
 * counts as "arrived". Generous enough that a large formation packs in around
 * the destination, tight enough that a unit blocked far away keeps trying.
 */
const SETTLE_NEAR_GOAL = fxFromFloat(3);
/** Upper bound on separation displacement per tick, to stop explosive shoves. */
const MAX_SEPARATION_STEP = fxFromFloat(0.25);
/**
 * Neighbour scratch capacity.
 *
 * Overflow is genuinely dangerous rather than merely lossy: `queryInto` fills
 * this buffer in cell-iteration order, so an overflow drops whichever
 * neighbours happen to come last -- which can be the unit sitting on top of
 * you, while a harmless one two tiles away is kept. That produced a pair of
 * permanently fused units.
 *
 * Sized so it cannot overflow in practice: queries cover only a couple of tiles
 * around a unit, and physical separation caps how many units fit there.
 */
const MAX_NEIGHBOURS = 256;

export interface WorldOptions {
  mapTiles: number;
  seed: number;
}

export class World {
  readonly mapTiles: number;
  readonly entities = new EntityStore();
  readonly grid: CostGrid;
  readonly spatial: SpatialHash;
  readonly flowFields = new FlowFieldCache();
  readonly rng: Rng;

  tick = 0;

  /** Steering output for the current tick; scratch, not part of world state. */
  private readonly stepX = new Int32Array(MAX_ENTITIES);
  private readonly stepY = new Int32Array(MAX_ENTITIES);
  private readonly neighbours = new Int32Array(MAX_NEIGHBOURS);

  constructor(options: WorldOptions) {
    this.mapTiles = options.mapTiles;
    this.grid = new CostGrid(options.mapTiles, options.mapTiles);
    // Cell size 2 tiles: large enough that a query touches few cells, small
    // enough that each cell holds a handful of units rather than a crowd.
    this.spatial = new SpatialHash(options.mapTiles, 2, MAX_ENTITIES);
    this.rng = new Rng(options.seed);
  }

  /**
   * Advance exactly one tick.
   *
   * `commands` must already be in the order the arbiter finalised, identically
   * on every peer. The simulation does not sort or deduplicate them: that would
   * hide an ordering bug in the netcode rather than surfacing it as a desync.
   */
  step(commands: readonly Command[]): void {
    for (const command of commands) this.applyCommand(command);

    this.spatial.rebuild(this.entities);
    this.computeSteering();
    this.applySteering();

    this.tick++;
  }

  /** Hash of all simulation state. Compared between peers to detect desync. */
  hash(): number {
    let h = hashInit();
    h = hashNumber(h, this.tick);
    h = hashNumber(h, this.rng.state);
    h = hashNumber(h, this.grid.version);
    h = this.entities.hash(h);
    // The cost grid is hashed too: a peer that missed a building placement
    // would otherwise path differently while reporting a matching hash.
    for (let i = 0; i < this.grid.tiles.length; i++) {
      h = hashNumber(h, this.grid.tiles[i]);
    }
    return hashFinish(h);
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  private applyCommand(command: Command): void {
    const store = this.entities;

    if (command.kind === CMD_STOP) {
      for (const id of command.entities) {
        if (!store.isAlive(id)) continue;
        const i = entityIndex(id);
        // Ownership is enforced here rather than trusted from the sender. In a
        // peer-hosted game the "server" is another player's browser, so a
        // modified client could otherwise issue orders to enemy units.
        if (store.owner[i] !== command.playerId) continue;
        store.orderKind[i] = ORDER_NONE;
        store.flowGoal[i] = -1;
        store.settled[i] = 1;
      }
      return;
    }

    if (command.kind === CMD_MOVE) {
      const tx = worldToTile(command.targetX);
      const ty = worldToTile(command.targetY);

      // Clicking a cliff or a building is extremely common; nudge the order to
      // the nearest reachable tile instead of silently discarding it.
      const goalCell = nearestReachable(this.grid, tx, ty);
      if (goalCell < 0) return;

      for (const id of command.entities) {
        if (!store.isAlive(id)) continue;
        const i = entityIndex(id);
        if (store.owner[i] !== command.playerId) continue;
        store.orderKind[i] = ORDER_MOVE;
        store.orderX[i] = command.targetX;
        store.orderY[i] = command.targetY;
        store.flowGoal[i] = goalCell;
        store.settled[i] = 0;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Movement
  // -------------------------------------------------------------------------

  /**
   * Work out how far each entity wants to move this tick.
   *
   * Split into a compute pass and an apply pass so that every entity steers
   * against the *same* snapshot of positions. Moving entities as they are
   * visited would make the result depend on iteration order in a way that is
   * far harder to reason about, even though it would still be deterministic.
   */
  private computeSteering(): void {
    const store = this.entities;
    const { posX, posY, radius, moveSpeed, orderKind, orderX, orderY, flowGoal, settled } = store;

    for (let i = 0; i < store.highWater; i++) {
      this.stepX[i] = 0;
      this.stepY[i] = 0;
      if (store.alive[i] !== 1) continue;

      let dx = 0;
      let dy = 0;
      let distToGoal = 0;
      const hasOrder = orderKind[i] === ORDER_MOVE;

      if (hasOrder) {
        const toGoalX = orderX[i] - posX[i];
        const toGoalY = orderY[i] - posY[i];
        distToGoal = fxLength(toGoalX, toGoalY);

        if (distToGoal <= ARRIVAL_RADIUS) {
          orderKind[i] = ORDER_NONE;
          flowGoal[i] = -1;
          settled[i] = 1;
        } else {
          const goal = flowGoal[i];
          const tx = worldToTile(posX[i]);
          const ty = worldToTile(posY[i]);
          const field = goal >= 0 ? this.flowFields.get(this.grid, goal) : null;
          const cell = this.grid.inBounds(tx, ty) ? this.grid.index(tx, ty) : -1;
          const dir = field && cell >= 0 ? field.dir[cell] : -1;

          if (dir >= 0) {
            // Follow the field toward the goal tile.
            dx = DIR_X[dir] * FX_ONE;
            dy = DIR_Y[dir] * FX_ONE;
          } else {
            // Either already in the goal tile, or off the field entirely.
            // Steer straight at the exact order point for the final approach.
            dx = toGoalX;
            dy = toGoalY;
          }

          const len = fxLength(dx, dy);
          if (len > 0) {
            const speed = moveSpeed[i];
            // Do not overshoot the destination on the last tick.
            const travel = distToGoal < speed ? distToGoal : speed;
            dx = fxMul(fxDiv(dx, len), travel);
            dy = fxMul(fxDiv(dy, len), travel);
          } else {
            dx = 0;
            dy = 0;
          }
        }
      }

      // Separation. Applied to settled units too, at reduced strength, so a
      // crowd that arrives together spreads out instead of stacking into one
      // tile -- but weakly enough that it converges rather than churning.
      // Query only as far as an overlap could physically reach. A fixed, larger
      // radius returns a crowd of irrelevant units, which is both wasted work
      // and the thing that used to overflow the neighbour buffer.
      const queryTiles = (((radius[i] + MAX_UNIT_RADIUS) >> 16) | 0) + 1;
      const count = this.spatial.queryInto(posX[i], posY[i], queryTiles, this.neighbours);
      // Shallow overlaps are damped for settled units so formations come to
      // rest. Deep overlaps are never damped -- see the comment below.
      let pushX = 0;
      let pushY = 0;
      let hardPushX = 0;
      let hardPushY = 0;
      let blockedBySettled = false;

      for (let k = 0; k < count; k++) {
        const j = this.neighbours[k];
        if (j === i) continue;

        const ax = posX[i] - posX[j];
        const ay = posY[i] - posY[j];
        const minDist = radius[i] + radius[j];
        if (minDist <= 0) continue;

        let dirX: Fx;
        let dirY: Fx;
        let overlap: Fx;

        if (ax === 0 && ay === 0) {
          // Exactly coincident: there is no natural direction to separate
          // along, so pick one deterministically. Breaking the tie on slot
          // index makes the pair push opposite ways rather than both the same.
          //
          // Overlap is the full minimum distance here. Computing it from the
          // separation vector instead would use the vector's own length, and
          // any unit-length choice exceeds minDist -- which reads as "not
          // overlapping" and leaves coincident units fused together forever.
          dirX = i < j ? FX_ONE : -FX_ONE;
          dirY = 0;
          overlap = minDist;
        } else {
          const dist = fxLength(ax, ay);
          if (dist >= minDist) continue;
          dirX = fxDiv(ax, dist);
          dirY = fxDiv(ay, dist);
          overlap = minDist - dist;
        }

        if (settled[j] === 1) blockedBySettled = true;

        const magnitude = fxMul(overlap, SEPARATION_STRENGTH);
        // An overlap past half the minimum distance means the pair is close to
        // fused. Settled units must resolve that at FULL strength: a unit can
        // settle while already overlapping, and damped separation is then far
        // too weak to ever pull the pair apart, so they stay permanently
        // stacked. Shallow overlaps stay dampable, which is what stops an
        // arrived formation from churning.
        if (overlap * 2 > minDist) {
          hardPushX += fxMul(dirX, magnitude);
          hardPushY += fxMul(dirY, magnitude);
        } else {
          pushX += fxMul(dirX, magnitude);
          pushY += fxMul(dirY, magnitude);
        }
      }

      // Crowd settling. A unit ordered somewhere already occupied cannot reach
      // the exact point, so arrival radius alone never fires and it orbits the
      // destination forever, shoving its neighbours as it goes.
      //
      // Instead, a unit that is near the goal and pressed against an
      // already-settled unit settles too. The effect cascades outward from the
      // first arrival, so a formation comes to rest instead of churning.
      //
      // This reads `settled` for neighbours while writing it for the current
      // entity, so it is order-dependent -- but iteration is strictly by
      // ascending index, so it is order-dependent *identically on every peer*.
      if (hasOrder && blockedBySettled && distToGoal <= SETTLE_NEAR_GOAL) {
        orderKind[i] = ORDER_NONE;
        flowGoal[i] = -1;
        settled[i] = 1;
        dx = 0;
        dy = 0;
      }

      if (settled[i] === 1) {
        pushX = fxMul(pushX, SETTLED_RESISTANCE);
        pushY = fxMul(pushY, SETTLED_RESISTANCE);
      }
      pushX += hardPushX;
      pushY += hardPushY;

      const pushLen = fxLength(pushX, pushY);
      if (pushLen > MAX_SEPARATION_STEP) {
        pushX = fxMul(fxDiv(pushX, pushLen), MAX_SEPARATION_STEP);
        pushY = fxMul(fxDiv(pushY, pushLen), MAX_SEPARATION_STEP);
      }

      this.stepX[i] = dx + pushX;
      this.stepY[i] = dy + pushY;
    }
  }

  /** Commit the steering computed above, with wall sliding and turn limiting. */
  private applySteering(): void {
    const store = this.entities;
    const { posX, posY, facing, turnRate } = store;
    const limit = (this.mapTiles << 16) - 1;

    for (let i = 0; i < store.highWater; i++) {
      if (store.alive[i] !== 1) continue;
      const dx = this.stepX[i];
      const dy = this.stepY[i];
      if (dx === 0 && dy === 0) continue;

      const fromX = posX[i];
      const fromY = posY[i];
      let toX = fxClamp(fromX + dx, 0, limit);
      let toY = fxClamp(fromY + dy, 0, limit);

      // Wall sliding: if the combined move lands in a blocked tile, try each
      // axis alone. Without this a unit brushing a wall diagonally sticks to it
      // instead of sliding along, which reads as the unit being "caught".
      if (this.blockedAt(toX, toY)) {
        const slideX = fxClamp(fromX + dx, 0, limit);
        const slideY = fxClamp(fromY + dy, 0, limit);
        if (!this.blockedAt(slideX, fromY)) {
          toX = slideX;
          toY = fromY;
        } else if (!this.blockedAt(fromX, slideY)) {
          toX = fromX;
          toY = slideY;
        } else {
          toX = fromX;
          toY = fromY;
        }
      }

      posX[i] = toX;
      posY[i] = toY;

      // Turn toward actual travel, rate-limited so units arc instead of
      // snapping. Uses the real displacement, not the desired one, so a unit
      // sliding along a wall faces where it is really going.
      const movedX = toX - fromX;
      const movedY = toY - fromY;
      if (movedX !== 0 || movedY !== 0) {
        const desired = fxAtan2(movedY, movedX);
        const delta = fxAngleDelta(facing[i], desired);
        const rate = turnRate[i];
        const applied = delta > rate ? rate : delta < -rate ? -rate : delta;
        facing[i] = (facing[i] + applied) & 0xffff;
      }
    }
  }

  private blockedAt(x: Fx, y: Fx): boolean {
    return this.grid.isBlocked(worldToTile(x), worldToTile(y));
  }
}

/**
 * Nearest reachable tile to a click, expanding outward if it is blocked.
 *
 * Kept as a free function rather than a method so tests can exercise the
 * fallback behaviour against a bare grid.
 */
function nearestReachable(grid: CostGrid, tx: number, ty: number): number {
  if (grid.inBounds(tx, ty) && !grid.isBlocked(tx, ty)) return grid.index(tx, ty);

  for (let r = 1; r <= 24; r++) {
    let best = -1;
    let bestDistSq = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = tx + dx;
        const ny = ty + dy;
        if (!grid.inBounds(nx, ny) || grid.isBlocked(nx, ny)) continue;
        const dsq = dx * dx + dy * dy;
        if (dsq < bestDistSq) {
          bestDistSq = dsq;
          best = grid.index(nx, ny);
        }
      }
    }
    if (best !== -1) return best;
  }
  return -1;
}
