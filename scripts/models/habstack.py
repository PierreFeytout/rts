"""
The Habstack -- where the Ashen Directorate keeps its conscripts. Content id: vanguard.pylon.

    blender -b --factory-startup --python scripts/models/habstack.py

From its sheet in UNIVERSE.md. They were cargo pods from the Tender, the kind
freight travels in; they are the same pods stacked four high and fitted with
bunks, a ladder tower and a ration chute. People travel in them now. Nothing
else changed. It provides supply, and it is the tall thin building in a
Directorate base:

  - four pods, each set down a little askew on the one below: corner
    castings, ribbed sides, locking-bar doors on their ends in the owner's
    paint (+X), numbered hatches and slit windows along their sides (-Y);
  - a narrow stair tower in a painted frame at the +X end, a landing at every
    pod, a floodlight and a siren horn on top;
  - a vent fan on the top pod, a ration chute down to a hopper, a reel of
    cable hanging off the side;
  - a skid and a rockcrete pad under it all.

Paint: the pod ends and the tower's frame. The camera looks from +X and -Y.

ANIMATION. `build`: the pad rises; the pods come down one at a time and settle
onto the stack; the tower runs up beside them; the chute swings out; the
windows and the floodlight come on. `idle`: windows go light and dark as
shifts change, the floodlight sweeps, the fan turns. No `produce` or
`release`: it trains nothing.

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

CONTENT_ID = "vanguard.pylon"
FOOTPRINT = 2
PREVIEW_DIR = os.environ.get("RTS_PREVIEW_DIR", os.path.join(kit.REPO, "art", "previews"))
TEXTURE_SIZE = int(os.environ.get("RTS_TEXTURE_SIZE", "1024"))

kit.fresh_scene()
col = kit.collection("Habstack")
s = surfaces.structure_surfaces(scale=6.0)
lamp = kit.directorate_palette()["lamp"]
rng = random.Random(31)


def rot(axis, degrees):
    return Matrix.Rotation(math.radians(degrees), 3, axis)


# ---------------------------------------------------------------------------
# Proportions, in tiles. The footprint is +-1.
# ---------------------------------------------------------------------------

SKID = 0.14
L, W, H = 1.04, 0.56, 0.44
STACK = Vector((-0.22, -0.2))
# Each pod set down a little off the one below.
# Enough to see from the game camera; at a couple of degrees the stack read
# as one block.
OFFSETS = [(0.0, 0.0, 0.0), (0.07, -0.05, 5.5), (-0.05, 0.05, -4.0), (0.06, -0.03, 7.0)]
LEVELS = [SKID + H / 2 + k * (H + 0.01) for k in range(4)]
TOWER = Vector((0.66, 0.22))
TOWER_HALF = 0.16
TOWER_TOP = LEVELS[3] + H / 2 + 0.06
FLOOD = Vector((TOWER.x, TOWER.y, TOWER_TOP + 0.42))


def pod_frame(k):
    """Where pod k sits, and how it is turned."""
    dx, dy, yaw = OFFSETS[k]
    return Vector((STACK.x + dx, STACK.y + dy, LEVELS[k])), rot("Z", yaw)


def on_pod(k, local):
    centre, turn = pod_frame(k)
    return centre + turn @ Vector(local)


# ---------------------------------------------------------------------------
# Skeleton.
# ---------------------------------------------------------------------------

bones = [
    ("root", (0, 0, 0), (0, 0, 0.5), None),
    ("pad", (0, 0, 0), (0, 0, 0.1), "root"),
    ("tower", (TOWER.x, TOWER.y, SKID), (TOWER.x, TOWER.y, TOWER_TOP), "root"),
    ("flood", tuple(FLOOD), (FLOOD.x + 0.2, FLOOD.y, FLOOD.z), "tower"),
    ("chute", tuple(on_pod(2, (-L / 2, -W / 2, 0.0))), (-0.8, -0.8, 0.1), "root"),
]
for k in range(4):
    centre, _ = pod_frame(k)
    bones.append((f"pod.{k}", tuple(centre - Vector((0, 0, H / 2))), tuple(centre + Vector((0, 0, H / 2))), "root"))
    bones.append((f"win.{k}", tuple(on_pod(k, (0.15, -W / 2, 0.06))), tuple(on_pod(k, (0.15, -W / 2 - 0.2, 0.06))),
                  f"pod.{k}"))
bones.append(("fan", tuple(on_pod(3, (-0.22, 0.05, H / 2 + 0.06))), tuple(on_pod(3, (-0.22, 0.05, H / 2 + 0.3))),
              "pod.3"))
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


def pod_box(k, size, local, mat, bone=None, extra=None, **kw):
    """A box placed in pod k's own frame."""
    _, turn = pod_frame(k)
    rotation = turn if extra is None else turn @ extra
    return box(size, on_pod(k, local), mat, bone or f"pod.{k}", rotation, **kw)


# ---------------------------------------------------------------------------
# The pad and the skid.
# ---------------------------------------------------------------------------

for x in (-0.5, 0.5):
    for y in (-0.5, 0.5):
        tilt = rot("X", rng.uniform(-0.6, 0.6)) @ rot("Y", rng.uniform(-0.6, 0.6))
        box((0.96, 0.96, 0.08), (x, y, 0.04 + rng.uniform(-0.008, 0.01)), s["rockcrete"], "pad", tilt,
            bevel=None if (x, y) == (-0.5, 0.5) else 0.014)
# Hazard marking the length of the two pad edges the camera sees.
box((0.16, 1.9, 0.012), (0.91, 0.0, 0.086), s["hazard"], "pad")
box((1.9, 0.16, 0.012), (0.0, -0.91, 0.086), s["hazard"], "pad")

for y in (STACK.y - W / 2 + 0.08, STACK.y + W / 2 - 0.08):
    piece(kit.beam((STACK.x - L / 2 - 0.04, y, SKID - 0.03), (STACK.x + L / 2 + 0.04, y, SKID - 0.03), 0.06,
                   width=0.08), s["iron"], "pad", bevel=0.01)
for x in (STACK.x - 0.45, STACK.x, STACK.x + 0.45):
    piece(kit.beam((x, STACK.y - W / 2, SKID - 0.07), (x, STACK.y + W / 2, SKID - 0.07), 0.05), s["iron"], "pad")

# ---------------------------------------------------------------------------
# The pods.
# ---------------------------------------------------------------------------

NUMBER_PLATE = {0: 0.3, 1: -0.3, 2: 0.3, 3: -0.3}
for k in range(4):
    bone = f"pod.{k}"
    pod_box(k, (L, W, H), (0, 0, 0), s["plate"] if k % 2 else s["iron"], bevel=0.015)
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                pod_box(k, (0.075, 0.075, 0.07), (sx * (L / 2 - 0.02), sy * (W / 2 - 0.02), sz * (H / 2 - 0.02)),
                        s["iron"], bevel=0.006)
    # Ribbed along the side the camera sees.
    for x in (-0.38, -0.24, -0.1, 0.04, 0.18, 0.32):
        pod_box(k, (0.03, 0.022, H - 0.08), (x, -W / 2 - 0.011, 0), s["iron"])
    # The door end, in the owner's paint, with its locking bars.
    pod_box(k, (0.022, W - 0.08, H - 0.08), (L / 2 + 0.011, 0, 0), s["paint"], painted=True, bevel=0.006)
    for y in (-0.1, 0.1):
        a, b = on_pod(k, (L / 2 + 0.035, y, -H / 2 + 0.05)), on_pod(k, (L / 2 + 0.035, y, H / 2 - 0.05))
        piece(kit.rod(a, b, 0.012, segments=5), s["iron"], bone)
        for z in (-0.08, 0.08):
            pod_box(k, (0.03, 0.05, 0.025), (L / 2 + 0.035, y, z), s["iron"])
    pod_box(k, (0.012, 0.16, 0.08), (L / 2 + 0.024, -0.2 if k % 2 else 0.2, 0.1), s["ceramic"])
    # A numbered hatch, and slit windows lit from inside.
    hatch_x = -0.3 if k % 2 == 0 else 0.3
    pod_box(k, (0.18, 0.02, 0.3), (hatch_x, -W / 2 - 0.025, -0.02), s["plate"], bevel=0.006)
    a = on_pod(k, (hatch_x, -W / 2 - 0.035, 0.0))
    piece(kit.rod(a, a + pod_frame(k)[1] @ Vector((0, -0.03, 0)), 0.04, segments=8), s["iron"], bone)
    pod_box(k, (0.14, 0.012, 0.06), (NUMBER_PLATE[k], -W / 2 - 0.04, 0.13), s["ceramic"])
    # A caged lamp over the hatch.
    pod_box(k, (0.06, 0.04, 0.04), (hatch_x, -W / 2 - 0.035, 0.17), s["iron"])
    pod_box(k, (0.04, 0.02, 0.025), (hatch_x, -W / 2 - 0.05, 0.155), lamp)
    for x in (-0.08, 0.1):
        if abs(x - hatch_x) < 0.16 or abs(x - NUMBER_PLATE[k]) < 0.12:
            continue
        pod_box(k, (0.18, 0.02, 0.085), (x, -W / 2 - 0.026, 0.06), s["iron"])
        pod_box(k, (0.14, 0.012, 0.05), (x, -W / 2 - 0.034, 0.06), s["rubber"])
        pod_box(k, (0.13, 0.01, 0.042), (x, -W / 2 - 0.042, 0.06), lamp, bone=f"win.{k}")

# The top pod: a vent fan and a reel of cable.
fan_base = on_pod(3, (-0.22, 0.05, H / 2))
piece(kit.rod(fan_base, fan_base + Vector((0, 0, 0.1)), 0.17, segments=12), s["iron"], "pod.3", bevel=0.008)
piece(kit.rod(fan_base + Vector((0, 0, 0.1)), fan_base + Vector((0, 0, 0.12)), 0.19, segments=12), s["grate"],
      "pod.3")
for a in (0, 90):
    tip = Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0)) * 0.15
    piece(kit.beam(fan_base + Vector((0, 0, 0.13)) - tip, fan_base + Vector((0, 0, 0.13)) + tip, 0.02, width=0.05),
          s["iron"], "fan")
piece(kit.rod(fan_base + Vector((0, 0, 0.12)), fan_base + Vector((0, 0, 0.16)), 0.035, segments=8), s["iron"], "fan")
pod_box(3, (0.34, 0.26, 0.03), (0.22, 0.08, H / 2 + 0.015), s["ceramic"], bevel=0.006)
# A light strip along the top pod's eave on the side the camera sees.
pod_box(3, (L - 0.16, 0.012, 0.03), (0.0, -W / 2 - 0.008, H / 2 - 0.02), lamp)

# A canvas sheet rigged over the second pod's hatch against the ash.
for k, x in ((1, 0.3),):
    pod_box(k, (0.3, 0.12, 0.014), (x, -W / 2 - 0.07, 0.22), s["canvas"], extra=rot("X", -28), bevel=0.004)
    for dx in (-0.14, 0.14):
        a = on_pod(k, (x + dx, -W / 2 - 0.12, 0.19))
        piece(kit.beam(a, on_pod(k, (x + dx, -W / 2 - 0.01, 0.16)), 0.012), s["iron"], f"pod.{k}")

# Conduit run up the side, strapped to each pod.
for k in range(4):
    a, b = on_pod(k, (-0.46, -W / 2 - 0.05, -H / 2)), on_pod(k, (-0.46, -W / 2 - 0.05, H / 2 + 0.01))
    piece(kit.rod(a, b, 0.028, segments=6), s["iron"], f"pod.{k}")
    pod_box(k, (0.07, 0.06, 0.03), (-0.46, -W / 2 - 0.035, 0.0), s["iron"])
box((0.12, 0.1, 0.16), (STACK.x - 0.46, STACK.y - W / 2 - 0.08, SKID + 0.08), s["iron"], "pad", bevel=0.01)
box((0.02, 0.06, 0.04), (STACK.x - 0.4, STACK.y - W / 2 - 0.135, SKID + 0.12), lamp, "pad")

reel = on_pod(2, (-0.1, -W / 2 - 0.1, -H / 2 + 0.02))
piece(kit.rod(reel + Vector((-0.06, 0, 0)), reel + Vector((0.06, 0, 0)), 0.08, segments=10), s["rubber"], "pod.2")
piece(kit.rod(reel + Vector((-0.07, 0, 0)), reel + Vector((0.07, 0, 0)), 0.03, segments=6), s["iron"], "pod.2")
piece(kit.rod(reel + Vector((0.02, -0.07, -0.02)), reel + Vector((0.05, -0.08, -0.55)), 0.012, segments=4),
      s["rubber"], "pod.2")
for dy in (-0.06, 0.06):
    piece(kit.beam(on_pod(2, (-0.1 + dy, -W / 2, -H / 2 + 0.06)), reel + Vector((dy, 0, 0)), 0.02), s["iron"], "pod.2")

# ---------------------------------------------------------------------------
# The ration chute, from the third pod down to a hopper on the pad.
# ---------------------------------------------------------------------------

top = on_pod(2, (-L / 2 + 0.1, -W / 2, 0.0))
hopper = Vector((-0.74, -0.78, 0.2))
piece(kit.beam(top, hopper + Vector((0, 0, 0.12)), 0.08, width=0.14), s["plate"], "chute", bevel=0.008)
piece(kit.beam(top + Vector((0, 0, 0.05)), hopper + Vector((0, 0, 0.17)), 0.02, width=0.15), s["hazard"], "chute")
box((0.2, 0.18, 0.2), tuple(hopper), s["iron"], "chute", bevel=0.012)
box((0.16, 0.14, 0.01), (hopper.x, hopper.y, hopper.z + 0.105), s["rubber"], "chute")
piece(kit.beam(hopper + Vector((0, 0.05, -0.1)), hopper + Vector((0, 0.05, -0.2)), 0.03), s["iron"], "chute")

# ---------------------------------------------------------------------------
# The stair tower.
# ---------------------------------------------------------------------------

t = TOWER
th = TOWER_HALF
corners = [(t.x + sx * th, t.y + sy * th) for sx, sy in ((1, -1), (1, 1), (-1, 1), (-1, -1))]
for x, y in corners:
    piece(kit.beam((x, y, SKID - 0.04), (x, y, TOWER_TOP), 0.045), s["paint"], "tower", painted=True, bevel=0.006)
for k in range(4):
    z0 = SKID + k * (H + 0.01)
    z1 = z0 + H + 0.01
    # Bracing on the two faces the camera sees.
    for (ax, ay), (bx, by) in ((corners[0], corners[1]), (corners[3], corners[0])):
        piece(kit.beam((ax, ay, z0 + 0.03), (bx, by, z1 - 0.03), 0.018), s["iron"], "tower")
    # A landing, a flight up to the next, and a gangway across to the pod door.
    box((2 * th, 2 * th, 0.03), (t.x, t.y, z1), s["grate"], "tower", bevel=0.004)
    flip = 1 if k % 2 else -1
    piece(kit.beam((t.x - th * 0.7, t.y + flip * th * 0.5, z0 + 0.02), (t.x + th * 0.7, t.y + flip * th * 0.5, z1),
                   0.025, width=0.12), s["grate"], "tower")
    piece(kit.beam((t.x - th * 0.7, t.y + flip * th * 0.9, z0 + 0.2), (t.x + th * 0.7, t.y + flip * th * 0.9, z1 + 0.18),
                   0.015), s["iron"], "tower")
    pod_end = on_pod(k, (L / 2, -0.12, -H / 2))
    piece(kit.beam((pod_end.x, pod_end.y + 0.02, z0 + 0.02), (t.x - th, pod_end.y + 0.02, z0 + 0.02), 0.025,
                   width=0.14), s["grate"], "tower")
# The top: a railed platform, the floodlight mast and the siren.
for x, y in corners:
    piece(kit.beam((x, y, TOWER_TOP), (x, y, TOWER_TOP + 0.16), 0.02), s["iron"], "tower")
for (ax, ay), (bx, by) in zip(corners, corners[1:] + corners[:1]):
    piece(kit.beam((ax, ay, TOWER_TOP + 0.15), (bx, by, TOWER_TOP + 0.15), 0.018), s["hazard"], "tower")
piece(kit.rod((t.x, t.y, TOWER_TOP), (t.x, t.y, FLOOD.z - 0.02), 0.028, segments=6), s["iron"], "tower")
piece(kit.rod((t.x, t.y - 0.02, TOWER_TOP + 0.28), (t.x, t.y - 0.2, TOWER_TOP + 0.3), 0.02, segments=8,
              radius_end=0.075), s["iron"], "tower")

box((0.12, 0.2, 0.12), (FLOOD.x + 0.02, FLOOD.y, FLOOD.z + 0.04), s["iron"], "flood", bevel=0.01)
box((0.02, 0.16, 0.09), (FLOOD.x + 0.09, FLOOD.y, FLOOD.z + 0.04), lamp, "flood")
box((0.04, 0.22, 0.02), (FLOOD.x + 0.08, FLOOD.y, FLOOD.z + 0.11), s["iron"], "flood")
piece(kit.rod((FLOOD.x - 0.05, FLOOD.y, FLOOD.z - 0.02), (FLOOD.x + 0.03, FLOOD.y, FLOOD.z - 0.02), 0.03, segments=6),
      s["iron"], "flood")

body = kit.join(parts, "body")
print("habstack geometry:", kit.report(col))

surfaces.unwrap(body, kit)
images = surfaces.bake(body, kit, "habstack", size=TEXTURE_SIZE)
surfaces.save_images(images, os.path.join(PREVIEW_DIR, "textures"))

kit.bind(body, rig)
rig.scale = (1 / FOOTPRINT,) * 3

# ---------------------------------------------------------------------------
# Clips. Positions in tiles before the rig is shrunk.
# ---------------------------------------------------------------------------

DARK = [("scale", 0.0)]

build = {
    "pad": {0: [("loc", (0, 0, -0.14))], 8: []},
    "tower": {0: [("stretch", 0.1)], 84: [("stretch", 0.1)], 100: []},
    "chute": {0: [("scale", 0.0)], 94: [("scale", 0.0)], 102: []},
    "flood": {0: [("scale", 0.0)], 104: [("scale", 0.0)], 108: []},
}
# One pod at a time, the bottom one first, each settling with a small bounce.
# A pod not yet on its way is not there at all: four pods hanging over the site
# from the first frame read as a building floating above it.
DROP = 2.2
for k in range(4):
    start = 8 + k * 18
    build[f"pod.{k}"] = {0: [("loc", (0, 0, DROP)), ("scale", 0.0)], start: [("loc", (0, 0, DROP)), ("scale", 0.0)],
                         start + 2: [("loc", (0, 0, DROP))], start + 14: [("loc", (0, 0, -0.03))], start + 18: []}
    build[f"win.{k}"] = {0: DARK, 98 + k * 3: DARK, 100 + k * 3: []}
kit.track_clip(rig, "build", 120, build)

# Four seconds. Two windows keep their lights, two go dark and come back as
# shifts turn over; the floodlight sweeps the approach; the fan never stops.
kit.track_clip(rig, "idle", 120, {
    "win.1": {0: [], 40: [], 42: DARK, 98: DARK, 100: []},
    "win.2": {0: DARK, 58: DARK, 60: [], 108: [], 110: DARK, 120: DARK},
    "flood": {0: [("Z", -35)], 60: [("Z", 35)], 120: [("Z", -35)]},
    "fan": {f: [("Z", f * 6)] for f in range(0, 121, 15)},
}, linear=("fan",))

stats = kit.report(col)
print("habstack:", stats)
print("wrote", kit.export_rigged(col, CONTENT_ID))
print("wrote", kit.save_blend(CONTENT_ID))

if os.environ.get("RTS_PREVIEWS", "1") != "0":
    os.makedirs(PREVIEW_DIR, exist_ok=True)

    def pose(action, frame):
        return lambda: kit.set_pose(rig, bpy.data.actions[action], frame)

    pose("idle", 0)()
    print("previews", kit.previews(
        col, PREVIEW_DIR, "habstack", views=((35, -45), (35, 135), (20, -70)), frame=1.8,
        poses=[
            ("build30", pose("build", 36)),
            ("build60", pose("build", 72)),
            ("build85", pose("build", 96)),
            ("idle70", pose("idle", 70)),
        ],
    ))
