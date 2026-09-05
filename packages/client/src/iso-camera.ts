import * as THREE from "three";

/**
 * Locked isometric camera rig.
 *
 * The camera uses a true isometric orientation -- azimuth 45 degrees, elevation
 * atan(1/sqrt(2)) ~= 35.264 degrees -- which places it along the (1, 1, 1)
 * diagonal so all three axes foreshorten equally. That is what produces the
 * classic 2.5D read.
 *
 * Rotation is deliberately not exposed. A fixed viewing angle is the entire
 * point of an isometric game: it lets art be authored for one direction, keeps
 * unit silhouettes readable, and means players never lose their bearings. Zoom
 * changes the orthographic frustum height rather than moving the camera, since
 * dollying an orthographic camera does nothing.
 */

/** Elevation of true isometric, in radians: atan(1 / sqrt(2)). */
const ISO_ELEVATION = Math.atan(1 / Math.SQRT2);
/** Azimuth of true isometric, in radians. */
const ISO_AZIMUTH = Math.PI / 4;

/**
 * Distance from target to camera. Irrelevant to apparent size under an
 * orthographic projection; it only has to be far enough that the near/far
 * planes bracket the whole scene.
 *
 * Exported because anything configured in view-space distance -- fog above all
 * -- must be expressed relative to it. Fog ranges that look sensible for a
 * perspective camera ("far = 260") put the entire scene beyond the fog far
 * plane here, rendering the world as a flat sheet of fog colour.
 */
export const CAMERA_DISTANCE = 400;

const MIN_VIEW_HEIGHT = 8;
const MAX_VIEW_HEIGHT = 120;

/** Axis-aligned ground box the camera target is confined to, in world units. */
export interface CameraBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface IsoCameraOptions {
  /** World units visible vertically. Smaller is more zoomed in. */
  viewHeight?: number;
  /** Region the camera target may roam. Defaults to a 256x256 map at the origin. */
  bounds?: CameraBounds;
}

export class IsoCamera {
  readonly camera: THREE.OrthographicCamera;
  /** Ground point the camera looks at. Only x and z are meaningful. */
  readonly target = new THREE.Vector3(0, 0, 0);

  viewHeight: number;
  bounds: CameraBounds;

  /** Unit ground vector that appears to point right on screen. */
  private readonly screenRight = new THREE.Vector3();
  /** Unit ground vector that appears to point up-screen. */
  private readonly screenUp = new THREE.Vector3();
  /** Unit vector from target toward the camera. */
  private readonly offset = new THREE.Vector3();

  private aspect = 1;

  constructor(options: IsoCameraOptions = {}) {
    this.viewHeight = options.viewHeight ?? 40;
    this.bounds = options.bounds ?? { minX: 0, maxX: 256, minZ: 0, maxZ: 256 };

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, CAMERA_DISTANCE * 3);

    // Direction from target to camera, from the fixed isometric angles.
    const ce = Math.cos(ISO_ELEVATION);
    this.offset.set(ce * Math.cos(ISO_AZIMUTH), Math.sin(ISO_ELEVATION), ce * Math.sin(ISO_AZIMUTH));

    // Ground-plane pan basis, derived from the camera orientation rather than
    // hardcoded, so changing the azimuth above does not silently break panning.
    const groundDir = new THREE.Vector3(this.offset.x, 0, this.offset.z).normalize();
    this.screenRight.copy(new THREE.Vector3(0, 1, 0)).cross(groundDir).normalize();
    this.screenUp.copy(groundDir).negate();

    this.update();
  }

  /** Call on resize. */
  setViewport(width: number, height: number): void {
    this.aspect = width / Math.max(1, height);
    this.update();
  }

  /**
   * Pan in screen space. `dx` is rightward, `dy` is upward, both in world units
   * along the ground plane.
   */
  pan(dx: number, dy: number): void {
    this.target.addScaledVector(this.screenRight, dx);
    this.target.addScaledVector(this.screenUp, dy);
    this.clampTarget();
    this.update();
  }

  /**
   * Zoom by a multiplicative factor. Multiplicative rather than additive so a
   * wheel notch feels the same at every zoom level.
   */
  zoomBy(factor: number): void {
    this.viewHeight = THREE.MathUtils.clamp(
      this.viewHeight * factor,
      MIN_VIEW_HEIGHT,
      MAX_VIEW_HEIGHT,
    );
    this.update();
  }

  /** Jump the camera to a ground position. */
  lookAtGround(x: number, z: number): void {
    this.target.set(x, 0, z);
    this.clampTarget();
    this.update();
  }

  /**
   * World units per pixel at the current zoom, so mouse-drag panning tracks the
   * cursor exactly instead of drifting.
   */
  worldUnitsPerPixel(viewportHeight: number): number {
    return this.viewHeight / Math.max(1, viewportHeight);
  }

  private clampTarget(): void {
    const b = this.bounds;
    this.target.x = THREE.MathUtils.clamp(this.target.x, b.minX, b.maxX);
    this.target.z = THREE.MathUtils.clamp(this.target.z, b.minZ, b.maxZ);
    this.target.y = 0;
  }

  private update(): void {
    const halfH = this.viewHeight / 2;
    const halfW = halfH * this.aspect;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.near = 1;
    this.camera.far = CAMERA_DISTANCE * 3;

    this.camera.position.copy(this.target).addScaledVector(this.offset, CAMERA_DISTANCE);
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
  }
}
