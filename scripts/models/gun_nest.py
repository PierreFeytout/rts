"""
The Gun Nest -- the Ashen Directorate's fixed defence. Content id: vanguard.turret.

    blender -b --factory-startup --python scripts/models/gun_nest.py

From its sheet in UNIVERSE.md. It was a point-defence mount unbolted from a
hauler's flank; it is that mount set in a ring of salvaged armour plate and
slag-filled gabions, fed by a plasma line. Obviously a weapon, obviously fixed:

  - a low, wide ring of mismatched plate, leaning out, with wire gabions of
    slag between;
  - in it, on a pintle, a traversing mount: cheeks, a breech, a gunner's
    shield and mantlet in the owner's paint, and a long plasma projector
    with heat-sink fins and ember coils toward the muzzle;
  - coolant tanks and the plasma line outside the ring (-Y), ammunition
    lockers and a ladder over it (+X);
  - a rockcrete pad under it all.

ANIMATION. `build`: the pad rises; the mount comes down into the empty ring;
the ring's plates, lying flat, hinge up one after another and lock; the
stores come up; the barrel elevates into position.

It aims. `aim` is one full turn of the mount, anticlockwise from +X, and
`aim_fire` the same turn with the barrel recoiled; the renderer picks the
frame for the heading to each turret's target and blends the two for each
shot's kick (packages/client/src/aim.ts). `idle` is the mount at rest, for
anything that does not aim it.

Built in tiles at its real footprint and shrunk into the unit box at the end.
Blender axes: +X, +Y left, +Z up.
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import kit  # noqa: E402
import surfaces  # noqa: E402

CONTENT_ID = "vanguard.turret"
FOOTPRINT = 2
PREVIEW_DIR = os.environ.get("RTS_PREVIEW_DIR", os.path.join(kit.REPO, "art", "previews"))
TEXTURE_SIZE = int(os.environ.get("RTS_TEXTURE_SIZE", "1024"))

kit.fresh_scene()
col = kit.collection("GunNest")
s = surfaces.structure_surfaces(scale=6.0)
lamp = kit.directorate_palette()["lamp"]
rng = random.Random(41)


def rot(axis, degrees):
    return Matrix.Rotation(math.radians(degrees), 3, axis)


def radial(a, r, z=0.0):
    return Vector((math.cos(math.radians(a)) * r, math.sin(math.radians(a)) * r, z))


# ---------------------------------------------------------------------------
# Proportions, in tiles. The footprint is +-1.
# ---------------------------------------------------------------------------

PAD = 0.08
RING_R = 0.7
PINTLE = 0.36
TRUNNION = 0.62
QUADRANTS = [45, 135, 225, 315]
PLATES = 12

# ---------------------------------------------------------------------------
# Skeleton.
# ---------------------------------------------------------------------------

bones = [
    ("root", (0, 0, 0), (0, 0, 0.5), None),
    ("pad", (0, 0, 0), (0, 0, 0.1), "root"),
    ("stores", (0, 0, 0), (0, 0, 0.3), "root"),
    ("mount", (0, 0, PAD), (0, 0, PINTLE), "root"),
    ("turret", (0, 0, PINTLE), (0, 0, TRUNNION + 0.2), "mount"),
    ("barrel", (0.02, 0, TRUNNION), (0.6, 0, TRUNNION), "turret"),
]
for q, a in enumerate(QUADRANTS):
    bones.append((f"ring.{q}", tuple(radial(a, RING_R, PAD)), tuple(radial(a, RING_R, PAD + 0.35)), "root"))
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


def rock(radii, centre, jitter=0.3):
    bm = kit.ellipsoid(radii, centre, segments=6, rings=3)
    for v in bm.verts:
        v.co += Vector((rng.uniform(-1, 1) * radii[0], rng.uniform(-1, 1) * radii[1],
                        rng.uniform(-0.5, 0.5) * radii[2])) * jitter
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


# ---------------------------------------------------------------------------
# The pad.
# ---------------------------------------------------------------------------

for x in (-0.5, 0.5):
    for y in (-0.5, 0.5):
        tilt = rot("X", rng.uniform(-0.6, 0.6)) @ rot("Y", rng.uniform(-0.6, 0.6))
        box((0.96, 0.96, PAD), (x, y, PAD / 2 + rng.uniform(-0.006, 0.008)), s["rockcrete"], "pad", tilt,
            bevel=0.012)
piece(kit.rod((0, 0, PAD - 0.01), (0, 0, PAD + 0.015), 0.5, segments=16), s["iron"], "pad")

# ---------------------------------------------------------------------------
# The ring: salvaged plate, leaning out, each piece off a different wreck.
# ---------------------------------------------------------------------------

for k in range(PLATES):
    a = k * 360 / PLATES
    q = min(range(4), key=lambda j: abs(((a - QUADRANTS[j] + 180) % 360) - 180))
    bone = f"ring.{q}"
    # Lower on +X, where the ladder goes over.
    height = 0.24 if k == 0 else rng.choice((0.36, 0.42, 0.39))
    width = 2 * RING_R * math.tan(math.radians(180 / PLATES)) + 0.06
    lean = rot("Z", a + rng.uniform(-3, 3)) @ rot("Y", 10 + rng.uniform(-4, 4))
    centre = radial(a, RING_R + 0.02, PAD + height / 2)
    material = s["plate"] if k % 3 else s["iron"]
    box((0.07, width, height), centre, material, bone, lean, bevel=0.012)
    if k % 4 == 1:
        top = radial(a, RING_R + 0.06, PAD + height - 0.02)
        box((0.02, width * 0.8, 0.05), top, s["hazard"], bone, lean)
    if k % 3 == 2:
        for dz in (0.1, height - 0.08):
            for dy in (-0.1, 0.1):
                p = centre + rot("Z", a) @ Vector((0.045, dy, dz - height / 2))
                piece(kit.rod(p, p + radial(a, 0.025), 0.018, segments=5), s["iron"], bone)
    # A patch welded over a hole.
    if k in (4, 9):
        box((0.02, 0.14, 0.12), radial(a, RING_R + 0.075, PAD + height * 0.55), s["plate"], bone,
            lean @ rot("X", 18), bevel=0.004)

# Gabions of slag between the plates and the pad's edge, on the faces the camera sees.
for a in (-35, -95, 60, 200):
    c = radial(a, 0.86, PAD)
    turn = rot("Z", a)
    for dx, dy in ((-0.1, -0.12), (0.1, -0.12), (0.1, 0.12), (-0.1, 0.12)):
        p = c + turn @ Vector((dx, dy, 0))
        piece(kit.beam(p, p + Vector((0, 0, 0.26)), 0.018), s["iron"], "stores")
    for z in (0.02, 0.26):
        for (ax, ay), (bx, by) in (((-0.1, -0.12), (0.1, -0.12)), ((0.1, -0.12), (0.1, 0.12)),
                                   ((0.1, 0.12), (-0.1, 0.12)), ((-0.1, 0.12), (-0.1, -0.12))):
            piece(kit.beam(c + turn @ Vector((ax, ay, z)), c + turn @ Vector((bx, by, z)), 0.015), s["iron"], "stores")
    box((0.19, 0.23, 0.24), c + Vector((0, 0, 0.13)), s["grate"], "stores", turn)
    for j in range(3):
        p = c + turn @ Vector((rng.uniform(-0.05, 0.05), rng.uniform(-0.07, 0.07), 0.25))
        piece(rock((0.06, 0.055, 0.04), p), s["slag"], "stores")

# ---------------------------------------------------------------------------
# Stores: coolant tanks and the plasma line (-Y), lockers and a ladder (+X).
# ---------------------------------------------------------------------------

for x in (-0.46, -0.14):
    piece(kit.rod((x, -0.72, 0.2), (x, -0.98, 0.2), 0.1, segments=12), s["iron"], "stores", bevel=0.01)
    piece(kit.rod((x, -0.7, 0.2), (x, -0.74, 0.2), 0.105, segments=12), s["hazard"], "stores")
    for y in (-0.76, -0.94):
        box((0.26, 0.04, 0.1), (x, y, 0.13), s["iron"], "stores")
    piece(kit.rod((x, -0.85, 0.3), (x, -0.85, 0.36), 0.025, segments=6), s["iron"], "stores")
line = [Vector((-0.3, -0.85, 0.36)), Vector((-0.3, -0.72, 0.5)), Vector((-0.2, -0.4, 0.5)), Vector((-0.1, -0.15, 0.4))]
for a, b in zip(line, line[1:]):
    piece(kit.rod(a, b, 0.03, segments=6), s["rubber"], "stores")

for y in (-0.42, 0.4):
    box((0.2, 0.3, 0.2), (0.88, y, PAD + 0.1), s["iron"], "stores", rot("Z", rng.uniform(-6, 6)), bevel=0.012)
    box((0.21, 0.31, 0.03), (0.88, y, PAD + 0.215), s["hazard"], "stores", bevel=0.005)
    box((0.02, 0.1, 0.04), (0.985, y, PAD + 0.15), s["ceramic"], "stores")
for y in (-0.08, 0.08):
    piece(kit.beam((0.97, y, PAD), (0.72, y, PAD + 0.42), 0.025), s["iron"], "stores")
for k in range(4):
    t = (k + 0.5) / 4
    x, z = 0.97 + (0.72 - 0.97) * t, PAD + 0.42 * t
    piece(kit.beam((x, -0.08, z), (x, 0.08, z), 0.018), s["iron"], "stores")

# ---------------------------------------------------------------------------
# The mount.
# ---------------------------------------------------------------------------

piece(kit.rod((0, 0, PAD), (0, 0, PINTLE - 0.02), 0.18, segments=12, radius_end=0.15), s["iron"], "mount", bevel=0.01)
piece(kit.rod((0, 0, PAD + 0.01), (0, 0, PAD + 0.06), 0.26, segments=12), s["iron"], "mount", bevel=0.008)
for k in range(8):
    p = radial(k * 45 + 22.5, 0.22, PAD + 0.06)
    piece(kit.rod(p, p + Vector((0, 0, 0.03)), 0.018, segments=5), s["iron"], "mount")

t = "turret"
piece(kit.rod((0, 0, PINTLE - 0.02), (0, 0, PINTLE + 0.05), 0.27, segments=16), s["plate"], t, bevel=0.01)
for y in (-0.15, 0.15):
    box((0.4, 0.05, 0.3), (0.0, y, TRUNNION - 0.04), s["plate"], t, bevel=0.012)
    box((0.08, 0.06, 0.08), (0.02, y, TRUNNION), s["iron"], t)
piece(kit.rod((0.02, -0.2, TRUNNION), (0.02, 0.2, TRUNNION), 0.04, segments=8), s["iron"], t)
# The gunner's shield and the seat behind it.
box((0.05, 0.56, 0.34), (0.2, 0, TRUNNION + 0.08), s["paint"], t, rot("Y", -16), painted=True, bevel=0.015)
box((0.05, 0.16, 0.14), (0.19, 0.3, TRUNNION + 0.0), s["paint"], t, rot("Z", 30) @ rot("Y", -16), painted=True,
    bevel=0.01)
box((0.05, 0.16, 0.14), (0.19, -0.3, TRUNNION + 0.0), s["paint"], t, rot("Z", -30) @ rot("Y", -16), painted=True,
    bevel=0.01)
box((0.02, 0.12, 0.025), (0.235, 0.14, TRUNNION + 0.18), lamp, t, rot("Y", -16))
box((0.14, 0.14, 0.03), (-0.2, 0.1, TRUNNION - 0.12), s["leather"], t, bevel=0.01)
piece(kit.beam((-0.2, 0.1, TRUNNION - 0.14), (-0.1, 0.1, PINTLE + 0.05), 0.03), s["iron"], t)
# A work lamp on the shield's top edge.
box((0.06, 0.06, 0.05), (0.14, -0.2, TRUNNION + 0.27), s["iron"], t)
box((0.015, 0.04, 0.03), (0.175, -0.2, TRUNNION + 0.27), lamp, t)

b = "barrel"
box((0.3, 0.2, 0.2), (-0.12, 0, TRUNNION), s["iron"], b, bevel=0.015)
for y in (-0.06, 0.06):
    piece(kit.rod((-0.28, y, TRUNNION + 0.04), (-0.2, y, TRUNNION + 0.04), 0.04, segments=8), s["iron"], b)
piece(kit.rod((0.12, 0, TRUNNION), (0.32, 0, TRUNNION), 0.1, segments=12), s["paint"], b, painted=True, bevel=0.008)
piece(kit.rod((0.3, 0, TRUNNION), (0.64, 0, TRUNNION), 0.07, segments=12), s["plate"], b)
for k in range(6):
    x = 0.36 + k * 0.045
    box((0.018, 0.2, 0.2), (x, 0, TRUNNION), s["iron"], b)
for k in range(4):
    x = 0.68 + k * 0.045
    piece(kit.rod((x - 0.012, 0, TRUNNION), (x + 0.012, 0, TRUNNION), 0.08, segments=10), lamp, b)
piece(kit.rod((0.62, 0, TRUNNION), (0.93, 0, TRUNNION), 0.045, segments=10), s["iron"], b)
piece(kit.rod((0.9, 0, TRUNNION), (0.97, 0, TRUNNION), 0.065, segments=10), s["iron"], b, bevel=0.006)
for y in (-0.05, 0.05):
    box((0.05, 0.015, 0.03), (0.935, y, TRUNNION), s["rubber"], b)

body = kit.join(parts, "body")
print("gun nest geometry:", kit.report(col))

surfaces.unwrap(body, kit)
images = surfaces.bake(body, kit, "gun_nest", size=TEXTURE_SIZE)
surfaces.save_images(images, os.path.join(PREVIEW_DIR, "textures"))

kit.bind(body, rig)
rig.scale = (1 / FOOTPRINT,) * 3

# ---------------------------------------------------------------------------
# Clips. Positions in tiles before the rig is shrunk.
# ---------------------------------------------------------------------------

build = {
    "pad": {0: [("loc", (0, 0, -0.12))], 8: []},
    "mount": {0: [("loc", (0, 0, 2.4))], 12: [("loc", (0, 0, 2.4))], 48: [("loc", (0, 0, -0.03))], 54: []},
    "barrel": {0: [("Y", 24)], 84: [("Y", 24)], 98: [("Y", -3)], 104: []},
    "stores": {0: [("loc", (0, 0, -0.45))], 80: [("loc", (0, 0, -0.45))], 94: []},
}
for q, a in enumerate(QUADRANTS):
    across = (-math.sin(math.radians(a)), math.cos(math.radians(a)), 0)
    up = 56 + q * 6
    # Lying flat outward until their turn, then up, past vertical, and locked.
    build[f"ring.{q}"] = {0: [(across, 90)], up: [(across, 90)], up + 8: [(across, -6)], up + 11: []}
kit.track_clip(rig, "build", 120, build)

kit.track_clip(rig, "idle", 60, {})

# One full traverse, a key every twelfth of a turn. 48 frames, so a heading is
# never more than 3.75 degrees from a baked one.
TURN = {f: [("Z", f * 7.5)] for f in range(0, 49, 4)}
kit.track_clip(rig, "aim", 48, {"turret": TURN}, linear=("turret",))
kit.track_clip(rig, "aim_fire", 48, {
    "turret": TURN,
    "barrel": {0: [("loc", (-0.13, 0, 0))]},
}, linear=("turret",))

stats = kit.report(col)
print("gun nest:", stats)
print("wrote", kit.export_rigged(col, CONTENT_ID))
print("wrote", kit.save_blend(CONTENT_ID))

if os.environ.get("RTS_PREVIEWS", "1") != "0":
    os.makedirs(PREVIEW_DIR, exist_ok=True)

    def pose(action, frame):
        return lambda: kit.set_pose(rig, bpy.data.actions[action], frame)

    pose("idle", 0)()
    print("previews", kit.previews(
        col, PREVIEW_DIR, "gun_nest", views=((35, -45), (35, 135), (20, -70)), frame=1.35,
        poses=[
            ("build40", pose("build", 48)),
            ("build60", pose("build", 70)),
            ("aim90", pose("aim", 12)),
            ("aim225_fire", pose("aim_fire", 30)),
        ],
    ))
