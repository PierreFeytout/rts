import { isHostile, killEntity, runCombat } from "./combat.js";
import {
  CMD_ATTACK,
  CMD_ATTACK_MOVE,
  CMD_BUILD,
  CMD_CANCEL_TRAIN,
  CMD_GATHER,
  CMD_HOLD,
  CMD_MOVE,
  CMD_RALLY,
  CMD_STOP,
  CMD_TRAIN,
  type BuildCommand,
  type Command,
} from "./commands.js";
import { runEconomy, walkTo } from "./economy.js";
import {
  MAX_ENTITIES,
  NULL_ENTITY,
  ORDER_ATTACK,
  ORDER_ATTACK_MOVE,
  ORDER_BUILD,
  ORDER_GATHER,
  ORDER_HOLD,
  ORDER_MOVE,
  ORDER_NONE,
  ORDER_RETURN,
  EntityStore,
  entityIndex,
  footprintCentre,
  spawnTyped,
  type EntityId,
} from "./entities.js";
import {
  BLOCKED_QUEUE_FULL,
  BLOCKED_RESOURCES,
  BLOCKED_SPACE,
  BLOCKED_SUPPLY,
  EV_BLOCKED,
  EventLog,
} from "./events.js";
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
import { CostGrid, TILE_STRUCTURE, TILE_WALKABLE, worldToTile } from "./grid.js";
import { hashFinish, hashInit, hashNumber } from "./hash.js";
import { PlayerState } from "./players.js";
import { recomputeSupplyAndDefeat, runConstruction, runProduction } from "./production.js";
import { Rng } from "./rng.js";
import { SpatialHash } from "./spatial.js";
import type { TypeTable } from "./types.js";
import {
  CAN_BUILD,
  CAN_GATHER,
  CAN_PRODUCE,
  KIND_BUILDING,
  KIND_RESOURCE,
  NEEDS_VENT,
  defaultTypes,
} from "./types.js";

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
const MAX_NEIGHBOURS = 512;

export interface WorldOptions {
  mapTiles: number;
  seed: number;
  /**
   * Content set. Defaults to race #1.
   *
   * Injected rather than imported by the systems so that M5 can load content
   * from files without touching a single line of simulation code -- and so a
   * test can define three toy unit types instead of reasoning about balance.
   */
  types?: TypeTable;
}

export class World {
  readonly mapTiles: number;
  readonly entities = new EntityStore();
  readonly grid: CostGrid;
  readonly spatial: SpatialHash;
  readonly flowFields = new FlowFieldCache();
  readonly rng: Rng;
  readonly types: TypeTable;
  readonly players = new PlayerState();
  /** Derived, non-hashed output for the renderer. Cleared at the start of each tick. */
  readonly events = new EventLog();

  tick = 0;

  /**
   * Shared scratch for spatial queries made outside the steering loop.
   *
   * Sized to the whole store: the systems that use it (nearest patch, nearest
   * target) fail *silently and wrongly* on truncation rather than loudly, so
   * the buffer is made large enough that truncation cannot happen.
   */
  readonly queryScratch = new Int32Array(MAX_ENTITIES);

  /** Largest radius in the loaded content. Sizes neighbour queries. */
  private readonly maxRadius: Fx;

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
    this.types = options.types ?? defaultTypes;

    // Derived from content rather than hardcoded. A neighbour query must cover
    // the largest thing that could be overlapping the querier, and a constant
    // here would silently stop covering a Nexus the moment someone added a
    // bigger building.
    let widest = 0;
    for (const type of this.types.all) {
      if (type.radius > widest) widest = type.radius;
    }
    this.maxRadius = widest;
  }

  /**
   * Advance exactly one tick.
   *
   * `commands` must already be in the order the arbiter finalised, identically
   * on every peer. The simulation does not sort or deduplicate them: that would
   * hide an ordering bug in the netcode rather than surfacing it as a desync.
   *
   * System order is fixed and matters for feel, not for correctness -- any
   * order is equally deterministic, but this one means a unit produced this
   * tick can move this tick, and a unit killed this tick does not get to fire.
   */
  step(commands: readonly Command[]): void {
    this.events.clear();

    for (const command of commands) this.applyCommand(command);

    this.spatial.rebuild(this.entities);
    runConstruction(this);
    runProduction(this);
    runEconomy(this);
    runCombat(this);

    // Combat and production both change who exists. Rebuild before steering so
    // units do not separate against corpses or walk through a unit that was
    // just placed.
    this.spatial.rebuild(this.entities);
    this.computeSteering();
    this.applySteering();

    recomputeSupplyAndDefeat(this);

    this.tick++;
  }

  /** Hash of all simulation state. Compared between peers to detect desync. */
  hash(): number {
    let h = hashInit();
    h = hashNumber(h, this.tick);
    h = hashNumber(h, this.rng.state);
    h = hashNumber(h, this.grid.version);
    h = this.entities.hash(h);
    h = this.players.hash(h);
    // The cost grid is hashed too: a peer that missed a building placement
    // would otherwise path differently while reporting a matching hash.
    for (let i = 0; i < this.grid.tiles.length; i++) {
      h = hashNumber(h, this.grid.tiles[i]);
    }
    return hashFinish(h);
  }

  // -------------------------------------------------------------------------
  // Grid helpers, shared with the systems
  // -------------------------------------------------------------------------

  /** Free the tiles a destroyed or cancelled building occupied. */
  clearFootprint(anchorX: number, anchorY: number, footprint: number): void {
    if (footprint <= 0) return;
    this.grid.fillRect(anchorX, anchorY, footprint, footprint, TILE_WALKABLE);
  }

  /** Nearest walkable cell to a tile, or -1 within a bounded search. */
  nearestOpenCell(tx: number, ty: number): number {
    return nearestReachable(this.grid, tx, ty);
  }

  /**
   * Place a structure directly, bypassing cost and builder checks.
   *
   * Used by map setup for starting bases and ore patches, and by the build
   * command once it has validated everything. Keeping one path means a
   * building placed by the map and one placed by a player are stamped into the
   * grid identically -- a difference there is an invisible wall.
   */
  placeStructure(
    typeId: number,
    tileX: number,
    tileY: number,
    owner: number,
    complete = true,
  ): EntityId {
    const type = this.types.get(typeId);
    const span = type.footprint > 0 ? type.footprint : 1;

    for (let y = tileY; y < tileY + span; y++) {
      for (let x = tileX; x < tileX + span; x++) {
        if (!this.grid.inBounds(x, y)) return NULL_ENTITY;
      }
    }

    this.grid.fillRect(tileX, tileY, span, span, TILE_STRUCTURE);
    const id = spawnTyped(
      this.entities,
      this.types,
      typeId,
      footprintCentre(tileX, span),
      footprintCentre(tileY, span),
      owner,
    );
    if (id === NULL_ENTITY) {
      this.clearFootprint(tileX, tileY, span);
      return NULL_ENTITY;
    }

    if (!complete) {
      const i = entityIndex(id);
      this.entities.buildRemaining[i] = type.buildTime;
      // A foundation starts at a tenth of its final health, so an early rush
      // can kill one before it finishes -- but never at zero, which would make
      // it die to the placement itself.
      this.entities.health[i] = Math.max(1, Math.ceil(type.maxHealth / 10));
    }
    return id;
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  /**
   * Whether this player may act on this entity.
   *
   * Ownership is enforced here rather than trusted from the sender. In a
   * peer-hosted game the "server" is another player's browser, so a modified
   * client could otherwise issue orders to enemy units.
   */
  private controls(index: number, playerId: number): boolean {
    return this.entities.owner[index] === playerId && this.players.isValid(playerId);
  }

  private applyCommand(command: Command): void {
    const store = this.entities;

    switch (command.kind) {
      case CMD_STOP:
      case CMD_HOLD: {
        const hold = command.kind === CMD_HOLD;
        for (const id of command.entities) {
          const i = store.indexOfLive(id);
          if (i < 0 || !this.controls(i, command.playerId)) continue;
          store.orderKind[i] = hold ? ORDER_HOLD : ORDER_NONE;
          store.flowGoal[i] = -1;
          store.targetId[i] = NULL_ENTITY;
          store.gatherTimer[i] = 0;
          store.settled[i] = 1;
        }
        return;
      }

      case CMD_MOVE:
      case CMD_ATTACK_MOVE: {
        const goalCell = this.resolveGoal(command.targetX, command.targetY);
        if (goalCell < 0) return;
        const order = command.kind === CMD_MOVE ? ORDER_MOVE : ORDER_ATTACK_MOVE;

        for (const id of command.entities) {
          const i = store.indexOfLive(id);
          if (i < 0 || !this.controls(i, command.playerId)) continue;
          if (store.moveSpeed[i] === 0) continue;
          store.orderKind[i] = order;
          store.orderX[i] = command.targetX;
          store.orderY[i] = command.targetY;
          store.flowGoal[i] = goalCell;
          store.targetId[i] = NULL_ENTITY;
          store.gatherTimer[i] = 0;
          store.settled[i] = 0;
        }
        return;
      }

      case CMD_ATTACK: {
        const ti = store.indexOfLive(command.target);
        if (ti < 0) return;
        if (this.types.get(store.typeId[ti]).kind === KIND_RESOURCE) return;

        for (const id of command.entities) {
          const i = store.indexOfLive(id);
          if (i < 0 || !this.controls(i, command.playerId)) continue;
          if (!isHostile(store.owner[i], store.owner[ti])) continue;
          store.orderKind[i] = ORDER_ATTACK;
          store.targetId[i] = command.target;
          store.settled[i] = 0;
          walkTo(this, i, store.posX[ti], store.posY[ti]);
        }
        return;
      }

      case CMD_GATHER: {
        const ni = store.indexOfLive(command.target);
        if (ni < 0) return;
        if (this.types.get(store.typeId[ni]).kind !== KIND_RESOURCE) return;

        for (const id of command.entities) {
          const i = store.indexOfLive(id);
          if (i < 0 || !this.controls(i, command.playerId)) continue;
          if (!this.types.can(store.typeId[i], CAN_GATHER)) continue;
          // A drone already holding a full load walks it home first rather
          // than dropping it, which is what a player expects when they
          // re-task a harvester mid-trip.
          const full = store.cargo[i] >= this.types.get(store.typeId[i]).cargoCapacity;
          store.orderKind[i] = full ? ORDER_RETURN : ORDER_GATHER;
          store.targetId[i] = command.target;
          store.gatherTimer[i] = 0;
          store.settled[i] = 0;
        }
        return;
      }

      case CMD_BUILD:
        this.applyBuild(command);
        return;

      case CMD_TRAIN: {
        const bi = store.indexOfLive(command.building);
        if (bi < 0 || !this.controls(bi, command.playerId)) return;
        if (store.buildRemaining[bi] > 0) return;
        if (!this.types.can(store.typeId[bi], CAN_PRODUCE)) return;
        if (!this.types.has(command.unitType)) return;
        if (!this.types.get(store.typeId[bi]).produces.includes(command.unitType)) return;

        const unit = this.types.get(command.unitType);
        const player = command.playerId;

        if (store.queueLen[bi] >= 5) {
          this.blocked(player, BLOCKED_QUEUE_FULL, command.unitType);
          return;
        }
        // Supply is checked before the charge, so a blocked order costs
        // nothing. The totals were recomputed at the end of the previous tick,
        // which is exactly the state the player was looking at when they clicked.
        if (this.players.supplyUsed[player] + unit.supplyCost > this.players.supplyCap[player]) {
          this.blocked(player, BLOCKED_SUPPLY, command.unitType);
          return;
        }
        if (!this.players.spend(player, unit.costAlloy, unit.costPlasma)) {
          this.blocked(player, BLOCKED_RESOURCES, command.unitType);
          return;
        }
        if (!store.enqueue(bi, command.unitType)) {
          this.players.refund(player, unit.costAlloy, unit.costPlasma);
          this.blocked(player, BLOCKED_QUEUE_FULL, command.unitType);
        }
        return;
      }

      case CMD_CANCEL_TRAIN: {
        const bi = store.indexOfLive(command.building);
        if (bi < 0 || !this.controls(bi, command.playerId)) return;
        const len = store.queueLen[bi];
        if (len === 0) return;
        const position = command.position < 0 ? len - 1 : command.position;
        if (position >= len) return;

        const removed = store.dequeueAt(bi, position);
        if (this.types.has(removed)) {
          const unit = this.types.get(removed);
          this.players.refund(command.playerId, unit.costAlloy, unit.costPlasma);
        }
        // Cancelling the item in progress abandons its progress too, which is
        // the standard rule and stops a queue from being used as free storage.
        if (position === 0) store.produceRemaining[bi] = 0;
        return;
      }

      case CMD_RALLY: {
        for (const id of command.entities) {
          const i = store.indexOfLive(id);
          if (i < 0 || !this.controls(i, command.playerId)) continue;
          if (!this.types.can(store.typeId[i], CAN_PRODUCE)) continue;
          store.rallyX[i] = command.targetX;
          store.rallyY[i] = command.targetY;
        }
        return;
      }
    }
  }

  /** Validate and place a construction site, then send the builders to it. */
  private applyBuild(command: BuildCommand): void {
    const store = this.entities;
    const player = command.playerId;
    if (!this.players.isValid(player)) return;
    if (!this.types.has(command.buildingType)) return;

    const type = this.types.get(command.buildingType);
    if (type.kind !== KIND_BUILDING) return;

    // At least one live builder the player actually controls. Without this a
    // modified client could place buildings with no drone anywhere near.
    let hasBuilder = false;
    for (const id of command.entities) {
      const i = store.indexOfLive(id);
      if (i < 0 || !this.controls(i, player)) continue;
      if (!this.types.can(store.typeId[i], CAN_BUILD)) continue;
      if (!this.types.get(store.typeId[i]).builds.includes(command.buildingType)) continue;
      hasBuilder = true;
      break;
    }
    if (!hasBuilder) return;

    const span = type.footprint > 0 ? type.footprint : 1;
    const tileX = command.tileX | 0;
    const tileY = command.tileY | 0;

    // An Extractor replaces the vent it is built on, so its footprint check is
    // "is there a vent here" rather than "are these tiles clear" -- the vent
    // itself blocks them.
    let ventIndex = -1;
    if ((type.abilities & NEEDS_VENT) !== 0) {
      ventIndex = this.ventAt(tileX, tileY, span);
      if (ventIndex < 0) {
        this.blocked(player, BLOCKED_SPACE, command.buildingType);
        return;
      }
    } else if (!this.areaClear(tileX, tileY, span)) {
      this.blocked(player, BLOCKED_SPACE, command.buildingType);
      return;
    }

    if (!this.players.spend(player, type.costAlloy, type.costPlasma)) {
      this.blocked(player, BLOCKED_RESOURCES, command.buildingType);
      return;
    }

    // Only now is the vent consumed. Removing it before the affordability
    // check would destroy the vent on a failed placement.
    if (ventIndex >= 0) killEntity(this, ventIndex);

    const site = this.placeStructure(command.buildingType, tileX, tileY, player, false);
    if (site === NULL_ENTITY) {
      this.players.refund(player, type.costAlloy, type.costPlasma);
      this.blocked(player, BLOCKED_SPACE, command.buildingType);
      return;
    }

    for (const id of command.entities) {
      const i = store.indexOfLive(id);
      if (i < 0 || !this.controls(i, player)) continue;
      if (!this.types.can(store.typeId[i], CAN_BUILD)) continue;
      store.orderKind[i] = ORDER_BUILD;
      store.targetId[i] = site;
      store.gatherTimer[i] = 0;
      store.settled[i] = 0;
      walkTo(this, i, store.posX[entityIndex(site)], store.posY[entityIndex(site)]);
    }
  }

  /** Every tile of a prospective footprint is in bounds and walkable. */
  private areaClear(tileX: number, tileY: number, span: number): boolean {
    for (let y = tileY; y < tileY + span; y++) {
      for (let x = tileX; x < tileX + span; x++) {
        if (!this.grid.inBounds(x, y) || this.grid.isBlocked(x, y)) return false;
      }
    }
    return true;
  }

  /** A geothermal vent whose footprint exactly matches this placement, or -1. */
  private ventAt(tileX: number, tileY: number, span: number): number {
    const store = this.entities;
    const wantX = footprintCentre(tileX, span);
    const wantY = footprintCentre(tileY, span);
    for (let i = 0; i < store.highWater; i++) {
      if (store.alive[i] !== 1) continue;
      const type = this.types.get(store.typeId[i]);
      if (type.kind !== KIND_RESOURCE || type.resourceAmount !== 0) continue;
      if (store.posX[i] === wantX && store.posY[i] === wantY) return i;
    }
    return -1;
  }

  private blocked(player: number, reason: number, typeId: number): void {
    this.events.push({ kind: EV_BLOCKED, player, reason, typeId });
  }

  /** Snap an order point to a reachable tile, nudging off cliffs and buildings. */
  private resolveGoal(x: Fx, y: Fx): number {
    // Clicking a cliff or a building is extremely common; nudge the order to
    // the nearest reachable tile instead of silently discarding it.
    return nearestReachable(this.grid, worldToTile(x), worldToTile(y));
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
      // Buildings and ore patches are obstacles, not participants. They still
      // appear in every other unit's neighbour query -- they just never move,
      // which is why a Nexus cannot be shoved out of its own footprint.
      if (moveSpeed[i] === 0) continue;

      let dx = 0;
      let dy = 0;
      let distToGoal = 0;
      const kind = orderKind[i];
      const hasOrder =
        kind === ORDER_MOVE ||
        kind === ORDER_ATTACK_MOVE ||
        kind === ORDER_ATTACK ||
        kind === ORDER_GATHER ||
        kind === ORDER_RETURN ||
        kind === ORDER_BUILD;

      if (hasOrder) {
        const toGoalX = orderX[i] - posX[i];
        const toGoalY = orderY[i] - posY[i];
        distToGoal = fxLength(toGoalX, toGoalY);

        if (distToGoal <= ARRIVAL_RADIUS) {
          // Only a plain move ends on arrival. The working orders own their own
          // completion -- a drone that reached its patch has *started* mining,
          // not finished its job, and clearing the order here would drop it.
          if (kind === ORDER_MOVE || kind === ORDER_ATTACK_MOVE) {
            orderKind[i] = ORDER_NONE;
            flowGoal[i] = -1;
          }
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
      const queryTiles = (((radius[i] + this.maxRadius) >> 16) | 0) + 1;
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
      // Only plain moves settle this way. A harvester or builder pressed
      // against a crowd must keep pushing toward its patch or its site, or a
      // busy base would quietly stall its own economy.
      //
      // This reads `settled` for neighbours while writing it for the current
      // entity, so it is order-dependent -- but iteration is strictly by
      // ascending index, so it is order-dependent *identically on every peer*.
      const settleable = kind === ORDER_MOVE || kind === ORDER_ATTACK_MOVE;
      if (settleable && blockedBySettled && distToGoal <= SETTLE_NEAR_GOAL) {
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
