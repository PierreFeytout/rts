"""
The Conscript -- the Ashen Directorate's line infantry. Content id: vanguard.trooper.

    blender -b --factory-startup --python scripts/models/conscript.py

"Numbered before named" (UNIVERSE.md). They were foundry hands, welders and
slag-sorters; the Directorate bought their contracts along with the salvage
rights, and gave them a weapon and a number, in that order. So nothing on them
is a uniform. It is what they wore at the foundry, reinforced:

  - a welder's visor for a helmet, painted in the owner's colour, with the
    lens glowing where the eyes are -- which is also what says which way a
    figure faces from the game camera;
  - a ceramic heat apron, bone-coloured, which stops shrapnel as well as sparks;
  - an ash filter over the mouth;
  - a rivet driver re-bored to fire white-hot bolts: long, held low and level,
    with its heating coils glowing near the muzzle. It sticks out far in front
    of the figure because range is this unit's whole identity, and at twenty
    pixels tall the length of the gun is the only way to say so.

Painted shoulder plates carry the team colour, as the visor does, because from
above those and the helmet are most of what is visible.

One entity is a squad of three, in a wedge. Rigid pieces, each weighted to one
bone -- see kit.rigid_part.

Blender axes: +X forward, +Y left, +Z up, one unit is one tile.
"""

import math
import os
import sys

import bpy
from mathutils import Matrix

sys.path.insert(0, os.path.dirname(__file__))
import kit  # noqa: E402

CONTENT_ID = "vanguard.trooper"
PREVIEW_DIR = os.environ.get("RTS_PREVIEW_DIR", os.path.join(kit.REPO, "art", "previews"))

kit.fresh_scene()
col = kit.collection("Conscript")
m = kit.directorate_palette()

# ---------------------------------------------------------------------------
# Skeleton. Built 0.45 tall -- hips at 0.2, shoulders at 0.35 -- and scaled below.
# ---------------------------------------------------------------------------

HIP, KNEE, ANKLE = 0.2, 0.105, 0.02
bones = [
    ("pelvis", (0, 0, HIP), (0, 0, 0.25), None),
    ("chest", (0, 0, 0.25), (0, 0, 0.36), "pelvis"),
    ("head", (0, 0, 0.36), (0, 0, 0.44), "chest"),
    # The gun and both arms, as one piece pivoting at the shoulder: a recoil is
    # the whole weapon kicking up, arms and all.
    ("rifle", (0, -0.03, 0.3), (0.2, -0.03, 0.3), "chest"),
]
for side, y in (("L", 0.03), ("R", -0.03)):
    bones.append((f"thigh.{side}", (0, y, HIP), (0, y, KNEE), "pelvis"))
    bones.append((f"shin.{side}", (0, y, KNEE), (0, y, ANKLE), f"thigh.{side}"))
rig = kit.armature("rig", col, bones)

parts = []


def piece(name, bm, mat, bone, painted=False, bevel=None):
    obj = kit.rigid_part(name, bm, mat, col, bone, painted=painted)
    if bevel is not None:
        kit.bevel(obj, width=bevel)
    parts.append(obj)
    return obj


# ---------------------------------------------------------------------------
# Legs: work trousers and heavy boots.
# ---------------------------------------------------------------------------

for side, y in (("L", 0.03), ("R", -0.03)):
    piece(f"thigh.{side}", kit.box((0.04, 0.037, 0.1), (0, y, 0.155)), m["iron"], f"thigh.{side}")
    piece(f"shin.{side}", kit.box((0.034, 0.032, 0.085), (0, y, 0.066)), m["iron"], f"shin.{side}")
    # Boots longer forward than back, so a stride reads as a stride.
    piece(f"boot.{side}", kit.box((0.062, 0.04, 0.03), (0.012, y, 0.015)), m["iron"], f"shin.{side}")

# ---------------------------------------------------------------------------
# Body: hips, torso, the ceramic apron in two plates so the legs can swing.
# ---------------------------------------------------------------------------

piece("hips", kit.box((0.062, 0.092, 0.05), (0, 0, 0.215)), m["iron"], "pelvis")
piece("apron.lower", kit.box((0.014, 0.078, 0.062), (0.042, 0, 0.19)), m["ceramic"], "pelvis", bevel=0.003)

piece("torso", kit.box((0.066, 0.1, 0.11), (0, 0, 0.3)), m["iron"], "chest")
piece("apron.upper", kit.box((0.016, 0.086, 0.1), (0.039, 0, 0.297)), m["ceramic"], "chest", bevel=0.004)
# The back plate is where the contract number is stencilled; bare ceramic here.
piece("backplate", kit.box((0.014, 0.07, 0.075), (-0.038, 0, 0.31)), m["ceramic"], "chest", bevel=0.003)

for side, sign in (("L", 1), ("R", -1)):
    tilt = Matrix.Rotation(math.radians(-22 * sign), 3, "X")
    piece(
        f"pauldron.{side}",
        kit.box((0.06, 0.04, 0.018), (0.002, 0.063 * sign, 0.352), rotation=tilt),
        m["paint"], "chest", painted=True, bevel=0.003,
    )

# ---------------------------------------------------------------------------
# Head: the welder's visor.
# ---------------------------------------------------------------------------

piece("helmet", kit.box((0.062, 0.058, 0.066), (0, 0, 0.397)), m["ceramic"], "head", bevel=0.006)
piece("visor", kit.box((0.012, 0.058, 0.048), (0.035, 0, 0.402)), m["paint"], "head", painted=True)
piece("lens", kit.box((0.005, 0.042, 0.009), (0.042, 0, 0.408)), m["lamp"], "head")
piece("filter", kit.cylinder(0.013, 0.022, segments=8, centre=(0.036, 0, 0.368), axis="X"), m["iron"], "head")

# ---------------------------------------------------------------------------
# The rivet driver, and the arms that hold it.
# ---------------------------------------------------------------------------

GUN_Y, GUN_Z = -0.03, 0.29
piece("receiver", kit.box((0.3, 0.022, 0.03), (0.1, GUN_Y, GUN_Z)), m["iron"], "rifle")
piece("barrel", kit.beam((0.25, GUN_Y, GUN_Z + 0.004), (0.35, GUN_Y, GUN_Z + 0.004), 0.014), m["iron"], "rifle")
piece("hopper", kit.box((0.045, 0.018, 0.045), (0.06, GUN_Y, GUN_Z - 0.03)), m["iron"], "rifle")
piece("stock", kit.box((0.055, 0.02, 0.034), (-0.075, GUN_Y, GUN_Z - 0.006)), m["iron"], "rifle")
for i, x in enumerate((0.265, 0.29, 0.315)):
    piece(f"coil.{i}", kit.cylinder(0.012, 0.007, segments=8, centre=(x, GUN_Y, GUN_Z + 0.004), axis="X"), m["lamp"], "rifle")

ARM = 0.024
# Right hand on the grip, left hand forward on the receiver.
piece("arm.R.upper", kit.beam((0, -0.064, 0.345), (-0.02, -0.062, 0.282), ARM), m["iron"], "rifle")
piece("arm.R.lower", kit.beam((-0.02, -0.062, 0.282), (0.035, GUN_Y, 0.28), ARM), m["iron"], "rifle")
piece("arm.L.upper", kit.beam((0, 0.064, 0.345), (0.045, 0.052, 0.292), ARM), m["iron"], "rifle")
piece("arm.L.lower", kit.beam((0.045, 0.052, 0.292), (0.15, GUN_Y + 0.008, GUN_Z), ARM), m["iron"], "rifle")

body = kit.join(parts, "body")
kit.bind(body, rig)

# Built at a comfortable size and enlarged here, on the armature alone -- the
# body is its child. At true scale beside a Servitor, from the game camera at a
# normal zoom, a squad was three grey specks; a soldier has to be drawn larger
# than life to be read at all.
SCALE = 1.35
rig.scale = (SCALE, SCALE, SCALE)

# ---------------------------------------------------------------------------
# The squad: a wedge, point forward, so the unit's facing reads even when all
# three are standing still. Phases spread so they do not step in unison.
# ---------------------------------------------------------------------------

# In tiles, at final size: the armature's scale does not apply to these.
rig["rts_squad"] = [
    0.16, 0.0, 0.0,
    -0.12, 0.21, 0.37,
    -0.12, -0.21, 0.71,
]

# ---------------------------------------------------------------------------
# Clips. Rotations in armature axes (see kit.pose_rotation):
#   about Y, positive tips an upright bone forward and a leg's foot back;
#   about Z, positive turns toward the figure's left.
# ---------------------------------------------------------------------------

# Standing: breathing, and a look around. Two seconds, so a crowd of these does
# not visibly cycle.
kit.clip(rig, "idle", 60, {
    0: {},
    20: {"chest": [("Y", -2)], "head": [("Z", 14)], "rifle": [("Y", 3)]},
    40: {"chest": [("Y", 1)], "head": [("Z", -10)], "rifle": [("Y", 2)]},
    60: {},
})

# A jog, timed for full speed: 2.4 tiles a second is fast for a figure this
# size, so the stride is long and the cycle short. The body leans in and the
# gun is held level against the lean.
LEAN = 7


def stride(front, back):
    return {
        f"thigh.{front}": [("Y", -32)], f"shin.{front}": [("Y", 8)],
        f"thigh.{back}": [("Y", 26)], f"shin.{back}": [("Y", 28)],
        "pelvis": [("Z", 5 if front == "R" else -5)],
        "chest": [("Y", LEAN), ("Z", -6 if front == "R" else 6)],
        "rifle": [("Y", -LEAN)],
    }


def passing(planted, lifting):
    return {
        f"thigh.{planted}": [("Y", 2)],
        f"thigh.{lifting}": [("Y", -12)], f"shin.{lifting}": [("Y", 60)],
        "chest": [("Y", LEAN + 2)],
        "rifle": [("Y", -LEAN + 2)],
    }


kit.clip(rig, "walk", 16, {
    0: stride("L", "R"),
    4: passing("L", "R"),
    8: stride("R", "L"),
    12: passing("R", "L"),
    16: stride("L", "R"),
})

# One bolt: the gun kicks up and the shoulders rock back, then settle. Short, so
# the recoil lands on the muzzle flash and is over well before the next shot.
kit.clip(rig, "fire", 9, {
    0: {},
    1: {"rifle": [("Y", -16)], "chest": [("Y", -7)], "head": [("Y", -4)]},
    4: {"rifle": [("Y", -5)], "chest": [("Y", -2)]},
    9: {},
})

stats = kit.report(col)
print("conscript:", stats)
print("wrote", kit.export_rigged(col, CONTENT_ID))
print("wrote", kit.save_blend(CONTENT_ID))

if os.environ.get("RTS_PREVIEWS", "1") != "0":
    os.makedirs(PREVIEW_DIR, exist_ok=True)

    def pose(action, frame):
        return lambda: kit.set_pose(rig, bpy.data.actions[action], frame)

    print("previews", kit.previews(col, PREVIEW_DIR, "conscript", poses=[
        ("walk0", pose("walk", 0)),
        ("walk4", pose("walk", 4)),
        ("fire1", pose("fire", 1)),
    ]))
