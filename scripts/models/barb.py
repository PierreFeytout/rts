"""
The Barb -- the Verdigris's fixed defence. Content id: concord.barb.

    blender -b --factory-startup --python scripts/models/barb.py

WHAT IT IS (UNIVERSE.md, Structures, "The Verdigris")
--------------------------------------------------------
It was the jib of a scrap crane, riveted girders and a winch drum. It is the
jib grown into a coiled spine, bent back under tension over its own base
like a scorpion's tail, its tip crusted with barbed shards that it flings.
Kinetic, range 6.5: obviously a weapon, and obviously fixed.

WHAT IT LOOKS LIKE
------------------
A single curved spine rising from a crusted base and bent back over itself.
The crane is still in it -- the winch drum grown into a knot of wet bronze
at the foot, the jib's girders showing inside the spine's crust -- but the
spine is a body: segments of bronze sinew, each swollen at the joint, crust
grown round them in rings and heaped along the outer curve, a tendon down
the inside holding the tension, and a faint cold glow in the knot where
that tension is held. At the tip a knuckle of crust bristling with bronze
shards. The bloom is along the spine's outer curve, where the camera sees
it from any heading.

ANIMATION. `build` is emergence: the crust base rises, the drum and its
knot surface, the spine uncoils upward segment by segment and bends back
under tension, the shards grow at the tip, the blooms open last. It aims:
`aim` is one full turn of the spine round its base, anticlockwise from +X,
and `aim_fire` the same turn with the spine flicked forward in the throw;
the renderer picks the frame for the heading to each turret's target and
blends the two for each shot (packages/client/src/aim.ts, and
scripts/models/gun_nest.py for the Directorate's). `idle` is the spine
swaying under its tension, for anything that does not aim it.

Built in tiles at its real footprint (+-1) and shrunk into the unit box at
the end. Blender axes: +X toward the camera, +Y left, +Z up.
"""

import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import growth  # noqa: E402
import kit  # noqa: E402
import surfaces  # noqa: E402
from growth import rot  # noqa: E402

CONTENT_ID = "concord.barb"
FOOTPRINT = 2
PREVIEW_DIR = os.environ.get("RTS_PREVIEW_DIR", os.path.join(kit.REPO, "art", "previews"))
TEXTURE_SIZE = int(os.environ.get("RTS_TEXTURE_SIZE", "1024"))

kit.fresh_scene()
col = kit.collection("Barb")
s = surfaces.verdigris_surfaces(scale=4.0)
glow = kit.verdigris_palette()["glow"]
g = growth.Growth(col, s, glow, seed=55)
rng = g.rng

# ---------------------------------------------------------------------------
# Proportions, in tiles. The footprint is +-1. The spine faces +X.
# ---------------------------------------------------------------------------

DRUM = Vector((-0.2, 0.0, 0.3))
MOUNT = Vector((0.0, 0.0, 0.5))
SEGMENTS = 5
SPINE = growth.curve([MOUNT, (-0.18, 0, 0.82), (-0.34, 0, 1.15), (-0.24, 0, 1.46), (0.06, 0, 1.6), (0.36, 0, 1.54),
                      (0.56, 0, 1.38)], 5)
ARC = Vector((0.05, 0.0, 1.1))
N = len(SPINE)
CUTS = [round(k * (N - 1) / SEGMENTS) for k in range(SEGMENTS + 1)]
TIP = SPINE[-1]


def inward(p):
    """The unit vector from a point on the spine toward the arc's centre."""
    d = ARC - p
    d.y = 0
    return d.normalized()


def radius_at(i):
    t = i / (N - 1)
    r = 0.11 * (1.0 + (0.45 - 1.0) * t)
    for a in (0.2, 0.4, 0.6, 0.8):
        r *= 1 + 0.4 * math.exp(-((t - a) / 0.05) ** 2)
    return r


# ---------------------------------------------------------------------------
# Skeleton.
# ---------------------------------------------------------------------------

g.bone("mat", (0, 0, 0), (0, 0, 0.3), "root")
g.bone("base", (DRUM.x, DRUM.y, 0.05), (DRUM.x, DRUM.y, 0.6), "root")
g.bone("mount", tuple(MOUNT - Vector((0, 0, 0.1))), tuple(MOUNT + Vector((0, 0, 0.2))), "root")
prev = "mount"
for k in range(SEGMENTS):
    name = f"spine.{k + 1}"
    g.bone(name, SPINE[CUTS[k]], SPINE[CUTS[k + 1]], prev)
    prev = name
g.bone("tip", TIP, TIP + Vector((0.2, 0, -0.1)), prev)
BLOOMS = {"bloom.1": 2, "bloom.2": 3, "bloom.3": 4}
for name, k in BLOOMS.items():
    i = (CUTS[k - 1] + CUTS[k]) // 2
    p = SPINE[i] - inward(SPINE[i]) * radius_at(i)
    g.bone(name, p, p + Vector((0, 0, 0.2)), f"spine.{k}")
for k in range(3):
    a = (-60, 40, 200)[k]
    g.bone(f"vein.{k + 1}", (math.cos(math.radians(a)) * 0.5, math.sin(math.radians(a)) * 0.5, 0.1),
           (math.cos(math.radians(a)) * 0.95, math.sin(math.radians(a)) * 0.95, 0.04), "mat")
rig = g.rig()

# ---------------------------------------------------------------------------
# The base: crust heaped over the crane's foot, its girders showing through,
# the winch drum grown into a knot of bronze, the glow in the knot.
# ---------------------------------------------------------------------------

g.shelf((-0.05, 0.05, 0.0), 0.92, 0.1, s["crust"], "mat", segments=24, floor=0.0)
g.shelf((-0.15, 0.0, 0.08), 0.62, 0.12, s["crust"], "mat", segments=20, floor=0.0)
for a in (-75, -25, 30, 110, 170, 250):
    p = Vector((-0.05 + math.cos(math.radians(a)) * 0.82, 0.05 + math.sin(math.radians(a)) * 0.82, 0.05))
    g.bubbles("mat", [p, p + Vector((rng.uniform(-0.1, 0.1), rng.uniform(-0.1, 0.1), 0.0))], 0.045)
for k in range(3):
    a = (-60, 40, 200)[k]
    d = Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0))
    g.vein([d * 0.5 + Vector((0, 0, 0.1)), d * 0.72 + Vector((0.05, -0.04, 0.08)), d * 0.95 + Vector((0, 0, 0.045))],
           0.055, f"vein.{k + 1}", at=(0.5,), amount=0.5, taper=(1.0, 0.5), segments=9, per_segment=5)
# The jib's foot: girders and their rivets, half in the crust.
for y in (-0.2, 0.2):
    g.piece(kit.beam((-0.55, y, 0.12), (0.02, y * 0.5, 0.58), 0.045), s["rot"], "base", bevel=0.006)
    g.piece(kit.beam((0.3, y, 0.12), (0.02, y * 0.5, 0.58), 0.04), s["rot"], "base", bevel=0.006)
    for t in (0.35, 0.7):
        p = Vector((-0.55, y, 0.12)).lerp(Vector((0.02, y * 0.5, 0.58)), t)
        g.piece(kit.rod(p + Vector((0, y * 0.12, 0)), p + Vector((0, y * 0.16, 0)), 0.014, segments=6), s["rot"], "base")
g.piece(kit.beam((-0.55, -0.2, 0.12), (-0.55, 0.2, 0.12), 0.04), s["rot"], "base")
g.piece(kit.beam((-0.3, -0.16, 0.35), (-0.3, 0.16, 0.35), 0.035), s["rot"], "base")
# The drum, and the knot grown over it.
g.piece(kit.rod(DRUM + Vector((0, -0.32, 0)), DRUM + Vector((0, 0.32, 0)), 0.2, segments=18), s["rot"], "base",
        bevel=0.01)
for y in (-0.33, 0.33):
    g.piece(kit.rod(DRUM + Vector((0, y, 0)), DRUM + Vector((0, y * 1.1, 0)), 0.27, segments=18), s["rot"], "base",
            bevel=0.008)
    for k in range(8):
        a = math.radians(k * 45 + 10)
        p = DRUM + Vector((math.cos(a) * 0.22, y * 1.1, math.sin(a) * 0.22))
        g.piece(kit.rod(p, p + Vector((0, y * 0.08, 0)), 0.014, segments=6), s["rot"], "base")
g.blob((0.28, 0.24, 0.26), DRUM + Vector((0.16, -0.2, 0.12)), s["bronze"], "base", amount=0.22, scale=5, segments=18,
       rings=10)
g.blob((0.24, 0.22, 0.22), DRUM + Vector((-0.08, 0.24, 0.14)), s["bronze"], "base", amount=0.22, scale=5, segments=16,
       rings=9)
g.blob((0.17, 0.15, 0.14), DRUM + Vector((0.2, 0.06, 0.28)), s["membrane"], "base", amount=0.25, scale=7,
       segments=12, rings=7)
g.ball((0.07, 0.07, 0.07), DRUM + Vector((0.24, -0.26, 0.24)), glow, "base", segments=8, rings=5)
g.ball((0.045, 0.045, 0.045), DRUM + Vector((-0.02, 0.3, 0.32)), glow, "base", segments=8, rings=5)
g.shelf(DRUM + Vector((-0.2, 0.05, 0.18)), 0.3, 0.09, s["crust"], "base", segments=16)
g.shelf(DRUM + Vector((0.15, -0.28, 0.1)), 0.24, 0.09, s["crust"], "base", segments=14)
g.bubbles("base", [DRUM + Vector((rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), rng.uniform(0.15, 0.4)))
                   for _ in range(8)], 0.04)
g.drips("base", [DRUM + Vector((0.3, -0.2, 0.1)), DRUM + Vector((-0.25, 0.25, 0.14)), DRUM + Vector((0.05, -0.36, 0.2))],
        0.015, length=0.1)
# The socket the spine turns in.
g.ball((0.2, 0.2, 0.16), MOUNT - Vector((0, 0, 0.06)), s["bronze"], "mount", segments=16, rings=9)
g.tube(growth.ring((MOUNT.x, MOUNT.y), 0.19, 18, z=MOUNT.z - 0.02) + [growth.ring((MOUNT.x, MOUNT.y), 0.19, 18,
                                                                                    z=MOUNT.z - 0.02)[0]],
       0.035, s["crust"], "mount", segments=8)

# ---------------------------------------------------------------------------
# The spine: segments of bronze sinew round the jib's girders, crust along
# the outer curve, the tendon down the inside, the bloom where it shows.
# ---------------------------------------------------------------------------

for k in range(SEGMENTS):
    bone = f"spine.{k + 1}"
    i0, i1 = CUTS[k], CUTS[k + 1]
    pts = SPINE[i0:i1 + 1]
    radii = [radius_at(i) for i in range(i0, i1 + 1)]
    g.tube(pts, radii, s["bronze"], bone, segments=12, wobble=0.03)
    # The joint: a knuckle of bronze under a cap of crust.
    g.ball((radii[0] * 1.12,) * 3, pts[0], s["bronze"], bone, segments=12, rings=7)
    g.ball((radii[0] * 1.1, radii[0] * 1.1, radii[0] * 0.7), pts[0] - inward(pts[0]) * radii[0] * 0.7, s["crust"],
           bone, segments=10, rings=6)
    # The girders inside: two rot beams along the outer side, rivets on them.
    for y in (-1, 1):
        a = pts[0] - inward(pts[0]) * radii[0] * 0.55 + Vector((0, y * radii[0] * 0.7, 0))
        b = pts[-1] - inward(pts[-1]) * radii[-1] * 0.55 + Vector((0, y * radii[-1] * 0.7, 0))
        g.piece(kit.beam(a, b, 0.03), s["rot"], bone, bevel=0.004)
        for t in (0.3, 0.7):
            p = a.lerp(b, t)
            out = -inward(p)
            g.piece(kit.rod(p, p + out * 0.025, 0.012, segments=6), s["rot"], bone)
    # The tendon down the inside, and crust rings round the sinew.
    a = pts[0] + inward(pts[0]) * (radii[0] + 0.02)
    b = pts[-1] + inward(pts[-1]) * (radii[-1] + 0.02)
    mid = pts[len(pts) // 2] + inward(pts[len(pts) // 2]) * (radii[len(pts) // 2] + 0.02)
    tendon = growth.curve([a, mid, b], 4)
    g.tube(tendon, growth.swell(len(tendon), 0.03, at=(0.5,), amount=0.3), s["bronze"], bone, segments=8)
    for t in (0.35, 0.75):
        i = i0 + int(t * (i1 - i0))
        p = SPINE[i]
        d = (SPINE[min(i + 1, N - 1)] - SPINE[max(i - 1, 0)]).normalized()
        r = radius_at(i) * 1.12
        loop = [p + growth.facing(d) @ Vector((math.cos(math.radians(j * 30)) * r, math.sin(math.radians(j * 30)) * r, 0))
                for j in range(13)]
        g.tube(loop, 0.024, s["crust"], bone, segments=6)
    # Crust heaped along the outer curve.
    for t in (0.25, 0.6):
        i = i0 + int(t * (i1 - i0))
        p = SPINE[i] - inward(SPINE[i]) * radius_at(i) * 0.9
        g.blob((radius_at(i) * 0.8, radius_at(i) * 1.1, radius_at(i) * 0.5), p, s["crust"], bone, amount=0.4, scale=8,
               segments=10, rings=6)
    g.drips(bone, [SPINE[i0 + 2] + inward(SPINE[i0 + 2]) * radius_at(i0 + 2) * 0.9 + Vector((0, 0.02, 0))], 0.012,
            length=0.07)

# The tip: a knuckle of crust bristling with the shards it flings.
g.ball((0.13, 0.13, 0.12), TIP, s["crust"], "tip", segments=14, rings=8)
g.ball((0.09, 0.09, 0.09), TIP + Vector((0.06, 0, -0.03)), s["bronze"], "tip", segments=10, rings=6)
forward = (TIP - SPINE[-3]).normalized()
frame = growth.facing(forward)
for k in range(9):
    a = math.radians(k * 40)
    spread = 0.55 if k % 2 else 0.35
    d = (frame @ Vector((math.cos(a) * spread, math.sin(a) * spread, 1.0))).normalized()
    base = TIP + d * 0.09
    g.piece(kit.rod(base, base + d * rng.uniform(0.22, 0.32), 0.028, segments=8, radius_end=0.003), s["bronze"], "tip")
    g.ball((0.035, 0.035, 0.03), base, s["crust"], "tip", segments=8, rings=5)
g.ball((0.035, 0.035, 0.035), TIP + Vector((0.02, 0, 0.1)), glow, "tip", segments=8, rings=5)
for name, k in BLOOMS.items():
    i = (CUTS[k - 1] + CUTS[k]) // 2
    p = SPINE[i] - inward(SPINE[i]) * radius_at(i)
    g.crystals(name, p, 0.11, 8, up=-inward(SPINE[i]), spread=0.7)

body = kit.join(g.parts, "body")
print("barb geometry:", kit.report(col))
kit.ground_check([body])

surfaces.unwrap(body, kit)
images = surfaces.bake(body, kit, "barb", size=TEXTURE_SIZE)
surfaces.save_images(images, os.path.join(PREVIEW_DIR, "textures"))

kit.bind(body, rig)
rig.scale = (1 / FOOTPRINT,) * 3

# ---------------------------------------------------------------------------
# Clips. Positions in tiles before the rig is shrunk.
# ---------------------------------------------------------------------------

build = {
    "mat": {0: [("scale", 0.05)], 10: []},
    "base": {0: [("loc", (0, 0, -0.7))], 6: [("loc", (0, 0, -0.7))], 40: []},
    "mount": {0: [("scale", 0.1)], 36: [("scale", 0.1)], 52: []},
    "tip": {0: [("scale", 0.0)], 92: [("scale", 0.0)], 106: []},
}
for k in range(3):
    build[f"vein.{k + 1}"] = {0: [("stretch", 0.03)], 4 + 4 * k: [("stretch", 0.03)], 30 + 4 * k: []}
# Coiled tight under the ground, and uncoiling upward segment by segment.
for k in range(SEGMENTS):
    start = 48 + 7 * k
    build[f"spine.{k + 1}"] = {0: [("Y", -62)], start: [("Y", -62)], start + 26: [("Y", 4)], start + 32: []}
for k, name in enumerate(BLOOMS):
    build[name] = {0: [("scale", 0.0)], 104 + 4 * k: [("scale", 0.0)], 114 + 2 * k: []}
kit.track_clip(rig, "build", 120, build)

kit.track_clip(rig, "idle", 90, {
    "spine.2": {0: [("Y", -1.5)], 45: [("Y", 1.5)], 90: [("Y", -1.5)]},
    "spine.4": {0: [("Y", 1.0)], 45: [("Y", -1.5)], 90: [("Y", 1.0)]},
    "base": {0: [], 45: [("scale", 1.03)], 90: []},
})

# One full traverse, a key every twelfth of a turn: 48 frames, so a heading
# is never more than 3.75 degrees from a baked one.
TURN = {f: [("Z", f * 7.5)] for f in range(0, 49, 4)}
kit.track_clip(rig, "aim", 48, {"mount": TURN}, linear=("mount",))
kit.track_clip(rig, "aim_fire", 48, {
    "mount": TURN,
    "spine.3": {0: [("Y", 12)]},
    "spine.4": {0: [("Y", 16)]},
    "spine.5": {0: [("Y", 20)]},
    "tip": {0: [("Y", 10)]},
}, linear=("mount",))

stats = kit.report(col)
print("barb:", stats)
print("wrote", kit.export_rigged(col, CONTENT_ID))
print("wrote", kit.save_blend(CONTENT_ID))

if os.environ.get("RTS_PREVIEWS", "1") != "0":
    os.makedirs(PREVIEW_DIR, exist_ok=True)

    def pose(action, frame):
        return lambda: kit.set_pose(rig, bpy.data.actions[action], frame)

    pose("idle", 0)()
    print("previews", kit.previews(
        col, PREVIEW_DIR, "barb", views=((35, -45), (35, 135), (20, -70)), frame=2.0,
        poses=[
            ("build45", pose("build", 54)),
            ("build70", pose("build", 84)),
            ("aim90", pose("aim", 12)),
            ("aim225_fire", pose("aim_fire", 30)),
        ],
    ))
