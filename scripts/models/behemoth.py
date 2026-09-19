"""
The Behemoth -- the Verdigris's siege beast. Content id: concord.behemoth.

    blender -b --factory-startup --python scripts/models/behemoth.py

WHAT IT IS (UNIVERSE.md, "The beasts")
--------------------------------------
Bigger than anything the Sump ever fed: the hive's siege beast. A horned
quadruped with a frill of crust and a head that is more jaw than skull, it
carries the hive's own furnace in its gut -- it eats metal and heat -- and
vomits a slug of it at whatever stands in the brood's way. Buildings crack.

  - **Body:** an elephant's mass on four columnar legs, a spined back under
    crust shelves, the bloom on it large enough to read from the air in the
    brood's colour; a thick tail.
  - **Head:** a tyrant's jaws with bronze teeth, three bronze horns -- two
    over the eyes and one on the nose -- and a frill of crust plates behind
    the skull; eyes lit cold, and the gullet lit hot enough to show through
    the throat.

WHY IT IS BUILT LIKE THIS
-------------------------
Silhouette first: a horned bulk with a frill, the head leading. It is the
heaviest thing either army fields and is built at true size: the frill and
the horns are what say "Behemoth" at playing zoom, the bloom on its back what
says whose. Built from beast.py's parts and the Verdigris surfaces.

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

CONTENT_ID = "concord.behemoth"
PREVIEW_DIR = os.environ.get("RTS_PREVIEW_DIR", os.path.join(kit.REPO, "art", "previews"))
TEXTURE_SIZE = int(os.environ.get("RTS_TEXTURE_SIZE", "1024"))

kit.fresh_scene()
col = kit.collection("Behemoth")
s = surfaces.verdigris_surfaces(scale=2.0)
glow = kit.verdigris_palette()["glow"]
b = beast.Beast(col, s, glow)

# ---------------------------------------------------------------------------
# Proportions, in tiles, at true size: 1.5 from the horn to the tail tip, 0.8
# across the legs, the back at 0.7 and the frill at 0.9. The legs are columns.
# ---------------------------------------------------------------------------

BODY = Vector((-0.08, 0.0, 0.5))
NECK = Vector((0.3, 0.0, 0.58))
HEAD = Vector((0.5, 0.0, 0.6))
LEGS = {"leg.FL": (0.18, 1), "leg.FR": (0.18, -1), "leg.RL": (-0.3, 1), "leg.RR": (-0.3, -1)}

b.bone("body", (BODY.x, 0, 0.3), (BODY.x, 0, 0.7), "root")
b.bone("neck", (0.22, 0, 0.55), tuple(NECK + Vector((0.1, 0, 0.02))), "body")
b.bone("head", tuple(NECK + Vector((0.1, 0, 0.02))), (0.8, 0, 0.6), "neck")
b.bone("jaw", (0.46, 0, 0.53), (0.78, 0, 0.48), "head")
b.bone("gullet", (0.44, 0, 0.55), (0.5, 0, 0.55), "head")
for name, (x, side) in LEGS.items():
    beast.leg(b, name, "body", (x, side * 0.22, 0.42), (x + 0.06, side * 0.26, 0.24), (x, side * 0.28, 0.02), 0.055,
              claws=3)
TAIL = beast.tail(b, "body", (-0.42, 0, 0.5), (-0.85, 0, 0.36), 0.09, segments=3)
rig = b.rig()

# ---------------------------------------------------------------------------
# The body: an elephant's mass in hide, the spine of crust shelves and the
# bloom down the back, polyps along the flanks, the belly lit from the gut.
# ---------------------------------------------------------------------------

b.piece(kit.ellipsoid((0.46, 0.27, 0.24), BODY, segments=26, rings=15), s["hide"], "body")
b.piece(kit.ellipsoid((0.3, 0.22, 0.14), BODY + Vector((0.05, 0, -0.12)), segments=22, rings=12), s["hide"], "body")
beast.spine(b, "body", [(0.22, 0, 0.72), (0.08, 0, 0.75), (-0.06, 0, 0.75), (-0.2, 0, 0.73), (-0.34, 0, 0.68)], 0.16)
for k, (dx, dy, lx, ly, tilt) in enumerate(((0.1, 0.18, 0.2, 0.14, 14), (-0.2, -0.2, 0.22, 0.14, -12),
                                            (-0.05, 0.22, 0.16, 0.12, 20), (0.15, -0.2, 0.16, 0.12, -18))):
    b.box((lx, ly, 0.04), BODY + Vector((dx, dy, 0.16)), s["crust"], "body", rot("X", tilt) @ rot("Z", tilt * 2),
          bevel=0.008)
for x in (0.25, 0.1, -0.05, -0.2, -0.35):
    for side in (1, -1):
        b.piece(kit.ellipsoid((0.04, 0.03, 0.03), (x, side * 0.26, BODY.z + 0.02), segments=14, rings=7), s["bronze"],
                "body")
        # Short bronze spurs, not spines: the mass has to stay an elephant's.
        b.piece(kit.rod((x, side * 0.24, BODY.z + 0.16), (x - 0.02, side * 0.28, BODY.z + 0.24), 0.02, segments=6,
                        radius_end=0.005), s["bronze"], "body")
# The gut's heat shows through the belly and up the throat.
b.box((0.36, 0.03, 0.03), (BODY.x + 0.05, 0, BODY.z - 0.24), glow, "body")
beast.drips(b, "body", [(0.2, 0.25, 0.36), (-0.1, -0.26, 0.36), (-0.3, 0.24, 0.38), (0.0, 0.27, 0.34)], 0.012)
beast.scales(b, "body", BODY, (0.46, 0.27, 0.24), rows=5, per_row=12, size=0.05, lat=(-15, 50))
beast.scales(b, "neck", (0.31, 0, 0.57), (0.13, 0.15, 0.15), rows=3, per_row=5, size=0.035, lat=(-30, 50))
beast.scales(b, "head", HEAD + Vector((0.08, 0, 0.02)), (0.26, 0.15, 0.13), rows=3, per_row=7, size=0.03, lat=(-10, 50), lon=(10, 150))

# The neck, and the frill of crust plates behind the skull.
b.piece(kit.rod((0.2, 0, 0.54), (0.42, 0, 0.6), 0.16, segments=18, radius_end=0.13), s["hide"], "neck")
b.box((0.14, 0.03, 0.05), (0.3, 0, 0.44), glow, "neck")
for k, a in enumerate((-75, -50, -25, 0, 25, 50, 75)):
    turn = rot("X", a)
    base = Vector((0.4, 0, 0.62))
    c = base + turn @ Vector((-0.05, 0, 0.2))
    b.box((0.05, 0.12, 0.26), c, s["crust"], "head", turn @ rot("Y", -20), bevel=0.008)
    b.piece(kit.rod(base + turn @ Vector((-0.02, 0, 0.3)), base + turn @ Vector((-0.06, 0, 0.42)), 0.02, segments=6,
                    radius_end=0.004), s["bronze"], "head")

# The head: a tyrant's jaws, three horns, eyes lit cold.
b.piece(kit.ellipsoid((0.26, 0.15, 0.13), HEAD + Vector((0.08, 0, 0.02)), segments=22, rings=12), s["hide"], "head")
b.box((0.2, 0.16, 0.03), (HEAD.x + 0.02, 0, HEAD.z + 0.14), s["crust"], "head", rot("Z", 6), bevel=0.006)
for side in (1, -1):
    b.piece(kit.ellipsoid((0.03, 0.026, 0.024), (HEAD.x + 0.14, side * 0.11, HEAD.z + 0.09), segments=14, rings=7),
            glow, "head")
    b.piece(kit.rod((HEAD.x + 0.1, side * 0.1, HEAD.z + 0.13), (HEAD.x + 0.34, side * 0.14, HEAD.z + 0.26), 0.035,
                    segments=14, radius_end=0.006), s["bronze"], "head")
b.piece(kit.rod((HEAD.x + 0.3, 0, HEAD.z + 0.08), (HEAD.x + 0.42, 0, HEAD.z + 0.22), 0.04, segments=8,
                radius_end=0.006), s["bronze"], "head")
b.piece(kit.ellipsoid((0.24, 0.12, 0.05), (HEAD.x + 0.12, 0, HEAD.z - 0.06), segments=22, rings=11), s["hide"], "jaw")
for k in range(11):
    x = HEAD.x + 0.0 + k * 0.03
    for side in (1, -1):
        b.piece(kit.rod((x, side * 0.1, HEAD.z - 0.06), (x, side * 0.1, HEAD.z - 0.01), 0.012, segments=5,
                        radius_end=0.002), s["bronze"], "jaw")
        b.piece(kit.rod((x + 0.02, side * 0.11, HEAD.z - 0.02), (x + 0.02, side * 0.11, HEAD.z - 0.08), 0.012,
                        segments=8, radius_end=0.002), s["bronze"], "head")
b.piece(kit.rod((HEAD.x + 0.06, 0, HEAD.z - 0.04), (HEAD.x + 0.14, 0, HEAD.z - 0.03), 0.05, segments=18), glow,
        "gullet")

kit.ground_check(b.parts)
body = kit.join(b.parts, "body")
print("behemoth geometry:", kit.report(col))

surfaces.unwrap(body, kit)
images = surfaces.bake(body, kit, "behemoth", size=TEXTURE_SIZE)
surfaces.save_images(images, os.path.join(PREVIEW_DIR, "textures"))

kit.bind(body, rig)
# Built a little over life size for the proportions to be workable, and taken
# down here: at 1.78 tiles from horn to tail tip it would not fit through a
# gap its own collision radius fits through.
SCALE = 0.88
rig.scale = (SCALE, SCALE, SCALE)

# ---------------------------------------------------------------------------
# Clips. The legs are columnar (beast.column_pose): negative Y swings forward.
# ---------------------------------------------------------------------------


def tail_pose(sway):
    return {name: [("Z", sway * (k + 1) * 0.5)] for k, name in enumerate(TAIL)}


kit.clip(rig, "idle", 90, {
    0: {},
    22: {"body": [("loc", (0, 0, 0.014)), ("X", 0.5)], "head": [("Y", 2)], **tail_pose(-4)},
    45: {"head": [("Z", 6)]},
    67: {"body": [("loc", (0, 0, -0.008)), ("X", -0.5)], "head": [("Y", -2), ("Z", -4)], **tail_pose(4)},
    90: {},
})

# A heavy walk: diagonal pairs, the body rolling onto the leg that takes it,
# the head nodding with the stride. Twenty-four frames.
WALK = {}
for f, (a_swing, a_bend, b_swing, b_bend, roll, bob) in {
    0: (14, 4, -14, 24, 3, 0.0), 6: (0, 4, 0, 30, 0, 0.012), 12: (-14, 24, 14, 4, -3, 0.0), 18: (0, 30, 0, 4, 0, 0.012),
}.items():
    pose = {}
    for name in LEGS:
        first = name in ("leg.FL", "leg.RR")
        pose.update(beast.column_pose(name, a_swing if first else b_swing, a_bend if first else b_bend))
    pose["body"] = [("X", roll), ("loc", (0, 0, bob)), ("Y", 1.5)]
    pose["neck"] = [("Y", -1.5 - bob * 60)]
    pose["head"] = [("X", -roll * 0.5)]
    pose.update(tail_pose(-roll * 1.5))
    WALK[f] = pose
WALK[24] = WALK[0]
kit.clip(rig, "walk", 24, WALK)

# The head rears back, the jaws open, the gullet flares, and the head comes
# down as the slug goes.
kit.clip(rig, "fire", 16, {
    0: {"jaw": [("Y", 6)]},
    3: {"neck": [("Y", -16)], "head": [("Y", -10)], "jaw": [("Y", 30)], "gullet": [("scale", 2.2)],
        "body": [("loc", (0, 0, 0.01)), ("Y", -2)]},
    5: {"neck": [("Y", 8), ("loc", (0.03, 0, 0))], "head": [("Y", 4)], "jaw": [("Y", 36)], "gullet": [("scale", 2.6)],
        "body": [("Y", 2), ("loc", (0.02, 0, -0.01))]},
    9: {"neck": [("Y", 4)], "jaw": [("Y", 14)], "gullet": [("scale", 1.3)], "body": [("Y", 1)]},
    16: {},
})

kit.rest_pose(rig)
stats = kit.report(col)
print("behemoth:", stats)
print("wrote", kit.export_rigged(col, CONTENT_ID))
print("wrote", kit.save_blend(CONTENT_ID))

if os.environ.get("RTS_PREVIEWS", "1") != "0":
    os.makedirs(PREVIEW_DIR, exist_ok=True)

    def pose(action, frame):
        return lambda: kit.set_pose(rig, bpy.data.actions[action], frame)

    print("previews", kit.previews(col, PREVIEW_DIR, "behemoth", frame=2.2, poses=[
        ("walk", pose("walk", 6)),
        ("roar", pose("fire", 5)),
    ]))
