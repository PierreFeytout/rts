"""
The Servitor -- the Ashen Directorate's labour. Content id: vanguard.drone.

    blender -b --factory-startup --python scripts/models/servitor.py

WHAT IT IS (UNIVERSE.md)
------------------------
"Labour, not a machine." Servitors are labourers wired into the harness of a
hauling rig until there is little to tell apart. The rig is the same class of
loader frame the Conscript fights in -- the powered exoskeleton every foundry
hand on this world has worn since they could walk -- but a hauler's frame:
heavier in the legs, hunched under the hopper it carries on its back, its arms
ending in the tools of the strip-back rather than in hands.

  - **The frame is the Conscript's**, older than the war: machined rams and
    servo housings at every joint, salvage plate bolted over the front of it,
    wide flat boots. Heavier, because it carries.
  - **The hopper is the load**, high on the back where a frame carries best:
    recovered alloy heaped above its rim, hazard marking on the edge, the
    Contract Office's paint on its side panels -- the largest painted faces
    on the figure, which is how a player's own Servitors read from the air.
  - **The left arm is a cutter**, a disc saw in a guard, for opening scrap
    seams; the right a grapple, for what comes out. Barely a weapon, and
    that is the point.
  - **Wired in.** Cables run from the pack into the back of the hood and the
    spine; there is no seat and no cage. The hood is a welder's hood, sealed,
    one ember lens. The contract number is on the backplate, under the
    hopper, where the officer reads it.

WHY IT IS BUILT LIKE THIS
-------------------------
Silhouette first: a Conscript's frame with a box on its back and a disc on one
arm, hunched forward. At playing zoom that is what has to read: the load high
over the shoulders, the disc leading, the wide plant of the feet. It is built
from the same pieces as the Conscript, in the same surfaces, so the two read
as one machine in two jobs.

Built from rigid pieces, each weighted to one bone (kit.rigid_part), baked to
one texture set (surfaces.py). One figure per entity.

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

CONTENT_ID = "vanguard.drone"
PREVIEW_DIR = os.environ.get("RTS_PREVIEW_DIR", os.path.join(kit.REPO, "art", "previews"))
TEXTURE_SIZE = int(os.environ.get("RTS_TEXTURE_SIZE", "1024"))

kit.fresh_scene()
col = kit.collection("Servitor")
s = surfaces.armour_surfaces()
s["hazard"] = surfaces.hazard()
s["grate"] = surfaces.grate()
lamp = kit.directorate_palette()["lamp"]


def rot(axis, degrees):
    return Matrix.Rotation(math.radians(degrees), 3, axis)


# ---------------------------------------------------------------------------
# Skeleton. The Conscript's, stockier: hips at 0.2, shoulders at 0.36, and the
# legs set wider for the load. The hopper rides the chest; each arm is one
# bone from the shoulder to the tool, and the cutter's disc has a bone of its
# own so it can spin.
# ---------------------------------------------------------------------------

HIP, KNEE, ANKLE = 0.2, 0.112, 0.034
LEG_Y = 0.056
SHOULDER_Z = 0.352
CUTTER = Vector((0.27, 0.1, 0.16))
CLAW = Vector((0.2, -0.11, 0.16))

bones = [
    ("pelvis", (0, 0, HIP), (0, 0, 0.268), None),
    ("chest", (0, 0, 0.268), (0, 0, 0.37), "pelvis"),
    ("head", (0.03, 0, 0.36), (0.05, 0, 0.43), "chest"),
    ("cutter.arm", (0, 0.1, SHOULDER_Z), tuple(CUTTER), "chest"),
    ("cutter", (CUTTER.x, CUTTER.y - 0.03, CUTTER.z), (CUTTER.x, CUTTER.y + 0.03, CUTTER.z), "cutter.arm"),
    ("claw.arm", (0, -0.1, SHOULDER_Z), tuple(CLAW), "chest"),
]
for side, y in (("L", LEG_Y), ("R", -LEG_Y)):
    bones.append((f"thigh.{side}", (0, y, HIP), (0, y, KNEE), "pelvis"))
    bones.append((f"shin.{side}", (0, y, KNEE), (0, y, ANKLE), f"thigh.{side}"))
    bones.append((f"foot.{side}", (0, y, ANKLE), (0.066, y, 0.026), f"shin.{side}"))
rig = kit.armature("rig", col, bones)

parts = []
count = [0]


def piece(bm, mat, bone, painted=False, bevel=None, segments=3):
    count[0] += 1
    obj = kit.rigid_part(f"{bone}.{count[0]}", bm, mat, col, bone, painted=painted)
    if bevel is not None:
        kit.bevel(obj, width=bevel, segments=segments)
    parts.append(obj)
    return obj


def box(size, centre, mat, bone, rotation=None, **kw):
    return piece(kit.box(size, centre, rotation), mat, bone, **kw)


# ---------------------------------------------------------------------------
# Legs: the frame's rams and servos with plate over the front, as on the
# Conscript, on heavier bones and wider boots.
# ---------------------------------------------------------------------------

for side, y in (("L", LEG_Y), ("R", -LEG_Y)):
    thigh, shin, foot = f"thigh.{side}", f"shin.{side}", f"foot.{side}"
    out = 1 if side == "L" else -1

    piece(kit.rod((0, y - 0.024 * out, HIP - 0.004), (0, y + 0.03 * out, HIP - 0.004), 0.03, segments=20),
          s["servo"], thigh)
    piece(kit.rod((0, y + 0.028 * out, HIP - 0.004), (0, y + 0.036 * out, HIP - 0.004), 0.015, segments=16),
          s["iron"], thigh)
    piece(kit.frustum((0.054, 0.054), (0.062, 0.06), KNEE + 0.006, HIP - 0.008, (0, y)), s["iron"], thigh,
          bevel=0.008)
    box((0.018, 0.062, 0.076), (0.032, y, 0.164), s["plate"], thigh, rot("Y", -6), bevel=0.006)
    piece(kit.rod((0.006, y + 0.054 * out, HIP - 0.018), (0.004, y + 0.05 * out, KNEE + 0.014), 0.01, segments=12),
          s["servo"], thigh)
    piece(kit.rod((0.006, y + 0.054 * out, HIP - 0.03), (0.006, y + 0.054 * out, HIP - 0.008), 0.014, segments=12),
          s["iron"], thigh)

    piece(kit.rod((0, y - 0.032 * out, KNEE), (0, y + 0.036 * out, KNEE), 0.026, segments=20), s["servo"], shin)
    box((0.016, 0.054, 0.036), (0.032, y, KNEE + 0.008), s["plate"], shin, rot("Y", -10), bevel=0.005)
    piece(kit.frustum((0.046, 0.05), (0.054, 0.054), ANKLE + 0.008, KNEE - 0.01, (0, y)), s["iron"], shin,
          bevel=0.007)
    box((0.016, 0.056, 0.062), (0.03, y, 0.076), s["plate"], shin, rot("Y", 4), bevel=0.005)
    piece(kit.rod((-0.024, y + 0.032 * out, KNEE - 0.012), (-0.02, y + 0.03 * out, ANKLE + 0.012), 0.009, segments=12),
          s["servo"], shin)

    piece(kit.rod((0, y - 0.026, ANKLE), (0, y + 0.026, ANKLE), 0.018, segments=16), s["servo"], foot)
    # As long as the Conscript's boot, wider: a longer boot's toe dipped under
    # the ground mid-stride, where the sole tilts a degree between keys.
    box((0.088, 0.07, 0.032), (0.016, y, 0.03), s["plate"], foot, bevel=0.007)
    box((0.03, 0.066, 0.022), (0.056, y, 0.022), s["iron"], foot, rot("Y", 8), bevel=0.005)
    box((0.102, 0.074, 0.012), (0.018, y, 0.008), s["rubber"], foot)
    box((0.024, 0.066, 0.024), (-0.026, y, 0.022), s["iron"], foot, bevel=0.004)

# ---------------------------------------------------------------------------
# Hips: the waist block, a belt of the frame's hardware, tassets over the
# thighs, and the struts that take the hopper's weight down to the pelvis.
# ---------------------------------------------------------------------------

piece(kit.frustum((0.06, 0.096), (0.074, 0.108), HIP - 0.008, 0.262), s["iron"], "pelvis", bevel=0.01)
box((0.02, 0.09, 0.048), (0.054, 0, 0.238), s["plate"], "pelvis", rot("Y", -8), bevel=0.006)
box((0.084, 0.114, 0.018), (0, 0, 0.258), s["leather"], "pelvis")
box((0.01, 0.03, 0.022), (0.046, 0, 0.258), s["servo"], "pelvis", bevel=0.004)
for y in (0.034, -0.034):
    box((0.012, 0.054, 0.054), (0.054, y, 0.214), s["plate"], "pelvis", rot("Y", -14), bevel=0.005)
    box((0.01, 0.052, 0.046), (-0.054, y, 0.22), s["plate"], "pelvis", rot("Y", 12), bevel=0.004)
    piece(kit.rod((-0.032, y * 1.6, 0.25), (-0.014, y * 1.9, 0.208), 0.007, segments=12), s["rubber"], "pelvis")
for y in (0.06, -0.06):
    box((0.028, 0.026, 0.032), (0.014, y * 1.02, 0.242), s["leather"], "pelvis", bevel=0.005)

# ---------------------------------------------------------------------------
# Chest: the frame's spine and yoke, the chest plate, and the pack -- and on
# the back, the hopper with the load in it.
# ---------------------------------------------------------------------------

piece(kit.frustum((0.054, 0.084), (0.066, 0.098), 0.262, 0.358), s["iron"], "chest", bevel=0.012)
box((0.022, 0.1, 0.072), (0.056, 0, 0.31), s["paint"], "chest", rot("Y", -7), painted=True, bevel=0.007)
box((0.014, 0.104, 0.012), (0.054, 0, 0.274), s["iron"], "chest", rot("Y", -7))
for z in (0.29, 0.328):
    box((0.01, 0.108, 0.008), (0.046, 0, z), s["servo"], "chest")
piece(kit.rod((0.03, 0, 0.352), (0.03, 0, 0.372), 0.038, segments=20), s["servo"], "chest")
piece(kit.rod((0.03, 0, 0.37), (0.03, 0, 0.378), 0.032, segments=16), s["rubber"], "chest")

# The backframe the hopper hangs off, and the number plate under it.
box((0.03, 0.12, 0.11), (-0.06, 0, 0.32), s["iron"], "chest", bevel=0.006)
box((0.012, 0.08, 0.05), (-0.078, 0, 0.29), s["ceramic"], "chest", bevel=0.004)
for y in (0.05, -0.05):
    piece(kit.beam((-0.07, y, 0.36), (-0.15, y, 0.4), 0.02), s["iron"], "chest", bevel=0.004)
    piece(kit.beam((-0.07, y, 0.29), (-0.15, y, 0.34), 0.02), s["iron"], "chest", bevel=0.004)
    piece(kit.beam((-0.04, y * 1.4, HIP + 0.05), (-0.15, y * 1.4, 0.34), 0.014), s["servo"], "pelvis")

# The hopper: an open bin, side panels in the owner's paint, hazard on its rim,
# and the recovered alloy heaped above it.
HX, HZ = -0.17, 0.42
box((0.2, 0.2, 0.014), (HX, 0, HZ - 0.06), s["plate"], "chest", bevel=0.004)
for y in (0.1, -0.1):
    box((0.2, 0.014, 0.12), (HX, y, HZ), s["plate"], "chest", bevel=0.005)
    box((0.15, 0.008, 0.08), (HX, y * 1.1, HZ), s["paint"], "chest", painted=True)
    box((0.21, 0.02, 0.012), (HX, y, HZ + 0.066), s["hazard"], "chest")
box((0.014, 0.2, 0.12), (HX - 0.1, 0, HZ), s["plate"], "chest", bevel=0.005)
box((0.014, 0.2, 0.09), (HX + 0.1, 0, HZ - 0.015), s["iron"], "chest", bevel=0.005)
box((0.02, 0.21, 0.012), (HX - 0.1, 0, HZ + 0.066), s["hazard"], "chest")
for k in range(3):
    piece(kit.rod((HX - 0.1 + k * 0.1, 0.108, HZ), (HX - 0.1 + k * 0.1, 0.114, HZ), 0.006, segments=10), s["servo"],
          "chest")
    piece(kit.rod((HX - 0.1 + k * 0.1, -0.108, HZ), (HX - 0.1 + k * 0.1, -0.114, HZ), 0.006, segments=10), s["servo"],
          "chest")
for size, centre, (rx, ry, rz), mat in (
    ((0.07, 0.06, 0.04), (HX - 0.04, 0.04, HZ + 0.07), (12, 25, 30), "iron"),
    ((0.06, 0.08, 0.035), (HX + 0.03, -0.04, HZ + 0.065), (-20, 8, -15), "plate"),
    ((0.05, 0.05, 0.05), (HX + 0.02, 0.05, HZ + 0.06), (30, -10, 45), "iron"),
    ((0.08, 0.04, 0.03), (HX - 0.05, -0.05, HZ + 0.075), (5, -22, 60), "servo"),
    ((0.04, 0.04, 0.06), (HX - 0.01, 0.0, HZ + 0.08), (40, 10, 20), "plate"),
):
    box(size, centre, s[mat], "chest", rot("Z", rz) @ rot("Y", ry) @ rot("X", rx))

# The pack, under the hopper: the frame's power, vented hot, and the stack
# that stands clear of the load.
box((0.05, 0.11, 0.07), (-0.1, 0, 0.27), s["plate"], "chest", bevel=0.007)
for y in (0.03, -0.03):
    box((0.008, 0.022, 0.036), (-0.126, y, 0.268), lamp, "chest")
box((0.006, 0.09, 0.046), (-0.122, 0, 0.268), s["iron"], "chest")
piece(kit.rod((-0.1, 0.09, 0.3), (-0.09, 0.115, 0.5), 0.012, segments=12), s["iron"], "chest")
piece(kit.rod((-0.09, 0.115, 0.495), (-0.09, 0.115, 0.505), 0.016, segments=12), s["servo"], "chest")

# Wired in: cables from the pack up the spine into the hood and the collar.
for i, path in enumerate((
    [(-0.076, 0.03, 0.31), (-0.05, 0.04, 0.35), (-0.01, 0.035, 0.38), (0.02, 0.026, 0.4)],
    [(-0.076, -0.03, 0.31), (-0.05, -0.04, 0.35), (-0.01, -0.035, 0.38), (0.02, -0.026, 0.4)],
    [(-0.076, 0.0, 0.3), (-0.04, 0.0, 0.34), (0.0, 0.0, 0.365)],
)):
    for a, b in zip(path, path[1:]):
        piece(kit.rod(a, b, 0.006, segments=10), s["rubber"], "chest")

# Shoulders: the yoke and its servos. No pauldrons -- nobody armoured a hauler.
for side, sign in (("L", 1), ("R", -1)):
    piece(kit.rod((0, 0.052 * sign, 0.356), (0, 0.1 * sign, 0.35), 0.028, segments=16), s["servo"], "chest")
    piece(kit.rod((0, 0.098 * sign, 0.35), (0, 0.118 * sign, 0.35), 0.034, segments=20), s["iron"], "chest")
    box((0.06, 0.03, 0.05), (0.0, 0.122 * sign, 0.33), s["plate"], "chest", rot("X", -12 * sign), bevel=0.006)

# ---------------------------------------------------------------------------
# Head: the welder's hood, sunk forward between the shoulders and cabled at
# the back.
# ---------------------------------------------------------------------------

box((0.064, 0.066, 0.058), (0.04, 0, 0.41), s["plate"], "head", bevel=0.016, segments=4)
piece(kit.ellipsoid((0.033, 0.034, 0.02), (0.038, 0, 0.436), segments=16, rings=8), s["iron"], "head")
box((0.016, 0.06, 0.05), (0.076, 0, 0.408), s["plate"], "head", rot("Y", -12), bevel=0.005)
box((0.01, 0.056, 0.012), (0.084, 0, 0.42), s["iron"], "head", rot("Y", -16))
box((0.006, 0.048, 0.011), (0.085, 0, 0.412), lamp, "head")
piece(kit.rod((0.072, 0, 0.386), (0.092, 0, 0.384), 0.014, segments=16), s["servo"], "head")
for y in (0.035, -0.035):
    box((0.026, 0.008, 0.026), (0.04, y, 0.406), s["servo"], "head", bevel=0.004)
    piece(kit.rod((0.01, y * 0.8, 0.4), (0.02, y * 0.8, 0.4), 0.009, segments=12), s["rubber"], "head")

# ---------------------------------------------------------------------------
# The arms: the frame's servo tubes with plate sleeves, ending in the tools.
# ---------------------------------------------------------------------------


def arm(bone, shoulder, elbow, hand):
    piece(kit.rod(shoulder, elbow, 0.019, segments=12, radius_end=0.016), s["servo"], bone)
    box((0.036, 0.04, 0.042), shoulder.lerp(elbow, 0.42), s["plate"], bone, bevel=0.006)
    piece(kit.rod(elbow + Vector((0, -0.014, 0)), elbow + Vector((0, 0.014, 0)), 0.018, segments=16), s["servo"], bone)
    piece(kit.rod(elbow, hand, 0.015, segments=12, radius_end=0.013), s["servo"], bone)
    box((0.05, 0.036, 0.036), elbow.lerp(hand, 0.45), s["plate"], bone, bevel=0.005)
    ram_a = shoulder + Vector((0.02, 0.018 * (1 if shoulder.y > 0 else -1), -0.02))
    piece(kit.rod(ram_a, elbow.lerp(hand, 0.2), 0.008, segments=12), s["servo"], bone)


# The cutter: a disc saw in a guard on the left, leading.
arm("cutter.arm", Vector((0, 0.1, SHOULDER_Z)), Vector((0.12, 0.13, 0.31)), Vector((0.24, 0.1, 0.19)))
box((0.05, 0.05, 0.05), (0.25, 0.1, 0.18), s["iron"], "cutter.arm", bevel=0.006)
box((0.09, 0.032, 0.03), (CUTTER.x + 0.01, CUTTER.y, CUTTER.z + 0.05), s["paint"], "cutter.arm", rot("Y", 6),
    painted=True, bevel=0.004)
box((0.02, 0.03, 0.02), (0.235, 0.1, 0.21), lamp, "cutter.arm")
piece(kit.rod((CUTTER.x, CUTTER.y - 0.006, CUTTER.z), (CUTTER.x, CUTTER.y + 0.006, CUTTER.z), 0.058, segments=32),
      s["iron"], "cutter")
piece(kit.rod((CUTTER.x, CUTTER.y - 0.012, CUTTER.z), (CUTTER.x, CUTTER.y + 0.012, CUTTER.z), 0.018, segments=16),
      s["servo"], "cutter")
for k in range(10):
    a = k * 36
    p = CUTTER + Vector((math.cos(math.radians(a)) * 0.056, 0, math.sin(math.radians(a)) * 0.056))
    box((0.014, 0.01, 0.012), p, s["servo"], "cutter", rot("Y", -a))

# The grapple: three fingers on a wrist servo, on the right.
arm("claw.arm", Vector((0, -0.1, SHOULDER_Z)), Vector((0.1, -0.14, 0.3)), Vector((0.18, -0.11, 0.19)))
piece(kit.rod((0.18, -0.126, 0.18), (0.18, -0.094, 0.18), 0.02, segments=16), s["servo"], "claw.arm")
for a in (-40, 0, 40):
    turn = rot("Y", a)
    root = Vector((0.19, -0.11, 0.17))
    tip = root + turn @ Vector((0.05, 0, -0.03))
    piece(kit.beam(root, tip, 0.012), s["iron"], "claw.arm")
    piece(kit.beam(tip, tip + turn @ Vector((0.02, 0, -0.03)), 0.01), s["plate"], "claw.arm")

kit.ground_check(parts)
body = kit.join(parts, "body")
print("servitor geometry:", kit.report(col))

# ---------------------------------------------------------------------------
# Textures: unwrap once, bake every surface into one set of images.
# ---------------------------------------------------------------------------

surfaces.unwrap(body, kit)
images = surfaces.bake(body, kit, "servitor", size=TEXTURE_SIZE)
surfaces.save_images(images, os.path.join(PREVIEW_DIR, "textures"))

kit.bind(body, rig)
# Larger than life, like the Conscript, and for the same reason.
SCALE = 1.35
rig.scale = (SCALE, SCALE, SCALE)

# ---------------------------------------------------------------------------
# Clips, in the Conscript's terms (see conscript.py for why): a bent knee
# lowers the hips by exactly what the leg geometry says, and a boot at rest
# height stays flat.
# ---------------------------------------------------------------------------

THIGH_LEN, SHIN_LEN = HIP - KNEE, KNEE - ANKLE


def legs(a, b, va, vb):
    out = {}
    for side, (thigh, shin, sole) in ((a, va), (b, vb)):
        out[f"thigh.{side}"] = [("Y", thigh)]
        out[f"shin.{side}"] = [("Y", shin)]
        out[f"foot.{side}"] = [("Y", sole - thigh - shin)]
    return out


def hip_drop(thigh, shin):
    reach = THIGH_LEN * math.cos(math.radians(thigh)) + SHIN_LEN * math.cos(math.radians(thigh + shin))
    return reach - (THIGH_LEN + SHIN_LEN)


# Standing under the load: the knees flex, the frame settles, the hood looks
# about, and the cutter idles at the end of its arm.
def settle(bend, **rest):
    pose = legs("L", "R", (0, bend, 0), (0, bend, 0))
    pose["pelvis"] = [("loc", (0, 0, hip_drop(0, bend)))]
    pose["chest"] = [("Y", 6)]
    pose.update(rest)
    return pose


kit.clip(rig, "idle", 60, {
    0: settle(0),
    16: settle(5, head=[("Z", 12), ("Y", -3)], **{"cutter.arm": [("Y", 3)]}),
    34: settle(2, head=[("Z", -10)], **{"claw.arm": [("Y", 4)]}),
    48: settle(4, head=[("Z", 3)]),
    60: settle(0),
})

# The march: the Conscript's, under a load. The lean is deeper, the arms hang
# and swing a little, and the hopper rides the bob.
LEAN = 7


def march(a, b, va, vb, drop, roll, swing):
    pose = legs(a, b, va, vb)
    pose["pelvis"] = [("loc", (0, 0, drop)), ("X", roll), ("Z", swing)]
    pose["chest"] = [("Y", LEAN), ("Z", -swing * 1.3), ("X", -roll * 0.6)]
    pose["head"] = [("Y", -3), ("Z", swing * 0.5), ("X", -roll * 0.4)]
    pose["cutter.arm"] = [("Y", -swing * 1.5)]
    pose["claw.arm"] = [("Y", swing * 1.5)]
    return pose


WALK = {}
for step, (a, b) in enumerate((("L", "R"), ("R", "L"))):
    t = step * 8
    sign = 1 if a == "L" else -1
    WALK[t + 0] = march(a, b, (-24, 14, 0), (22, 30, 20), hip_drop(-24, 14), 2 * sign, 4 * sign)
    WALK[t + 2] = march(a, b, (-4, 42, 0), (6, 58, -5), hip_drop(-4, 42), 4 * sign, 2 * sign)
    WALK[t + 4] = march(a, b, (8, 6, 0), (-14, 50, -12), hip_drop(8, 6), 1 * sign, -1 * sign)
    WALK[t + 6] = march(a, b, (22, 16, 13), (-28, 16, -5), -0.010, -2 * sign, -3 * sign)
WALK[16] = WALK[0]
kit.clip(rig, "walk", 16, WALK)

# Cutting: the frame braces and the cutter comes down into what is in front
# of it, the disc spinning up; then the arm lifts clear. Its "attack".
BRACE_DROP = hip_drop(-24, 30)


def cutting(arm_down, chest, spin, sink=0.0):
    pose = legs("L", "R", (-24, 30, 0), (16, 14, 8))
    pose["pelvis"] = [("loc", (0, 0, BRACE_DROP + sink)), ("Z", 5)]
    pose["chest"] = [("Y", chest), ("Z", -4)]
    pose["head"] = [("Y", 2)]
    pose["cutter.arm"] = [("Y", arm_down)]
    pose["cutter"] = [("Y", spin)]
    pose["claw.arm"] = [("Y", arm_down * 0.3)]
    return pose


# The arm dips five degrees and no more: the disc hangs a hand off the ground
# at rest, and at twenty-five it was cutting the ground rather than the seam.
# The cut is sold by the spin and the brace, not by the reach.
kit.clip(rig, "fire", 16, {
    0: cutting(0, 6, 0),
    3: cutting(4, 9, 180, -0.003),
    6: cutting(5, 10, 360, -0.004),
    9: cutting(5, 9, 540, -0.003),
    12: cutting(2, 7, 720),
    16: cutting(0, 6, 720),
})

for clip_name, clip_frames in (("idle", 60), ("walk", 16), ("fire", 16)):
    floor = kit.pose_floor(rig, body, bpy.data.actions[clip_name], clip_frames)
    lowest = min(floor, key=lambda f: f[1])
    print(f"floor {clip_name}: lowest {lowest[1]} at frame {lowest[0]} on {lowest[2]}")

kit.rest_pose(rig)
stats = kit.report(col)
print("servitor:", stats)
print("wrote", kit.export_rigged(col, CONTENT_ID))
print("wrote", kit.save_blend(CONTENT_ID))

if os.environ.get("RTS_PREVIEWS", "1") != "0":
    os.makedirs(PREVIEW_DIR, exist_ok=True)

    def pose(action, frame):
        return lambda: kit.set_pose(rig, bpy.data.actions[action], frame)

    print("previews", kit.previews(col, PREVIEW_DIR, "servitor", poses=[
        ("walk-contact", pose("walk", 0)),
        ("cut", pose("fire", 6)),
    ]))
