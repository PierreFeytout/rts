"""
The Outrider -- the Ashen Directorate's scout. Content id: vanguard.scout.

    blender -b --factory-startup --python scripts/models/outrider.py

WHAT IT IS (UNIVERSE.md)
------------------------
A survey trike: the runabout a prospecting crew rides out ahead of the
drop-hulls to flag the ground the Tender will lower onto. One fat wheel out in
front on a long fork, two under a flat bed behind, and a survey mast with a
beacon on it so the crew could find each other across a sector. The Ashen
Directorate kept the trikes and the doctrine; it only changed what is on the
bed: the instruments came off, a rivet driver went onto the bars on a pintle,
and a Conscript in a half-frame rides it.

  - **The trike is older than the war**: a tubular spine, servo rams on the
    fork and the swingarms, an engine block between the rear wheels with its
    exhaust bent up past the rider, fat ribbed tyres for clinker.
  - **The bed carries what a scout needs**: a fuel drum with a hazard band, a
    toolbox, and the survey mast -- kept, because the beacon is how the
    Contract Office knows where its scouts are.
  - **The cowl over the front wheel is issued**, and painted; so are the bed's
    side plates. The frame, the engine and the wheels never are.
  - **The rider is a Conscript** hunched over the bars in the frame's upper
    half: the same hood, lens and pauldrons, the same contract number.
  - **The weapon is the same rivet driver**, on a pintle over the bars, firing
    straight ahead at whatever the trike is pointed at.

WHY IT IS BUILT LIKE THIS
-------------------------
Silhouette first: long and low, one big wheel leading, a rider crouched over
it, and a thin mast with a lamp standing up behind -- the tallest narrow thing
on any light unit, so a scout reads as a scout at any zoom. Everything else is
for the portrait and for the player who zooms in.

Built from rigid pieces, each weighted to one bone (kit.rigid_part), in the
vehicle surfaces (surfaces.py): the figure's frame and rubber, the structures'
cold steel for what was cut off a hull. The wheels are bones so they turn; the
fork, the gun and the rider are bones so they can work, kick and lean.

Blender axes: +X forward, +Y left, +Z up, one unit is one tile.
"""

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import kit  # noqa: E402
import surfaces  # noqa: E402

CONTENT_ID = "vanguard.scout"
PREVIEW_DIR = os.environ.get("RTS_PREVIEW_DIR", os.path.join(kit.REPO, "art", "previews"))
TEXTURE_SIZE = int(os.environ.get("RTS_TEXTURE_SIZE", "1024"))

kit.fresh_scene()
col = kit.collection("Outrider")
s = surfaces.vehicle_surfaces(scale=1.3)
lamp = kit.directorate_palette()["lamp"]


def rot(axis, degrees):
    return Matrix.Rotation(math.radians(degrees), 3, axis)


# ---------------------------------------------------------------------------
# Proportions, in tiles, at true size: 0.86 long over the wheels, a wheelbase
# of half a tile. The front wheel is the biggest single thing on it.
# ---------------------------------------------------------------------------

WHEEL_R, REAR_R = 0.11, 0.09
# Tread blocks stand a little proud of the tyre, so the axle sits that much up.
FRONT = Vector((0.3, 0.0, WHEEL_R + 0.012))
REAR_X, REAR_Y, REAR_Z = -0.2, 0.19, REAR_R + 0.012
CROWN = Vector((0.15, 0.0, 0.33))
SEAT = Vector((-0.06, 0.0, 0.27))
MAST = Vector((-0.3, 0.1))
GUN_Z = 0.41

bones = [
    ("root", (0, 0, 0), (0, 0, 0.3), None),
    ("hull", (-0.05, 0, 0.12), (-0.05, 0, 0.3), "root"),
    ("fork", tuple(CROWN), tuple(FRONT), "hull"),
    ("wheel.F", (FRONT.x, -0.05, FRONT.z), (FRONT.x, 0.05, FRONT.z), "fork"),
    ("wheel.L", (REAR_X, REAR_Y - 0.05, REAR_Z), (REAR_X, REAR_Y + 0.05, REAR_Z), "hull"),
    ("wheel.R", (REAR_X, -REAR_Y - 0.05, REAR_Z), (REAR_X, -REAR_Y + 0.05, REAR_Z), "hull"),
    ("gun", (0.12, 0, GUN_Z), (0.4, 0, GUN_Z), "hull"),
    ("rider", (SEAT.x, 0, SEAT.z), (0.03, 0, 0.42), "hull"),
    ("head", (0.04, 0, 0.43), (0.06, 0, 0.5), "rider"),
    ("mast", (MAST.x, MAST.y, 0.28), (MAST.x, MAST.y, 0.7), "hull"),
    ("beacon", (MAST.x, MAST.y, 0.7), (MAST.x, MAST.y, 0.76), "mast"),
]
rig = kit.armature("rig", col, bones)

parts = []
count = [0]


def piece(bm, mat, bone, painted=False, bevel=None, segments=1):
    count[0] += 1
    obj = kit.rigid_part(f"{bone}.{count[0]}", bm, mat, col, bone, painted=painted)
    if bevel is not None:
        kit.bevel(obj, width=bevel, segments=segments)
    parts.append(obj)
    return obj


def box(size, centre, mat, bone, rotation=None, **kw):
    return piece(kit.box(size, centre, rotation), mat, bone, **kw)


def wheel(bone, centre, radius, width, treads):
    """A fat off-road wheel: tyre, tread blocks round it, rim and hub."""
    c = Vector(centre)
    piece(kit.rod(c + Vector((0, -width / 2, 0)), c + Vector((0, width / 2, 0)), radius, segments=14), s["rubber"],
          bone)
    for k in range(treads):
        a = k * 360 / treads
        p = c + Vector((math.cos(math.radians(a)) * (radius - 0.002), 0, math.sin(math.radians(a)) * (radius - 0.002)))
        box((0.026, width + 0.006, 0.018), p, s["rubber"], bone, rot("Y", -a))
    piece(kit.rod(c + Vector((0, -width / 2 - 0.004, 0)), c + Vector((0, width / 2 + 0.004, 0)), radius * 0.62,
                  segments=10), s["iron"], bone)
    piece(kit.rod(c + Vector((0, -width / 2 - 0.012, 0)), c + Vector((0, width / 2 + 0.012, 0)), radius * 0.26,
                  segments=8), s["servo"], bone)
    for k in range(5):
        a = math.radians(k * 72)
        p = c + Vector((math.cos(a) * radius * 0.42, width / 2 + 0.008, math.sin(a) * radius * 0.42))
        piece(kit.rod(p, p + Vector((0, 0.006, 0)), 0.006, segments=5), s["servo"], bone)


# ---------------------------------------------------------------------------
# The front wheel, its fork, and the issued cowl over it.
# ---------------------------------------------------------------------------

wheel("wheel.F", FRONT, WHEEL_R, 0.08, 10)

for sy in (1, -1):
    top = Vector((CROWN.x, sy * 0.06, CROWN.z))
    axle = Vector((FRONT.x, sy * 0.064, FRONT.z))
    piece(kit.beam(top, axle, 0.02, width=0.016), s["iron"], "fork", bevel=0.004)
    # The ram that lets the wheel work over clinker, outside the blade.
    piece(kit.rod(top + Vector((0.02, sy * 0.012, -0.02)), axle.lerp(top, 0.35) + Vector((0.016, sy * 0.012, 0)),
                  0.009, segments=6), s["servo"], "fork")
    piece(kit.rod(top + Vector((0.02, sy * 0.012, -0.03)), top + Vector((0.02, sy * 0.012, 0.0)), 0.013, segments=6),
          s["iron"], "fork")
    piece(kit.rod(axle + Vector((0, sy * 0.01, 0)), axle + Vector((0, sy * 0.022, 0)), 0.014, segments=6),
          s["iron"], "fork")
box((0.05, 0.15, 0.03), CROWN, s["iron"], "fork", bevel=0.006)
# The cowl: three plates over the wheel, issued and painted, with the lamp
# hung under its lip.
box((0.12, 0.11, 0.016), (FRONT.x, 0, FRONT.z + WHEEL_R + 0.03), s["paint"], "fork", painted=True, bevel=0.005)
box((0.09, 0.11, 0.016), (FRONT.x + 0.085, 0, FRONT.z + WHEEL_R - 0.005), s["paint"], "fork", rot("Y", 42),
    painted=True, bevel=0.005)
box((0.09, 0.11, 0.016), (FRONT.x - 0.085, 0, FRONT.z + WHEEL_R - 0.005), s["paint"], "fork", rot("Y", -42),
    painted=True, bevel=0.005)
box((0.03, 0.05, 0.03), (FRONT.x + 0.06, 0, FRONT.z + WHEEL_R + 0.04), s["iron"], "fork", bevel=0.005)
box((0.008, 0.042, 0.022), (FRONT.x + 0.078, 0, FRONT.z + WHEEL_R + 0.04), lamp, "fork")
# Handlebars, risers and grips.
for sy in (1, -1):
    piece(kit.rod((CROWN.x, sy * 0.04, CROWN.z + 0.015), (CROWN.x + 0.01, sy * 0.05, CROWN.z + 0.05), 0.009,
                  segments=6), s["iron"], "fork")
piece(kit.rod((CROWN.x + 0.01, -0.15, CROWN.z + 0.05), (CROWN.x + 0.01, 0.15, CROWN.z + 0.05), 0.008, segments=6),
      s["iron"], "fork")
for sy in (1, -1):
    piece(kit.rod((CROWN.x + 0.01, sy * 0.1, CROWN.z + 0.05), (CROWN.x + 0.01, sy * 0.155, CROWN.z + 0.05), 0.011,
                  segments=6), s["rubber"], "fork")
    box((0.02, 0.016, 0.03), (CROWN.x + 0.03, sy * 0.115, CROWN.z + 0.04), s["servo"], "fork", rot("X", sy * 20))

# ---------------------------------------------------------------------------
# The chassis: a tubular spine, the engine, the rear wheels on their
# swingarms, and the bed with what the scout carries.
# ---------------------------------------------------------------------------

piece(kit.beam((CROWN.x - 0.02, 0, CROWN.z - 0.02), (-0.34, 0, 0.2), 0.04, width=0.05), s["iron"], "hull",
      bevel=0.006)
piece(kit.beam((CROWN.x - 0.02, 0, CROWN.z - 0.03), (-0.02, 0, 0.12), 0.03), s["iron"], "hull", bevel=0.005)
piece(kit.beam((-0.02, 0, 0.12), (-0.24, 0, 0.1), 0.03), s["iron"], "hull", bevel=0.005)
for sy in (1, -1):
    box((0.15, 0.06, 0.012), (0.02, sy * 0.115, 0.1), s["grate"], "hull")
    piece(kit.beam((0.02, sy * 0.03, 0.115), (0.02, sy * 0.12, 0.1), 0.014), s["iron"], "hull")
    box((0.02, 0.05, 0.02), (0.1, sy * 0.115, 0.11), s["hazard"], "hull")

# The engine between the rear wheels: a block, two heads, the exhaust bent up
# past the rider and a heat shield where a leg would touch it.
box((0.14, 0.12, 0.12), (-0.09, 0, 0.15), s["iron"], "hull", bevel=0.008)
for sy in (1, -1):
    piece(kit.rod((-0.12, sy * 0.06, 0.17), (-0.03, sy * 0.1, 0.17), 0.03, segments=8), s["servo"], "hull")
    piece(kit.rod((-0.03, sy * 0.1, 0.17), (-0.01, sy * 0.1, 0.17), 0.034, segments=8), s["iron"], "hull")
for k in range(3):
    box((0.11, 0.1, 0.006), (-0.09, 0, 0.215 + k * 0.012), s["ceramic"], "hull")
piece(kit.rod((-0.1, -0.11, 0.13), (-0.2, -0.14, 0.15), 0.013, segments=7), s["iron"], "hull")
piece(kit.rod((-0.2, -0.14, 0.15), (-0.27, -0.13, 0.36), 0.013, segments=7), s["iron"], "hull")
piece(kit.rod((-0.27, -0.13, 0.36), (-0.3, -0.13, 0.4), 0.017, segments=7), s["iron"], "hull")
piece(kit.rod((-0.3, -0.13, 0.395), (-0.305, -0.13, 0.404), 0.013, segments=7), s["rubber"], "hull")
box((0.08, 0.016, 0.07), (-0.16, -0.155, 0.19), s["ceramic"], "hull", rot("Y", -10), bevel=0.004)

# Rear wheels on their swingarms, with a ram to each.
for bone, sy in (("wheel.L", 1), ("wheel.R", -1)):
    wheel(bone, (REAR_X, sy * REAR_Y, REAR_Z), REAR_R, 0.07, 8)
    axle = Vector((REAR_X, sy * (REAR_Y - 0.05), REAR_Z))
    piece(kit.beam((-0.06, sy * 0.13, 0.15), axle, 0.022, width=0.016), s["iron"], "hull", bevel=0.004)
    piece(kit.rod((-0.12, sy * 0.15, 0.25), axle + Vector((0.02, 0, 0.02)), 0.009, segments=6), s["servo"], "hull")
    piece(kit.rod((-0.12, sy * 0.15, 0.22), (-0.12, sy * 0.15, 0.26), 0.013, segments=6), s["iron"], "hull")
    piece(kit.rod(axle, axle + Vector((0, sy * 0.06, 0)), 0.012, segments=6), s["iron"], "hull")

# The bed: a plate deck, painted side plates, a hazard edge at the back, the
# drum, the toolbox, and the contract number where the officer reads it.
box((0.2, 0.3, 0.02), (-0.27, 0, 0.2), s["plate"], "hull", bevel=0.005)
for sy in (1, -1):
    box((0.2, 0.012, 0.06), (-0.27, sy * 0.155, 0.23), s["paint"], "hull", painted=True, bevel=0.004)
    for x in (-0.34, -0.27, -0.2):
        piece(kit.rod((x, sy * 0.158, 0.24), (x, sy * 0.166, 0.24), 0.005, segments=5), s["servo"], "hull")
box((0.014, 0.3, 0.05), (-0.372, 0, 0.225), s["hazard"], "hull")
box((0.06, 0.05, 0.03), (-0.39, 0, 0.19), s["iron"], "hull", bevel=0.005)
box((0.008, 0.09, 0.05), (-0.378, 0.1, 0.24), s["ceramic"], "hull")
piece(kit.rod((-0.28, 0.07, 0.21), (-0.28, 0.07, 0.33), 0.048, segments=10), s["plate"], "hull", bevel=0.005)
piece(kit.rod((-0.28, 0.07, 0.255), (-0.28, 0.07, 0.275), 0.05, segments=10), s["hazard"], "hull")
piece(kit.rod((-0.28, 0.07, 0.33), (-0.28, 0.07, 0.34), 0.03, segments=8), s["iron"], "hull")
piece(kit.rod((-0.28, 0.07, 0.34), (-0.28, 0.07, 0.35), 0.014, segments=6), s["rubber"], "hull")
for z in (0.23, 0.31):
    box((0.11, 0.11, 0.008), (-0.28, 0.07, z), s["leather"], "hull")
box((0.1, 0.09, 0.06), (-0.25, -0.09, 0.24), s["iron"], "hull", bevel=0.005)
box((0.1, 0.09, 0.008), (-0.25, -0.09, 0.274), s["plate"], "hull", bevel=0.003)
box((0.02, 0.07, 0.01), (-0.25, -0.09, 0.28), s["hazard"], "hull")
# The seat, on its post.
box((0.14, 0.09, 0.03), (SEAT.x, 0, SEAT.z - 0.01), s["leather"], "hull", bevel=0.006)
piece(kit.rod((SEAT.x, 0, 0.22), (SEAT.x, 0, SEAT.z - 0.02), 0.014, segments=6), s["servo"], "hull")

# ---------------------------------------------------------------------------
# The survey mast and its beacon: the tallest thing on the trike, and the
# whole reason a scout reads as a scout from the air.
# ---------------------------------------------------------------------------

box((0.05, 0.05, 0.04), (MAST.x, MAST.y, 0.27), s["iron"], "hull", bevel=0.005)
piece(kit.rod((MAST.x, MAST.y, 0.28), (MAST.x, MAST.y, 0.7), 0.008, segments=6), s["iron"], "mast")
piece(kit.beam((MAST.x, MAST.y - 0.06, 0.6), (MAST.x, MAST.y + 0.06, 0.6), 0.01), s["iron"], "mast")
box((0.04, 0.04, 0.05), (MAST.x, MAST.y, 0.5), s["plate"], "mast", bevel=0.004)
box((0.006, 0.03, 0.02), (MAST.x + 0.022, MAST.y, 0.5), lamp, "mast")
piece(kit.rod((MAST.x, MAST.y + 0.05, 0.6), (MAST.x, MAST.y + 0.05, 0.82), 0.003, segments=4), s["iron"], "mast")
piece(kit.rod((MAST.x, MAST.y, 0.7), (MAST.x, MAST.y, 0.71), 0.016, segments=8), s["iron"], "mast")
piece(kit.ellipsoid((0.02, 0.02, 0.022), (MAST.x, MAST.y, 0.73), segments=8, rings=5), lamp, "beacon")
box((0.012, 0.05, 0.036), (MAST.x - 0.02, MAST.y, 0.735), s["iron"], "beacon")

# ---------------------------------------------------------------------------
# The rivet driver on its pintle over the bars.
# ---------------------------------------------------------------------------

piece(kit.rod((0.12, 0, 0.34), (0.12, 0, GUN_Z - 0.02), 0.012, segments=6), s["servo"], "hull")
piece(kit.rod((0.12, 0, GUN_Z - 0.02), (0.12, 0, GUN_Z), 0.016, segments=8), s["iron"], "gun")
box((0.13, 0.03, 0.04), (0.2, 0, GUN_Z), s["plate"], "gun", bevel=0.004)
box((0.1, 0.026, 0.01), (0.2, 0, GUN_Z + 0.025), s["iron"], "gun")
piece(kit.rod((0.17, -0.015, GUN_Z - 0.032), (0.17, 0.015, GUN_Z - 0.032), 0.024, segments=10), s["iron"], "gun")
piece(kit.rod((0.17, -0.019, GUN_Z - 0.032), (0.17, 0.019, GUN_Z - 0.032), 0.009, segments=6), s["servo"], "gun")
piece(kit.rod((0.26, 0, GUN_Z + 0.004), (0.35, 0, GUN_Z + 0.004), 0.014, segments=10), s["iron"], "gun")
for x in (0.275, 0.295):
    box((0.012, 0.02, 0.008), (x, 0, GUN_Z + 0.018), s["rubber"], "gun")
for x in (0.32, 0.34):
    piece(kit.rod((x - 0.004, 0, GUN_Z + 0.004), (x + 0.004, 0, GUN_Z + 0.004), 0.018, segments=8), lamp, "gun")
piece(kit.rod((0.35, 0, GUN_Z + 0.004), (0.43, 0, GUN_Z + 0.004), 0.008, segments=8), s["servo"], "gun")
box((0.028, 0.024, 0.024), (0.44, 0, GUN_Z + 0.004), s["iron"], "gun", bevel=0.004)
box((0.04, 0.018, 0.016), (0.22, 0, GUN_Z + 0.04), s["plate"], "gun", bevel=0.003)
box((0.005, 0.012, 0.01), (0.242, 0, GUN_Z + 0.04), lamp, "gun")
box((0.02, 0.012, 0.012), (0.22, 0, GUN_Z + 0.028), s["iron"], "gun")

# ---------------------------------------------------------------------------
# The rider: a Conscript from the waist up, in the frame's half-harness,
# crouched over the bars. The legs are on the pegs and belong to the hull;
# the torso leans with the bike and the head looks around.
# ---------------------------------------------------------------------------

for sy in (1, -1):
    y = sy * 0.07
    piece(kit.beam((SEAT.x - 0.02, y, SEAT.z), (0.05, sy * 0.1, 0.19), 0.04), s["iron"], "hull", bevel=0.005)
    box((0.014, 0.05, 0.07), (0.0, sy * 0.1, 0.24), s["plate"], "hull", rot("Y", -40), bevel=0.004)
    piece(kit.rod((0.05, sy * 0.08, 0.19), (0.05, sy * 0.125, 0.19), 0.02, segments=8), s["servo"], "hull")
    piece(kit.beam((0.05, sy * 0.1, 0.19), (0.02, sy * 0.115, 0.125), 0.032), s["iron"], "hull", bevel=0.004)
    box((0.012, 0.046, 0.055), (0.05, sy * 0.115, 0.155), s["plate"], "hull", rot("Y", 6), bevel=0.003)
    box((0.08, 0.05, 0.028), (0.03, sy * 0.115, 0.125), s["plate"], "hull", bevel=0.005)
    box((0.09, 0.054, 0.01), (0.03, sy * 0.115, 0.107), s["rubber"], "hull")

# Torso, leaning into the bars.
piece(kit.beam((SEAT.x, 0, SEAT.z + 0.01), (0.04, 0, 0.41), 0.075, width=0.09), s["iron"], "rider", bevel=0.01)
box((0.02, 0.092, 0.07), (0.035, 0, 0.36), s["paint"], "rider", rot("Y", -40), painted=True, bevel=0.006)
box((0.012, 0.086, 0.07), (-0.07, 0, 0.35), s["ceramic"], "rider", rot("Y", -40), bevel=0.004)
box((0.04, 0.1, 0.07), (-0.1, 0, 0.36), s["plate"], "rider", rot("Y", -40), bevel=0.006)
for y in (0.03, -0.03):
    box((0.008, 0.02, 0.04), (-0.122, y, 0.35), lamp, "rider", rot("Y", -40))
    piece(kit.rod((-0.1, y * 1.5, 0.39), (-0.115, y * 1.5, 0.43), 0.01, segments=6), s["iron"], "rider")
piece(kit.rod((0.04, 0, 0.4), (0.05, 0, 0.42), 0.034, segments=10), s["servo"], "rider")
piece(kit.rod((0.05, 0, 0.42), (0.052, 0, 0.428), 0.028, segments=8), s["rubber"], "rider")
for sy in (1, -1):
    piece(kit.rod((0.04, sy * 0.05, 0.405), (0.04, sy * 0.09, 0.4), 0.024, segments=8), s["servo"], "rider")
    box((0.08, 0.05, 0.065), (0.04, sy * 0.11, 0.385), s["paint"], "rider", rot("X", -14 * sy), painted=True,
        bevel=0.008, segments=2)
    box((0.084, 0.016, 0.012), (0.04, sy * 0.12, 0.352), s["iron"], "rider", rot("X", -20 * sy), bevel=0.003)
    # Arms out to the grips.
    shoulder = Vector((0.04, sy * 0.08, 0.4))
    elbow = Vector((0.11, sy * 0.13, 0.4))
    hand = Vector((CROWN.x + 0.02, sy * 0.115, CROWN.z + 0.065))
    piece(kit.rod(shoulder, elbow, 0.017, segments=6, radius_end=0.014), s["servo"], "rider")
    box((0.034, 0.036, 0.038), shoulder.lerp(elbow, 0.42), s["plate"], "rider", bevel=0.005)
    piece(kit.rod(elbow + Vector((0, -0.012 * sy, 0)), elbow + Vector((0, 0.012 * sy, 0)), 0.016, segments=8),
          s["servo"], "rider")
    piece(kit.rod(elbow, hand, 0.013, segments=6, radius_end=0.011), s["servo"], "rider")
    box((0.046, 0.032, 0.032), elbow.lerp(hand, 0.45), s["plate"], "rider", bevel=0.004)
    box((0.024, 0.022, 0.024), hand, s["iron"], "rider", bevel=0.004)

# The hood: a sealed welder's helmet, lens burning ember, one aerial.
box((0.06, 0.062, 0.056), (0.05, 0, 0.47), s["plate"], "head", bevel=0.014, segments=2)
piece(kit.ellipsoid((0.031, 0.032, 0.02), (0.048, 0, 0.494), segments=8, rings=4), s["iron"], "head")
box((0.016, 0.056, 0.048), (0.085, 0, 0.468), s["paint"], "head", rot("Y", -10), painted=True, bevel=0.005)
box((0.01, 0.052, 0.012), (0.092, 0, 0.48), s["iron"], "head", rot("Y", -16))
box((0.006, 0.044, 0.011), (0.094, 0, 0.472), lamp, "head")
piece(kit.rod((0.08, 0, 0.448), (0.1, 0, 0.446), 0.013, segments=8), s["servo"], "head")
for y in (0.033, -0.033):
    box((0.026, 0.008, 0.026), (0.05, y, 0.466), s["servo"], "head", bevel=0.004)
piece(kit.rod((0.036, 0.03, 0.492), (0.03, 0.036, 0.53), 0.0035, segments=5), s["iron"], "head")
piece(kit.rod((0.03, 0.036, 0.527), (0.029, 0.037, 0.534), 0.005, segments=5), lamp, "head")

kit.ground_check(parts)
body = kit.join(parts, "body")
print("outrider geometry:", kit.report(col))

# ---------------------------------------------------------------------------
# Textures, then the size it is drawn at.
# ---------------------------------------------------------------------------

surfaces.unwrap(body, kit)
images = surfaces.bake(body, kit, "outrider", size=TEXTURE_SIZE)
surfaces.save_images(images, os.path.join(PREVIEW_DIR, "textures"))

kit.bind(body, rig)
# A little larger than life, like the Conscript, so a scout is more than a
# speck at playing zoom -- but less so: it is meant to be small.
SCALE = 1.15
rig.scale = (SCALE, SCALE, SCALE)

# ---------------------------------------------------------------------------
# Clips. Rotations in armature axes: about Y, positive tips a forward-pointing
# thing down and rolls a wheel forward; about Z, positive turns left.
# ---------------------------------------------------------------------------

# Standing: the engine shakes the whole trike, the rider looks about, and the
# beacon blinks twice a cycle. The beacon is scaled away between blinks, and
# so has to be keyed on every frame listed, or it comes back at rest size.
IDLE = 60
idle = {}
for f in range(0, IDLE + 1, 3):
    shake = 0.0025 if (f // 3) % 2 else -0.0025
    idle[f] = {
        "hull": [("loc", (0, 0, shake))],
        "beacon": [("scale", 1.0 if f in (12, 15, 42, 45) else 0.0)],
    }
idle[0]["head"] = idle[IDLE]["head"] = []
idle[18]["head"] = [("Z", 14)]
idle[33]["head"] = [("Z", -10), ("Y", 3)]
idle[48]["head"] = [("Z", 4)]
kit.clip(rig, "idle", IDLE, idle)

# Under way: the wheels turn, one full turn in twelve frames, the fork works
# over the ground, the rider leans in and the beacon stays lit.
TURN = {f: [("Y", f * 30)] for f in range(0, 13, 3)}
kit.track_clip(rig, "walk", 12, {
    "wheel.F": TURN,
    "wheel.L": TURN,
    "wheel.R": TURN,
    "hull": {0: [("loc", (0, 0, 0)), ("Y", 1.5)], 3: [("loc", (0, 0, 0.006)), ("Y", 1.5)],
             6: [("loc", (0, 0, 0)), ("Y", 1.5)], 9: [("loc", (0, 0, 0.005)), ("Y", 1.5)],
             12: [("loc", (0, 0, 0)), ("Y", 1.5)]},
    "fork": {0: [("Y", -1)], 6: [("Y", 1.5)], 12: [("Y", -1)]},
    "rider": {0: [("Y", 4)], 12: [("Y", 4)]},
    "head": {0: [("Y", -3)], 12: [("Y", -3)]},
    "beacon": {0: [], 12: []},
}, linear=("wheel.F", "wheel.L", "wheel.R"))

# Firing: the driver kicks up on its pintle, the rider braces against the
# bars and the front end lifts a hair on its fork.
kit.track_clip(rig, "fire", 10, {
    "gun": {0: [], 1: [("Y", -16)], 3: [("Y", -9)], 6: [("Y", -3)], 10: []},
    "rider": {0: [], 1: [("Y", -7)], 4: [("Y", -3)], 10: []},
    "head": {0: [], 1: [("Y", 2)], 10: []},
    "fork": {0: [], 1: [("Y", -2)], 5: [], 10: []},
    "hull": {0: [], 2: [("Y", -1.5)], 6: [], 10: []},
    "beacon": {0: [], 10: []},
})

kit.rest_pose(rig)
stats = kit.report(col)
print("outrider:", stats)
print("wrote", kit.export_rigged(col, CONTENT_ID))
print("wrote", kit.save_blend(CONTENT_ID))

if os.environ.get("RTS_PREVIEWS", "1") != "0":
    os.makedirs(PREVIEW_DIR, exist_ok=True)

    def pose(action, frame):
        return lambda: kit.set_pose(rig, bpy.data.actions[action], frame)

    print("previews", kit.previews(col, PREVIEW_DIR, "outrider", frame=1.4, poses=[
        ("walk", pose("walk", 3)),
        ("fire-kick", pose("fire", 1)),
    ]))
