import type { CostGrid } from "./grid.js";

/**
 * Flow-field pathfinding.
 *
 * Running A* per unit does not scale: 400 units re-pathing after every order
 * would dominate the tick budget. Instead, one Dijkstra pass from the
 * destination produces an integrated cost field over the whole map, and every
 * unit heading to that destination just reads the direction stored in its
 * current tile. The cost is per *destination*, not per unit, so ordering one
 * unit and ordering two hundred cost the same.
 *
 * Fields are pure functions of (grid contents, goal), which has a useful
 * consequence: the cache does not need to behave identically on every peer. A
 * peer that evicts a field and recomputes it gets bit-identical results, so
 * cache policy cannot cause a desync. Only *invalidation* must be correct, and
 * that is handled by comparing the grid version.
 */

/** Cost of an orthogonal step. Scaled by 10 so the diagonal stays an integer. */
const COST_STRAIGHT = 10;
/** Cost of a diagonal step: 10 * sqrt(2) rounded to 14. */
const COST_DIAGONAL = 14;

/** Unreachable. Large enough to never be produced by a real path. */
export const FLOW_UNREACHABLE = 0x7fffffff;

/** Neighbour offsets, east then clockwise (remember +y is south). */
export const DIR_X = new Int8Array([1, 1, 0, -1, -1, -1, 0, 1]);
export const DIR_Y = new Int8Array([0, 1, 1, 1, 0, -1, -1, -1]);
/** True for the four diagonal directions. */
const DIR_DIAGONAL = [false, true, false, true, false, true, false, true];

export class FlowField {
  readonly goal: number;
  readonly gridVersion: number;
  /** Integrated cost from each tile to the goal. */
  readonly dist: Int32Array;
  /** Index into DIR_X/DIR_Y pointing one step toward the goal, or -1. */
  readonly dir: Int8Array;

  constructor(goal: number, gridVersion: number, size: number) {
    this.goal = goal;
    this.gridVersion = gridVersion;
    this.dist = new Int32Array(size);
    this.dir = new Int8Array(size);
  }
}

/**
 * Binary min-heap over (cell, priority), with lazy deletion.
 *
 * Lazy deletion -- pushing a duplicate rather than decreasing a key, and
 * discarding stale pops -- keeps the structure simple at the cost of a few
 * extra entries. That trade is right here because the heap is rebuilt from
 * scratch per field rather than maintained over time.
 */
class MinHeap {
  private cells: Int32Array;
  private prios: Int32Array;
  private size = 0;

  topCell = 0;
  topPrio = 0;

  constructor(capacity: number) {
    this.cells = new Int32Array(capacity);
    this.prios = new Int32Array(capacity);
  }

  clear(): void {
    this.size = 0;
  }

  get isEmpty(): boolean {
    return this.size === 0;
  }

  push(cell: number, prio: number): void {
    if (this.size === this.cells.length) this.grow();

    let i = this.size++;
    this.cells[i] = cell;
    this.prios[i] = prio;

    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prios[parent] <= this.prios[i]) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  pop(): boolean {
    if (this.size === 0) return false;
    this.topCell = this.cells[0];
    this.topPrio = this.prios[0];

    this.size--;
    if (this.size > 0) {
      this.cells[0] = this.cells[this.size];
      this.prios[0] = this.prios[this.size];

      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.size && this.prios[l] < this.prios[smallest]) smallest = l;
        if (r < this.size && this.prios[r] < this.prios[smallest]) smallest = r;
        if (smallest === i) break;
        this.swap(smallest, i);
        i = smallest;
      }
    }
    return true;
  }

  private swap(a: number, b: number): void {
    const c = this.cells[a];
    this.cells[a] = this.cells[b];
    this.cells[b] = c;
    const p = this.prios[a];
    this.prios[a] = this.prios[b];
    this.prios[b] = p;
  }

  private grow(): void {
    const cells = new Int32Array(this.cells.length * 2);
    const prios = new Int32Array(this.prios.length * 2);
    cells.set(this.cells);
    prios.set(this.prios);
    this.cells = cells;
    this.prios = prios;
  }
}

/**
 * Build a flow field leading to `goal`.
 *
 * Dijkstra outward from the destination. Because step costs are symmetric, the
 * distance computed from the goal is also the distance to it.
 */
export function buildFlowField(grid: CostGrid, goal: number, scratchHeap?: MinHeap): FlowField {
  const heap = scratchHeap ?? new MinHeap(4096);
  const { width, height } = grid;
  const field = new FlowField(goal, grid.version, width * height);

  field.dist.fill(FLOW_UNREACHABLE);
  field.dir.fill(-1);

  const goalX = goal % width;
  const goalY = (goal / width) | 0;
  if (!grid.inBounds(goalX, goalY) || grid.isBlocked(goalX, goalY)) return field;

  heap.clear();
  field.dist[goal] = 0;
  heap.push(goal, 0);

  while (heap.pop()) {
    const cell = heap.topCell;
    const d = heap.topPrio;
    // Stale entry left behind by lazy deletion.
    if (d > field.dist[cell]) continue;

    const cx = cell % width;
    const cy = (cell / width) | 0;

    for (let dir = 0; dir < 8; dir++) {
      const nx = cx + DIR_X[dir];
      const ny = cy + DIR_Y[dir];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (grid.isBlocked(nx, ny)) continue;

      // Refuse to cut corners: a diagonal step is only legal when both
      // adjoining orthogonal tiles are clear. Without this, units slip through
      // the seam between two diagonally touching walls -- visually wrong, and
      // it lets them walk through what players read as a solid barrier.
      if (DIR_DIAGONAL[dir] && (grid.isBlocked(nx, cy) || grid.isBlocked(cx, ny))) continue;

      const step = DIR_DIAGONAL[dir] ? COST_DIAGONAL : COST_STRAIGHT;
      const nd = d + step;
      const n = ny * width + nx;
      if (nd >= field.dist[n]) continue;

      field.dist[n] = nd;
      // The neighbour should walk back toward `cell`, i.e. the opposite of the
      // direction we travelled to reach it.
      field.dir[n] = (dir + 4) & 7;
      heap.push(n, nd);
    }
  }

  return field;
}

/**
 * Nearest walkable tile to a blocked one, by expanding ring search.
 *
 * Players click on cliffs and buildings constantly. Rejecting those orders
 * outright feels broken, so the destination is nudged to the closest reachable
 * tile instead. Returns -1 if nothing walkable is found within `maxRadius`.
 */
export function nearestWalkable(grid: CostGrid, tx: number, ty: number, maxRadius = 24): number {
  if (grid.inBounds(tx, ty) && !grid.isBlocked(tx, ty)) return grid.index(tx, ty);

  for (let r = 1; r <= maxRadius; r++) {
    let best = -1;
    let bestDistSq = Infinity;
    // Scan the full ring and keep the closest by true distance, rather than
    // taking the first hit -- ring order would otherwise bias the result
    // toward whichever edge happens to be scanned first.
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

/**
 * Cache of flow fields keyed by destination tile.
 *
 * Bounded so that a player spam-clicking move orders cannot grow it without
 * limit. Eviction is oldest-first; as noted above, the policy is free to differ
 * between peers because recomputing yields identical results.
 */
export class FlowFieldCache {
  private readonly fields = new Map<number, FlowField>();
  private readonly order: number[] = [];
  private readonly heap = new MinHeap(4096);
  private readonly capacity: number;
  private gridVersion = -1;

  /** Fields computed since the last counter reset. Useful in tests and profiling. */
  builds = 0;

  constructor(capacity = 24) {
    this.capacity = capacity;
  }

  get(grid: CostGrid, goal: number): FlowField {
    // A grid mutation invalidates every field at once. Buildings are placed
    // rarely, so wholesale invalidation is far simpler than tracking which
    // fields a given tile could have affected, and costs little in practice.
    if (grid.version !== this.gridVersion) {
      this.fields.clear();
      this.order.length = 0;
      this.gridVersion = grid.version;
    }

    const existing = this.fields.get(goal);
    if (existing) return existing;

    const field = buildFlowField(grid, goal, this.heap);
    this.builds++;

    this.fields.set(goal, field);
    this.order.push(goal);
    if (this.order.length > this.capacity) {
      const evicted = this.order.shift();
      if (evicted !== undefined) this.fields.delete(evicted);
    }
    return field;
  }

  clear(): void {
    this.fields.clear();
    this.order.length = 0;
    this.gridVersion = -1;
  }
}
