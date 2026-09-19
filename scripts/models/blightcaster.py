"""
The Blightcaster -- the Verdigris's spitter. Content id: concord.sporecaster.

    blender -b --factory-startup --python scripts/models/blightcaster.py

WHAT IT IS (UNIVERSE.md, "The beasts")
--------------------------------------
A spitter: a squat toad of a lizard with a throat sac the hive has grown into
a bladder of bronze, full of the slurry it sprays. It spits a long way and
folds to anything that reaches it.

  - **Body:** broad and low on four short legs, a dome of crust over the back
    with the bloom on its crest, in the brood's colour; a short thick tail.
  - **Head:** wide, the jaw hinged low, the sac hanging under it and swelling
    with every breath; eyes and gullet lit cold.

WHY IT IS BUILT LIKE THIS
-------------------------
Silhouette first: a toad with a bladder under its chin, which is a shape
nothing else on the field has. The sac's swell and clench are the whole of
what it does. Built from beast.py's parts and the Verdigris surfaces.

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

CONTENT_ID = "concord.sporecaster"
PREVIEW_DIR = os.environ.get("RTS_PREVIEW_DIR", os.path.join(kit.REPO, "art", "previews"))
TEXTURE_SIZE = int(os.environ.get("RTS_TEXTURE_SIZE", "1024"))

kit.fresh_scene()
col = kit.collection("Blightcaster")
s = surfaces.verdigris_surfaces(scale=1.2)
glow = kit.verdigris_palette()["glow"]
b = beast.Beast(col, s, glow)

# ---------------------------------------------------------------------------
# Proportions, in tiles: 0.6 from snout to tail, 0.5 across the legs, the
# crest at 0.3. Squat: the legs are short and bent, the belly nearly down.
# ---------------------------------------------------------------------------

BODY = Vector((-0.04, 0.0, 0.16))
HEAD = Vector((0.2, 0.0, 0.2))
SAC = Vector((0.16, 0.0, 0.118))
LEGS = {"leg.FL": (0.1, 1), "leg.FR": (0.1, -1), "leg.RL": (-0.14, 1), "leg.RR": (-0.14, -1)}

b.bone("body", (BODY.x, 0, 0.08), (BODY.x, 0, 0.28), "root")
b.bone("head", (0.12, 0, 0.2), (0.3, 0, 0.2), "body")
b.bone("jaw", (0.14, 0, 0.16), (0.3, 0, 0.14), "head")
b.bone("sac", (SAC.x, 0, SAC.z + 0.06), (SAC.x, 0, SAC.z - 0.06), "head")
b.bone("gullet", (0.29, 0, 0.17), (0.34, 0, 0.17), "head")
for name, (x, side) in LEGS.items():
    beast.leg(b, name, "body", (x, side * 0.1, 0.14), (x + 0.01, side * 0.2, 0.19), (x + 0.04, side * 0.23, 0.02),
              0.024, sprawl=True)
TAIL = beast.tail(b, "body", (-0.2, 0, 0.14), (-0.36, 0, 0.1), 0.04, segments=2, spikes=False)
rig = b.rig()

# ---------------------------------------------------------------------------
# The body: a toad's, broad and low, the crust dome over it and the bloom on
# the crest; the head wide with the jaw hinged low and the sac under it.
# ---------------------------------------------------------------------------

b.piece(kit.ellipsoid((0.19, 0.15, 0.1), BODY, segments=24, rings=14), s["hide"], "body")
b.piece(kit.ellipsoid((0.14, 0.12, 0.05), BODY + Vector((0, 0, 0.07)), segments=22, rings=11), s["crust"], "body")
beast.spine(b, "body", [(0.04, 0, 0.27), (-0.05, 0, 0.28), (-0.13, 0, 0.26)], 0.075)
for k, (dx, dy, lx, ly, tilt) in enumerate(((0.06, 0.08, 0.08, 0.06, 12), (-0.1, -0.09, 0.07, 0.06, -10),
                                            (-0.02, -0.1, 0.06, 0.05, 20), (0.0, 0.1, 0.06, 0.05, -18))):
    b.box((lx, ly, 0.025), (BODY.x + dx, dy, BODY.z + 0.09), s["crust"], "body", rot("X", tilt) @ rot("Z", tilt * 2),
          bevel=0.005)
for x in (0.06, -0.04, -0.14):
    for side in (1, -1):
        b.piece(kit.ellipsoid((0.018, 0.014, 0.014), (x, side * 0.14, BODY.z + 0.02), segments=12, rings=6),
                s["bronze"], "body")
beast.drips(b, "body", [(0.02, 0.13, 0.1), (-0.12, -0.13, 0.1), (-0.06, 0.14, 0.095)], 0.007)
beast.scales(b, "body", BODY, (0.19, 0.15, 0.1), rows=4, per_row=9, size=0.03, lat=(-15, 35))
beast.scales(b, "head", HEAD, (0.13, 0.12, 0.05), rows=2, per_row=6, size=0.024, lat=(0, 45), lon=(0, 150))

# The head: wide and flat, eyes on top, the jaw hinged low and lined with
# bronze, the gullet lit cold at the back of the mouth.
b.piece(kit.ellipsoid((0.13, 0.12, 0.05), HEAD, segments=22, rings=11), s["hide"], "head")
b.box((0.1, 0.1, 0.018), (HEAD.x - 0.02, 0, HEAD.z + 0.05), s["crust"], "head", rot("Z", 15), bevel=0.004)
for side in (1, -1):
    b.piece(kit.ellipsoid((0.02, 0.018, 0.016), (HEAD.x + 0.02, side * 0.075, HEAD.z + 0.05), segments=14, rings=7),
            glow, "head")
    b.piece(kit.ellipsoid((0.026, 0.024, 0.014), (HEAD.x + 0.02, side * 0.075, HEAD.z + 0.045), segments=14, rings=7),
            s["hide"], "head")
b.piece(kit.ellipsoid((0.12, 0.11, 0.025), (HEAD.x + 0.02, 0, HEAD.z - 0.035), segments=22, rings=9), s["hide"], "jaw")
for k in range(9):
    x = HEAD.x + 0.02 + k * 0.012
    for side in (1, -1):
        b.piece(kit.rod((x, side * 0.085, HEAD.z - 0.02), (x, side * 0.085, HEAD.z), 0.004, segments=4,
                        radius_end=0.001), s["bronze"], "jaw")
b.piece(kit.rod((0.3, 0, HEAD.z - 0.01), (0.31, 0, HEAD.z - 0.01), 0.03, segments=18), glow, "gullet")

# The sac: a bladder of bronze under the jaw, seamed and lit along the seams.
b.piece(kit.ellipsoid((0.11, 0.1, 0.085), SAC, segments=24, rings=14), s["bronze"], "sac")
for dx in (-0.05, 0.0, 0.05):
    c = SAC + Vector((dx, 0, 0))
    r = 0.1 * (1 - (dx / 0.11) ** 2) ** 0.5
    b.piece(kit.rod(c + Vector((-0.002, 0, 0)), c + Vector((0.002, 0, 0)), r + 0.003, segments=14), glow, "sac")
    b.piece(kit.rod(c + Vector((-0.008, 0, 0)), c + Vector((-0.003, 0, 0)), r + 0.005, segments=14), s["crust"], "sac")
    b.piece(kit.rod(c + Vector((0.003, 0, 0)), c + Vector((0.008, 0, 0)), r + 0.005, segments=14), s["crust"], "sac")
beast.drips(b, "sac", [(0.16, 0.02, 0.04), (0.2, -0.03, 0.045)], 0.006)

kit.ground_check(b.parts)
body = kit.join(b.parts, "body")
print("blightcaster geometry:", kit.report(col))

surfaces.unwrap(body, kit)
images = surfaces.bake(body, kit, "blightcaster", size=TEXTURE_SIZE)
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


kit.clip(rig, "idle", 60, {
    0: {},
    20: {"sac": [("scale", (1.12, 1.12, 1.12))], "body": [("loc", (0, 0, -0.003))], "head": [("Y", -2)]},
    40: {"sac": [("scale", (0.95, 0.95, 0.95))], "head": [("Z", 8)], "tail.1": [("Z", 6)], "tail.2": [("Z", 10)]},
    60: {},
})

# A waddle: diagonal pairs, short and quick, the body rocking. Sixteen frames.
WALK = {}
for f, (a_swing, a_lift, b_swing, b_lift, roll) in {
    0: (12, 0, -12, 12, 4), 4: (0, 0, 0, 14, 0), 8: (-12, 12, 12, 0, -4), 12: (0, 14, 0, 0, 0),
}.items():
    stance = {}
    for name in LEGS:
        first = name in ("leg.FL", "leg.RR")
        stance[name] = (a_swing, a_lift, a_lift * 1.5) if first else (b_swing, b_lift, b_lift * 1.5)
    pose = legs_pose(stance)
    pose["body"] = [("X", roll), ("loc", (0, 0, 0.004 if f % 8 else 0))]
    pose["head"] = [("X", -roll * 0.5)]
    pose["tail.1"] = [("Z", roll * 1.5)]
    pose["tail.2"] = [("Z", roll * 2.5)]
    WALK[f] = pose
WALK[16] = WALK[0]
kit.clip(rig, "walk", 16, WALK)

# The sac clenches, the head jerks forward with the jaw wide, the gullet flares.
kit.clip(rig, "fire", 12, {
    0: {"sac": [("scale", (1.1, 1.1, 1.1))]},
    1: {"sac": [("scale", (0.82, 0.86, 0.86))], "head": [("loc", (0.03, 0, 0.01)), ("Y", -10)], "jaw": [("Y", 30)],
        "gullet": [("scale", 2.4)], "body": [("loc", (-0.01, 0, 0.005)), ("Y", -3)]},
    3: {"sac": [("scale", (0.9, 0.92, 0.92))], "head": [("loc", (0.02, 0, 0.005)), ("Y", -6)], "jaw": [("Y", 20)],
        "gullet": [("scale", 1.4)], "body": [("Y", -1.5)]},
    6: {"sac": [("scale", (1.04, 1.02, 1.02))], "jaw": [("Y", 6)]},
    12: {},
})

kit.rest_pose(rig)
stats = kit.report(col)
print("blightcaster:", stats)
print("wrote", kit.export_rigged(col, CONTENT_ID))
print("wrote", kit.save_blend(CONTENT_ID))

if os.environ.get("RTS_PREVIEWS", "1") != "0":
    os.makedirs(PREVIEW_DIR, exist_ok=True)

    def pose(action, frame):
        return lambda: kit.set_pose(rig, bpy.data.actions[action], frame)

    print("previews", kit.previews(col, PREVIEW_DIR, "blightcaster", frame=1.1, poses=[
        ("walk", pose("walk", 4)),
        ("spit", pose("fire", 1)),
    ]))
