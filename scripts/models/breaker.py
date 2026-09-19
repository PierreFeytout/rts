"""
The Breaker -- the Ashen Directorate's siege hovertank. Content id: vanguard.hovertank.

    blender -b --factory-startup --python scripts/models/breaker.py

WHAT IT IS (UNIVERSE.md)
------------------------
A slag skimmer: one of the foundries' hover-sleds, a flat hull on two lift
fans that could cross ground too hot and too broken for wheels, with a blade
on the nose to skim the crust off a cooling pour and a bed behind to haul it.
Most of them were still parked where the foundry hands left them when the
Directorate came back. A Breaker is a skimmer with a breaching mortar where
the skimming blade was -- a foundry charge-setter, the tool that set the
explosive bolts for cracking a cold pour, re-bored to lob those charges at a
wall -- and hull plate bolted round the crew well. It is named for what it
does to buildings.

  - **The sled is the point.** Low, wide and flat, a skirt just off the
    ground, two big ducted fans let into the deck under bars. The fans are
    most of what the camera sees, and they never stop.
  - **The hull is salvage over a working machine**: plate slabs bolted round
    the crew well and along the flanks, mismatched and overlapping, with the
    ducts, the exhausts and the fan housings left as they were.
  - **The blade stays**, hazard-striped, teeth along its lower edge. A
    Breaker leads with it.
  - **The mortar is short and heavy**, in a squat housing at the front of the
    deck on recoil rams, its charges racked on the flanks in canisters. It
    fires straight ahead and the whole hull rocks when it does.
  - **Paint** on the housing's top plate and the flank slabs; the fans, the
    ducts, the blade and the skirt never. **Ember** in the stern exhausts and
    the charge canisters, and a lamp on the crew hatch.

WHY IT IS BUILT LIKE THIS
-------------------------
Silhouette first: the widest, flattest thing in a Directorate army, two round
grates in its back and a stubby gun on its nose. It hovers, so it never
touches the ground and never stands still: the bob, the fans and the skirt's
sway are what say "running" from the game camera, before any detail does.

Built from rigid pieces, each weighted to one bone (kit.rigid_part), in the
vehicle surfaces (surfaces.py): the structures' cold steel for the hull, the
figure's servo steel and rubber for the mechanism and the skirt.

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

CONTENT_ID = "vanguard.hovertank"
PREVIEW_DIR = os.environ.get("RTS_PREVIEW_DIR", os.path.join(kit.REPO, "art", "previews"))
TEXTURE_SIZE = int(os.environ.get("RTS_TEXTURE_SIZE", "1024"))

kit.fresh_scene()
col = kit.collection("Breaker")
s = surfaces.vehicle_surfaces(scale=2.0)
lamp = kit.directorate_palette()["lamp"]


def rot(axis, degrees):
    return Matrix.Rotation(math.radians(degrees), 3, axis)


def rect(x0, x1, y0, y1, c=0.0):
    """A rectangle with its corners cut back by `c`, anticlockwise, for kit.prism."""
    return [(x1, y0 + c), (x1, y1 - c), (x1 - c, y1), (x0 + c, y1), (x0, y1 - c), (x0, y0 + c), (x0 + c, y0),
            (x1 - c, y0)]


# ---------------------------------------------------------------------------
# Proportions, in tiles, at true size: 1.3 long, 0.86 wide, hovering with its
# skirt a hand off the ground. The deck is at 0.3; nothing but the housing,
# the hatch and the aerials stands above it.
# ---------------------------------------------------------------------------

X0, X1, Y0, Y1 = -0.62, 0.58, -0.42, 0.42
BOTTOM, DECK = 0.09, 0.3
SKIRT = 0.03
FAN_R = 0.16
FANS = {"fan.L": (-0.22, 0.23), "fan.R": (-0.22, -0.23)}
GUN_Z = 0.41
HATCH = Vector((-0.05, 0.0))

bones = [
    ("root", (0, 0, 0), (0, 0, 0.3), None),
    ("hull", (-0.1, 0, BOTTOM), (-0.1, 0, DECK), "root"),
    ("skirt", (-0.1, 0, SKIRT), (-0.1, 0, BOTTOM), "hull"),
    ("gun", (0.44, 0, GUN_Z), (0.8, 0, GUN_Z), "hull"),
    ("hatch", (HATCH.x, HATCH.y, DECK), (HATCH.x, HATCH.y, DECK + 0.1), "hull"),
]
for name, (x, y) in FANS.items():
    bones.append((name, (x, y, DECK - 0.06), (x, y, DECK + 0.1), "hull"))
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
# The hull and its skirt.
# ---------------------------------------------------------------------------

piece(kit.prism(rect(X0, X1, Y0, Y1, 0.1), BOTTOM, DECK, top_scale=0.96), s["plate"], "hull", bevel=0.012)
# The lip the deck plates sit in.
piece(kit.prism(rect(X0 + 0.03, X1 - 0.03, Y0 + 0.03, Y1 - 0.03, 0.1), DECK - 0.01, DECK + 0.02, top_scale=0.99),
      s["iron"], "hull", bevel=0.006)
# The skirt: rubber, ribbed, swaying on its own bone.
piece(kit.prism(rect(X0 - 0.01, X1 - 0.01, Y0 - 0.01, Y1 + 0.01, 0.12), SKIRT, BOTTOM + 0.01, top_scale=0.985),
      s["rubber"], "skirt")
for k in range(7):
    x = X0 + 0.08 + k * 0.17
    for sy, y in ((1, Y1), (-1, Y0)):
        box((0.05, 0.02, 0.07), (x, y + sy * 0.005, BOTTOM - 0.03), s["rubber"], "skirt", bevel=0.004)
for y in (-0.28, -0.1, 0.1, 0.28):
    box((0.02, 0.05, 0.07), (X0 - 0.005, y, BOTTOM - 0.03), s["rubber"], "skirt", bevel=0.004)

# Deck plates: mismatched sheets over the crew well, each a little askew.
for (cx, cy, lx, ly, spin) in ((-0.5, 0.0, 0.16, 0.7, 1.0), (-0.22, 0.0, 0.14, 0.12, -1.5), (0.08, 0.28, 0.26, 0.22, 0.8),
                               (0.08, -0.28, 0.26, 0.22, -1.2), (0.03, 0.0, 0.16, 0.3, 0.4)):
    box((lx, ly, 0.02), (cx, cy, DECK + 0.02), s["plate"], "hull", rot("Z", spin), bevel=0.004)

# Flank slabs: issued armour, painted, bolted along both sides and leaning out.
for sy in (1, -1):
    y = sy * (Y1 + 0.025)
    for cx, lx, lean in ((0.2, 0.34, 8), (-0.2, 0.36, 10), (-0.52, 0.16, 6)):
        box((lx, 0.03, 0.15), (cx, y, 0.21), s["paint"], "hull", rot("X", -lean * sy), painted=True, bevel=0.006)
        for dx in (-lx * 0.35, 0.0, lx * 0.35):
            piece(kit.rod((cx + dx, y + sy * 0.014, 0.26), (cx + dx, y + sy * 0.024, 0.26), 0.008, segments=5),
                  s["servo"], "hull")
    # A patch welded over something that went through.
    box((0.12, 0.02, 0.09), (0.05, y + sy * 0.01, 0.19), s["plate"], "hull", rot("X", -9 * sy) @ rot("Z", 12),
        bevel=0.004)

# ---------------------------------------------------------------------------
# The blade at the nose: hazard-striped, toothed, braced back to the hull.
# ---------------------------------------------------------------------------

box((0.05, 0.86, 0.26), (X1 + 0.08, 0, 0.17), s["hazard"], "hull", rot("Y", -14), bevel=0.008)
box((0.06, 0.88, 0.03), (X1 + 0.11, 0, 0.305), s["iron"], "hull", rot("Y", -14), bevel=0.005)
for k in range(7):
    y = -0.36 + k * 0.12
    box((0.05, 0.06, 0.05), (X1 + 0.13, y, 0.05), s["iron"], "hull", rot("Y", 12), bevel=0.005)
for y in (-0.25, 0.25):
    piece(kit.beam((X1 - 0.02, y, 0.26), (X1 + 0.07, y, 0.1), 0.035), s["iron"], "hull", bevel=0.004)
    piece(kit.beam((X1 - 0.05, y, DECK - 0.02), (X1 + 0.06, y, 0.3), 0.025), s["iron"], "hull")

# ---------------------------------------------------------------------------
# The lift fans: an open duct of segments, the blades turning inside it, and
# bars over the top. What the camera sees most of, so the bars are wide apart.
# ---------------------------------------------------------------------------

# The ducts stand proud of the deck rather than being sunk into it: a well
# cut into the hull would be inside the hull's own top face, and the blades
# in it would be baked into the dark. Raised, the ring is a shape from the
# air and the blades turn in the open between the bars.
for name, (x, y) in FANS.items():
    for k in range(14):
        a = k * 360 / 14
        p = Vector((x + math.cos(math.radians(a)) * (FAN_R + 0.02), y + math.sin(math.radians(a)) * (FAN_R + 0.02),
                    DECK + 0.045))
        box((0.03, 0.082, 0.085), p, s["iron"], "hull", rot("Z", a))
    # The duct's floor, dark, and nothing over its mouth but the bars: a rod
    # is a solid cylinder, and a lip drawn as one capped the whole duct.
    piece(kit.rod((x, y, DECK + 0.005), (x, y, DECK + 0.015), FAN_R + 0.01, segments=14), s["rubber"], "hull")
    for k in range(14):
        a = k * 360 / 14
        p = Vector((x + math.cos(math.radians(a)) * (FAN_R + 0.03), y + math.sin(math.radians(a)) * (FAN_R + 0.03),
                    DECK + 0.093))
        box((0.05, 0.084, 0.014), p, s["plate"], "hull", rot("Z", a))
    for k in range(5):
        dy = -0.12 + k * 0.06
        half = math.sqrt(max(FAN_R * FAN_R - dy * dy, 0.0)) + 0.025
        piece(kit.beam((x - half, y + dy, DECK + 0.08), (x + half, y + dy, DECK + 0.08), 0.012, width=0.02),
              s["grate"], "hull")
    piece(kit.rod((x, y, DECK + 0.01), (x, y, DECK + 0.06), 0.035, segments=8), s["servo"], name)
    for k in range(4):
        a = math.radians(k * 90)
        tip = Vector((math.cos(a), math.sin(a), 0)) * (FAN_R - 0.01)
        piece(kit.beam((x, y, DECK + 0.045), (x + tip.x, y + tip.y, DECK + 0.045), 0.012, width=0.05),
              s["servo"], name)

# ---------------------------------------------------------------------------
# The stern: three exhausts glowing behind their slats, and the tow hooks.
# ---------------------------------------------------------------------------

for y in (-0.24, 0.0, 0.24):
    box((0.03, 0.14, 0.1), (X0 - 0.01, y, 0.2), s["iron"], "hull", bevel=0.006)
    box((0.01, 0.1, 0.07), (X0 - 0.028, y, 0.2), lamp, "hull")
    for dz in (-0.025, 0.0, 0.025):
        box((0.012, 0.11, 0.01), (X0 - 0.032, y, 0.2 + dz), s["grate"], "hull")
for y in (-0.36, 0.36):
    piece(kit.beam((X0 + 0.02, y, 0.14), (X0 - 0.06, y, 0.14), 0.03, width=0.05), s["iron"], "hull", bevel=0.005)
    box((0.03, 0.05, 0.04), (X0 - 0.07, y, 0.14), s["hazard"], "hull")
for x in (-0.4, -0.15):
    piece(kit.rod((x, Y0 - 0.005, 0.12), (x, Y1 + 0.005, 0.12), 0.012, segments=6), s["iron"], "hull")

# ---------------------------------------------------------------------------
# The mortar in its housing, on recoil rams, and its charges on the flanks.
# ---------------------------------------------------------------------------

box((0.34, 0.4, 0.15), (0.26, 0, DECK + 0.075), s["plate"], "hull", bevel=0.01)
box((0.3, 0.36, 0.024), (0.26, 0, DECK + 0.16), s["paint"], "hull", painted=True, bevel=0.005)
for x, y in ((0.14, -0.15), (0.14, 0.15), (0.38, -0.15), (0.38, 0.15)):
    piece(kit.rod((x, y, DECK + 0.17), (x, y, DECK + 0.182), 0.012, segments=6), s["servo"], "hull")
box((0.04, 0.24, 0.12), (0.44, 0, GUN_Z), s["iron"], "hull", bevel=0.006)
for sy in (1, -1):
    piece(kit.rod((0.3, sy * 0.13, GUN_Z + 0.03), (0.48, sy * 0.13, GUN_Z + 0.02), 0.022, segments=8), s["iron"],
          "hull")
    piece(kit.rod((0.46, sy * 0.13, GUN_Z + 0.02), (0.6, sy * 0.13, GUN_Z + 0.01), 0.013, segments=6), s["servo"],
          "gun")
    box((0.04, 0.03, 0.05), (0.6, sy * 0.13, GUN_Z), s["iron"], "gun", bevel=0.004)
piece(kit.rod((0.36, 0, GUN_Z), (0.78, 0, GUN_Z), 0.055, segments=12), s["iron"], "gun")
piece(kit.rod((0.5, 0, GUN_Z), (0.56, 0, GUN_Z), 0.062, segments=12), s["plate"], "gun", bevel=0.004)
piece(kit.rod((0.66, 0, GUN_Z), (0.7, 0, GUN_Z), 0.06, segments=12), s["hazard"], "gun")
piece(kit.rod((0.77, 0, GUN_Z), (0.82, 0, GUN_Z), 0.068, segments=12, radius_end=0.062), s["iron"], "gun",
      bevel=0.004)
piece(kit.rod((0.815, 0, GUN_Z), (0.822, 0, GUN_Z), 0.042, segments=10), lamp, "gun")
box((0.1, 0.06, 0.05), (0.42, 0, GUN_Z + 0.09), s["plate"], "gun", bevel=0.004)
box((0.006, 0.04, 0.03), (0.472, 0, GUN_Z + 0.09), lamp, "gun")

# Charge canisters racked on both flanks of the housing, each banded ember.
for sy in (1, -1):
    for x in (0.16, 0.24, 0.32):
        piece(kit.rod((x, sy * 0.22, DECK + 0.04), (x, sy * 0.22, DECK + 0.14), 0.028, segments=8), s["iron"], "hull")
        piece(kit.rod((x, sy * 0.22, DECK + 0.085), (x, sy * 0.22, DECK + 0.1), 0.03, segments=8), lamp, "hull")
        piece(kit.rod((x, sy * 0.22, DECK + 0.14), (x, sy * 0.22, DECK + 0.155), 0.018, segments=6), s["rubber"],
              "hull")
    piece(kit.beam((0.11, sy * 0.25, DECK + 0.12), (0.37, sy * 0.25, DECK + 0.12), 0.012), s["hazard"], "hull")

# ---------------------------------------------------------------------------
# The crew hatch, the aerials, and the number.
# ---------------------------------------------------------------------------

piece(kit.rod((HATCH.x, HATCH.y, DECK + 0.02), (HATCH.x, HATCH.y, DECK + 0.05), 0.1, segments=12), s["iron"],
      "hull", bevel=0.006)
piece(kit.rod((HATCH.x, HATCH.y, DECK + 0.05), (HATCH.x, HATCH.y, DECK + 0.07), 0.085, segments=12), s["plate"],
      "hatch", bevel=0.005)
piece(kit.beam((HATCH.x - 0.05, HATCH.y, DECK + 0.085), (HATCH.x + 0.05, HATCH.y, DECK + 0.085), 0.014), s["iron"],
      "hatch")
box((0.04, 0.04, 0.04), (HATCH.x + 0.11, HATCH.y - 0.02, DECK + 0.05), s["iron"], "hull", bevel=0.004)
box((0.02, 0.03, 0.02), (HATCH.x + 0.13, HATCH.y - 0.02, DECK + 0.05), lamp, "hull")
box((0.1, 0.008, 0.05), (-0.36, Y1 + 0.03, 0.2), s["ceramic"], "hull")
for sy, top in ((1, 0.62), (-1, 0.54)):
    base = Vector((-0.55, sy * 0.3, DECK + 0.02))
    box((0.03, 0.03, 0.03), base, s["iron"], "hull")
    piece(kit.rod(base, (base.x - 0.02, base.y, top), 0.005, segments=5), s["iron"], "hull")
    piece(kit.rod((base.x - 0.02, base.y, top), (base.x - 0.021, base.y, top + 0.012), 0.008, segments=5), lamp,
          "hull")

kit.ground_check(parts)
body = kit.join(parts, "body")
print("breaker geometry:", kit.report(col))

surfaces.unwrap(body, kit)
images = surfaces.bake(body, kit, "breaker", size=TEXTURE_SIZE)
surfaces.save_images(images, os.path.join(PREVIEW_DIR, "textures"))

kit.bind(body, rig)

# ---------------------------------------------------------------------------
# Clips. It hovers, so every clip moves: the bob, the fans and the skirt are
# what say "running". Fans are keyed a third of a turn at a time, linear, so
# they neither ease nor flip.
# ---------------------------------------------------------------------------


def fans(frames, per_turn):
    return {name: {f: [("Z", f * 360 / per_turn)] for f in range(0, frames + 1, per_turn // 3)} for name in FANS}


IDLE = 90
kit.track_clip(rig, "idle", IDLE, {
    **fans(IDLE, 30),
    "hull": {0: [], 22: [("loc", (0, 0, 0.012)), ("X", 0.6)], 45: [], 67: [("loc", (0, 0, -0.01)), ("X", -0.6)],
             90: []},
    "skirt": {0: [], 22: [("X", -1.2)], 45: [], 67: [("X", 1.2)], 90: []},
}, linear=tuple(FANS))

WALK = 30
kit.track_clip(rig, "walk", WALK, {
    **fans(WALK, 15),
    # Nose down into it, bobbing twice a cycle.
    "hull": {0: [("Y", 3)], 7: [("loc", (0, 0, 0.008)), ("Y", 3)], 15: [("Y", 3)],
             22: [("loc", (0, 0, 0.008)), ("Y", 3)], 30: [("Y", 3)]},
    "skirt": {0: [("Y", -2)], 15: [("Y", -3)], 30: [("Y", -2)]},
}, linear=tuple(FANS))

# The mortar slams back into its rams; the hull pitches nose-up on its cushion
# and settles.
kit.track_clip(rig, "fire", 14, {
    **fans(14, 15),
    "gun": {0: [], 1: [("loc", (-0.11, 0, 0))], 4: [("loc", (-0.07, 0, 0))], 9: []},
    "hull": {0: [], 2: [("Y", -4), ("loc", (0, 0, 0.012))], 7: [("Y", -1)], 11: [("Y", 0.5)], 14: []},
    "skirt": {0: [], 2: [("Y", 3)], 8: [], 14: []},
}, linear=tuple(FANS))

kit.rest_pose(rig)
stats = kit.report(col)
print("breaker:", stats)
print("wrote", kit.export_rigged(col, CONTENT_ID))
print("wrote", kit.save_blend(CONTENT_ID))

if os.environ.get("RTS_PREVIEWS", "1") != "0":
    os.makedirs(PREVIEW_DIR, exist_ok=True)

    def pose(action, frame):
        return lambda: kit.set_pose(rig, bpy.data.actions[action], frame)

    print("previews", kit.previews(col, PREVIEW_DIR, "breaker", frame=2.0, poses=[
        ("walk", pose("walk", 7)),
        ("fire-kick", pose("fire", 2)),
    ]))
