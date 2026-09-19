"""
The Conscript -- the Ashen Directorate's line infantry. Content id: vanguard.trooper.

    blender -b --factory-startup --python scripts/models/conscript.py

WHAT IT IS (UNIVERSE.md)
------------------------
"Numbered before named." They were foundry hands, and a foundry hand does not
carry hull plate in their arms -- they wear a **loader frame** to do it: a
powered exoskeleton for lifting slag and stock, which is the same machine the
Servitors are wired into permanently. When the Directorate armed the workforce
it did not issue armour. It bolted plate onto the frame they already worked in.

That is the whole design, and every part of it follows:

  - **The frame is older than the war.** Machined rams, servo housings and
    actuator rods at every joint, bright steel against everything else on this
    world -- the one surface here made to a tolerance, because a powered frame
    only reads as powered if the mechanism is visibly finer than what is
    bolted over it. Rusting at the seals, because it is decades old.
  - **The armour is salvage.** Cut hull plate, mismatched between panels,
    scorched at the torch cuts, bolted over a frame it was never made for.
    Nothing is fitted; everything laps and overhangs.
  - **The helmet is still a welder's hood**, sealed now: one horizontal lens
    burning ember where the eyes are, which is also what says which way a
    figure faces at playing zoom.
  - **The pack is a foundry pack** -- the frame's power, vented hot, with the
    heat glow in the vents and the stacks standing above the shoulders.
  - **Paint is ownership.** The owner's colour goes only on what the Contract
    Office issued: the pauldrons, the faceplate and the chest plate. Never on
    the frame, never on salvage.
  - **The contract number** is on the backplate, where the officer reads it.
  - The weapon is still a site tool: a rivet driver re-bored to fire white-hot
    bolts, now heavy enough that the frame is what holds it level. Long, and
    carried out in front, because range is this unit's whole identity.

WHY IT IS BUILT LIKE THIS
-------------------------
Silhouette first. At playing zoom a figure is forty pixels tall, so what reads
is the outline and nothing else: shoulders far wider than the hips, a small
sealed head sunk between them, and a heavy plant at the feet. The detail below
that scale exists for the portrait and for the moment the player zooms in.

Built from rigid pieces, each weighted to one bone (kit.rigid_part), in
procedural surfaces baked to one texture set (surfaces.py). One entity is a
squad of three, in a wedge.

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
s = surfaces.armour_surfaces()
lamp = kit.directorate_palette()["lamp"]


def rot(axis, degrees):
    return Matrix.Rotation(math.radians(degrees), 3, axis)


# ---------------------------------------------------------------------------
# Skeleton. Built 0.46 tall -- hips at 0.212, shoulders at 0.375 -- and scaled
# below. Legs sit wider apart than a man's: the frame's rams run outside the
# thigh, and a narrow stance under those shoulders reads as a figure about to
# fall over.
#
# Feet are bones of their own, which the old model did without. A powered
# frame's weight is sold almost entirely at the moment a foot lands, and a
# boot that cannot roll from heel to toe cannot land -- it can only arrive.
# ---------------------------------------------------------------------------

HIP, KNEE, ANKLE = 0.212, 0.118, 0.034
LEG_Y = 0.046

bones = [
    ("pelvis", (0, 0, HIP), (0, 0, 0.278), None),
    ("chest", (0, 0, 0.278), (0, 0, 0.385), "pelvis"),
    ("head", (0, 0, 0.385), (0, 0, 0.462), "chest"),
    # The weapon and both arms, as one piece pivoting at the shoulder: a recoil
    # is the whole weapon kicking up, arms and all.
    ("rifle", (0, -0.032, 0.322), (0.2, -0.032, 0.322), "chest"),
]
for side, y in (("L", LEG_Y), ("R", -LEG_Y)):
    bones.append((f"thigh.{side}", (0, y, HIP), (0, y, KNEE), "pelvis"))
    bones.append((f"shin.{side}", (0, y, KNEE), (0, y, ANKLE), f"thigh.{side}"))
    bones.append((f"foot.{side}", (0, y, ANKLE), (0.062, y, 0.026), f"shin.{side}"))
rig = kit.armature("rig", col, bones)

parts = []


def piece(name, bm, mat, bone, painted=False, bevel=None, segments=3):
    obj = kit.rigid_part(name, bm, mat, col, bone, painted=painted)
    if bevel is not None:
        kit.bevel(obj, width=bevel, segments=segments)
    parts.append(obj)
    return obj


# ---------------------------------------------------------------------------
# Legs: the frame's rams and servos, with plate strapped over the front of
# them. The mechanism is on the outside of each leg where the camera sees it,
# and the armour on the front where a shot would come from.
# ---------------------------------------------------------------------------

for side, y in (("L", LEG_Y), ("R", -LEG_Y)):
    thigh, shin, foot = f"thigh.{side}", f"shin.{side}", f"foot.{side}"
    out = 1 if side == "L" else -1

    # Hip: the frame's main pivot, a servo housing the leg hangs off.
    piece(f"{thigh}.servo", kit.rod((0, y - 0.022 * out, HIP - 0.004), (0, y + 0.026 * out, HIP - 0.004),
                                    0.028, segments=20), s["servo"], thigh)
    piece(f"{thigh}.hub", kit.rod((0, y + 0.024 * out, HIP - 0.004), (0, y + 0.032 * out, HIP - 0.004),
                                  0.014, segments=16), s["iron"], thigh)

    # The thigh itself: a structural member, not a limb.
    piece(f"{thigh}.frame", kit.frustum((0.05, 0.05), (0.058, 0.056), KNEE + 0.006, HIP - 0.008, (0, y)),
          s["iron"], thigh, bevel=0.008)
    # Armour, bolted over the front of it and overhanging.
    piece(f"{thigh}.plate", kit.box((0.018, 0.058, 0.082), (0.03, y, 0.172), rotation=rot("Y", -6)),
          s["plate"], thigh, bevel=0.006)
    # The ram that drives the knee, outside the leg.
    piece(f"{thigh}.ram", kit.rod((0.006, y + 0.05 * out, HIP - 0.018), (0.004, y + 0.046 * out, KNEE + 0.014),
                                  0.009, segments=12), s["servo"], thigh)
    piece(f"{thigh}.ram.cap", kit.rod((0.006, y + 0.05 * out, HIP - 0.03), (0.006, y + 0.05 * out, HIP - 0.008),
                                      0.013, segments=12), s["iron"], thigh)

    # Knee: a big exposed servo disc, and a cap over it.
    piece(f"{shin}.servo", kit.rod((0, y - 0.03 * out, KNEE), (0, y + 0.034 * out, KNEE), 0.024, segments=20),
          s["servo"], shin)
    piece(f"{shin}.cap", kit.box((0.016, 0.05, 0.036), (0.03, y, KNEE + 0.008), rotation=rot("Y", -10)),
          s["plate"], shin, bevel=0.005)

    # Shin: frame, armoured shin plate, and the ankle actuator behind it.
    piece(f"{shin}.frame", kit.frustum((0.042, 0.046), (0.05, 0.05), ANKLE + 0.008, KNEE - 0.01, (0, y)),
          s["iron"], shin, bevel=0.007)
    piece(f"{shin}.plate", kit.box((0.016, 0.052, 0.066), (0.028, y, 0.078), rotation=rot("Y", 4)),
          s["plate"], shin, bevel=0.005)
    piece(f"{shin}.ram", kit.rod((-0.022, y + 0.03 * out, KNEE - 0.012), (-0.018, y + 0.028 * out, ANKLE + 0.012),
                                 0.008, segments=12), s["servo"], shin)

    # Ankle and boot: wide, flat, and heavy. The toe is a separate plate so
    # the foot has an edge to roll over.
    piece(f"{foot}.ankle", kit.rod((0, y - 0.024, ANKLE), (0, y + 0.024, ANKLE), 0.017, segments=16),
          s["servo"], foot)
    piece(f"{foot}.boot", kit.box((0.088, 0.062, 0.032), (0.016, y, 0.03)), s["plate"], foot, bevel=0.007)
    piece(f"{foot}.toe", kit.box((0.03, 0.058, 0.022), (0.056, y, 0.022), rotation=rot("Y", 8)),
          s["iron"], foot, bevel=0.005)
    piece(f"{foot}.sole", kit.box((0.102, 0.066, 0.012), (0.018, y, 0.008)), s["rubber"], foot)
    piece(f"{foot}.heel", kit.box((0.022, 0.058, 0.024), (-0.024, y, 0.022)), s["iron"], foot, bevel=0.004)

# ---------------------------------------------------------------------------
# Hips: the frame's waist block, a belt of the frame's own hardware, and
# tassets hanging over the thighs.
# ---------------------------------------------------------------------------

piece("waist", kit.frustum((0.056, 0.086), (0.07, 0.098), HIP - 0.008, 0.272), s["iron"], "pelvis", bevel=0.01)
piece("waist.plate", kit.box((0.02, 0.084, 0.05), (0.05, 0, 0.246), rotation=rot("Y", -8)),
      s["plate"], "pelvis", bevel=0.006)
piece("belt", kit.box((0.078, 0.104, 0.018), (0, 0, 0.268)), s["leather"], "pelvis")
piece("belt.clamp", kit.box((0.01, 0.028, 0.022), (0.042, 0, 0.268)), s["servo"], "pelvis", bevel=0.004)
for y in (0.052, -0.052):
    piece(f"pouch{y}", kit.box((0.026, 0.024, 0.03), (0.012, y * 1.02, 0.25)), s["leather"], "pelvis", bevel=0.005)
for y in (0.03, -0.03):
    # Tassets: issued plate, so they carry the owner's colour.
    piece(f"tasset{y}", kit.box((0.012, 0.05, 0.056), (0.05, y, 0.222), rotation=rot("Y", -14)),
          s["paint"], "pelvis", painted=True, bevel=0.005)
    piece(f"tasset{y}.rear", kit.box((0.01, 0.048, 0.046), (-0.05, y, 0.228), rotation=rot("Y", 12)),
          s["plate"], "pelvis", bevel=0.004)
    # Power down to each leg.
    piece(f"conduit{y}", kit.rod((-0.03, y * 1.6, 0.258), (-0.012, y * 1.9, 0.214), 0.007, segments=12),
          s["rubber"], "pelvis")

# ---------------------------------------------------------------------------
# Chest: the frame's spine and shoulder yoke, a cut hull plate over the front,
# and the pack on the back.
# ---------------------------------------------------------------------------

piece("torso", kit.frustum((0.05, 0.076), (0.062, 0.09), 0.272, 0.372), s["iron"], "chest", bevel=0.012)
# The issued chest plate: sloped, overhanging, and the largest painted area on
# the figure -- which is what makes the owner readable at playing zoom.
piece("chest.plate", kit.box((0.022, 0.092, 0.078), (0.052, 0, 0.322), rotation=rot("Y", -7)),
      s["paint"], "chest", painted=True, bevel=0.007)
piece("chest.rim", kit.box((0.014, 0.096, 0.012), (0.05, 0, 0.284), rotation=rot("Y", -7)), s["iron"], "chest")
for z in (0.3, 0.34):
    piece(f"rib{z}", kit.box((0.01, 0.1, 0.008), (0.042, 0, z)), s["servo"], "chest")

# The number goes here, where the officer reads it.
piece("backplate", kit.box((0.014, 0.086, 0.09), (-0.048, 0, 0.318)), s["ceramic"], "chest", bevel=0.005)

# Neck: a sealed ring, not a collar.
piece("collar", kit.rod((0, 0, 0.366), (0, 0, 0.386), 0.036, segments=20), s["servo"], "chest")
piece("collar.seal", kit.rod((0, 0, 0.384), (0, 0, 0.392), 0.03, segments=16), s["rubber"], "chest")

# The pack: the frame's power, vented hot.
piece("pack", kit.box((0.05, 0.11, 0.086), (-0.072, 0, 0.33)), s["plate"], "chest", bevel=0.008)
piece("pack.lid", kit.box((0.044, 0.098, 0.012), (-0.072, 0, 0.376)), s["iron"], "chest", bevel=0.004)
for y in (0.034, 0, -0.034):
    piece(f"pack.vent{y}", kit.box((0.008, 0.024, 0.042), (-0.096, y, 0.326)), lamp, "chest")
piece("pack.grille", kit.box((0.006, 0.09, 0.05), (-0.09, 0, 0.326)), s["iron"], "chest")
for y in (0.042, -0.042):
    piece(f"stack{y}", kit.rod((-0.062, y, 0.378), (-0.058, y, 0.424), 0.011, segments=12), s["iron"], "chest")
    piece(f"stack{y}.cap", kit.rod((-0.058, y, 0.42), (-0.058, y, 0.43), 0.015, segments=12), s["servo"], "chest")

# Hoses from the pack up to the helmet's seal.
hose = [(-0.05, 0.03, 0.372), (-0.03, 0.042, 0.386), (0.004, 0.04, 0.39), (0.024, 0.024, 0.386)]
for i, (a, b) in enumerate(zip(hose, hose[1:])):
    piece(f"hose{i}", kit.rod(a, b, 0.006, segments=10), s["rubber"], "chest")

# ---------------------------------------------------------------------------
# Shoulders: the yoke, and the pauldrons bolted to it. These are the widest
# thing on the figure by a long way -- the single feature that says "powered"
# from the game camera.
# ---------------------------------------------------------------------------

for side, sign in (("L", 1), ("R", -1)):
    piece(f"yoke.{side}", kit.rod((0, 0.05 * sign, 0.368), (0, 0.092 * sign, 0.362), 0.026, segments=16),
          s["servo"], "chest")
    piece(f"shoulder.{side}.servo", kit.rod((0, 0.09 * sign, 0.362), (0, 0.108 * sign, 0.362), 0.031, segments=20),
          s["iron"], "chest")
    # The pauldron: a cut hull panel, sloped outward and down, overhanging the
    # arm. Issued, so painted.
    piece(f"pauldron.{side}",
          kit.box((0.082, 0.05, 0.07), (0.0, 0.114 * sign, 0.346), rotation=rot("X", -14 * sign)),
          s["paint"], "chest", painted=True, bevel=0.009, segments=4)
    piece(f"pauldron.{side}.rim",
          kit.box((0.086, 0.016, 0.012), (0.0, 0.124 * sign, 0.312), rotation=rot("X", -20 * sign)),
          s["iron"], "chest", bevel=0.003)
    for x in (0.026, -0.022):
        piece(f"pauldron.{side}.bolt{x}",
              kit.rod((x, 0.104 * sign, 0.372), (x, 0.112 * sign, 0.374), 0.005, segments=10), s["servo"], "chest")

# ---------------------------------------------------------------------------
# Head: a sealed hood. Small on purpose -- a head this size between those
# shoulders is most of what makes the figure read as armoured rather than big.
# ---------------------------------------------------------------------------

piece("helmet", kit.box((0.062, 0.064, 0.058), (-0.006, 0, 0.424)), s["plate"], "head", bevel=0.016, segments=4)
piece("helmet.crown", kit.ellipsoid((0.032, 0.033, 0.02), (-0.008, 0, 0.45), segments=16, rings=8),
      s["iron"], "head")
# The faceplate, cut back at an angle, with the lens slot across it.
piece("face", kit.box((0.016, 0.058, 0.05), (0.03, 0, 0.424), rotation=rot("Y", -10)),
      s["paint"], "head", painted=True, bevel=0.005)
piece("lens.hood", kit.box((0.01, 0.054, 0.012), (0.038, 0, 0.436), rotation=rot("Y", -16)), s["iron"], "head")
piece("lens", kit.box((0.006, 0.046, 0.011), (0.039, 0, 0.428)), lamp, "head")
# The filter, sunk into the chin rather than hung off it.
piece("filter", kit.rod((0.026, 0, 0.402), (0.046, 0, 0.4), 0.014, segments=16), s["servo"], "head")
piece("filter.grille", kit.rod((0.044, 0, 0.4), (0.05, 0, 0.4), 0.011, segments=12), s["rubber"], "head")
for y in (0.034, -0.034):
    piece(f"ear{y}", kit.box((0.026, 0.008, 0.026), (-0.004, y, 0.42)), s["servo"], "head", bevel=0.004)
# One aerial, which breaks the helmet's outline against the ground.
piece("aerial", kit.rod((-0.018, 0.03, 0.448), (-0.026, 0.036, 0.492), 0.0035, segments=10), s["iron"], "head")
piece("aerial.tip", kit.rod((-0.026, 0.036, 0.488), (-0.027, 0.037, 0.496), 0.005, segments=10), lamp, "head")

# ---------------------------------------------------------------------------
# The rivet driver, and the armoured arms that hold it. All one bone: the
# frame carries the weapon's weight, so the weapon and the arms move together.
# ---------------------------------------------------------------------------

GUN_Y, GUN_Z = -0.032, 0.318
piece("receiver", kit.box((0.15, 0.03, 0.042), (0.07, GUN_Y, GUN_Z)), s["plate"], "rifle", bevel=0.005)
piece("receiver.top", kit.box((0.1, 0.026, 0.01), (0.074, GUN_Y, GUN_Z + 0.026)), s["iron"], "rifle")
# The drum of rivets, hung under the receiver.
piece("drum", kit.rod((0.048, GUN_Y - 0.016, GUN_Z - 0.036), (0.048, GUN_Y + 0.016, GUN_Z - 0.036), 0.028,
                      segments=20), s["iron"], "rifle")
piece("drum.hub", kit.rod((0.048, GUN_Y - 0.02, GUN_Z - 0.036), (0.048, GUN_Y + 0.02, GUN_Z - 0.036), 0.01,
                          segments=12), s["servo"], "rifle")
# The shroud, its heat vents, and the coils that drive a bolt white-hot.
piece("shroud", kit.rod((0.14, GUN_Y, GUN_Z + 0.004), (0.25, GUN_Y, GUN_Z + 0.004), 0.015, segments=20),
      s["iron"], "rifle")
for i, x in enumerate((0.158, 0.182, 0.206)):
    piece(f"vent{i}", kit.box((0.012, 0.022, 0.008), (x, GUN_Y, GUN_Z + 0.019)), s["rubber"], "rifle")
for i, x in enumerate((0.224, 0.244, 0.264)):
    piece(f"coil{i}", kit.rod((x - 0.004, GUN_Y, GUN_Z + 0.004), (x + 0.004, GUN_Y, GUN_Z + 0.004), 0.019,
                              segments=16), lamp, "rifle")
piece("barrel", kit.rod((0.26, GUN_Y, GUN_Z + 0.004), (0.336, GUN_Y, GUN_Z + 0.004), 0.009, segments=16),
      s["servo"], "rifle")
piece("brake", kit.box((0.03, 0.026, 0.026), (0.348, GUN_Y, GUN_Z + 0.004)), s["iron"], "rifle", bevel=0.005)
# An optic, which is the clearest single sign that this is a weapon and not a pipe.
piece("optic", kit.box((0.05, 0.02, 0.018), (0.116, GUN_Y, GUN_Z + 0.04)), s["plate"], "rifle", bevel=0.004)
piece("optic.lens", kit.box((0.005, 0.014, 0.012), (0.142, GUN_Y, GUN_Z + 0.04)), lamp, "rifle")
piece("optic.mount", kit.box((0.03, 0.014, 0.014), (0.116, GUN_Y, GUN_Z + 0.028)), s["iron"], "rifle")
piece("grip", kit.box((0.02, 0.022, 0.044), (0.008, GUN_Y, GUN_Z - 0.036), rotation=rot("Y", 16)),
      s["rubber"], "rifle", bevel=0.004)
piece("stock", kit.beam((-0.012, GUN_Y, GUN_Z - 0.004), (-0.088, GUN_Y, GUN_Z - 0.014), 0.026, width=0.024),
      s["plate"], "rifle", bevel=0.005)
piece("buttpad", kit.box((0.012, 0.026, 0.042), (-0.094, GUN_Y, GUN_Z - 0.016)), s["rubber"], "rifle", bevel=0.004)

# Right hand on the grip, left hand forward under the shroud. The arms are
# armoured tubes with a servo at the elbow -- the same frame as the legs.
arms = {
    "R": [(0.0, -0.078, 0.35), (-0.016, -0.076, 0.29), (0.012, GUN_Y - 0.016, GUN_Z - 0.03)],
    "L": [(0.0, 0.078, 0.35), (0.05, 0.062, 0.3), (0.132, GUN_Y + 0.016, GUN_Z - 0.014)],
}
for side, (shoulder, elbow, hand) in arms.items():
    ex, ey, ez = elbow
    piece(f"arm.{side}.upper", kit.rod(shoulder, elbow, 0.018, segments=12, radius_end=0.015),
          s["servo"], "rifle")
    piece(f"arm.{side}.sleeve", kit.box((0.034, 0.038, 0.04),
                                        [a + (b - a) * 0.42 for a, b in zip(shoulder, elbow)]),
          s["plate"], "rifle", bevel=0.006)
    # The elbow servo's disc lies across the hinge, so the joint reads as a
    # joint rather than as a kink in a pipe.
    piece(f"arm.{side}.elbow", kit.rod((ex, ey - 0.013, ez), (ex, ey + 0.013, ez), 0.017, segments=16),
          s["servo"], "rifle")
    piece(f"arm.{side}.lower", kit.rod(elbow, hand, 0.014, segments=12, radius_end=0.012), s["servo"], "rifle")
    cuff = [e + (h - e) * 0.45 for e, h in zip(elbow, hand)]
    piece(f"arm.{side}.vambrace", kit.box((0.05, 0.034, 0.034), cuff), s["plate"], "rifle", bevel=0.005)
    piece(f"arm.{side}.hand", kit.box((0.026, 0.024, 0.022), hand), s["iron"], "rifle", bevel=0.005)

kit.ground_check(parts)
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
    0.17, 0.0, 0.0,
    -0.13, 0.23, 0.37,
    -0.13, -0.23, 0.71,
]

# ---------------------------------------------------------------------------
# Clips. Rotations in armature axes (see kit.pose_rotation):
#   about Y, positive tips an upright bone forward and a leg's foot back --
#     so on a foot bone, which points forward, positive is toe-down;
#   about Z, positive turns toward the figure's left;
#   about X, positive rolls the figure's left side up.
# ---------------------------------------------------------------------------


def legs(a, b, va, vb):
    """Both legs, as `(thigh, shin, sole)` degrees for the `a` and `b` sides.

    `sole` is the boot's angle **against the ground**, not against the shin:
    0 is flat, positive is toe-down. The foot bone is a child of the shin and
    so inherits everything the thigh and the shin are doing, which means a
    pose written in the bone's own terms tips the boot by whatever the leg
    above it happens to be doing -- and a boot tipped at all, at rest height,
    has one end of its sole underground. Cancelling the parents here is what
    makes "flat" mean flat in every pose in this file.
    """
    out = {}
    for side, (thigh, shin, sole) in ((a, va), (b, vb)):
        out[f"thigh.{side}"] = [("Y", thigh)]
        out[f"shin.{side}"] = [("Y", shin)]
        out[f"foot.{side}"] = [("Y", sole - thigh - shin)]
    return out


# ---------------------------------------------------------------------------
# WHERE THE FEET GO
#
# Two facts about this rig decide every pose below, and neither is obvious
# until the model is standing in the game with its boots buried:
#
#   1. **Bending a knee lowers the hips.** The leg is a fixed 0.178 long
#      (thigh 0.094, shin 0.084), so a pose cannot both bend the knees and
#      keep the pelvis where it was -- the foot would have to leave the
#      ground. The pelvis drop is therefore *derived* from the leg angles,
#      never chosen beside them, which is what `hip_drop` is for.
#   2. **A foot at rest height cannot rotate.** The sole lies flat on the
#      ground, so any rotation drives one end of it underground. A foot may
#      only roll if its ankle has risen far enough to let it -- which is why
#      the plant in this walk is *flat*. A loader frame slams its whole boot
#      down; heel-to-toe rolling is how an unarmoured person walks, and it is
#      not what this thing is.
#
# `kit.pose_floor` reports the lowest point of the model on every frame of
# every clip, and the numbers below were tuned against it rather than guessed.
# ---------------------------------------------------------------------------

THIGH_LEN, SHIN_LEN = HIP - KNEE, KNEE - ANKLE


def hip_drop(thigh, shin):
    """How far the pelvis falls when one leg is bent like this, keeping its
    foot flat on the ground. Negative, and zero only for a straight leg."""
    reach = THIGH_LEN * math.cos(math.radians(thigh)) + SHIN_LEN * math.cos(math.radians(thigh + shin))
    return reach - (THIGH_LEN + SHIN_LEN)


# Standing: the frame idling under load. It breathes from the pack rather than
# the chest -- a weight shift and a slow settle, not a ribcage -- and looks
# around now and then. The knees flex a few degrees and the hips follow them
# down by the millimetre that costs; anything more and a standing squad is
# ankle-deep in the ground. Two seconds, so a crowd does not visibly cycle.
def settle(bend, **rest):
    pose = legs("L", "R", (0, bend, 0), (0, bend, 0))
    pose["pelvis"] = [("loc", (0, 0, hip_drop(0, bend)))]
    pose.update(rest)
    return pose


kit.clip(rig, "idle", 60, {
    0: settle(0),
    16: settle(5, chest=[("Y", -1.5)], head=[("Z", 13), ("Y", -2)], rifle=[("Y", 3)]),
    34: settle(2, chest=[("Y", 1), ("Z", -2)], head=[("Z", -9)], rifle=[("Y", 1.5)]),
    48: settle(4, chest=[("Y", -1)], head=[("Z", 2)], rifle=[("Y", 2.5)]),
    60: settle(0),
})

# ---------------------------------------------------------------------------
# The march.
#
# The old walk was a jog: a light figure leaning into a run. This one is the
# opposite and has to be, because the figure now weighs what a loader frame
# weighs. Everything here is in service of that one impression:
#
#   - The body FALLS onto each foot and is caught. The pelvis drops nearly a
#     centimetre at every plant and rises through the passing frame, which is
#     twice the bob a person walks with and is the single strongest weight cue
#     available at this size.
#   - The foot lands HEEL FIRST and rolls. That is what the foot bones are for.
#   - The frame rolls side to side onto the leg carrying it, and the chest
#     counter-rotates so the weapon stays pointed where the unit is going.
#   - The knees stay bent. A straight leg reads as light.
#
# Sixteen frames, which is two steps at the speed this unit actually covers
# ground -- the renderer scales the playback rate to the distance travelled,
# so the stride length here is what keeps the feet from skating.
# ---------------------------------------------------------------------------

LEAN = 4


def march(a, b, va, vb, drop, roll, swing):
    """One phase: `a` is the leg carrying the weight, `b` the one swinging."""
    pose = legs(a, b, va, vb)
    pose["pelvis"] = [("loc", (0, 0, drop)), ("X", roll), ("Z", swing)]
    pose["chest"] = [("Y", LEAN), ("Z", -swing * 1.4), ("X", -roll * 0.6)]
    # The head stays level and facing forward through all of it. A helmet that
    # rolls with the body makes the figure look like it is being carried.
    pose["head"] = [("Z", swing * 0.5), ("X", -roll * 0.4)]
    # The weapon rides the bob rather than fighting it, but stays level: the
    # frame is what is carrying its weight, and a frame does not tire.
    pose["rifle"] = [("Y", -LEAN - drop * 70), ("Z", -swing * 0.5)]
    return pose


WALK = {}
for step, (a, b) in enumerate((("L", "R"), ("R", "L"))):
    t = step * 8
    sign = 1 if a == "L" else -1
    # Contact: the whole boot lands at once, out in front, and the frame
    # starts to take the weight. The other leg is still on its toe behind.
    WALK[t + 0] = march(a, b, (-24, 14, 0), (22, 30, 20),
                        hip_drop(-24, 14), 2 * sign, 4 * sign)
    # Absorb: the weight arrives on a bent knee. Lowest point of the cycle,
    # and the frame of the whole walk that has to sell the mass.
    WALK[t + 2] = march(a, b, (-4, 42, 0), (6, 58, -5),
                        hip_drop(-4, 42), 4 * sign, 2 * sign)
    # Passing: driven back up over a nearly straight leg, the other swinging
    # through underneath with the knee high. Highest point of the cycle.
    WALK[t + 4] = march(a, b, (8, 6, 0), (-14, 50, -12),
                        hip_drop(8, 6), 1 * sign, -1 * sign)
    # Push: rolled onto the toe and shoving off, the other leg reaching. The
    # ankle has risen far enough by now that the boot is allowed to rotate.
    WALK[t + 6] = march(a, b, (22, 16, 13), (-28, 16, -5),
                        -0.010, -2 * sign, -3 * sign)
WALK[16] = WALK[0]
kit.clip(rig, "walk", 16, WALK)

# ---------------------------------------------------------------------------
# Firing.
#
# Differentiated from the march by POSTURE first and motion second, because a
# clip that differs only in motion is unreadable at forty pixels: the figure
# has to be standing differently before the recoil even starts.
#
# So the frame BRACES. It drops into a wide stance, left leg forward, both
# knees loaded, hips squared to the target -- and every frame of the clip
# holds that stance, including the ones where nothing is recoiling. Then the
# weapon kicks hard and the whole frame absorbs it: the chest rocks back, the
# body sinks another notch, and it settles. The helmet never leaves the
# target, which is what makes it read as aimed rather than as flinching.
# ---------------------------------------------------------------------------

# Left foot forward and flat, right leg back with the heel just off the
# ground -- so the drop is the left leg's, and the right ankle rides high
# enough for its boot to tip onto the toe without digging in.
BRACE_DROP = hip_drop(-28, 32)


def firing(rifle, chest, sink, head=0.0):
    pose = legs("L", "R", (-28, 32, 0), (18, 16, 8))
    pose["pelvis"] = [("loc", (0, 0, BRACE_DROP + sink)), ("Z", -7)]
    pose["chest"] = [("Y", chest), ("Z", 5)]
    pose["head"] = [("Y", head), ("Z", -2)]
    pose["rifle"] = [("Y", rifle)]
    return pose


kit.clip(rig, "fire", 12, {
    # Braced, weapon levelled.
    0: firing(0, 1, 0.0),
    # The bolt goes. One frame, so it is a jolt and not a swing.
    1: firing(-21, -8, -0.005, head=-3),
    3: firing(-14, -6, -0.003, head=-2),
    6: firing(-6, -2, -0.001),
    9: firing(-2, 0, 0.0),
    12: firing(0, 1, 0.0),
})

# Where the feet actually are, frame by frame. A planted boot belongs at the
# ground and never below it; see kit.pose_floor for why this is measured
# rather than looked at.
for clip_name, clip_frames in (("idle", 60), ("walk", 16), ("fire", 12)):
    floor = kit.pose_floor(rig, body, bpy.data.actions[clip_name], clip_frames)
    lowest = min(floor, key=lambda f: f[1])
    print(f"floor {clip_name}: lowest {lowest[1]} at frame {lowest[0]} on {lowest[2]}")
    if os.environ.get("RTS_FLOOR"):
        print("   ", " ".join(f"{f}:{z:+.4f}:{bone}" for f, z, bone in floor))

kit.rest_pose(rig)
stats = kit.report(col)
print("conscript:", stats)
print("wrote", kit.export_rigged(col, CONTENT_ID))
print("wrote", kit.save_blend(CONTENT_ID))

if os.environ.get("RTS_PREVIEWS", "1") != "0":
    os.makedirs(PREVIEW_DIR, exist_ok=True)

    def pose(action, frame):
        return lambda: kit.set_pose(rig, bpy.data.actions[action], frame)

    print("previews", kit.previews(col, PREVIEW_DIR, "conscript", poses=[
        ("walk-contact", pose("walk", 0)),
        ("walk-passing", pose("walk", 4)),
        ("fire-brace", pose("fire", 0)),
        ("fire-kick", pose("fire", 1)),
    ]))
