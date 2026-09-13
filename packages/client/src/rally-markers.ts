import { CAN_PRODUCE, type EntityId, type World } from "@rts/sim";
import * as THREE from "three";
import { simToWorld } from "./coords.js";
import { teamColour } from "./palette.js";

/**
 * Rally flags: where a selected building sends what it makes.
 *
 * The rally point itself is simulation state -- set by right-clicking with a
 * producer selected, read when a unit comes out (production.ts). This draws
 * it, for the local player's own selected producers only: a flag in the
 * owner's colour at the point, and a faint dashed line from the building's
 * centre to it. Nothing is drawn for a producer whose rally is still itself,
 * which is what an unset rally point is.
 *
 * Presentation only, like the selection rings.
 */

export interface RallyPoint {
  building: EntityId;
  owner: number;
  /** Building centre and rally point, in world units on the ground plane. */
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
}

/** The rally points to draw for a selection. */
export function rallyPoints(world: World, selected: ReadonlySet<EntityId>, localPlayer: number): RallyPoint[] {
  const e = world.entities;
  const out: RallyPoint[] = [];
  for (const id of selected) {
    const i = e.indexOfLive(id);
    if (i < 0 || e.owner[i] !== localPlayer) continue;
    if (!world.types.can(e.typeId[i], CAN_PRODUCE)) continue;
    if (e.rallyX[i] === e.posX[i] && e.rallyY[i] === e.posY[i]) continue;
    out.push({
      building: id,
      owner: e.owner[i],
      fromX: simToWorld(e.posX[i]),
      fromZ: simToWorld(e.posY[i]),
      toX: simToWorld(e.rallyX[i]),
      toZ: simToWorld(e.rallyY[i]),
    });
  }
  return out;
}

/** Just above the ground, under the selection rings, so the line never z-fights with it. */
const LINE_HEIGHT = 0.05;
const POLE_HEIGHT = 1.25;

interface Marker {
  flag: THREE.Group;
  pennant: THREE.Mesh;
  line: THREE.Line;
  colourOwner: number;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
}

export class RallyMarkers {
  private readonly scene: THREE.Scene;
  private readonly markers: Marker[] = [];

  // Shared by every marker. Colour lives on per-marker materials.
  private readonly poleGeometry = new THREE.CylinderGeometry(0.025, 0.035, POLE_HEIGHT, 6).translate(0, POLE_HEIGHT / 2, 0);
  private readonly pennantGeometry = pennant();
  private readonly baseGeometry = new THREE.RingGeometry(0.16, 0.24, 20).rotateX(-Math.PI / 2);
  private readonly knobGeometry = new THREE.SphereGeometry(0.06, 8, 6);
  private readonly poleMaterial = new THREE.MeshBasicMaterial({ color: 0x3a2e24 });
  /** Ember, the palette's own light, so the flag reads against dark ground. */
  private readonly knobMaterial = new THREE.MeshBasicMaterial({ color: 0xe8a04a });

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  update(world: World, selected: ReadonlySet<EntityId>, localPlayer: number, seconds: number): void {
    const points = rallyPoints(world, selected, localPlayer);
    while (this.markers.length < points.length) this.markers.push(this.create());

    this.markers.forEach((marker, k) => {
      const point = points[k];
      const visible = point !== undefined;
      marker.flag.visible = visible;
      marker.line.visible = visible;
      if (!point) return;

      if (marker.colourOwner !== point.owner) {
        marker.colourOwner = point.owner;
        const colour = teamColour(point.owner);
        (marker.pennant.material as THREE.MeshBasicMaterial).color.setHex(colour);
        (marker.line.material as THREE.LineDashedMaterial).color.setHex(colour);
        ((marker.flag.children[2] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(colour);
      }

      if (point.fromX !== marker.fromX || point.fromZ !== marker.fromZ || point.toX !== marker.toX || point.toZ !== marker.toZ) {
        marker.fromX = point.fromX;
        marker.fromZ = point.fromZ;
        marker.toX = point.toX;
        marker.toZ = point.toZ;
        const position = marker.line.geometry.getAttribute("position") as THREE.BufferAttribute;
        position.setXYZ(0, point.fromX, LINE_HEIGHT, point.fromZ);
        position.setXYZ(1, point.toX, LINE_HEIGHT, point.toZ);
        position.needsUpdate = true;
        marker.line.geometry.computeBoundingSphere();
        // Dashes are laid out along the line's length, which just changed.
        marker.line.computeLineDistances();
        marker.flag.position.set(point.toX, 0, point.toZ);
      }

      // A slow stir in the ash-laden air, offset per flag.
      marker.pennant.rotation.y = Math.sin(seconds * 1.7 + k) * 0.18;
    });
  }

  private create(): Marker {
    const flag = new THREE.Group();
    const pole = new THREE.Mesh(this.poleGeometry, this.poleMaterial);
    const pennant = new THREE.Mesh(
      this.pennantGeometry,
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    pennant.position.y = POLE_HEIGHT - 0.02;
    const base = new THREE.Mesh(
      this.baseGeometry,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false }),
    );
    base.position.y = LINE_HEIGHT;
    const knob = new THREE.Mesh(this.knobGeometry, this.knobMaterial);
    knob.position.y = POLE_HEIGHT + 0.04;
    flag.add(pole, pennant, base, knob);

    const line = new THREE.Line(
      new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3)),
      // Faint on purpose: it is a reminder of where units will go, not a thing
      // to look at, and several selected buildings draw several of them.
      new THREE.LineDashedMaterial({ dashSize: 0.3, gapSize: 0.22, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    line.frustumCulled = false;

    flag.visible = false;
    line.visible = false;
    this.scene.add(flag, line);
    return { flag, pennant, line, colourOwner: -1, fromX: NaN, fromZ: NaN, toX: NaN, toZ: NaN };
  }
}

/** A swallow-tailed pennant hanging off the pole toward +X, top edge at y = 0. */
function pennant(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.5, 0);
  shape.lineTo(0.36, -0.16);
  shape.lineTo(0.5, -0.32);
  shape.lineTo(0, -0.32);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}
