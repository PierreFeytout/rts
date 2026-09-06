import { describe, expect, it } from "vitest";
import {
  DIR_X,
  DIR_Y,
  FLOW_UNREACHABLE,
  FLOW_WINDOW,
  FlowFieldCache,
  buildFlowField,
  flowWindow,
  nearestWalkable,
  type FlowField,
} from "./flowfield.js";
import { CostGrid, TILE_BLOCKED } from "./grid.js";

function openGrid(size = 16): CostGrid {
  return new CostGrid(size, size);
}

/** Walk the field from a start tile to the goal, or fail after `maxSteps`. */
function walk(
  grid: CostGrid,
  field: FlowField,
  startX: number,
  startY: number,
  maxSteps = 4096,
): { reached: boolean; steps: number; path: number[] } {
  let x = startX;
  let y = startY;
  const path: number[] = [];
  for (let s = 0; s < maxSteps; s++) {
    const cell = grid.index(x, y);
    path.push(cell);
    const d = field.dirAt(cell);
    if (d < 0) return { reached: true, steps: s, path };
    x += DIR_X[d];
    y += DIR_Y[d];
    if (grid.isBlocked(x, y)) return { reached: false, steps: s, path };
  }
  return { reached: false, steps: maxSteps, path };
}

describe("buildFlowField", () => {
  it("gives the goal zero cost and no direction", () => {
    const grid = openGrid();
    const goal = grid.index(8, 8);
    const f = buildFlowField(grid, goal);
    expect(f.distAt(goal)).toBe(0);
    expect(f.dirAt(goal)).toBe(-1);
  });

  it("uses 10 for orthogonal and 14 for diagonal steps", () => {
    const grid = openGrid();
    const goal = grid.index(8, 8);
    const f = buildFlowField(grid, goal);
    expect(f.distAt(grid.index(9, 8))).toBe(10);
    expect(f.distAt(grid.index(8, 9))).toBe(10);
    expect(f.distAt(grid.index(9, 9))).toBe(14);
    // Two diagonals must beat two orthogonals, or units zigzag instead of
    // taking the hypotenuse.
    expect(f.distAt(grid.index(10, 10))).toBe(28);
  });

  it("leads every open tile to the goal", () => {
    const grid = openGrid();
    const goal = grid.index(3, 12);
    const f = buildFlowField(grid, goal);
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        expect(walk(grid, f, x, y).reached, `from ${x},${y}`).toBe(true);
      }
    }
  });

  it("routes around a wall", () => {
    const grid = openGrid(16);
    // Vertical wall with a gap at the bottom.
    for (let y = 0; y < 13; y++) grid.set(8, y, TILE_BLOCKED);

    const goal = grid.index(14, 2);
    const f = buildFlowField(grid, goal);
    const result = walk(grid, f, 2, 2);

    expect(result.reached).toBe(true);
    // A straight line would be ~12 steps; going around the gap must be longer.
    expect(result.steps).toBeGreaterThan(12);
    // And the path must never enter the wall.
    for (const cell of result.path) {
      expect(grid.tiles[cell]).not.toBe(TILE_BLOCKED);
    }
  });

  it("marks enclosed regions unreachable", () => {
    const grid = openGrid(16);
    // Box in tile (2,2) completely.
    for (const [x, y] of [
      [1, 1], [2, 1], [3, 1],
      [1, 2], [3, 2],
      [1, 3], [2, 3], [3, 3],
    ] as const) {
      grid.set(x, y, TILE_BLOCKED);
    }

    const f = buildFlowField(grid, grid.index(10, 10));
    expect(f.distAt(grid.index(2, 2))).toBe(FLOW_UNREACHABLE);
    expect(f.dirAt(grid.index(2, 2))).toBe(-1);
  });

  it("refuses to cut diagonally between two blocked tiles", () => {
    // The classic corner-cutting bug: (1,0) and (0,1) blocked leaves a
    // diagonal seam from (0,0) to (1,1). Slipping through it lets units walk
    // through what the player sees as a solid barrier.
    const grid = openGrid(8);
    grid.set(1, 0, TILE_BLOCKED);
    grid.set(0, 1, TILE_BLOCKED);

    const f = buildFlowField(grid, grid.index(1, 1));
    // (0,0) is sealed off, so it must be unreachable rather than one diagonal step.
    expect(f.distAt(grid.index(0, 0))).toBe(FLOW_UNREACHABLE);
  });

  it("refuses a diagonal past a single blocked corner", () => {
    // The rule is strict: a diagonal needs BOTH adjoining orthogonal tiles
    // clear, not just one. With only (1,0) blocked, the lenient rule would let
    // a unit clip the corner from (0,0) to (1,1) for 14. Strict forces it
    // around via (0,1) for 10 + 10 = 20.
    //
    // Strict is the right choice for an RTS: it means units visually never
    // shave the corner of a building, at the cost of slightly longer paths.
    const grid = openGrid(8);
    grid.set(1, 0, TILE_BLOCKED);
    const f = buildFlowField(grid, grid.index(1, 1));
    expect(f.distAt(grid.index(0, 0))).toBe(20);
  });

  it("allows a diagonal through fully open space", () => {
    const grid = openGrid(8);
    const f = buildFlowField(grid, grid.index(1, 1));
    expect(f.distAt(grid.index(0, 0))).toBe(14);
  });

  it("returns an empty field when the goal itself is blocked", () => {
    const grid = openGrid(8);
    grid.set(4, 4, TILE_BLOCKED);
    const f = buildFlowField(grid, grid.index(4, 4));
    expect(f.distAt(grid.index(0, 0))).toBe(FLOW_UNREACHABLE);
  });

  it("is reproducible", () => {
    const grid = openGrid(24);
    for (let i = 0; i < 40; i++) grid.set((i * 7) % 24, (i * 13) % 24, TILE_BLOCKED);
    const a = buildFlowField(grid, grid.index(20, 20));
    const b = buildFlowField(grid, grid.index(20, 20));
    expect(Array.from(a.dist)).toEqual(Array.from(b.dist));
    expect(Array.from(a.dir)).toEqual(Array.from(b.dir));
  });
});

describe("the window", () => {
  it("covers a small map whole, so nothing about pathing changes there", () => {
    expect(flowWindow(64, 64, 32, 32)).toEqual({ minX: 0, minY: 0, width: 64, height: 64 });

    // And the field agrees: every tile has a real index, and the window index
    // and the map index are the same number.
    const grid = openGrid(64);
    const field = buildFlowField(grid, grid.index(32, 32));
    expect(field.dist.length).toBe(64 * 64);
    expect(field.localOf(grid.index(63, 63))).toBe(grid.index(63, 63));
  });

  it("caps a large map at the window size", () => {
    const win = flowWindow(1024, 1024, 512, 512);
    expect(win.width).toBe(FLOW_WINDOW);
    expect(win.height).toBe(FLOW_WINDOW);
    expect(win.minX).toBe(512 - FLOW_WINDOW / 2);
  });

  it("clamps to the map rather than truncating at an edge", () => {
    // A base in the corner is exactly where paths converge, so it gets a
    // full-size window, not the half of one that fits.
    const near = flowWindow(1024, 1024, 3, 3);
    expect(near).toEqual({ minX: 0, minY: 0, width: FLOW_WINDOW, height: FLOW_WINDOW });

    const far = flowWindow(1024, 1024, 1020, 1020);
    expect(far.minX).toBe(1024 - FLOW_WINDOW);
    expect(far.minY).toBe(1024 - FLOW_WINDOW);
  });

  it("costs the same on a huge map as on a small one", () => {
    const big = new CostGrid(1024, 1024);
    const field = buildFlowField(big, big.index(512, 512));
    // The allocation is what would otherwise be five megabytes per cached
    // destination, and the search is what would otherwise be a million cells.
    expect(field.dist.length).toBe(FLOW_WINDOW * FLOW_WINDOW);
  });

  it("gives no direction outside the window, which steers a unit straight in", () => {
    const big = new CostGrid(1024, 1024);
    const goal = big.index(512, 512);
    const field = buildFlowField(big, goal);

    // Just inside the window: a real step toward the goal.
    expect(field.dirAt(big.index(512 - FLOW_WINDOW / 2 + 1, 512))).toBeGreaterThanOrEqual(0);
    // Far outside it: nothing, which world.ts reads as "head for the goal".
    expect(field.dirAt(big.index(20, 20))).toBe(-1);
    expect(field.distAt(big.index(20, 20))).toBe(FLOW_UNREACHABLE);
  });

  it("still walks a unit home from inside the window on a huge map", () => {
    const big = new CostGrid(1024, 1024);
    big.fillRect(500, 470, 3, 40, TILE_BLOCKED);
    const field = buildFlowField(big, big.index(512, 512));
    // Starts on the far side of the wall, well inside the window.
    expect(walk(big, field, 460, 490).reached).toBe(true);
  });

  it("does not mistake a window index for a map index", () => {
    // The bug this guards against is silent: on a windowed map the two index
    // spaces differ by an offset, and reading one with the other returns a
    // plausible direction for entirely the wrong tile.
    const big = new CostGrid(1024, 1024);
    const goal = big.index(600, 600);
    const field = buildFlowField(big, goal);
    expect(field.localOf(goal)).not.toBe(goal);
    expect(field.distAt(goal)).toBe(0);
    expect(field.dirAt(goal)).toBe(-1);
  });
});

describe("nearestWalkable", () => {
  it("returns the tile itself when already walkable", () => {
    const grid = openGrid();
    expect(nearestWalkable(grid, 5, 5)).toBe(grid.index(5, 5));
  });

  it("finds an adjacent tile when the target is blocked", () => {
    const grid = openGrid();
    grid.set(5, 5, TILE_BLOCKED);
    const found = nearestWalkable(grid, 5, 5);
    expect(found).not.toBe(-1);
    expect(grid.tiles[found]).not.toBe(TILE_BLOCKED);
  });

  it("escapes a large blocked region", () => {
    const grid = openGrid(32);
    grid.fillRect(4, 4, 10, 10, TILE_BLOCKED);
    const found = nearestWalkable(grid, 9, 9);
    expect(found).not.toBe(-1);
    expect(grid.tiles[found]).not.toBe(TILE_BLOCKED);
  });

  it("gives up rather than looping forever on a fully blocked map", () => {
    const grid = openGrid(8);
    grid.tiles.fill(TILE_BLOCKED);
    expect(nearestWalkable(grid, 4, 4, 8)).toBe(-1);
  });
});

describe("FlowFieldCache", () => {
  it("reuses a field for a repeated destination", () => {
    const grid = openGrid();
    const cache = new FlowFieldCache();
    const goal = grid.index(4, 4);
    const a = cache.get(grid, goal);
    const b = cache.get(grid, goal);
    expect(b).toBe(a);
    expect(cache.builds).toBe(1);
  });

  it("rebuilds after the grid changes", () => {
    // Stale fields after a building is placed would path units straight into it.
    const grid = openGrid();
    const cache = new FlowFieldCache();
    const goal = grid.index(4, 4);
    cache.get(grid, goal);
    grid.set(2, 2, TILE_BLOCKED);
    cache.get(grid, goal);
    expect(cache.builds).toBe(2);
  });

  it("evicts beyond capacity but still returns correct fields", () => {
    const grid = openGrid();
    const cache = new FlowFieldCache(2);
    const g1 = grid.index(1, 1);
    cache.get(grid, g1);
    cache.get(grid, grid.index(2, 2));
    cache.get(grid, grid.index(3, 3)); // evicts g1
    const again = cache.get(grid, g1);
    expect(cache.builds).toBe(4);
    // A recomputed field must equal the original -- this is why cache policy
    // is allowed to differ between peers without causing a desync.
    expect(Array.from(again.dist)).toEqual(Array.from(buildFlowField(grid, g1).dist));
  });
});
