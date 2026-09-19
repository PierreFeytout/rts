"""
The Foundry -- the Ashen Directorate's armoury. Content id: vanguard.foundry.

    blender -b --factory-startup --python scripts/models/foundry.py

From its sheet in UNIVERSE.md. It was a section of a mobile smelter, cut out of
a hauler's hull with its crucible still in it; it is the sector's armoury, where
plate is poured and pressed and whatever comes out walks or drives away. It
trains Conscripts, Outriders and Breakers. It has to read as industry, never as
command:

  - a long, low hall under a gantry crane, the crane's hook hanging through a
    slot in the roof where the forge light shows;
  - at one end the crucible house, taller, with two stacks; in its open bay
    the crucible on its trunnions, a furnace mouth glowing behind it, ceramic
    heat tiles around;
  - along the -Y face a runner and a line of moulds glowing with poured metal,
    and a forging press;
  - on the +X face a vehicle door big enough for a Breaker, in a painted
    frame, with a beacon over it;
  - the module's chassis on thruster bells and short anchor legs, on a
    rockcrete apron, with plate stock stacked on the apron.

Paint: the crane, the door frame, the roof. The camera looks from +X and -Y.

ANIMATION. `build`: the apron rises, the module comes down folded flat on its
thrusters and anchors, the walls rise one after another, the roof panels swing
closed like wings, the gantry runs up, the stacks extend, the beacon lights.
`idle`: the hook sways. `produce`: the crucible tips and pours, the crane runs
the length of the hall and lowers its hook, the press strikes. `release`: the
doors swing open on the lit hall and close, the beacon turning.

Built in tiles at its real footprint and shrunk into the unit box at the end.
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

CONTENT_ID = "vanguard.foundry"
FOOTPRINT = 3
PREVIEW_DIR = os.environ.get("RTS_PREVIEW_DIR", os.path.join(kit.REPO, "art", "previews"))
TEXTURE_SIZE = int(os.environ.get("RTS_TEXTURE_SIZE", "2048"))

kit.fresh_scene()
col = kit.collection("Foundry")
s = surfaces.structure_surfaces(scale=6.0)
lamp = kit.directorate_palette()["lamp"]
rng = random.Random(11)


def rot(axis, degrees):
    return Matrix.Rotation(math.radians(degrees), 3, axis)


def rect(x0, x1, y0, y1, c=0.0):
    """A rectangle with its corners cut back by `c`, anticlockwise, for kit.prism."""
    return [(x1, y0 + c), (x1, y1 - c), (x1 - c, y1), (x0 + c, y1), (x0, y1 - c), (x0, y0 + c), (x0 + c, y0),
            (x1 - c, y0)]


# ---------------------------------------------------------------------------
# Proportions, in tiles. The footprint is +-1.5.
# ---------------------------------------------------------------------------

DECK = 0.24
# The hall, between the crucible house and the door.
HX0, HX1 = -0.72, 1.3
HY0, HY1 = -0.8, 0.55
HMID = (HY0 + HY1) / 2
EAVE = 1.0
SLOT = (-0.2, 0.02)
# The crucible house.
KX0, KX1, KY0, KY1, KTOP = -1.36, -0.72, -0.35, 0.88, 1.55
CRUCIBLE = Vector((-1.04, -0.7, 0.72))
DOOR = (-0.55, 0.3)
DOOR_TOP = 0.9
GANTRY_X = (-0.62, 1.22)
GANTRY_Y = (-0.9, 0.66)
RAIL = 1.32
PRESS = Vector((0.75, -0.98))

CORNERS = {"FR": (1.22, -1.0, 1, -1), "FL": (1.22, 0.82, 1, 1), "BL": (-1.3, 0.82, -1, 1), "BR": (-1.3, -1.0, -1, -1)}
COLUMNS = {"W": -1.0, "C": 0.0, "E": 1.0}
THRUSTERS = [(1.0, -0.55), (1.0, 0.3), (-1.1, 0.0), (-1.1, 0.7)]
STACKS = {"stack.A": (-1.18, 0.62, 2.75, 0.12), "stack.B": (-0.9, 0.7, 2.4, 0.1)}

# ---------------------------------------------------------------------------
# Skeleton.
# ---------------------------------------------------------------------------

bones = [
    ("root", (0, 0, 0), (0, 0, 0.5), None),
    ("hull", (0, 0, 0.1), (0, 0, 1.0), "root"),
    ("thrusters", (0, 0, 0.1), (0, 0, 0.5), "hull"),
    ("wall.S", (0.29, HY0, DECK), (0.29, HY0, EAVE), "hull"),
    ("wall.N", (0.29, HY1, DECK), (0.29, HY1, EAVE), "hull"),
    ("wall.E", (HX1, HMID, DECK), (HX1, HMID, EAVE), "hull"),
    ("roof.S", (0.29, HY0, EAVE), (0.29, SLOT[0], EAVE), "wall.S"),
    ("roof.N", (0.29, HY1, EAVE), (0.29, SLOT[1], EAVE), "wall.N"),
    ("door.R", (HX1 + 0.04, DOOR[0], DECK), (HX1 + 0.04, DOOR[0], DOOR_TOP), "wall.E"),
    ("door.L", (HX1 + 0.04, DOOR[1], DECK), (HX1 + 0.04, DOOR[1], DOOR_TOP), "wall.E"),
    ("beacon", (HX1 + 0.08, HMID, EAVE + 0.06), (HX1 + 0.08, HMID, EAVE + 0.25), "wall.E"),
    ("crucible", tuple(CRUCIBLE), (CRUCIBLE.x, CRUCIBLE.y, 1.1), "hull"),
    ("pour", (CRUCIBLE.x, -1.07, 0.72), (CRUCIBLE.x, -1.04, 0.3), "hull"),
    ("press", (PRESS.x, PRESS.y, 0.95), (PRESS.x, PRESS.y, 0.55), "hull"),
    ("gantry", (0.3, HMID, DECK), (0.3, HMID, RAIL), "hull"),
    ("bridge", (0.3, HMID, RAIL + 0.06), (0.3, HMID + 0.4, RAIL + 0.06), "gantry"),
    ("hook", (0.3, -0.09, RAIL + 0.1), (0.3, -0.09, 0.95), "bridge"),
]
for name, (x, y, top, r) in STACKS.items():
    bones.append((name, (x, y, KTOP), (x, y, top), "hull"))
for name, (x, y, sx, sy) in CORNERS.items():
    bones.append((f"leg.{name}", (x, y, 0.22), (x + sx * 0.13, y + sy * 0.13, 0.12), "hull"))
for name, x in COLUMNS.items():
    bones.append((f"apron.{name}", (x, 0, 0), (x, 0, 0.3), "root"))
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


# ---------------------------------------------------------------------------
# The apron, and the plate stock waiting on it.
# ---------------------------------------------------------------------------

for name, x in COLUMNS.items():
    for y in (-1.0, 0.0, 1.0):
        lift = rng.uniform(-0.01, 0.012)
        tilt = rot("X", rng.uniform(-0.7, 0.7)) @ rot("Y", rng.uniform(-0.7, 0.7))
        hidden = y == 0.0 and x < 0.5
        box((0.96, 0.96, 0.08), (x, y, 0.04 + lift), s["rockcrete"], f"apron.{name}", tilt,
            bevel=None if hidden else 0.014)

# Hazard marking the length of the two apron edges the camera sees.
box((0.16, 2.9, 0.012), (1.41, 0.0, 0.086), s["hazard"], "apron.E")
for name, x in COLUMNS.items():
    box((0.96, 0.16, 0.012), (x, -1.41, 0.086), s["hazard"], f"apron.{name}")

for (x, y, bone, turn) in ((1.38, 0.8, "apron.E", 90), (0.32, -1.3, "apron.C", 0)):
    for k in range(5):
        box((0.36, 0.2, 0.024), (x + rng.uniform(-0.02, 0.02), y + rng.uniform(-0.02, 0.02), 0.095 + k * 0.027),
            s["plate"] if k % 2 else s["iron"], bone, rot("Z", turn + rng.uniform(-6, 6)), bevel=0.005)
    box((0.04, 0.24, 0.16), (x, y, 0.16), s["iron"], bone, rot("Z", turn))

# ---------------------------------------------------------------------------
# The chassis: a drop-rated deck on thruster bells and anchor legs.
# ---------------------------------------------------------------------------

piece(kit.prism(rect(-1.38, 1.3, -1.08, 0.9, 0.12), 0.1, DECK, top_scale=1.0), s["iron"], "hull", bevel=0.02)
for x, y in THRUSTERS:
    piece(kit.rod((x, y, 0.16), (x, y, 0.07), 0.1, segments=10, radius_end=0.14), s["iron"], "hull")
    piece(kit.rod((x, y, 0.72), (x, y, 0.12), 0.13, segments=8, radius_end=0.03), lamp, "thrusters")
# Hazard edging along the two faces the camera sees.
box((2.5, 0.05, 0.03), (-0.04, -1.07, DECK + 0.005), s["hazard"], "hull")
box((0.05, 1.8, 0.03), (1.29, -0.09, DECK + 0.005), s["hazard"], "hull")

for name, (x, y, sx, sy) in CORNERS.items():
    bone = f"leg.{name}"
    foot = Vector((x + sx * 0.13, y + sy * 0.13, 0.12))
    box((0.14, 0.2, 0.16), (x, y, 0.19), s["iron"], "hull", rot("Z", 45 * sx * sy), bevel=0.015)
    piece(kit.beam((x, y, 0.2), foot, 0.1, width=0.12), s["plate"], bone, bevel=0.015)
    box((0.17, 0.17, 0.05), (foot.x, foot.y, 0.105), s["iron"], bone, rot("Z", 45), bevel=0.01)
    if name != "BL":
        for k in range(3):
            a = math.radians(90 * k + 45)
            p = Vector((foot.x + math.cos(a) * 0.06, foot.y + math.sin(a) * 0.06, 0.13))
            piece(kit.rod(p, p + Vector((0, 0, 0.03)), 0.022, segments=5), s["iron"], bone)

# ---------------------------------------------------------------------------
# The crucible house.
# ---------------------------------------------------------------------------

piece(kit.prism(rect(KX0, KX1, KY0, KY1, 0.06), DECK, KTOP, top_scale=0.97,
                centre=(0, 0)), s["plate"], "hull", bevel=0.03)
piece(kit.prism(rect(KX0 - 0.04, KX1 + 0.04, KY0 - 0.04, KY1 + 0.04, 0.08), KTOP - 0.02, KTOP + 0.06,
                top_scale=0.98), s["iron"], "hull", bevel=0.015)

# The furnace mouth behind the crucible, in a ceramic surround.
box((0.4, 0.02, 0.34), (CRUCIBLE.x, KY0 - 0.005, 0.56), lamp, "hull")
for dx in (-0.25, 0.25):
    box((0.1, 0.08, 0.48), (CRUCIBLE.x + dx, KY0 - 0.03, 0.5), s["ceramic"], "hull", bevel=0.012)
box((0.6, 0.09, 0.1), (CRUCIBLE.x, KY0 - 0.035, 0.79), s["ceramic"], "hull", bevel=0.012)
for z in (0.97, 1.17, 1.37):
    for k in range(3):
        x = KX0 + 0.12 + k * 0.2
        box((0.18, 0.035, 0.17), (x, KY0 - 0.02, z), s["ceramic"], "hull", rot("Z", rng.uniform(-2, 2)),
            bevel=0.01)

# An extraction hood over the crucible, short enough that the game camera still
# sees into the bay. A full canopy hid the crucible entirely.
piece(kit.prism(rect(-0.26, 0.26, -0.2, 0.2, 0.05), 1.12, 1.3, top_scale=0.55, centre=(CRUCIBLE.x, KY0 - 0.2)),
      s["plate"], "hull", bevel=0.012)
box((0.56, 0.44, 0.04), (CRUCIBLE.x, KY0 - 0.2, 1.12), s["iron"], "hull", bevel=0.01)
piece(kit.rod((CRUCIBLE.x, KY0 - 0.2, 1.28), (CRUCIBLE.x, KY0 - 0.2, 1.46), 0.08, segments=8), s["iron"], "hull")
piece(kit.rod((CRUCIBLE.x, KY0 - 0.2, 1.44), (CRUCIBLE.x, KY0 + 0.1, KTOP + 0.02), 0.075, segments=8), s["iron"],
      "hull")
for dx in (-0.24, 0.24):
    piece(kit.beam((CRUCIBLE.x + dx, KY0, 1.3), (CRUCIBLE.x + dx, KY0 - 0.36, 1.14), 0.035), s["iron"], "hull")

# The house roof: a hatch, a ceramic patch, a work lamp and a ladder hoop.
piece(kit.rod((-1.14, 0.15, KTOP + 0.05), (-1.14, 0.15, KTOP + 0.09), 0.13, segments=10), s["iron"], "hull")
piece(kit.beam((-1.24, 0.15, KTOP + 0.11), (-1.04, 0.15, KTOP + 0.11), 0.025), s["iron"], "hull")
box((0.3, 0.26, 0.03), (-0.95, -0.15, KTOP + 0.07), s["ceramic"], "hull", rot("Z", 7), bevel=0.008)
box((0.07, 0.07, 0.09), (KX1 - 0.06, KY0 + 0.06, KTOP + 0.1), s["iron"], "hull")
box((0.05, 0.05, 0.04), (KX1 - 0.02, KY0 + 0.06, KTOP + 0.12), lamp, "hull")
for y in (0.6, 0.78):
    piece(kit.beam((KX0 + 0.05, y, KTOP + 0.06), (KX0 + 0.05, y, KTOP + 0.3), 0.025), s["iron"], "hull")
piece(kit.beam((KX0 + 0.05, 0.6, KTOP + 0.28), (KX0 + 0.05, 0.78, KTOP + 0.28), 0.025), s["iron"], "hull")

# A lit window above the hall roof, where the house's +X face is seen.
box((0.02, 0.5, 0.08), (KX1 + 0.005, 0.25, 1.36), lamp, "hull")
box((0.04, 0.58, 0.03), (KX1 + 0.02, 0.25, 1.42), s["iron"], "hull")
box((0.03, 0.3, 0.2), (KX1 + 0.01, -0.15, 1.3), s["ceramic"], "hull", bevel=0.008)

# Pipes on the far faces.
for y in (0.1, 0.55):
    piece(kit.rod((KX0 - 0.05, y, 0.3), (KX0 - 0.05, y, 1.45), 0.045, segments=6), s["iron"], "hull")
    for z in (0.6, 1.1):
        box((0.06, 0.08, 0.06), (KX0 - 0.02, y, z), s["iron"], "hull")

# The stacks.
for name, (x, y, top, r) in STACKS.items():
    piece(kit.rod((x, y, KTOP - 0.05), (x, y, top), r, segments=10), s["iron"], name)
    piece(kit.rod((x, y, KTOP), (x, y, KTOP + 0.2), r + 0.05, segments=10), s["ceramic"], name)
    piece(kit.rod((x, y, top - 0.5), (x, y, top - 0.44), r + 0.02, segments=10), s["plate"], name)
    piece(kit.rod((x, y, top), (x, y, top + 0.07), r + 0.03, segments=10, radius_end=r + 0.015), s["iron"], name)
    piece(kit.rod((x, y, top + 0.06), (x, y, top + 0.075), r - 0.02, segments=8), s["rubber"], name)

# ---------------------------------------------------------------------------
# The crucible on its trunnions, and the stream it pours.
# ---------------------------------------------------------------------------

for dx in (-0.33, 0.33):
    box((0.08, 0.12, 0.54), (CRUCIBLE.x + dx, CRUCIBLE.y, 0.51), s["iron"], "hull", bevel=0.01)
piece(kit.rod((CRUCIBLE.x - 0.37, CRUCIBLE.y, CRUCIBLE.z), (CRUCIBLE.x + 0.37, CRUCIBLE.y, CRUCIBLE.z), 0.035,
              segments=6), s["iron"], "hull")
c = CRUCIBLE
piece(kit.rod((c.x, c.y, 0.46), (c.x, c.y, 0.96), 0.19, segments=12, radius_end=0.25), s["iron"], "crucible")
for z, r in ((0.6, 0.235), (0.86, 0.26)):
    piece(kit.rod((c.x, c.y, z), (c.x, c.y, z + 0.05), r, segments=12), s["plate"], "crucible")
piece(kit.rod((c.x, c.y, 0.95), (c.x, c.y, 1.0), 0.275, segments=12), s["iron"], "crucible")
piece(kit.rod((c.x, c.y, 0.975), (c.x, c.y, 1.005), 0.22, segments=12), lamp, "crucible")
box((0.14, 0.12, 0.05), (c.x, c.y - 0.29, 0.98), s["iron"], "crucible", bevel=0.01)
for dx in (-0.26, 0.26):
    piece(kit.rod((c.x + dx * 0.8, c.y, c.z), (c.x + dx * 1.2, c.y, c.z), 0.06, segments=8), s["iron"], "crucible")
piece(kit.rod((c.x, -1.07, 0.72), (c.x + 0.01, -1.03, 0.3), 0.04, segments=6, radius_end=0.028), lamp, "pour")

# The runner and the moulds, glowing with what was poured into them.
piece(kit.beam((c.x, -0.95, 0.3), (-0.72, -0.95, 0.27), 0.06, width=0.1), s["iron"], "hull", bevel=0.008)
piece(kit.beam((c.x, -0.95, 0.335), (-0.72, -0.95, 0.305), 0.01, width=0.05), lamp, "hull")
for x in (-0.48, -0.22, 0.04):
    box((0.18, 0.15, 0.1), (x, -0.95, 0.29), s["iron"], "hull", bevel=0.012)
    box((0.12, 0.09, 0.01), (x, -0.95, 0.342), lamp, "hull")

# ---------------------------------------------------------------------------
# The forging press.
# ---------------------------------------------------------------------------

box((0.26, 0.2, 0.12), (PRESS.x, PRESS.y, DECK + 0.06), s["iron"], "hull", bevel=0.015)
for dx in (-0.15, 0.15):
    piece(kit.beam((PRESS.x + dx, PRESS.y, DECK), (PRESS.x + dx, PRESS.y, 1.02), 0.07), s["iron"], "hull", bevel=0.01)
box((0.42, 0.17, 0.11), (PRESS.x, PRESS.y, 1.03), s["plate"], "hull", bevel=0.015)
box((0.43, 0.02, 0.06), (PRESS.x, PRESS.y - 0.095, 1.03), s["hazard"], "hull")
piece(kit.rod((PRESS.x, PRESS.y, 0.98), (PRESS.x, PRESS.y, 0.62), 0.035, segments=6), s["iron"], "press")
box((0.2, 0.15, 0.16), (PRESS.x, PRESS.y, 0.56), s["plate"], "press", bevel=0.015)

# ---------------------------------------------------------------------------
# The hall.
# ---------------------------------------------------------------------------

piece(kit.box((HX1 - HX0 - 0.02, HY1 - HY0 - 0.02, 0.01), ((HX0 + HX1) / 2, HMID, DECK + 0.005)), s["rubber"],
      "hull")
# Forge light under the roof slot, which shows through it from above, and
# spilling toward the door, which shows when it opens.
box((0.12, DOOR[1] - DOOR[0] - 0.1, 0.01), (HX1 - 0.18, sum(DOOR) / 2, DECK + 0.012), lamp, "hull")
box((0.02, DOOR[1] - DOOR[0] - 0.2, 0.06), (HX1 - 0.4, sum(DOOR) / 2, 0.8), lamp, "hull")
box((1.5, 0.12, 0.01), (0.35, sum(SLOT) / 2, DECK + 0.012), lamp, "hull")

# -- the south wall, facing the camera --
length = HX1 - HX0
box((0.06, length, EAVE - DECK), ((HX0 + HX1) / 2, HY0, (DECK + EAVE) / 2), s["plate"], "wall.S", rot("Z", 90),
    bevel=0.02)
for x in (-0.45, -0.05, 0.35, 1.1):
    box((0.07, 0.05, EAVE - DECK - 0.04), (x, HY0 - 0.045, (DECK + EAVE) / 2), s["iron"], "wall.S", bevel=0.008)
for x in (-0.25, 0.15, 0.55, 0.92):
    box((0.2, 0.03, 0.12), (x, HY0 - 0.035, 0.86), s["iron"], "wall.S")
    box((0.15, 0.02, 0.07), (x, HY0 - 0.05, 0.86), lamp, "wall.S")
box((length - 0.04, 0.02, 0.08), ((HX0 + HX1) / 2, HY0 - 0.04, DECK + 0.07), s["hazard"], "wall.S")
# A light strip under the eave, the length of the hall.
box((length - 0.2, 0.012, 0.035), ((HX0 + HX1) / 2, HY0 - 0.04, EAVE - 0.05), lamp, "wall.S")
box((0.34, 0.025, 0.28), (0.72, HY0 - 0.045, 0.55), s["plate"], "wall.S", rot("Y", 5), bevel=0.008)
# The contract number goes on a ceramic plate.
box((0.22, 0.02, 0.14), (-0.25, HY0 - 0.04, 0.58), s["ceramic"], "wall.S", bevel=0.006)
for x in (0.15, 0.36):
    box((0.16, 0.03, 0.16), (x, HY0 - 0.04, 0.5), s["iron"], "wall.S", bevel=0.006)
    for k in range(4):
        box((0.13, 0.025, 0.012), (x, HY0 - 0.058, 0.445 + k * 0.035), s["grate"], "wall.S")
for x in (-0.6, -0.4, 0.95, 1.2):
    piece(kit.rod((x, HY0 - 0.03, 0.97), (x, HY0 - 0.055, 0.97), 0.02, segments=5), s["iron"], "wall.S")

# -- the north wall --
box((0.06, length, EAVE - DECK), ((HX0 + HX1) / 2, HY1, (DECK + EAVE) / 2), s["plate"], "wall.N", rot("Z", 90),
    bevel=0.02)
for x in (-0.3, 0.4, 1.0):
    box((0.07, 0.05, EAVE - DECK - 0.04), (x, HY1 + 0.045, (DECK + EAVE) / 2), s["iron"], "wall.N")
piece(kit.rod((HX0, HY1 + 0.09, 0.7), (HX1, HY1 + 0.09, 0.7), 0.045, segments=6), s["iron"], "wall.N")

# -- the east wall, with the vehicle door --
for y0, y1 in ((HY0, DOOR[0] - 0.06), (DOOR[1] + 0.06, HY1)):
    box((0.06, y1 - y0, EAVE - DECK), (HX1, (y0 + y1) / 2, (DECK + EAVE) / 2), s["plate"], "wall.E", bevel=0.015)
for y in (DOOR[0] - 0.06, DOOR[1] + 0.06):
    box((0.1, 0.12, DOOR_TOP - DECK + 0.04), (HX1 + 0.02, y, (DECK + DOOR_TOP) / 2 + 0.02), s["paint"], "wall.E",
        painted=True, bevel=0.015)
box((0.11, DOOR[1] - DOOR[0] + 0.26, EAVE - DOOR_TOP + 0.02), (HX1 + 0.02, HMID, (DOOR_TOP + EAVE) / 2 + 0.01),
    s["paint"], "wall.E", painted=True, bevel=0.015)
box((0.01, DOOR[1] - DOOR[0], DOOR_TOP - DECK), (HX1 - 0.02, HMID, (DECK + DOOR_TOP) / 2), s["rubber"], "wall.E")
# A light strip along the lintel, the width of the door.
box((0.012, DOOR[1] - DOOR[0] + 0.1, 0.035), (HX1 + 0.08, HMID, DOOR_TOP + 0.06), lamp, "wall.E")

for name, hinge, sign in (("door.R", DOOR[0], 1), ("door.L", DOOR[1], -1)):
    width = (DOOR[1] - DOOR[0]) / 2
    y = hinge + sign * width / 2
    box((0.05, width - 0.01, DOOR_TOP - DECK - 0.02), (HX1 + 0.04, y, (DECK + DOOR_TOP) / 2), s["plate"], name,
        bevel=0.012)
    for z in (0.42, 0.6, 0.78):
        box((0.02, width - 0.06, 0.03), (HX1 + 0.072, y, z), s["iron"], name)
    box((0.02, width - 0.04, 0.07), (HX1 + 0.07, y, DECK + 0.06), s["hazard"], name)

box((0.06, 0.07, 0.06), (HX1 + 0.08, HMID, EAVE + 0.03), s["iron"], "wall.E")
piece(kit.rod((HX1 + 0.08, HMID, EAVE + 0.06), (HX1 + 0.08, HMID, EAVE + 0.16), 0.035, segments=8), lamp, "beacon")
box((0.03, 0.09, 0.1), (HX1 + 0.035, HMID, EAVE + 0.11), s["iron"], "beacon")
piece(kit.rod((HX1 + 0.08, HMID, EAVE + 0.16), (HX1 + 0.08, HMID, EAVE + 0.19), 0.05, segments=8), s["iron"],
      "beacon")

box((0.06, 0.12, 0.18), (HX1 + 0.05, HY0 + 0.07, 0.6), s["iron"], "wall.E", bevel=0.01)
box((0.02, 0.05, 0.04), (HX1 + 0.085, HY0 + 0.07, 0.65), lamp, "wall.E")
box((0.02, 0.08, 0.03), (HX1 + 0.085, HY0 + 0.07, 0.56), s["hazard"], "wall.E")

# The ramp, off the sill onto the apron.
for y in (DOOR[0] + 0.04, DOOR[1] - 0.04):
    piece(kit.beam((HX1 + 0.04, y, DECK), (1.49, y, 0.09), 0.04, width=0.05), s["hazard"], "hull")
for t in (0.3, 0.7):
    x = HX1 + 0.04 + (1.49 - HX1 - 0.04) * t
    z = DECK + (0.09 - DECK) * t
    piece(kit.beam((x, DOOR[0] + 0.06, z), (x, DOOR[1] - 0.06, z), 0.02, width=0.05), s["grate"], "hull")

# -- the roof, in the owner's paint, open along a slot for the hook --
for name, y0, y1 in (("roof.S", HY0 - 0.06, SLOT[0]), ("roof.N", SLOT[1], HY1 + 0.06)):
    box((length + 0.08, y1 - y0, 0.05), ((HX0 + HX1) / 2, (y0 + y1) / 2, EAVE + 0.025), s["paint"], name,
        painted=True, bevel=0.015)
    for x in (-0.45, 0.05, 0.55, 1.05):
        box((0.04, y1 - y0 - 0.04, 0.035), (x, (y0 + y1) / 2, EAVE + 0.065), s["iron"], name)
    if name == "roof.N":
        for x in (-0.2, 0.75):
            piece(kit.rod((x, 0.33, EAVE + 0.05), (x, 0.33, EAVE + 0.17), 0.09, segments=10), s["iron"], name)
            piece(kit.rod((x, 0.33, EAVE + 0.17), (x, 0.33, EAVE + 0.22), 0.12, segments=10, radius_end=0.05),
                  s["plate"], name)
    edge = SLOT[0] if name == "roof.S" else SLOT[1]
    box((length, 0.035, 0.03), ((HX0 + HX1) / 2, edge, EAVE + 0.065), s["hazard"], name)

# ---------------------------------------------------------------------------
# The gantry crane.
# ---------------------------------------------------------------------------

for x in GANTRY_X:
    for y in GANTRY_Y:
        piece(kit.beam((x, y, DECK), (x, y, RAIL), 0.07), s["iron"], "gantry", bevel=0.01)
for y in GANTRY_Y:
    piece(kit.beam((GANTRY_X[0] - 0.08, y, RAIL), (GANTRY_X[1] + 0.08, y, RAIL), 0.07), s["iron"], "gantry",
          bevel=0.01)
    for x, dx in ((GANTRY_X[0], 0.18), (GANTRY_X[1], -0.18)):
        piece(kit.beam((x, y, RAIL - 0.2), (x + dx, y, RAIL - 0.02), 0.035), s["iron"], "gantry")

piece(kit.beam((0.3, GANTRY_Y[0] - 0.08, RAIL + 0.08), (0.3, GANTRY_Y[1] + 0.08, RAIL + 0.08), 0.09, width=0.1),
      s["paint"], "bridge", painted=True, bevel=0.012)
for y in GANTRY_Y:
    box((0.2, 0.1, 0.07), (0.3, y, RAIL + 0.03), s["paint"], "bridge", painted=True, bevel=0.01)
box((0.16, 0.2, 0.1), (0.3, -0.09, RAIL + 0.17), s["iron"], "bridge", bevel=0.012)
box((0.14, 0.14, 0.12), (0.3, 0.45, RAIL - 0.02), s["plate"], "bridge", bevel=0.01)

piece(kit.rod((0.3, -0.09, RAIL + 0.12), (0.3, -0.09, 1.0), 0.012, segments=4), s["iron"], "hook")
box((0.09, 0.09, 0.09), (0.3, -0.09, 0.97), s["iron"], "hook", bevel=0.01)
for a, b in (((0.3, -0.09, 0.93), (0.3, -0.09, 0.85)), ((0.3, -0.09, 0.85), (0.3, -0.04, 0.82)),
             ((0.3, -0.04, 0.82), (0.3, -0.01, 0.87))):
    piece(kit.beam(a, b, 0.025), s["iron"], "hook")

body = kit.join(parts, "body")
print("foundry geometry:", kit.report(col))

surfaces.unwrap(body, kit)
images = surfaces.bake(body, kit, "foundry", size=TEXTURE_SIZE)
surfaces.save_images(images, os.path.join(PREVIEW_DIR, "textures"))

kit.bind(body, rig)
rig.scale = (1 / FOOTPRINT,) * 3

# ---------------------------------------------------------------------------
# Clips. Positions in tiles before the rig is shrunk.
# ---------------------------------------------------------------------------

# Hidden in every clip: the stream only exists while the crucible pours.
NO_POUR = {"pour": {0: [("scale", 0.0)]}}

BUILD = 120
DROP = 2.6
build = {
    **NO_POUR,
    "hull": {0: [("loc", (0, 0, DROP))], 14: [("loc", (0, 0, DROP))], 52: [("loc", (0, 0, 0.25))],
             58: [("loc", (0, 0, -0.03))], 62: []},
    "thrusters": {0: [("loc", (0, 0, -0.6))], 54: [("loc", (0, 0, -0.6))], 60: []},
    # Folded flat onto the deck, one over another; they rise in the reverse order.
    "wall.E": {0: [("Y", -84)], 60: [("Y", -84)], 70: []},
    "wall.N": {0: [("X", 87)], 64: [("X", 87)], 74: []},
    "wall.S": {0: [("X", -90)], 68: [("X", -90)], 78: []},
    # Folded back along their walls; open like wings once the walls stand.
    "roof.S": {0: [("X", 90)], 78: [("X", 90)], 88: []},
    "roof.N": {0: [("X", -90)], 80: [("X", -90)], 90: []},
    "gantry": {0: [("stretch", 0.12)], 84: [("stretch", 0.12)], 96: []},
    "stack.A": {0: [("stretch", 0.2)], 80: [("stretch", 0.2)], 92: []},
    "stack.B": {0: [("stretch", 0.2)], 84: [("stretch", 0.2)], 96: []},
    "beacon": {0: [("scale", 0.0)], 100: [("scale", 0.0)], 104: []},
}
for k, name in enumerate(("W", "C", "E")):
    build[f"apron.{name}"] = {0: [("loc", (0, 0, -0.14))], k * 4: [("loc", (0, 0, -0.14))], k * 4 + 9: []}
for name, (x, y, sx, sy) in CORNERS.items():
    across = (-sy, sx, 0)
    build[f"leg.{name}"] = {0: [(across, 50), ("stretch", 0.6)], 42: [(across, 50), ("stretch", 0.6)],
                            54: [(across, -4)], 58: []}
kit.track_clip(rig, "build", BUILD, build)

kit.track_clip(rig, "idle", 90, {
    **NO_POUR,
    "hook": {0: [("X", -3)], 45: [("X", 3)], 90: [("X", -3)]},
})

# Three seconds: pour, run the crane down the hall and back, strike twice.
kit.track_clip(rig, "produce", 90, {
    "crucible": {0: [], 12: [("X", 42)], 40: [("X", 42)], 54: []},
    "pour": {0: [("scale", 0.0)], 14: [("scale", 0.0)], 18: [], 38: [], 42: [("scale", 0.0)], 90: [("scale", 0.0)]},
    "bridge": {0: [("loc", (-0.7, 0, 0))], 40: [("loc", (0.72, 0, 0))], 50: [("loc", (0.72, 0, 0))],
               90: [("loc", (-0.7, 0, 0))]},
    "hook": {0: [], 40: [], 46: [("loc", (0, 0, -0.3))], 52: [("loc", (0, 0, -0.3))], 58: [], 90: []},
    "press": {0: [], 22: [], 25: [("loc", (0, 0, -0.22))], 28: [("loc", (0, 0, -0.22))], 36: [], 66: [],
              69: [("loc", (0, 0, -0.22))], 72: [("loc", (0, 0, -0.22))], 80: [], 90: []},
})

kit.track_clip(rig, "release", 45, {
    **NO_POUR,
    "door.R": {0: [], 10: [("Z", -100)], 32: [("Z", -100)], 45: []},
    "door.L": {0: [], 10: [("Z", 100)], 32: [("Z", 100)], 45: []},
    "beacon": {0: [], 15: [("Z", 90)], 30: [("Z", 180)], 45: [("Z", 270)]},
}, linear=("beacon",))

# Where it smokes, for the game (the model README, "Smoke"): the mouth of
# each stack, in the unit box, Blender axes. The Foundry never goes cold.
rig["rts_smoke"] = [
    v
    for (x, y, top, r) in STACKS.values()
    for v in (x / FOOTPRINT, y / FOOTPRINT, (top + 0.09) / FOOTPRINT)
]

stats = kit.report(col)
print("foundry:", stats)
print("wrote", kit.export_rigged(col, CONTENT_ID))
print("wrote", kit.save_blend(CONTENT_ID))

if os.environ.get("RTS_PREVIEWS", "1") != "0":
    os.makedirs(PREVIEW_DIR, exist_ok=True)

    def pose(action, frame):
        return lambda: kit.set_pose(rig, bpy.data.actions[action], frame)

    # Standing, as the game shows it: the bind pose still has the pour in it.
    pose("idle", 0)()
    print("previews", kit.previews(
        col, PREVIEW_DIR, "foundry", views=((35, -45), (35, 135), (20, -70)), frame=1.4,
        poses=[
            ("build30", pose("build", 36)),
            ("build60", pose("build", 72)),
            ("build80", pose("build", 84)),
            ("produce", pose("produce", 26)),
            ("release", pose("release", 20)),
        ],
    ))
