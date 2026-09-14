import type { BakedClip } from "./skinned-parts.js";

/**
 * Turret aiming, from baked clips.
 *
 * Clips play the same for every copy of a model, so nothing can turn one
 * turret's bone on its own -- but a clip can be *chosen* per instance, frame by
 * frame. A structure that aims carries an `aim` clip in which its turret makes
 * one full turn, anticlockwise seen from above, starting from +X; showing the
 * frame a quarter of the way through turns that instance's turret a quarter
 * turn. `aim_fire` is the same turn with the barrel recoiled, and the renderer
 * blends the two at the same angle for a shot's kick. Every turret on the map
 * stays one draw call.
 *
 * Presentation only: the simulation neither knows nor cares which way a
 * turret appears to point.
 */

const TAU = Math.PI * 2;

/**
 * Which way to point, from the aimer to its target, as the `aim` clip counts
 * it: radians anticlockwise from +X seen from above. The simulation's +Y is
 * Blender's -Y, which is why the second axis is negated.
 */
export function aimYaw(dx: number, dy: number): number {
  return Math.atan2(-dy, dx);
}

/** The shortest signed turn from `from` to `to`, in (-PI, PI]. */
export function angleBetween(from: number, to: number): number {
  const d = (((to - from) % TAU) + TAU) % TAU;
  return d > Math.PI ? d - TAU : d;
}

/** Turn from `current` toward `desired` by at most `maxStep`, the short way round. */
export function turnToward(current: number, desired: number, maxStep: number): number {
  const d = angleBetween(current, desired);
  return Math.abs(d) <= maxStep ? desired : current + Math.sign(d) * maxStep;
}

/**
 * The texture row showing a turret at `yaw`. Fractional, so the shader blends
 * between the two nearest baked angles; an `aim` clip loops, so its extra row
 * is its first and the blend wraps cleanly past a full turn.
 */
export function aimFrame(clip: BakedClip, yaw: number): number {
  const turns = (((yaw / TAU) % 1) + 1) % 1;
  return clip.start + turns * clip.frames;
}
