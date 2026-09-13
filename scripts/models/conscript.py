"""
The Conscript -- the Ashen Directorate's line infantry. Content id: vanguard.trooper.

    blender -b --factory-startup --python scripts/models/conscript.py

"Numbered before named" (UNIVERSE.md). They were foundry hands, welders and
slag-sorters; the Directorate bought their contracts along with the salvage
rights, and gave them a weapon and a number, in that order. So nothing on them
is a uniform. It is what they wore at the foundry, reinforced:

  - a welder's hood, a visor painted in the owner's colour, and the lens
    glowing where the eyes are -- which also says which way a figure faces;
  - a ceramic heat apron of overlapping bone-coloured tiles, which stops
    shrapnel as well as sparks, and ceramic pads on the knees and elbows;
  - an ash filter over the mouth, fed by a hose from canisters on the back;
  - a rivet driver re-bored to fire white-hot bolts: a drum of rivets, a
    vented shroud, heating coils glowing near the muzzle. It is long and held
    level because range is this unit's whole identity.

Built from rigid pieces, each weighted to one bone (kit.rigid_part), in
procedural surfaces baked to textures (surfaces.py). One entity is a squad of
three, in a wedge.

Blender axes: +X forward, +Y left, +Z up, one unit is one tile.
"""

import math
import os
import sys

import bpy
from mathutils import Matrix

sys.path.insert(0, os.path.dirname(__file__))
import kit  # noqa: E402
import surfaces  # noqa: E402

CONTENT_ID = "vanguard.trooper"
PREVIEW_DIR = os.environ.get("RTS_PREVIEW_DIR", os.path.join(kit.REPO, "art", "previews"))
TEXTURE_SIZE = int(os.environ.get("RTS_TEXTURE_SIZE", "1024"))

kit.fresh_scene()
col = kit.collection("Conscript")
s = surfaces.directorate_surfaces()
lamp = kit.directorate_palette()["lamp"]


def rot(axis, degrees):
    return Matrix.Rotation(math.radians(degrees), 3, axis)


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


def piece(name, bm, mat, bone, painted=False, bevel=None, segments=1):
    obj = kit.rigid_part(name, bm, mat, col, bone, painted=painted)
    if bevel is not None:
        kit.bevel(obj, width=bevel, segments=segments)
    parts.append(obj)
    return obj


# ---------------------------------------------------------------------------
# Legs: canvas trousers, ceramic knee pads, iron shin guards, hobnailed boots.
# ---------------------------------------------------------------------------

for side, y in (("L", 0.03), ("R", -0.03)):
    thigh, shin = f"thigh.{side}", f"shin.{side}"
    piece(f"{thigh}.leg", kit.frustum((0.034, 0.032), (0.044, 0.042), 0.104, 0.212, (0, y)),
          s["canvas"], thigh, bevel=0.007)
    piece(f"{thigh}.knee", kit.box((0.014, 0.032, 0.03), (0.02, y, 0.108)), s["ceramic"], thigh, bevel=0.005)
    piece(f"{thigh}.strap", kit.box((0.046, 0.046, 0.008), (0, y, 0.17)), s["leather"], thigh)

    piece(f"{shin}.leg", kit.frustum((0.03, 0.028), (0.035, 0.033), 0.03, 0.106, (0, y)),
          s["canvas"], shin, bevel=0.006)
    piece(f"{shin}.guard", kit.box((0.01, 0.03, 0.058), (0.019, y, 0.068), rotation=rot("Y", 4)),
          s["iron"], shin)
    piece(f"{shin}.boot", kit.frustum((0.066, 0.042), (0.046, 0.038), 0.006, 0.042, (0.012, y)),
          s["leather"], shin, bevel=0.008)
    piece(f"{shin}.toecap", kit.box((0.022, 0.044, 0.02), (0.038, y, 0.016)), s["iron"], shin, bevel=0.006)
    piece(f"{shin}.sole", kit.box((0.072, 0.046, 0.008), (0.012, y, 0.004)), s["rubber"], shin)

# ---------------------------------------------------------------------------
# Hips: belt, pouches, and the lower apron split for the legs.
# ---------------------------------------------------------------------------

piece("hips", kit.frustum((0.058, 0.086), (0.062, 0.094), 0.19, 0.245), s["canvas"], "pelvis", bevel=0.01)
piece("belt", kit.box((0.068, 0.1, 0.014), (0, 0, 0.238)), s["leather"], "pelvis")
piece("buckle", kit.box((0.006, 0.022, 0.014), (0.036, 0, 0.238)), s["iron"], "pelvis")
for y in (0.046, -0.046):
    piece(f"pouch{y}", kit.box((0.024, 0.02, 0.026), (0.018, y * 1.04, 0.224)), s["leather"], "pelvis")
    piece(f"pouch{y}.flap", kit.box((0.026, 0.022, 0.008), (0.018, y * 1.04, 0.236)), s["leather"], "pelvis")
for y in (0.021, -0.021):
    piece(f"apron.lower{y}", kit.box((0.01, 0.037, 0.05), (0.044, y, 0.198), rotation=rot("Y", -10)),
          s["ceramic"], "pelvis", bevel=0.004)

# ---------------------------------------------------------------------------
# Chest: canvas jacket under an apron of overlapping ceramic tiles, leather
# straps, and the filter canisters on the back.
# ---------------------------------------------------------------------------

piece("torso", kit.frustum((0.058, 0.088), (0.07, 0.112), 0.24, 0.35), s["canvas"], "chest", bevel=0.014)
piece("collar", kit.frustum((0.064, 0.08), (0.05, 0.062), 0.345, 0.365), s["leather"], "chest", bevel=0.006)

# Shingled: each row sits a little further out than the one above it, so it
# laps over the row below.
for row, z in enumerate((0.262, 0.293, 0.324)):
    for y in (0.023, -0.023):
        piece(
            f"apron.tile{row}{y}",
            kit.box((0.009, 0.044, 0.034), (0.039 + 0.003 * (2 - row), y, z), rotation=rot("Y", -12)),
            s["ceramic"], "chest", bevel=0.004,
        )

for y in (0.036, -0.036):
    piece(f"strap{y}.front", kit.beam((0.042, y, 0.338), (0.004, y, 0.358), 0.006, width=0.012), s["leather"], "chest")
    piece(f"strap{y}.back", kit.beam((0.004, y, 0.358), (-0.04, y, 0.33), 0.006, width=0.012), s["leather"], "chest")

# The contract number goes on this plate, where the officer reads it.
piece("backplate", kit.box((0.01, 0.074, 0.08), (-0.037, 0, 0.3)), s["ceramic"], "chest", bevel=0.004)
piece("canister.big", kit.rod((-0.058, 0.02, 0.262), (-0.058, 0.02, 0.338), 0.019, segments=10),
      s["iron"], "chest")
piece("canister.small", kit.rod((-0.054, -0.022, 0.27), (-0.054, -0.022, 0.322), 0.014, segments=10),
      s["iron"], "chest")
for x, y, z, r in ((-0.058, 0.02, 0.341, 0.013), (-0.054, -0.022, 0.325, 0.009)):
    piece(f"cap{y}", kit.rod((x, y, z - 0.004), (x, y, z + 0.004), r, segments=8), s["rubber"], "chest")
for i, z in enumerate((0.275, 0.318)):
    piece(f"band{i}", kit.rod((-0.058, 0.02, z - 0.003), (-0.058, 0.02, z + 0.003), 0.021, segments=8),
          s["leather"], "chest")

# The hose, from the big canister over the left shoulder to the filter.
hose = [(-0.058, 0.02, 0.345), (-0.05, 0.036, 0.37), (-0.02, 0.048, 0.382), (0.018, 0.04, 0.378),
        (0.034, 0.02, 0.37)]
for i, (a, b) in enumerate(zip(hose, hose[1:])):
    piece(f"hose{i}", kit.rod(a, b, 0.0055, segments=5), s["rubber"], "chest")

for side, sign in (("L", 1), ("R", -1)):
    piece(f"pauldron.{side}",
          kit.box((0.064, 0.046, 0.016), (0.002, 0.066 * sign, 0.356), rotation=rot("X", -22 * sign)),
          s["paint"], "chest", painted=True, bevel=0.007, segments=2)
    piece(f"pauldron.{side}.lower",
          kit.box((0.054, 0.03, 0.012), (0.0, 0.084 * sign, 0.334), rotation=rot("X", -48 * sign)),
          s["paint"], "chest", painted=True, bevel=0.004)
    for x in (0.022, -0.018):
        piece(f"rivet.{side}{x}",
              kit.rod((x, 0.064 * sign, 0.362), (x, 0.07 * sign, 0.37), 0.0035, segments=5),
              s["iron"], "chest")

# ---------------------------------------------------------------------------
# Head: the welder's hood.
# ---------------------------------------------------------------------------

piece("hood", kit.box((0.064, 0.062, 0.07), (-0.004, 0, 0.397)), s["leather"], "head", bevel=0.018, segments=2)
piece("crown", kit.ellipsoid((0.036, 0.035, 0.026), (-0.004, 0, 0.428), segments=8, rings=5), s["ceramic"], "head")
piece("visor", kit.box((0.014, 0.066, 0.054), (0.033, 0, 0.402), rotation=rot("Y", -8)),
      s["paint"], "head", painted=True, bevel=0.006)
piece("lens.frame", kit.box((0.006, 0.05, 0.018), (0.041, 0, 0.409)), s["iron"], "head")
piece("lens", kit.box((0.004, 0.042, 0.009), (0.0445, 0, 0.409)), lamp, "head")
for y in (0.036, -0.036):
    piece(f"hinge{y}", kit.rod((0.022, y, 0.418), (0.022, y * 1.2, 0.418), 0.008, segments=8), s["iron"], "head")
piece("filter", kit.rod((0.028, 0, 0.368), (0.054, 0, 0.368), 0.014, segments=10), s["iron"], "head")
for x in (0.036, 0.046):
    piece(f"filter.rib{x}", kit.rod((x - 0.002, 0, 0.368), (x + 0.002, 0, 0.368), 0.0165, segments=8),
          s["rubber"], "head")
piece("filter.grate", kit.rod((0.054, 0, 0.368), (0.057, 0, 0.368), 0.01, segments=8), s["rubber"], "head")

# ---------------------------------------------------------------------------
# The rivet driver, and the arms that hold it.
# ---------------------------------------------------------------------------

GUN_Y, GUN_Z = -0.03, 0.29
piece("receiver", kit.box((0.16, 0.024, 0.034), (0.06, GUN_Y, GUN_Z)), s["iron"], "rifle", bevel=0.004)
piece("receiver.plate", kit.box((0.09, 0.026, 0.012), (0.07, GUN_Y, GUN_Z + 0.02)), s["paint"], "rifle",
      painted=True)
piece("drum", kit.rod((0.05, GUN_Y - 0.013, GUN_Z - 0.03), (0.05, GUN_Y + 0.013, GUN_Z - 0.03), 0.026, segments=12),
      s["iron"], "rifle")
piece("drum.hub", kit.rod((0.05, GUN_Y - 0.016, GUN_Z - 0.03), (0.05, GUN_Y + 0.016, GUN_Z - 0.03), 0.008,
                          segments=8), s["rubber"], "rifle")
piece("shroud", kit.rod((0.14, GUN_Y, GUN_Z + 0.004), (0.25, GUN_Y, GUN_Z + 0.004), 0.013, segments=10),
      s["iron"], "rifle")
for i, x in enumerate((0.155, 0.175, 0.195)):
    piece(f"vent{i}", kit.box((0.01, 0.018, 0.006), (x, GUN_Y, GUN_Z + 0.017)), s["rubber"], "rifle")
for i, x in enumerate((0.215, 0.232, 0.249, 0.266)):
    piece(f"coil{i}", kit.rod((x - 0.003, GUN_Y, GUN_Z + 0.004), (x + 0.003, GUN_Y, GUN_Z + 0.004), 0.017,
                              segments=8), lamp, "rifle")
piece("barrel", kit.rod((0.25, GUN_Y, GUN_Z + 0.004), (0.33, GUN_Y, GUN_Z + 0.004), 0.008, segments=10),
      s["iron"], "rifle")
piece("muzzle", kit.rod((0.325, GUN_Y, GUN_Z + 0.004), (0.35, GUN_Y, GUN_Z + 0.004), 0.012, segments=10),
      s["iron"], "rifle")
piece("grip", kit.box((0.018, 0.018, 0.042), (0.0, GUN_Y, GUN_Z - 0.032), rotation=rot("Y", 15)),
      s["leather"], "rifle", bevel=0.004)
for dz in (0.008, -0.014):
    piece(f"stock{dz}", kit.rod((-0.02, GUN_Y, GUN_Z + dz), (-0.1, GUN_Y, GUN_Z + dz * 0.4 - 0.006), 0.005,
                                segments=5), s["iron"], "rifle")
piece("buttpad", kit.box((0.012, 0.022, 0.036), (-0.104, GUN_Y, GUN_Z - 0.01)), s["rubber"], "rifle", bevel=0.004)

# Right hand on the grip, left hand forward under the shroud.
arms = {
    "R": [(0.0, -0.068, 0.345), (-0.02, -0.066, 0.282), (0.004, GUN_Y - 0.014, GUN_Z - 0.026)],
    "L": [(0.0, 0.068, 0.345), (0.045, 0.056, 0.292), (0.14, GUN_Y + 0.012, GUN_Z - 0.012)],
}
for side, (shoulder, elbow, hand) in arms.items():
    piece(f"arm.{side}.upper", kit.rod(shoulder, elbow, 0.014, segments=6, radius_end=0.012), s["canvas"], "rifle")
    piece(f"arm.{side}.lower", kit.rod(elbow, hand, 0.012, segments=6, radius_end=0.011), s["canvas"], "rifle")
    piece(f"arm.{side}.elbow", kit.ellipsoid((0.013, 0.013, 0.013), elbow, segments=6, rings=4), s["ceramic"], "rifle")
    cuff = [e + (h - e) * 0.7 for e, h in zip(elbow, hand)]
    piece(f"arm.{side}.gauntlet", kit.rod(cuff, hand, 0.0145, segments=6), s["leather"], "rifle")
    piece(f"arm.{side}.hand", kit.box((0.02, 0.018, 0.016), hand), s["leather"], "rifle", bevel=0.005)

body = kit.join(parts, "body")

# ---------------------------------------------------------------------------
# Textures: unwrap once, bake every surface into one set of images.
# ---------------------------------------------------------------------------

surfaces.unwrap(body, kit)
images = surfaces.bake(body, kit, "conscript", size=TEXTURE_SIZE)
surfaces.save_images(images, os.path.join(PREVIEW_DIR, "textures"))

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
# In tiles, at final size: the armature's scale does not apply to these.
# ---------------------------------------------------------------------------

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
        ("fire1", pose("fire", 1)),
    ]))
