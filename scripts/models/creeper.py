"""
The Creeper -- the Verdigris's scavenger. Content id: concord.sporeling.

    blender -b --factory-startup --python scripts/models/creeper.py

WHAT IT IS (UNIVERSE.md, "The beasts")
--------------------------------------
A scavenger lizard, low and long, that used to strip the Sump's wrecks of
whatever it could dissolve. The hive is in its blood now and it hauls scrap
for the brood: it swallows what it can and carries the rest in its jaws, and
the gut where the metal dissolves glows cold through its belly.

  - **Body:** a monitor lizard's, sprawled on four bent legs, the belly a
    hand off the ground; crust shelves in two rows along the spine with the
    bloom between them, in the brood's colour; a long tail.
  - **Head:** wide and flat, a jaw that opens, eyes lit cold; a swollen gut
    under the throat, bronze, split by a glowing seam.

WHY IT IS BUILT LIKE THIS
-------------------------
Silhouette first: a lizard, low and long, wider than it is high, the head
leading. What has to read at playing zoom is the sprawl of the legs and the
tail swinging opposite the body. Built from beast.py's parts and the Verdigris
surfaces (surfaces.py): hide, bronze, crust, bloom.

Blender axes: +X forward, +Y left, +Z up, one unit is one tile.
"""

import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import beast  # noqa: E402
import kit  # noqa: E402
import surfaces  # noqa: E402
from beast import rot  # noqa: E402

CONTENT_ID = "concord.sporeling"
PREVIEW_DIR = os.environ.get("RTS_PREVIEW_DIR", os.path.join(kit.REPO, "art", "previews"))
TEXTURE_SIZE = int(os.environ.get("RTS_TEXTURE_SIZE", "1024"))

kit.fresh_scene()
col = kit.collection("Creeper")
s = surfaces.verdigris_surfaces(scale=1.2)
glow = kit.verdigris_palette()["glow"]
b = beast.Beast(col, s, glow)

# ---------------------------------------------------------------------------
# Proportions, in tiles: 0.9 from snout to tail tip, 0.5 across the legs, the
# back at 0.2. Sprawled: the knees are out to the sides and above the hips.
# ---------------------------------------------------------------------------

BODY = Vector((0.0, 0.0, 0.14))
HEAD = Vector((0.3, 0.0, 0.15))
LEGS = {"leg.FL": (0.13, 1), "leg.FR": (0.13, -1), "leg.RL": (-0.14, 1), "leg.RR": (-0.14, -1)}

b.bone("body", (-0.05, 0, 0.08), (-0.05, 0, 0.24), "root")
b.bone("neck", (0.18, 0, 0.15), (0.26, 0, 0.15), "body")
b.bone("head", (0.26, 0, 0.15), (0.4, 0, 0.15), "neck")
b.bone("jaw", (0.28, 0, 0.12), (0.4, 0, 0.1), "head")
b.bone("gut", (0.14, 0, 0.11), (0.14, 0, 0.02), "body")
for name, (x, side) in LEGS.items():
    # A monitor's sprawl: the knee out to the side and barely above the hip.
    beast.leg(b, name, "body", (x, side * 0.08, 0.13), (x + 0.02, side * 0.17, 0.16), (x + 0.05, side * 0.21, 0.02),
              0.024, sprawl=True)
TAIL = beast.tail(b, "body", (-0.2, 0, 0.13), (-0.52, 0, 0.09), 0.045, segments=3)
rig = b.rig()

# ---------------------------------------------------------------------------
# The body: a lizard's, hide over it, the crust in two rows down the spine and
# the bloom between them; the gut under the throat.
# ---------------------------------------------------------------------------

b.piece(kit.ellipsoid((0.23, 0.1, 0.07), BODY, segments=24, rings=14), s["hide"], "body")
b.piece(kit.ellipsoid((0.15, 0.08, 0.05), BODY + Vector((0.02, 0, -0.03)), segments=20, rings=10), s["hide"], "body")
for side in (1, -1):
    beast.spine(b, "body", [(0.12, side * 0.045, 0.195), (0.02, side * 0.05, 0.2), (-0.08, side * 0.045, 0.195),
                            (-0.17, side * 0.035, 0.18)], 0.06, painted=False)
for x, size, tilt in ((0.08, 0.04, 20), (-0.03, 0.05, -25), (-0.13, 0.036, 40)):
    b.box((size * 0.6, size * 0.6, size * 1.7), (x, 0, 0.215), s["bloom"], "body", rot("Y", tilt * 0.3) @ rot("Z", tilt),
          painted=True)
for x in (0.1, 0.0, -0.1):
    for side in (1, -1):
        b.piece(kit.ellipsoid((0.016, 0.012, 0.012), (x, side * 0.1, BODY.z + 0.02), segments=12, rings=6), s["bronze"],
                "body")
beast.drips(b, "body", [(0.05, 0.09, 0.09), (-0.1, -0.09, 0.09), (-0.02, 0.1, 0.085)], 0.007)
beast.scales(b, "body", BODY, (0.23, 0.1, 0.07), rows=4, per_row=10, size=0.028, lat=(-10, 45))
beast.scales(b, "neck", (0.215, 0, 0.15), (0.06, 0.05, 0.05), rows=2, per_row=4, size=0.02, lat=(-20, 40))

# The gut: a bronze swelling under the throat, split by a seam of cold light.
b.piece(kit.ellipsoid((0.09, 0.07, 0.05), (0.14, 0, 0.09), segments=20, rings=12), s["bronze"], "gut")
b.box((0.12, 0.012, 0.014), (0.14, 0, 0.045), glow, "gut")
b.piece(kit.ellipsoid((0.03, 0.028, 0.02), (0.06, 0, 0.16), segments=14, rings=7), s["bronze"], "gut")

# The neck and head: wide and flat, the jaw hinged under it, eyes lit cold.
b.piece(kit.rod((0.16, 0, 0.15), (0.27, 0, 0.15), 0.05, segments=16, radius_end=0.045), s["hide"], "neck")
b.piece(kit.ellipsoid((0.11, 0.07, 0.035), HEAD + Vector((0.04, 0, 0.015)), segments=20, rings=10), s["hide"], "head")
b.box((0.09, 0.09, 0.02), (HEAD.x + 0.02, 0, HEAD.z + 0.045), s["crust"], "head", rot("Z", 10), bevel=0.004)
for side in (1, -1):
    b.piece(kit.ellipsoid((0.014, 0.012, 0.012), (HEAD.x + 0.04, side * 0.05, HEAD.z + 0.035), segments=12, rings=6),
            glow, "head")
    b.piece(kit.rod((HEAD.x + 0.02, side * 0.06, HEAD.z + 0.05), (HEAD.x - 0.02, side * 0.075, HEAD.z + 0.09), 0.008,
                    segments=8, radius_end=0.002), s["bronze"], "head")
b.piece(kit.ellipsoid((0.1, 0.06, 0.02), (HEAD.x + 0.05, 0, HEAD.z - 0.02), segments=18, rings=8), s["hide"], "jaw")
for k in range(7):
    x = HEAD.x + 0.04 + k * 0.016
    for side in (1, -1):
        b.piece(kit.rod((x, side * 0.045, HEAD.z - 0.005), (x, side * 0.045, HEAD.z + 0.018), 0.005, segments=4,
                        radius_end=0.001), s["bronze"], "jaw")
b.piece(kit.rod((HEAD.x + 0.1, 0, HEAD.z - 0.015), (HEAD.x + 0.1, 0, HEAD.z), 0.02, segments=14), glow, "jaw")

# Scrap it is carrying, clamped in its jaws.
b.box((0.06, 0.04, 0.02), (HEAD.x + 0.12, 0.01, HEAD.z + 0.005), s["rot"], "head", rot("Z", 25) @ rot("Y", 10))

kit.ground_check(b.parts)
body = kit.join(b.parts, "body")
print("creeper geometry:", kit.report(col))

surfaces.unwrap(body, kit)
images = surfaces.bake(body, kit, "creeper", size=TEXTURE_SIZE)
surfaces.save_images(images, os.path.join(PREVIEW_DIR, "textures"))

kit.bind(body, rig)
SCALE = 1.25
rig.scale = (SCALE, SCALE, SCALE)

# ---------------------------------------------------------------------------
# Clips.
# ---------------------------------------------------------------------------


def legs_pose(stances):
    pose = {}
    for name, (swing, lift, bend) in stances.items():
        pose.update(beast.sprawl_pose(name, LEGS[name][1], swing, lift, bend))
    return pose


def tail_pose(sway):
    return {name: [("Z", sway * (k + 1) * 0.6)] for k, name in enumerate(TAIL)}


kit.clip(rig, "idle", 60, {
    0: {},
    15: {"body": [("loc", (0, 0, 0.004))], "head": [("Z", 12)], **tail_pose(-5)},
    30: {"body": [("loc", (0, 0, -0.002))], "head": [("Z", -8), ("Y", 3)], **tail_pose(4), "gut": [("scale", 1.06)]},
    45: {"head": [("Z", 3)], **tail_pose(-2)},
    60: {},
})

# A lizard's walk: diagonal pairs, the body swinging side to side and the
# tail lashing against it. Sixteen frames, two half-strides.
WALK = {}
for f, (a_swing, a_lift, b_swing, b_lift, yaw) in {
    0: (16, 0, -16, 14, 6), 4: (0, 0, 0, 16, 0), 8: (-16, 14, 16, 0, -6), 12: (0, 16, 0, 0, 0),
}.items():
    stance = {}
    for name in LEGS:
        first = name in ("leg.FL", "leg.RR")
        stance[name] = (a_swing, a_lift, a_lift * 1.5) if first else (b_swing, b_lift, b_lift * 1.5)
    pose = legs_pose(stance)
    pose["body"] = [("Z", yaw), ("loc", (0, 0, 0.003 if f % 8 else 0))]
    pose["neck"] = [("Z", -yaw * 0.6)]
    pose["head"] = [("Z", -yaw * 0.4)]
    pose.update(tail_pose(-yaw * 1.2))
    WALK[f] = pose
WALK[16] = WALK[0]
kit.clip(rig, "walk", 16, WALK)

# It lunges and bites: the neck shoots out, the jaw drops and snaps.
kit.clip(rig, "fire", 12, {
    0: {"jaw": [("Y", 8)]},
    2: {"neck": [("loc", (0.04, 0, 0)), ("Y", -6)], "head": [("Y", -8)], "jaw": [("Y", 34)],
        "body": [("loc", (0.02, 0, -0.006))]},
    4: {"neck": [("loc", (0.05, 0, 0))], "head": [("Y", 2)], "jaw": [("Y", 2)], "body": [("loc", (0.02, 0, -0.004))]},
    7: {"neck": [("loc", (0.02, 0, 0))], "jaw": [("Y", 6)]},
    12: {},
})

kit.rest_pose(rig)
stats = kit.report(col)
print("creeper:", stats)
print("wrote", kit.export_rigged(col, CONTENT_ID))
print("wrote", kit.save_blend(CONTENT_ID))

if os.environ.get("RTS_PREVIEWS", "1") != "0":
    os.makedirs(PREVIEW_DIR, exist_ok=True)

    def pose(action, frame):
        return lambda: kit.set_pose(rig, bpy.data.actions[action], frame)

    print("previews", kit.previews(col, PREVIEW_DIR, "creeper", frame=1.2, poses=[
        ("walk", pose("walk", 4)),
        ("bite", pose("fire", 2)),
    ]))
