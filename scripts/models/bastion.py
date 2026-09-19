"""
The Bastion -- the Ashen Directorate's headquarters. Content id: vanguard.nexus.

    blender -b --factory-startup --python scripts/models/bastion.py

"Dropped, not built" (UNIVERSE.md). The Directorate's buildings are
prefabricated bastions dropped onto cleared ground and bolted to whatever was
underneath. So this is a drop-hull, not a building:

  - a squat armoured hull with sloped walls, skinned in plate cut off other
    wrecks and welded back up, ceramic re-entry tiles still on its lower edge
    and retro-thrusters under its skirt;
  - four landing legs at the corners, their feet bolted through a rockcrete
    apron laid for it -- the one place the grid is allowed;
  - a Servitor bay on the +X face: a roller shutter in a hazard-striped frame,
    a grate ramp, and two warning beacons on the lintel;
  - an alloy intake on the -Y face, because the Bastion is where salvage is
    dropped off: a trough on the ground, a conveyor, a hopper into the hull;
  - a command tower with ember-lit slit windows, a painted cab, a sensor mast
    with a sweeping dish, and two exhaust stacks behind it.

The game camera looks from +X and -Y, so those two faces carry the doors and the
detail; the far faces carry pipes and the silhouette.

ANIMATION. Structures are rigged like units, with four clips (see the model
README): `build` is scrubbed by construction progress rather than played in
time -- the apron rises out of the ground, the hull comes down on its thrusters,
the legs swing out as it lands, the tower and stacks run up, the ramp and the
conveyor drop into place, the lights come on. `idle` sweeps the dish and blinks
the mast. `produce` loops while anything is queued: beacons spin, the deck
hammers pump. `release` plays each time a Servitor comes out: the shutter rolls
up and back down.

Built in tiles at its real footprint, so the procedural surfaces are sized for a
building, and shrunk into the unit box the game expects at the end.

Blender axes: +X, +Y left, +Z up.
"""

import math
import os
import random
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import kit  # noqa: E402
import surfaces  # noqa: E402

CONTENT_ID = "vanguard.nexus"
FOOTPRINT = 4
PREVIEW_DIR = os.environ.get("RTS_PREVIEW_DIR", os.path.join(kit.REPO, "art", "previews"))
TEXTURE_SIZE = int(os.environ.get("RTS_TEXTURE_SIZE", "2048"))

kit.fresh_scene()
col = kit.collection("Bastion")
# A plate on this hull is several times the size of anything on a Conscript,
# and its wear has to be too; see surfaces.Graph.
s = surfaces.structure_surfaces(scale=6.0)
lamp = kit.directorate_palette()["lamp"]
rng = random.Random(7)


def rot(axis, degrees):
    return Matrix.Rotation(math.radians(degrees), 3, axis)


# ---------------------------------------------------------------------------
# Proportions, in tiles. The footprint is +-2.
# ---------------------------------------------------------------------------

HULL_Z0, HULL_Z1 = 0.24, 1.45
HULL_HALF0, HULL_HALF1 = 1.4, 1.2
HULL_CHAMFER = 0.36
SLOPE = math.degrees(math.atan2(HULL_HALF0 - HULL_HALF1, HULL_Z1 - HULL_Z0))
DECK = 1.5
TOWER = Vector((-0.3, 0.3))
TOWER_HALF = 0.52
LINTEL = 1.36

# Faces of the hull, by the direction they look. Each has a frame: u runs along
# the face (anticlockwise seen from above), z is height, and out is away from it.
YAW = {"+X": 0, "+Y": 90, "-X": 180, "-Y": -90}


def half_at(z):
    return HULL_HALF0 + (HULL_HALF1 - HULL_HALF0) * (z - HULL_Z0) / (HULL_Z1 - HULL_Z0)


def wall_rotation(face, spin=0.0):
    """Local X out of the wall, Y along it, Z up its slope."""
    return rot("Z", YAW[face]) @ rot("Y", -SLOPE) @ rot("X", spin)


def normal(face):
    return wall_rotation(face) @ Vector((1, 0, 0))


def on_wall(face, u, z, out=0.0):
    return rot("Z", YAW[face]) @ Vector((half_at(z), u, z)) + normal(face) * out


# ---------------------------------------------------------------------------
# Skeleton. Every moving assembly is one bone; every piece is weighted wholly
# to one of them.
# ---------------------------------------------------------------------------

CORNERS = {"FR": (1, -1), "FL": (1, 1), "BL": (-1, 1), "BR": (-1, -1)}
QUADRANTS = {"FR": (1, -1), "FL": (1, 1), "BL": (-1, 1), "BR": (-1, -1)}

DOOR_TOP, DOOR_BOTTOM = 1.12, 0.32
RAMP_HINGE = on_wall("+X", 0, DOOR_BOTTOM - 0.02, 0.04)
CONVEYOR_HIGH = Vector((0.12, -1.68, 1.3))
CONVEYOR_LOW = Vector((-0.98, -1.68, 0.22))


def leg_mount(sx, sy):
    return Vector((sx * 1.14, sy * 1.14, 0.9))


def leg_foot(sx, sy):
    return Vector((sx * 1.64, sy * 1.64, 0.18))


bones = [
    ("root", (0, 0, 0), (0, 0, 0.5), None),
    ("hull", (0, 0, 0.2), (0, 0, 1.2), "root"),
    # Tucked inside the hull at rest, run out beneath it on the way down.
    ("thrusters", (0, 0, 0.1), (0, 0, 0.5), "hull"),
    ("shutter", tuple(on_wall("+X", 0, DOOR_TOP, 0.05)), tuple(on_wall("+X", 0, DOOR_BOTTOM, 0.05)), "hull"),
    ("ramp", tuple(RAMP_HINGE), (1.96, 0, 0.09), "hull"),
    ("conveyor", tuple(CONVEYOR_HIGH), tuple(CONVEYOR_LOW), "hull"),
    ("tower", (TOWER.x, TOWER.y, HULL_Z1), (TOWER.x, TOWER.y, 2.85), "hull"),
    ("mast", (TOWER.x, TOWER.y, 2.9), (TOWER.x, TOWER.y, 3.95), "tower"),
    ("dish", (TOWER.x, TOWER.y, 3.15), (TOWER.x, TOWER.y, 3.35), "mast"),
    ("beacon.mast", (TOWER.x, TOWER.y, 3.9), (TOWER.x, TOWER.y, 4.0), "mast"),
    ("stack.A", (-1.0, 0.85, HULL_Z1), (-1.0, 0.85, 3.05), "hull"),
    ("stack.B", (-1.05, 0.4, HULL_Z1), (-1.05, 0.4, 2.6), "hull"),
]
for side, u in (("L", 0.5), ("R", -0.5)):
    base = on_wall("+X", u, LINTEL, 0.12)
    bones.append((f"beacon.{side}", (base.x, base.y, LINTEL + 0.08), (base.x, base.y, LINTEL + 0.25), "hull"))
for name, x in (("hammer.A", 0.12), ("hammer.B", 0.98)):
    bones.append((name, (x, -0.45, DECK + 0.2), (x, -0.45, DECK + 0.4), "hull"))
for name, (sx, sy) in CORNERS.items():
    bones.append((f"leg.{name}", tuple(leg_mount(sx, sy)), tuple(leg_foot(sx, sy)), "hull"))
for name, (sx, sy) in QUADRANTS.items():
    bones.append((f"apron.{name}", (sx, sy, 0), (sx, sy, 0.3), "root"))
rig = kit.armature("rig", col, bones)

parts = []
count = [0]


def piece(bm, mat, bone, painted=False, bevel=None, segments=1, name=None):
    count[0] += 1
    obj = kit.rigid_part(name or f"{bone}.{count[0]}", bm, mat, col, bone, painted=painted)
    if bevel is not None:
        kit.bevel(obj, width=bevel, segments=segments)
    parts.append(obj)
    return obj


def wall_plate(face, u0, u1, z0, z1, mat, bone="hull", painted=False, out=0.0, thick=0.05, spin=0.0,
               bevel=0.02):
    u, z = (u0 + u1) / 2, (z0 + z1) / 2
    centre = on_wall(face, u, z, out + thick / 2)
    height = (z1 - z0) / math.cos(math.radians(SLOPE))
    return piece(kit.box((thick, u1 - u0, height), centre, wall_rotation(face, spin)), mat, bone,
                 painted=painted, bevel=bevel)


def rivets(face, us, z, out=0.05, bone="hull"):
    n = normal(face)
    for u in us:
        p = on_wall(face, u, z, out)
        piece(kit.rod(p, p + n * 0.025, 0.024, segments=5), s["iron"], bone)


def weld(face, u, z0, z1, out=0.03, bone="hull"):
    piece(kit.rod(on_wall(face, u, z0, out), on_wall(face, u, z1, out), 0.013, segments=4), s["iron"], bone)


# ---------------------------------------------------------------------------
# The apron: rockcrete slabs, laid a little unevenly on whatever is under them.
# ---------------------------------------------------------------------------

for name, (sx, sy) in QUADRANTS.items():
    for ix in (0.5, 1.5):
        for iy in (0.5, 1.5):
            lift = rng.uniform(-0.01, 0.012)
            tilt = rot("X", rng.uniform(-0.7, 0.7)) @ rot("Y", rng.uniform(-0.7, 0.7))
            # The four under the hull are never seen, and are not bevelled.
            under = ix == 0.5 and iy == 0.5
            piece(kit.box((0.96, 0.96, 0.08), (sx * ix, sy * iy, 0.04 + lift), tilt), s["rockcrete"],
                  f"apron.{name}", bevel=None if under else 0.014)

# Hazard marking the length of the two apron edges the camera sees -- where
# Servitors come and go, and where salvage is dropped. A pad bordered in
# furnace orange says "Directorate" from the air before anything on it does.
for y, bone in ((-0.98, "apron.FR"), (0.98, "apron.FL")):
    piece(kit.box((0.16, 1.9, 0.012), (1.91, y, 0.086)), s["hazard"], bone)
for x, bone in ((-0.98, "apron.BR"), (0.98, "apron.FR")):
    piece(kit.box((1.9, 0.16, 0.012), (x, -1.91, 0.086)), s["hazard"], bone)

# The intake trough, on the ground where the conveyor starts.
TROUGH = Vector((-1.1, -1.66))
piece(kit.box((0.62, 0.5, 0.05), (TROUGH.x, TROUGH.y, 0.1)), s["plate"], "apron.BR", bevel=0.01)
for dx, dy, sx_, sy_ in ((0.29, 0, 0.04, 0.5), (-0.29, 0, 0.04, 0.5), (0, 0.23, 0.62, 0.04), (0, -0.23, 0.62, 0.04)):
    piece(kit.box((sx_, sy_, 0.2), (TROUGH.x + dx, TROUGH.y + dy, 0.19)), s["plate"], "apron.BR", bevel=0.01)
    piece(kit.box((sx_ + 0.02, sy_ + 0.02, 0.035), (TROUGH.x + dx, TROUGH.y + dy, 0.305)), s["hazard"], "apron.BR")
for i in range(5):
    chunk = kit.box((rng.uniform(0.07, 0.14), rng.uniform(0.06, 0.12), rng.uniform(0.04, 0.09)),
                    (TROUGH.x + rng.uniform(-0.2, 0.2), TROUGH.y + rng.uniform(-0.15, 0.15), 0.16),
                    rot("Z", rng.uniform(0, 90)) @ rot("X", rng.uniform(-25, 25)))
    piece(chunk, s["iron"] if i % 2 else s["plate"], "apron.BR")

# ---------------------------------------------------------------------------
# The hull.
# ---------------------------------------------------------------------------

# Standing on its thruster bells and its legs, a hand above the apron.
piece(kit.prism(kit.octagon(1.52, 0.42), 0.16, 0.3, top_scale=0.97), s["iron"], "hull", bevel=0.03)
piece(kit.prism(kit.octagon(HULL_HALF0, HULL_CHAMFER), HULL_Z0, HULL_Z1, top_scale=HULL_HALF1 / HULL_HALF0),
      s["plate"], "hull", bevel=0.035)
# The deck is plate too: seen from the game camera it is the largest face the
# building has, and the plate grid is what makes it read as decking.
piece(kit.prism(kit.octagon(1.25, 0.34), HULL_Z1 - 0.02, DECK, top_scale=0.99), s["plate"], "hull", bevel=0.018)
# Light strips let into the hull's top edge on the two faces the camera sees:
# the lines of light a Directorate structure shows from the air.
for face, u0, u1, out in (("+X", -0.75, 0.75, 0.0), ("-Y", -1.0, 1.0, 0.05)):
    wall_plate(face, u0, u1, HULL_Z1 - 0.075, HULL_Z1 - 0.04, lamp, out=out, thick=0.012, bevel=None)

# Retro-thruster bells under the skirt, and their flames -- hidden in the hull
# until the drop.
for sx, sy in CORNERS.values():
    piece(kit.rod((sx * 1.02, sy * 1.02, 0.24), (sx * 1.02, sy * 1.02, 0.085), 0.12, segments=10, radius_end=0.17),
          s["iron"], "hull")
    piece(kit.rod((sx * 1.02, sy * 1.02, 0.85), (sx * 1.02, sy * 1.02, 0.12), 0.16, segments=8, radius_end=0.03),
          lamp, "thrusters")

# Ceramic re-entry tiles along the lower edge of the two faces the camera sees.
for face, gap in (("-Y", None), ("+X", 0.64)):
    for i in range(7):
        u = -0.84 + i * 0.28
        if gap is not None and abs(u) < gap:
            continue
        wall_plate(face, u - 0.13, u + 0.13, 0.31, 0.46, s["ceramic"], thick=0.04, spin=rng.uniform(-3, 3),
                   bevel=0.012)

# -- +X: the Servitor bay ----------------------------------------------------

wall_plate("+X", -0.6, 0.6, DOOR_BOTTOM, DOOR_TOP, s["rubber"], thick=0.01, bevel=None)
for i in range(8):
    z = DOOR_BOTTOM + i * 0.0875
    wall_plate("+X", -0.58, 0.58, z + 0.004, z + 0.083, s["iron"], bone="shutter", out=0.012, thick=0.035,
               bevel=0.01)
for u0 in (-0.76, 0.6):
    wall_plate("+X", u0, u0 + 0.16, 0.27, DOOR_TOP + 0.08, s["hazard"], out=0.0, thick=0.11, bevel=0.015)
wall_plate("+X", -0.84, 0.84, DOOR_TOP + 0.01, LINTEL + 0.02, s["paint"], painted=True, thick=0.13, bevel=0.02)
# A light strip along the lintel, the width of the door.
wall_plate("+X", -0.64, 0.64, DOOR_TOP + 0.05, DOOR_TOP + 0.085, lamp, out=0.13, thick=0.012, bevel=None)
wall_plate("+X", -0.62, 0.62, 0.25, DOOR_BOTTOM, s["iron"], thick=0.13, bevel=0.012)
rivets("+X", [-0.72, -0.48, -0.24, 0.0, 0.24, 0.48, 0.72], LINTEL - 0.05, out=0.13)

wall_plate("+X", 0.78, 1.0, 0.48, 0.9, s["plate"], spin=1.5)
wall_plate("+X", 0.78, 1.0, 0.92, 1.4, s["paint"], painted=True, spin=-1.0)
wall_plate("+X", -1.0, -0.78, 0.48, 1.0, s["plate"], spin=-2.0)
wall_plate("+X", -1.0, -0.78, 1.02, 1.4, s["plate"], spin=1.0)
weld("+X", 0.77, 0.45, 1.4, out=0.05)
weld("+X", -0.77, 0.45, 1.4, out=0.05)

# The ramp: two hazard-striped stringers and grate treads, hinged at the sill.
ramp_end = Vector((1.96, 0, 0.09))
for y in (0.5, -0.5):
    piece(kit.beam((RAMP_HINGE.x, y, RAMP_HINGE.z), (ramp_end.x, y, ramp_end.z), 0.06, width=0.06),
          s["hazard"], "ramp", bevel=0.01)
for i in range(7):
    t = (i + 0.5) / 7
    p = RAMP_HINGE.lerp(ramp_end, t)
    piece(kit.beam((p.x, -0.47, p.z + 0.01), (p.x, 0.47, p.z + 0.01), 0.025, width=0.06), s["grate"], "ramp")
piece(kit.beam((RAMP_HINGE.x, 0, RAMP_HINGE.z - 0.02), (ramp_end.x, 0, ramp_end.z - 0.02), 0.02, width=0.94),
      s["rubber"], "ramp")

# Warning beacons on the lintel: a lamp inside a hood with one open side, which
# turns to throw the light around.
for side in ("L", "R"):
    base = on_wall("+X", 0.5 if side == "L" else -0.5, LINTEL, 0.12)
    z = LINTEL + 0.02
    piece(kit.rod((base.x, base.y, z), (base.x, base.y, z + 0.08), 0.075, segments=8), s["iron"], "hull")
    piece(kit.rod((base.x, base.y, z + 0.08), (base.x, base.y, z + 0.2), 0.045, segments=8), lamp,
          f"beacon.{side}")
    piece(kit.box((0.04, 0.12, 0.13), (base.x - 0.06, base.y, z + 0.14)), s["iron"], f"beacon.{side}")
    piece(kit.rod((base.x, base.y, z + 0.2), (base.x, base.y, z + 0.24), 0.065, segments=8), s["iron"],
          f"beacon.{side}")

# -- -Y: the alloy intake ------------------------------------------------------

wall_plate("-Y", -1.0, -0.2, 0.48, 0.92, s["plate"], spin=-1.5)
wall_plate("-Y", -1.0, -0.2, 0.94, 1.4, s["plate"], spin=2.0)
wall_plate("-Y", -0.18, 0.58, 0.48, 0.72, s["plate"], spin=0.5)
wall_plate("-Y", 0.6, 1.0, 0.64, 1.4, s["paint"], painted=True)
# A patch welded over something that went through the paint.
wall_plate("-Y", 0.62, 0.84, 0.66, 0.86, s["plate"], out=0.05, thick=0.03, spin=11, bevel=0.01)
wall_plate("-Y", 0.62, 1.0, 0.48, 0.62, s["ceramic"], thick=0.04, bevel=0.01)
# An intake louvre beside the hopper: slats over a dark throat.
wall_plate("-Y", -0.92, -0.6, 1.0, 1.32, s["rubber"], out=0.05, thick=0.01, bevel=None)
for z in (1.03, 1.1, 1.17, 1.24):
    wall_plate("-Y", -0.93, -0.59, z, z + 0.035, s["iron"], out=0.055, thick=0.03, bevel=0.006)
rivets("-Y", [0.66, 0.81, 0.96], 1.35)
rivets("-Y", [-0.95, -0.7, -0.45], 1.35)
weld("-Y", -0.19, 0.45, 1.4)
weld("-Y", 0.59, 0.45, 1.4)

HOPPER = Vector((0.28, -1.5))
piece(kit.box((0.5, 0.36, 0.42), (HOPPER.x, HOPPER.y, 1.18)), s["plate"], "hull", bevel=0.02)
piece(kit.prism(kit.octagon(0.22, 0.04), 1.38, 1.64, top_scale=1.5, centre=HOPPER, open_top=True), s["iron"],
      "hull", bevel=0.01)
piece(kit.box((0.5, 0.5, 0.01), (HOPPER.x, HOPPER.y, 1.6)), s["rubber"], "hull")
for dx, dy, lx, ly in ((0.33, 0, 0.04, 0.68), (-0.33, 0, 0.04, 0.68), (0, 0.33, 0.68, 0.04), (0, -0.33, 0.68, 0.04)):
    piece(kit.box((lx, ly, 0.05), (HOPPER.x + dx, HOPPER.y + dy, 1.655)), s["hazard"], "hull")
for dx in (-0.2, 0.2):
    piece(kit.beam((HOPPER.x + dx, HOPPER.y + 0.05, 0.97), (HOPPER.x + dx, -1.33, 0.62), 0.06), s["iron"], "hull")

# The conveyor, swung down into place from against the wall.
along = (CONVEYOR_HIGH - CONVEYOR_LOW).normalized()
for dy in (0.2, -0.2):
    piece(kit.beam(CONVEYOR_LOW + Vector((0, dy, -0.04)), CONVEYOR_HIGH + Vector((0, dy, -0.04)), 0.09, width=0.06),
          s["iron"], "conveyor", bevel=0.01)
piece(kit.beam(CONVEYOR_LOW + Vector((0, 0, 0.0)), CONVEYOR_HIGH, 0.025, width=0.36), s["rubber"], "conveyor")
for i in range(6):
    p = CONVEYOR_LOW.lerp(CONVEYOR_HIGH, (i + 0.5) / 6) + Vector((0, 0, -0.035))
    piece(kit.rod((p.x, p.y - 0.23, p.z), (p.x, p.y + 0.23, p.z), 0.03, segments=6), s["iron"], "conveyor")
for t in (0.25, 0.6):
    p = CONVEYOR_LOW.lerp(CONVEYOR_HIGH, t)
    for dy in (0.18, -0.18):
        piece(kit.beam((p.x, p.y + dy, p.z - 0.06), (p.x + 0.08, p.y + dy, 0.09), 0.045), s["iron"], "conveyor")
for t in (0.2, 0.47, 0.74):
    p = CONVEYOR_LOW.lerp(CONVEYOR_HIGH, t) + Vector((0, rng.uniform(-0.08, 0.08), 0.05))
    size = (rng.uniform(0.09, 0.14), rng.uniform(0.08, 0.13), rng.uniform(0.05, 0.08))
    piece(kit.box(size, p, rot("Z", rng.uniform(0, 90)) @ rot("Y", -math.degrees(math.asin(along.z)))),
          s["plate"], "conveyor")

# -- the far faces: pipes and plates for the silhouette --------------------

for face in ("-X", "+Y"):
    wall_plate(face, -0.95, -0.05, 0.48, 1.4, s["plate"], spin=1.0)
    wall_plate(face, 0.05, 0.95, 0.48, 1.4, s["paint"] if face == "+Y" else s["plate"], painted=face == "+Y",
               spin=-1.5)
    for z in (0.7, 1.1):
        a, b = on_wall(face, -0.95, z, 0.16), on_wall(face, 0.95, z, 0.16)
        piece(kit.rod(a, b, 0.05, segments=6), s["iron"], "hull")
        for u in (-0.5, 0.5):
            piece(kit.box((0.14, 0.05, 0.12), on_wall(face, u, z, 0.08), wall_rotation(face)), s["iron"], "hull")

# -- corners: the landing legs -----------------------------------------------

for name, (sx, sy) in CORNERS.items():
    bone = f"leg.{name}"
    mount, foot = leg_mount(sx, sy), leg_foot(sx, sy)
    knee = Vector((sx * 1.5, sy * 1.5, 0.6))
    across = Vector((-sy, sx, 0)).normalized()
    piece(kit.box((0.28, 0.4, 0.4), (sx * 1.08, sy * 1.08, 0.9), rot("Z", 45 * sx * sy)), s["iron"], "hull",
          bevel=0.03)
    piece(kit.beam(mount, knee, 0.19, width=0.21), s["paint"], bone, painted=True, bevel=0.03)
    piece(kit.beam(knee, foot, 0.15), s["iron"], bone, bevel=0.025)
    piece(kit.rod(knee - across * 0.14, knee + across * 0.14, 0.105, segments=10), s["iron"], bone)
    ram_base = Vector((sx * 1.3, sy * 1.3, 0.36))
    piece(kit.rod(ram_base, ram_base.lerp(knee, 0.55), 0.06, segments=8), s["iron"], bone)
    piece(kit.rod(ram_base.lerp(knee, 0.5), knee, 0.035, segments=6), s["iron"], bone)
    piece(kit.box((0.38, 0.38, 0.07), (foot.x, foot.y, 0.115), rot("Z", 45)), s["iron"], bone, bevel=0.018)
    # Bolted through the apron -- where anyone can see the bolts.
    for k in range(4 if name != "BL" else 0):
        a = math.radians(45 + 90 * k)
        p = Vector((foot.x + math.cos(a) * 0.15, foot.y + math.sin(a) * 0.15, 0.15))
        piece(kit.rod(p, p + Vector((0, 0, 0.04)), 0.03, segments=5), s["iron"], bone)

# -- the deck -----------------------------------------------------------------

RAIL = 1.13
for (a, b) in (((RAIL, -0.85), (RAIL, 0.85)), ((-0.85, -RAIL), (0.85, -RAIL)), ((RAIL, -0.85), (0.85, -RAIL))):
    for z in (DECK + 0.14, DECK + 0.27):
        piece(kit.beam((a[0], a[1], z), (b[0], b[1], z), 0.03), s["hazard"], "hull")
for x, y in ((RAIL, -0.85), (RAIL, -0.28), (RAIL, 0.28), (RAIL, 0.85), (-0.85, -RAIL), (-0.28, -RAIL),
             (0.28, -RAIL), (0.85, -RAIL)):
    piece(kit.beam((x, y, DECK), (x, y, DECK + 0.29), 0.04), s["iron"], "hull")
# Hazard marking along the deck's two edges the camera sees, under the rail:
# the deck is the largest face the game camera gets of the building.
for a, b in (((1.17, -0.8), (1.17, 0.8)), ((-0.8, -1.17), (0.8, -1.17))):
    piece(kit.beam((a[0], a[1], DECK + 0.006), (b[0], b[1], DECK + 0.006), 0.012, width=0.12), s["hazard"], "hull")

# A furnace vent, glowing through its bars, and the hammers either side of it.
VENT = Vector((0.55, -0.45))
piece(kit.box((0.56, 0.44, 0.1), (VENT.x, VENT.y, DECK + 0.03)), s["iron"], "hull", bevel=0.015)
piece(kit.box((0.46, 0.34, 0.02), (VENT.x, VENT.y, DECK + 0.075)), lamp, "hull")
for k in range(6):
    x = VENT.x - 0.2 + k * 0.08
    piece(kit.beam((x, VENT.y - 0.19, DECK + 0.1), (x, VENT.y + 0.19, DECK + 0.1), 0.03, width=0.025), s["grate"],
          "hull")
for name, x in (("hammer.A", 0.12), ("hammer.B", 0.98)):
    piece(kit.rod((x, -0.45, DECK), (x, -0.45, DECK + 0.2), 0.075, segments=10), s["iron"], "hull")
    piece(kit.rod((x, -0.45, DECK + 0.18), (x, -0.45, DECK + 0.38), 0.035, segments=8), s["iron"], name)
    piece(kit.box((0.13, 0.13, 0.06), (x, -0.45, DECK + 0.39)), s["plate"], name, bevel=0.012)

# Salvage waiting on deck: crates, gas bottles, a hatch.
piece(kit.box((0.32, 0.28, 0.2), (0.8, 0.72, DECK + 0.1), rot("Z", 8)), s["plate"], "hull", bevel=0.015)
piece(kit.box((0.22, 0.2, 0.16), (0.78, 0.7, DECK + 0.28), rot("Z", -14)), s["iron"], "hull", bevel=0.012)
piece(kit.box((0.26, 0.3, 0.18), (0.5, 0.95, DECK + 0.09), rot("Z", 30)), s["canvas"], "hull", bevel=0.03)
for k, (x, y) in enumerate(((0.95, 0.25), (1.0, 0.1), (0.88, 0.12))):
    piece(kit.rod((x, y, DECK), (x, y, DECK + 0.32), 0.05, segments=8), s["iron"], "hull")
    piece(kit.rod((x, y, DECK + 0.32), (x, y, DECK + 0.36), 0.03, segments=6), s["rubber"], "hull")
piece(kit.rod((0.55, 0.1, DECK - 0.01), (0.55, 0.1, DECK + 0.03), 0.17, segments=12), s["iron"], "hull")
piece(kit.beam((0.42, 0.1, DECK + 0.05), (0.68, 0.1, DECK + 0.05), 0.025), s["iron"], "hull")
piece(kit.beam((0.55, -0.03, DECK + 0.05), (0.55, 0.23, DECK + 0.05), 0.025), s["iron"], "hull")

# ---------------------------------------------------------------------------
# The tower.
# ---------------------------------------------------------------------------

piece(kit.prism(kit.octagon(TOWER_HALF, 0.17), DECK - 0.05, 2.36, top_scale=0.88, centre=TOWER), s["plate"], "tower",
      bevel=0.025)
for sx, sy in CORNERS.values():
    a = Vector((TOWER.x + sx * 0.64, TOWER.y + sy * 0.64, DECK))
    b = Vector((TOWER.x + sx * 0.38, TOWER.y + sy * 0.38, 2.0))
    piece(kit.beam(a, b, 0.09), s["iron"], "tower", bevel=0.012)

# Slit windows on the faces the camera sees, each under an iron louvre.
for axis in ("x", "y"):
    for u in (-0.2, 0.0, 0.2):
        if axis == "x":
            centre, size, cap = (TOWER.x + 0.485, TOWER.y + u, 2.0), (0.03, 0.07, 0.22), (0.07, 0.12, 0.03)
            cap_at = (TOWER.x + 0.5, TOWER.y + u, 2.13)
        else:
            centre, size, cap = (TOWER.x + u, TOWER.y - 0.485, 2.0), (0.07, 0.03, 0.22), (0.12, 0.07, 0.03)
            cap_at = (TOWER.x + u, TOWER.y - 0.5, 2.13)
        piece(kit.box(size, centre), lamp, "tower")
        piece(kit.box(cap, cap_at), s["iron"], "tower")

# The cab, in the owner's paint -- the thing on the map that says whose base it is.
piece(kit.prism(kit.octagon(0.62, 0.2), 2.36, 2.74, top_scale=0.94, centre=TOWER), s["paint"], "tower",
      painted=True, bevel=0.02)
for axis in ("x", "y"):
    if axis == "x":
        piece(kit.box((0.03, 0.7, 0.09), (TOWER.x + 0.605, TOWER.y, 2.55)), lamp, "tower")
        piece(kit.box((0.14, 0.82, 0.04), (TOWER.x + 0.62, TOWER.y, 2.625), rot("Y", 18)), s["iron"], "tower",
              bevel=0.008)
        for u in (-0.2, 0.2):
            piece(kit.box((0.04, 0.03, 0.12), (TOWER.x + 0.61, TOWER.y + u, 2.55)), s["iron"], "tower")
    else:
        piece(kit.box((0.7, 0.03, 0.09), (TOWER.x, TOWER.y - 0.605, 2.55)), lamp, "tower")
        piece(kit.box((0.82, 0.14, 0.04), (TOWER.x, TOWER.y - 0.62, 2.625), rot("X", 18)), s["iron"], "tower",
              bevel=0.008)
        for u in (-0.2, 0.2):
            piece(kit.box((0.03, 0.04, 0.12), (TOWER.x + u, TOWER.y - 0.61, 2.55)), s["iron"], "tower")
piece(kit.prism(kit.octagon(0.58, 0.18), 2.74, 2.88, top_scale=0.7, centre=TOWER), s["iron"], "tower", bevel=0.015)
piece(kit.box((0.2, 0.2, 0.1), (TOWER.x, TOWER.y, 2.92)), s["iron"], "tower", bevel=0.01)
for dx, dy, top in ((-0.4, 0.35, 3.45), (-0.35, 0.42, 3.25)):
    piece(kit.rod((TOWER.x + dx, TOWER.y + dy, 2.74), (TOWER.x + dx, TOWER.y + dy, top), 0.016, segments=4),
          s["iron"], "tower")

# The mast, its dish and its lamp.
piece(kit.rod((TOWER.x, TOWER.y, 2.92), (TOWER.x, TOWER.y, 3.9), 0.05, segments=6, radius_end=0.028), s["iron"],
      "mast")
piece(kit.beam((TOWER.x - 0.24, TOWER.y, 3.5), (TOWER.x + 0.24, TOWER.y, 3.5), 0.03), s["iron"], "mast")
piece(kit.beam((TOWER.x, TOWER.y - 0.18, 3.72), (TOWER.x, TOWER.y + 0.18, 3.72), 0.026), s["iron"], "mast")
piece(kit.beam((TOWER.x, TOWER.y, 3.2), (TOWER.x + 0.22, TOWER.y, 3.2), 0.04), s["iron"], "dish")
piece(kit.rod((TOWER.x + 0.2, TOWER.y, 3.2), (TOWER.x + 0.32, TOWER.y, 3.2), 0.03, segments=10, radius_end=0.28),
      s["plate"], "dish")
piece(kit.rod((TOWER.x + 0.3, TOWER.y, 3.2), (TOWER.x + 0.48, TOWER.y, 3.2), 0.014, segments=4), s["iron"], "dish")
piece(kit.ellipsoid((0.06, 0.06, 0.06), (TOWER.x, TOWER.y, 3.93), segments=8, rings=5), lamp, "beacon.mast")

# The exhaust stacks.
for name, (x, y, top, r) in {"stack.A": (-1.0, 0.85, 3.05, 0.15), "stack.B": (-1.05, 0.4, 2.6, 0.115)}.items():
    piece(kit.rod((x, y, DECK - 0.05), (x, y, top), r, segments=10), s["iron"], name)
    piece(kit.rod((x, y, DECK - 0.05), (x, y, DECK + 0.2), r + 0.05, segments=10), s["ceramic"], name)
    for z in (DECK + 0.45, top - 0.5):
        piece(kit.rod((x, y, z), (x, y, z + 0.06), r + 0.02, segments=10), s["plate"], name)
    piece(kit.rod((x, y, top - 0.28), (x, y, top - 0.16), r + 0.015, segments=10), s["paint"], name, painted=True)
    piece(kit.rod((x, y, top), (x, y, top + 0.08), r + 0.035, segments=10, radius_end=r + 0.02), s["iron"], name)
    piece(kit.rod((x, y, top + 0.07), (x, y, top + 0.085), r - 0.02, segments=10), s["rubber"], name)

body = kit.join(parts, "body")
print("bastion geometry:", kit.report(col))

# ---------------------------------------------------------------------------
# Textures, then into the unit box.
# ---------------------------------------------------------------------------

surfaces.unwrap(body, kit)
images = surfaces.bake(body, kit, "bastion", size=TEXTURE_SIZE)
surfaces.save_images(images, os.path.join(PREVIEW_DIR, "textures"))

kit.bind(body, rig)
rig.scale = (1 / FOOTPRINT,) * 3

# ---------------------------------------------------------------------------
# Clips. Positions in tiles, before the rig is shrunk; rotations as in kit.clip.
# ---------------------------------------------------------------------------

# Construction, scrubbed by progress: frame 0 is a site just marked out, the last
# frame the finished building standing at rest. 120 frames so progress has
# resolution; its duration in seconds means nothing.
BUILD = 120
# Low enough that the hull reads as hanging over its own apron. At six tiles it
# sat so far up the screen that it looked like a second building behind.
DROP = 3.2
build = {
    "hull": {0: [("loc", (0, 0, DROP))], 16: [("loc", (0, 0, DROP))], 58: [("loc", (0, 0, 0.3))],
             64: [("loc", (0, 0, -0.04))], 70: []},
    "thrusters": {0: [("loc", (0, 0, -0.78))], 58: [("loc", (0, 0, -0.78))], 66: []},
    "tower": {0: [("loc", (0, 0, -1.36))], 70: [("loc", (0, 0, -1.36))], 90: []},
    "mast": {0: [("stretch", 0.06)], 86: [("stretch", 0.06)], 100: []},
    "stack.A": {0: [("stretch", 0.2)], 72: [("stretch", 0.2)], 86: []},
    "stack.B": {0: [("stretch", 0.2)], 78: [("stretch", 0.2)], 92: []},
    "ramp": {0: [("Y", -80)], 94: [("Y", -80)], 106: []},
    "conveyor": {0: [("Y", 72)], 98: [("Y", 72)], 110: []},
    "beacon.mast": {0: [("scale", 0.0)], 100: [("scale", 0.0)], 104: []},
    "beacon.L": {0: [("scale", 0.0)], 106: [("scale", 0.0)], 110: []},
    "beacon.R": {0: [("scale", 0.0)], 106: [("scale", 0.0)], 110: []},
}
for k, name in enumerate(("BR", "FR", "BL", "FL")):
    start = k * 3
    build[f"apron.{name}"] = {0: [("loc", (0, 0, -0.14))], start: [("loc", (0, 0, -0.14))], start + 9: []}
for name, (sx, sy) in CORNERS.items():
    # About the horizontal axis across the leg's corner: positive swings the
    # foot in under the hull, where it rides until just before touchdown.
    across = (-sy, sx, 0)
    build[f"leg.{name}"] = {0: [(across, 38), ("stretch", 0.6)], 44: [(across, 38), ("stretch", 0.6)],
                            57: [(across, -4)], 62: []}
kit.track_clip(rig, "build", BUILD, build)

kit.track_clip(rig, "idle", 90, {
    "dish": {0: [("Z", -40)], 45: [("Z", 40)], 90: [("Z", -40)]},
    "beacon.mast": {0: [], 40: [], 43: [("scale", 0.25)], 50: [("scale", 0.25)], 53: [], 90: []},
})

SPIN = {0: [], 15: [("Z", 90)], 30: [("Z", 180)], 45: [("Z", 270)], 60: [("Z", 360)]}
kit.track_clip(rig, "produce", 60, {
    "dish": {0: [("Z", -40)], 30: [("Z", 40)], 60: [("Z", -40)]},
    "beacon.L": SPIN,
    "beacon.R": {f: [("Z", -e[0][1])] if e else [] for f, e in SPIN.items()},
    "hammer.A": {0: [], 6: [("loc", (0, 0, -0.14))], 10: [], 30: [], 36: [("loc", (0, 0, -0.14))], 40: [], 60: []},
    "hammer.B": {0: [], 15: [], 21: [("loc", (0, 0, -0.14))], 25: [], 45: [], 51: [("loc", (0, 0, -0.14))], 55: [],
                 60: []},
}, linear=("beacon.L", "beacon.R"))

kit.track_clip(rig, "release", 45, {
    "shutter": {0: [], 10: [("stretch", 0.1)], 32: [("stretch", 0.1)], 45: []},
    "beacon.L": {0: [], 15: [("Z", 90)], 30: [("Z", 180)], 45: [("Z", 270)]},
    "beacon.R": {0: [], 15: [("Z", -90)], 30: [("Z", -180)], 45: [("Z", -270)]},
}, linear=("beacon.L", "beacon.R"))

stats = kit.report(col)
print("bastion:", stats)
print("wrote", kit.export_rigged(col, CONTENT_ID))
print("wrote", kit.save_blend(CONTENT_ID))

if os.environ.get("RTS_PREVIEWS", "1") != "0":
    os.makedirs(PREVIEW_DIR, exist_ok=True)

    def pose(action, frame):
        return lambda: kit.set_pose(rig, bpy.data.actions[action], frame)

    print("previews", kit.previews(
        col, PREVIEW_DIR, "bastion", views=((35, -45), (35, 135), (20, -70)), frame=1.75,
        poses=[
            ("build25", pose("build", 30)),
            ("build50", pose("build", 60)),
            ("build75", pose("build", 90)),
            ("release", pose("release", 20)),
        ],
    ))
