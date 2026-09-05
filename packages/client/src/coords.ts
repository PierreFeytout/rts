import { FX_ONE, type Fx } from "@rts/sim";

/**
 * The single place where simulation coordinates meet render coordinates.
 *
 * The simulation is 2D: positions are Q16.16 `(x, y)` on a flat ground plane,
 * with `y` running "south" across the map. Three.js is Y-up, so its ground
 * plane is XZ.
 *
 *     sim.x  ->  three.x
 *     sim.y  ->  three.z
 *     height ->  three.y   (render-only; the sim has no third axis)
 *
 * Terrain elevation is deliberately render-only for the vertical slice. Giving
 * the sim a height axis would mean pathfinding, ranges and collision all become
 * 3D problems, which is a large cost for a mostly cosmetic gain. Cliffs, when
 * they arrive, will be *impassable tiles in the cost grid* that happen to be
 * drawn tall -- gameplay stays 2D, visuals get depth.
 *
 * One world unit is one map tile.
 */

/** Convert a Q16.16 simulation coordinate to a float world unit for rendering. */
export function simToWorld(v: Fx): number {
  return v / FX_ONE;
}

/** Convert a float world unit back to Q16.16, for turning clicks into commands. */
export function worldToSim(v: number): Fx {
  return Math.round(v * FX_ONE);
}

/**
 * Convert a BAM angle to Three.js radians for a Y-axis rotation.
 *
 * Negated because BAM measures counter-clockwise in the sim's (x, y) plane,
 * while a Three.js Y-rotation is counter-clockwise in (x, z) -- and z points the
 * opposite way from the sim's y. Without the sign flip every unit turns the
 * wrong way, which is subtle enough to survive a long time unnoticed.
 *
 * ASSET CONVENTION: models must face +X at rest, because BAM angle 0 is +X.
 * This keeps the mapping a pure negation with no hidden 90-degree offset. Note
 * that it differs from the Three.js habit of authoring models facing +Z (which
 * comes from `Object3D.lookAt`), so imported .glb assets generally need a yaw
 * correction baked in at export rather than applied at runtime.
 */
export function bamToThreeY(angle: number): number {
  return -(angle / 65536) * Math.PI * 2;
}
