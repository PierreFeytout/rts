"""
The Flenser -- the Verdigris's brawler. Content id: concord.thornling.

    blender -b --factory-startup --python scripts/models/flenser.py

WHAT IT IS (UNIVERSE.md, "The beasts")
--------------------------------------
A runner: a raptor on two legs, built to close. Long-legged, long-tailed, a
narrow head all jaw, and a sickle claw on each foot the hive has grown into
bronze. It closes because corrosion spreads by touch, and what it touches it
opens.

  - **Body:** held level over two long legs, a stiff tail out behind for
    balance, two small clawed arms at the chest; a ridge of crust along the
    spine with the bloom on it, in the brood's colour.
  - **Head:** a raptor's, on a curved neck, jaws lined with bronze teeth,
    eyes lit cold.

WHY IT IS BUILT LIKE THIS
-------------------------
Silhouette first: lean, on two legs, the tail as long as the body. The run
is what says "this one closes" at playing zoom, and the tail is what makes a
run read. Built from beast.py's parts and the Verdigris surfaces.

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

CONTENT_ID = "concord.thornling"
PREVIEW_DIR = os.environ.get("RTS_PREVIEW_DIR", os.path.join(kit.REPO, "art", "previews"))
TEXTURE_SIZE = int(os.environ.get("RTS_TEXTURE_SIZE", "1024"))

kit.fresh_scene()
col = kit.collection("Flenser")
s = surfaces.verdigris_surfaces(scale=1.2)
glow = kit.verdigris_palette()["glow"]
b = beast.Beast(col, s, glow)

# ---------------------------------------------------------------------------
# Proportions, in tiles: 0.95 from snout to tail tip, the hips at 0.3, the
# head at 0.42. Two long legs, the knee forward and the ankle back.
# ---------------------------------------------------------------------------

HIP_Z = 0.3
BODY = Vector((0.0, 0.0, 0.31))

b.bone("pelvis", (-0.02, 0, HIP_Z - 0.04), (-0.02, 0, HIP_Z + 0.08), "root")
b.bone("chest", (0.06, 0, BODY.z), (0.2, 0, BODY.z + 0.02), "pelvis")
b.bone("neck", (0.18, 0, 0.34), (0.26, 0, 0.42), "chest")
b.bone("head", (0.26, 0, 0.42), (0.42, 0, 0.42), "neck")
b.bone("jaw", (0.28, 0, 0.39), (0.42, 0, 0.37), "head")
for side, name in ((1, "arm.L"), (-1, "arm.R")):
    b.bone(name, (0.14, side * 0.06, 0.3), (0.26, side * 0.07, 0.22), "chest")
for side, name in ((1, "leg.L"), (-1, "leg.R")):
    beast.leg(b, name, "pelvis", (-0.02, side * 0.07, HIP_Z), (0.08, side * 0.09, 0.17), (-0.02, side * 0.09, 0.02),
              0.024, claws=3)
TAIL = beast.tail(b, "pelvis", (-0.1, 0, 0.3), (-0.55, 0, 0.32), 0.04, segments=3, rise=0.03)
rig = b.rig()

# ---------------------------------------------------------------------------
# The body: chest and pelvis in hide, the crust ridge and the bloom along the
# spine, the small arms at the chest.
# ---------------------------------------------------------------------------

b.piece(kit.ellipsoid((0.11, 0.075, 0.075), (-0.03, 0, HIP_Z + 0.02), segments=20, rings=12), s["hide"], "pelvis")
b.piece(kit.ellipsoid((0.14, 0.07, 0.07), (0.1, 0, BODY.z + 0.01), segments=20, rings=12), s["hide"], "chest")
b.piece(kit.ellipsoid((0.06, 0.05, 0.045), (0.16, 0, BODY.z - 0.03), segments=14, rings=8), s["bronze"], "chest")
beast.spine(b, "chest", [(0.16, 0, 0.375), (0.08, 0, 0.385), (0.0, 0, 0.38)], 0.055)
beast.spine(b, "pelvis", [(-0.07, 0, 0.375)], 0.05)
for x in (0.14, 0.04):
    for side in (1, -1):
        b.piece(kit.beam((x, side * 0.03, BODY.z + 0.05), (x - 0.01, side * 0.075, BODY.z - 0.04), 0.012), s["bronze"],
                "chest")
beast.drips(b, "chest", [(0.1, 0.06, 0.26), (0.02, -0.06, 0.26)], 0.006)
beast.scales(b, "chest", (0.1, 0, BODY.z + 0.01), (0.14, 0.07, 0.07), rows=3, per_row=8, size=0.022, lat=(-15, 50))
beast.scales(b, "pelvis", (-0.03, 0, HIP_Z + 0.02), (0.11, 0.075, 0.075), rows=3, per_row=6, size=0.022, lat=(-15, 50))
beast.scales(b, "neck", (0.22, 0, 0.375), (0.045, 0.04, 0.045), rows=2, per_row=4, size=0.016, lat=(-30, 40))

for side, name in ((1, "arm.L"), (-1, "arm.R")):
    shoulder, elbow, hand = Vector((0.14, side * 0.06, 0.3)), Vector((0.2, side * 0.08, 0.26)), Vector((0.26, side * 0.07, 0.22))
    b.piece(kit.rod(shoulder, elbow, 0.014, segments=10, radius_end=0.012), s["hide"], name)
    b.piece(kit.ellipsoid((0.014, 0.014, 0.012), elbow, segments=10, rings=6), s["bronze"], name)
    b.piece(kit.rod(elbow, hand, 0.011, segments=10, radius_end=0.008), s["hide"], name)
    for a in (-25, 25):
        tip = hand + rot("Z", a) @ Vector((0.04, 0, -0.025))
        b.piece(kit.beam(hand, tip, 0.008), s["bronze"], name)

# The sickle claws: one big bronze hook on each foot, raised off the ground.
for side, name in ((1, "leg.L"), (-1, "leg.R")):
    foot = Vector((-0.02, side * 0.09, 0.02))
    b.piece(kit.beam(foot + Vector((0.01, side * 0.02, 0.05)), foot + Vector((0.07, side * 0.02, 0.09)), 0.014,
                     width=0.01), s["bronze"], f"{name}.lower")
    b.piece(kit.beam(foot + Vector((0.07, side * 0.02, 0.09)), foot + Vector((0.11, side * 0.02, 0.05)), 0.011,
                     width=0.008), s["bronze"], f"{name}.lower")

# The neck and head: a raptor's, jaws lined with teeth, eyes lit cold.
b.piece(kit.rod((0.17, 0, 0.33), (0.27, 0, 0.42), 0.04, segments=14, radius_end=0.035), s["hide"], "neck")
b.piece(kit.ellipsoid((0.1, 0.045, 0.04), (0.34, 0, 0.43), segments=20, rings=10), s["hide"], "head")
b.box((0.07, 0.05, 0.016), (0.31, 0, 0.465), s["crust"], "head", rot("Z", -8), bevel=0.003)
b.piece(kit.rod((0.3, 0, 0.47), (0.24, 0, 0.5), 0.008, segments=8, radius_end=0.002), s["bronze"], "head")
for side in (1, -1):
    b.piece(kit.ellipsoid((0.012, 0.01, 0.01), (0.33, side * 0.035, 0.445), segments=12, rings=6), glow, "head")
b.piece(kit.ellipsoid((0.09, 0.038, 0.018), (0.35, 0, 0.395), segments=18, rings=8), s["hide"], "jaw")
for k in range(8):
    x = 0.3 + k * 0.014
    for side in (1, -1):
        b.piece(kit.rod((x, side * 0.03, 0.4), (x, side * 0.03, 0.418), 0.004, segments=7, radius_end=0.001),
                s["bronze"], "jaw")
        b.piece(kit.rod((x + 0.01, side * 0.03, 0.42), (x + 0.01, side * 0.03, 0.404), 0.004, segments=4,
                        radius_end=0.001), s["bronze"], "head")
b.piece(kit.rod((0.4, 0, 0.4), (0.4, 0, 0.41), 0.015, segments=14), glow, "jaw")

kit.ground_check(b.parts)
body = kit.join(b.parts, "body")
print("flenser geometry:", kit.report(col))

surfaces.unwrap(body, kit)
images = surfaces.bake(body, kit, "flenser", size=TEXTURE_SIZE)
surfaces.save_images(images, os.path.join(PREVIEW_DIR, "textures"))

kit.bind(body, rig)
SCALE = 1.25
rig.scale = (SCALE, SCALE, SCALE)

# ---------------------------------------------------------------------------
# Clips. The legs are columnar (beast.column_pose): negative Y swings forward.
# ---------------------------------------------------------------------------


def tail_pose(sway, dip=0.0):
    return {name: [("Z", sway * (k + 1) * 0.5), ("Y", dip * (k + 1))] for k, name in enumerate(TAIL)}


kit.clip(rig, "idle", 60, {
    0: {},
    15: {"pelvis": [("loc", (0, 0, -0.004)), ("Z", 2)], "head": [("Z", 15), ("X", 10)], "arm.L": [("Y", 6)],
         **tail_pose(-6)},
    30: {"pelvis": [("Z", -2)], "neck": [("Y", 4)], "head": [("Z", -10)], "arm.R": [("Y", 6)], **tail_pose(5)},
    45: {"pelvis": [("loc", (0, 0, -0.003))], "head": [("Y", -4), ("X", -8)], **tail_pose(-2)},
    60: {},
})

# A run: one leg reaching while the other drives, the body pitching with it
# and the tail swinging out behind. Twelve frames a stride pair.
WALK = {}
for f, (l_swing, l_bend, r_swing, r_bend, bob, pitch) in {
    0: (26, 8, -22, 4, 0.0, 3), 3: (8, 34, -8, 2, 0.014, 0), 6: (-22, 4, 26, 8, 0.0, 3), 9: (-8, 2, 8, 34, 0.014, 0),
}.items():
    pose = {**beast.column_pose("leg.L", l_swing, l_bend), **beast.column_pose("leg.R", r_swing, r_bend)}
    pose["pelvis"] = [("loc", (0, 0, bob)), ("Y", pitch), ("Z", (l_swing - r_swing) * 0.08)]
    pose["chest"] = [("Y", 4)]
    pose["neck"] = [("Y", -pitch)]
    pose["head"] = [("Y", -3)]
    pose["arm.L"] = [("Y", -l_swing * 0.4)]
    pose["arm.R"] = [("Y", -r_swing * 0.4)]
    pose.update(tail_pose((r_swing - l_swing) * 0.15, -pitch * 0.5))
    WALK[f] = pose
WALK[12] = WALK[0]
kit.clip(rig, "walk", 12, WALK)

# It lunges: the body drops and shoots forward, the jaws open and snap, the
# arms rake down.
kit.clip(rig, "fire", 10, {
    0: {"jaw": [("Y", 10)], "neck": [("Y", -8)]},
    2: {"pelvis": [("loc", (0.05, 0, -0.03)), ("Y", 8)], "chest": [("Y", 6)], "neck": [("Y", -4)],
        "jaw": [("Y", 38)], "arm.L": [("Y", 40)], "arm.R": [("Y", 40)],
        **beast.column_pose("leg.L", 10, 30), **beast.column_pose("leg.R", -12, 12), **tail_pose(0, -6)},
    4: {"pelvis": [("loc", (0.06, 0, -0.025)), ("Y", 6)], "chest": [("Y", 4)], "jaw": [("Y", 2)],
        "arm.L": [("Y", 30)], "arm.R": [("Y", 30)],
        **beast.column_pose("leg.L", 10, 28), **beast.column_pose("leg.R", -12, 12), **tail_pose(0, -5)},
    7: {"pelvis": [("loc", (0.02, 0, -0.01)), ("Y", 2)], "jaw": [("Y", 8)], "arm.L": [("Y", 10)], "arm.R": [("Y", 10)],
        **beast.column_pose("leg.L", 4, 12), **beast.column_pose("leg.R", -4, 6)},
    10: {},
})

kit.rest_pose(rig)
stats = kit.report(col)
print("flenser:", stats)
print("wrote", kit.export_rigged(col, CONTENT_ID))
print("wrote", kit.save_blend(CONTENT_ID))

if os.environ.get("RTS_PREVIEWS", "1") != "0":
    os.makedirs(PREVIEW_DIR, exist_ok=True)

    def pose(action, frame):
        return lambda: kit.set_pose(rig, bpy.data.actions[action], frame)

    print("previews", kit.previews(col, PREVIEW_DIR, "flenser", frame=1.3, poses=[
        ("run", pose("walk", 3)),
        ("lunge", pose("fire", 2)),
    ]))
