"""
The Siphon -- the Verdigris's plasma extractor. Content id: concord.siphon.

    blender -b --factory-startup --python scripts/models/siphon.py

WHAT IT IS (UNIVERSE.md, Structures, "The Verdigris")
--------------------------------------------------------
It was a heat-exchanger manifold, a bank of pipes that once carried coolant
past the furnaces. It is those pipes, grown into a cluster of throats plunged
into a vent, drinking the heat. Built on a vent, which it consumes, so the
model carries the vent too; yields plasma; trains nothing.

WHAT IT LOOKS LIKE
------------------
A hand gripping the vent. From a swollen manifold body in the middle, six
thick tubes of wet bronze rise, arch over and bore down into the ground round
it, each thicker toward the ground where it drinks, with the swellings of
what it has swallowed along it and crust grown round it in rings. Between
the tubes, where they enter the ground, the vent's ember shows -- the one
warm light on a Verdigris building, because it is stolen -- with slag heaped
round it and cracks running out. Crust has closed over the vent's rim in a
ring, and two crust chimneys on the body vent the heat with the hive's cold
light in their throats. The bloom sits on the tubes' upper bends, where the
camera sees it.

ANIMATION. `build` is emergence: the crust ring rises, the body pushes up
out of the vent, the tubes grow out of it one after another and arch over
into the ground, the chimneys rise, the ember comes through as it starts to
drink, and the blooms open last. `idle` is swallowing: a bulge travels up
each tube in turn, from the ground to the body; the body swells with each,
the chimneys breathe, the ember flickers. No `produce` or `release`.

Built in tiles at its real footprint (+-1) and shrunk into the unit box at
the end. Blender axes: +X toward the camera, +Y left, +Z up.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import growth  # noqa: E402
import kit  # noqa: E402
import surfaces  # noqa: E402
from growth import rot  # noqa: E402

CONTENT_ID = "concord.siphon"
FOOTPRINT = 2
PREVIEW_DIR = os.environ.get("RTS_PREVIEW_DIR", os.path.join(kit.REPO, "art", "previews"))
TEXTURE_SIZE = int(os.environ.get("RTS_TEXTURE_SIZE", "1024"))

kit.fresh_scene()
col = kit.collection("Siphon")
s = surfaces.verdigris_surfaces(scale=4.0)
s["slag"] = surfaces.slag(scale=4.0, ash=0.0)
glow = kit.verdigris_palette()["glow"]
# The vent's own fire: the Directorate's warm lamp, because the heat is theirs.
ember = kit.directorate_palette()["lamp"]
g = growth.Growth(col, s, glow, seed=13)
rng = g.rng

# ---------------------------------------------------------------------------
# Proportions, in tiles. The footprint is +-1.
# ---------------------------------------------------------------------------

HUB = Vector((-0.05, 0.05, 0.6))
HUB_R = Vector((0.34, 0.32, 0.28))
# Six throats, leaving a gap over the ember on the camera's side (-45).
TUBES = (10, 80, 150, 220, 290, -100)
FOOT_R = 0.76
EMBER_R = (0.28, 0.58)
CHIMNEYS = {"chimney.1": (HUB.x + 0.12, HUB.y - 0.12, 1.4), "chimney.2": (HUB.x - 0.14, HUB.y + 0.1, 1.22)}


def around(a, r, z=0.0):
    return Vector((HUB.x + math.cos(math.radians(a)) * r, HUB.y + math.sin(math.radians(a)) * r, z))


def tube_path(a):
    """One throat's path from the body over and down into the ground."""
    return growth.curve([around(a, 0.22, HUB.z + 0.12), around(a + 4, 0.4, HUB.z + 0.4), around(a + 8, 0.6, 0.82),
                         around(a + 10, 0.72, 0.5), around(a + 11, FOOT_R, 0.16)], 5)


def rock(radii, centre, jitter=0.3, segments=7, rings=4):
    bm = kit.ellipsoid(radii, centre, segments=segments, rings=rings)
    for v in bm.verts:
        v.co += Vector((rng.uniform(-1, 1) * radii[0], rng.uniform(-1, 1) * radii[1],
                        rng.uniform(-0.5, 0.5) * radii[2])) * jitter
        v.co.z = max(v.co.z, 0.0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


# ---------------------------------------------------------------------------
# Skeleton.
# ---------------------------------------------------------------------------

g.bone("mat", (0, 0, 0), (0, 0, 0.3), "root")
g.bone("ember", (HUB.x, HUB.y, 0.0), (HUB.x, HUB.y, 0.2), "root")
g.bone("hub", (HUB.x, HUB.y, 0.05), (HUB.x, HUB.y, HUB.z + 0.3), "root")
paths = {}
for k, a in enumerate(TUBES):
    name = f"tube.{k + 1}"
    paths[name] = tube_path(a)
    g.bone(name, paths[name][0], paths[name][-1], "hub")
    foot = paths[name][-1]
    g.bone(f"gulp.{k + 1}", foot, foot + Vector((0, 0, 0.2)), name)
for name, (x, y, top) in CHIMNEYS.items():
    g.bone(name, (x, y, HUB.z + 0.15), (x, y, top), "hub")
BLOOMS = {"bloom.1": "tube.1", "bloom.2": "tube.5", "bloom.3": "tube.6"}
for name, parent in BLOOMS.items():
    p = paths[parent][8]
    g.bone(name, p, p + Vector((0, 0, 0.2)), parent)
rig = g.rig()

# ---------------------------------------------------------------------------
# The vent: the ember ring, cracks, slag, and crust closed over its rim.
# ---------------------------------------------------------------------------

g.piece(growth.lathe([(EMBER_R[0], 0.0), (EMBER_R[0], 0.02), (EMBER_R[1], 0.02), (EMBER_R[1], 0.0)], segments=24,
                     centre=(HUB.x, HUB.y, 0)), ember, "ember")
for k in range(9):
    a = k * 40 + 15 + rng.uniform(-10, 10)
    start, end = around(a, EMBER_R[1] - 0.04, 0.014), around(a + rng.uniform(-12, 12), rng.uniform(0.86, 0.96), 0.01)
    g.piece(kit.beam(start, end, 0.012, width=rng.uniform(0.02, 0.035)), ember, "ember")
for k in range(14):
    a = k * (360 / 14) + rng.uniform(-9, 9)
    r = rng.uniform(0.36, 0.6)
    size = (rng.uniform(0.07, 0.13), rng.uniform(0.06, 0.11), rng.uniform(0.04, 0.09))
    c = around(a, r)
    g.piece(rock(size, (c.x, c.y, 0.015)), s["slag"], "mat")
# The crust ring over the vent's rim, and the collars where the throats go in.
g.piece(growth.lathe([(0.6, 0.0), (0.62, 0.09), (0.78, 0.11), (0.94, 0.05), (0.97, 0.0)], segments=30,
                     centre=(HUB.x, HUB.y, 0),
                     radial=lambda th, z: 1 + 0.05 * math.sin(4 * th + 1) + 0.03 * math.sin(7 * th),
                     lift=lambda th, z: 0.02 * math.sin(5 * th) * z), s["crust"], "mat")
for name, path in paths.items():
    foot = path[-1]
    g.shelf((foot.x, foot.y, 0.0), 0.2, 0.15, s["crust"], "mat", segments=14, floor=0.0)
    g.bubbles("mat", [foot + Vector((rng.uniform(-0.14, 0.14), rng.uniform(-0.14, 0.14), -foot.z + 0.05))
                      for _ in range(3)], 0.04)
for a in (-60, -30, 160, 245):
    p = around(a + rng.uniform(-6, 6), rng.uniform(0.84, 0.92), 0.03)
    g.bubbles("mat", [p, p + Vector((0.08, 0.05, 0))], 0.045)

# ---------------------------------------------------------------------------
# The body: a swollen manifold of wet bronze on a root into the vent, crust
# capped, its chimneys venting the hive's light.
# ---------------------------------------------------------------------------

g.blob((0.36, 0.34, 0.24), (HUB.x, HUB.y, 0.16), s["bronze"], "hub", amount=0.25, scale=5, floor=0.03)
g.blob(tuple(HUB_R), HUB, s["bronze"], "hub", amount=0.14, scale=4, segments=20, rings=12)
g.blob((0.24, 0.22, 0.2), HUB + Vector((0.14, -0.14, 0.14)), s["membrane"], "hub", amount=0.2, scale=6)
g.blob((0.2, 0.2, 0.17), HUB + Vector((-0.16, 0.12, 0.18)), s["membrane"], "hub", amount=0.2, scale=6)
g.shelf((HUB.x - 0.02, HUB.y + 0.02, HUB.z + 0.2), 0.3, 0.1, s["crust"], "hub", segments=16)
g.shelf((HUB.x + 0.06, HUB.y - 0.04, HUB.z + 0.3), 0.2, 0.08, s["crust"], "hub", segments=14)
g.bubbles("hub", [HUB + Vector((math.cos(math.radians(a)) * 0.32, math.sin(math.radians(a)) * 0.3,
                                rng.uniform(-0.1, 0.1))) for a in (-70, -20, 30, 120, 200, 260)], 0.05)
g.drips("hub", [HUB + Vector((0.3, -0.12, -0.1)), HUB + Vector((0.1, -0.3, -0.12)), HUB + Vector((-0.28, 0.14, -0.1))],
        0.016, length=0.12)
for name, (x, y, top) in CHIMNEYS.items():
    path = growth.curve([(x, y, HUB.z + 0.12), (x + 0.02, y - 0.01, HUB.z + 0.5), (x, y, top)], 5)
    g.tube(path, growth.swell(len(path), 0.1, at=(0.4,), amount=0.3, taper=(1.0, 0.65)), s["crust"], name,
           segments=12, wall=0.03, wobble=0.05)
    g.ball((0.05, 0.05, 0.05), (x, y, top - 0.06), glow, name, segments=8, rings=5)
    for z in (0.3, 0.6):
        p = (x, y, HUB.z + 0.12 + (top - HUB.z - 0.12) * z)
        g.tube(growth.ring((x, y), 0.105 - z * 0.03, 12, z=p[2]) + [growth.ring((x, y), 0.105 - z * 0.03, 12, z=p[2])[0]],
               0.022, s["bronze"], name, segments=6)

# ---------------------------------------------------------------------------
# The throats: six tubes of wet bronze, thicker where they drink, crust grown
# round them in rings, the bloom on the bends the camera sees.
# ---------------------------------------------------------------------------

for k, (name, path) in enumerate(paths.items()):
    n = len(path)
    radii = growth.swell(n, 0.095, at=(0.28, 0.62), amount=0.3, width=0.08, taper=(0.9, 1.2))
    g.tube(path, radii, s["bronze"], name, segments=14, wobble=0.03)
    for t in (0.2, 0.5, 0.8):
        i = int(t * (n - 1))
        p = path[i]
        d = (path[min(i + 1, n - 1)] - path[max(i - 1, 0)]).normalized()
        loop = [p + growth.facing(d) @ Vector((math.cos(math.radians(j * 30)) * radii[i] * 1.1,
                                               math.sin(math.radians(j * 30)) * radii[i] * 1.1, 0)) for j in range(13)]
        g.tube(loop, 0.028, s["crust"], name, segments=6)
    # Where it lies on the crust ring: bubbles up its foot.
    g.bubbles(name, [path[-2] + Vector((rng.uniform(-0.1, 0.1), rng.uniform(-0.1, 0.1), rng.uniform(0.0, 0.1)))
                     for _ in range(2)], 0.035)
    # The swallowed: a bulge that travels up the throat at rest.
    g.ball((0.13, 0.13, 0.12), path[-1] + Vector((0, 0, 0.02)), s["membrane"], f"gulp.{k + 1}", segments=12, rings=7)
for name, parent in BLOOMS.items():
    i = 8
    p = paths[parent][i]
    up = (p - Vector((HUB.x, HUB.y, p.z - 0.3))).normalized()
    g.crystals(name, p, 0.12, 9, up=up, spread=0.7)

body = kit.join(g.parts, "body")
print("siphon geometry:", kit.report(col))
kit.ground_check([body])

surfaces.unwrap(body, kit)
images = surfaces.bake(body, kit, "siphon", size=TEXTURE_SIZE)
surfaces.save_images(images, os.path.join(PREVIEW_DIR, "textures"))

kit.bind(body, rig)
rig.scale = (1 / FOOTPRINT,) * 3

# ---------------------------------------------------------------------------
# Clips. Positions in tiles before the rig is shrunk.
# ---------------------------------------------------------------------------

build = {
    "mat": {0: [("loc", (0, 0, -0.16))], 10: []},
    "hub": {0: [("loc", (0, 0, -0.9))], 8: [("loc", (0, 0, -0.9))], 40: []},
    "ember": {0: [("scale", 0.2)], 88: [("scale", 0.2)], 108: []},
}
for k, name in enumerate(paths):
    build[name] = {0: [("stretch", 0.04)], 28 + 6 * k: [("stretch", 0.04)], 62 + 6 * k: []}
    build[f"gulp.{k + 1}"] = {0: [("scale", 0.0)], 96: [("scale", 0.0)], 104: []}
for k, name in enumerate(CHIMNEYS):
    build[name] = {0: [("stretch", 0.08)], 78 + 6 * k: [("stretch", 0.08)], 98 + 6 * k: []}
for k, name in enumerate(BLOOMS):
    build[name] = {0: [("scale", 0.0)], 100 + 5 * k: [("scale", 0.0)], 114 + 2 * k: []}
kit.track_clip(rig, "build", 120, build)

# Three seconds: each throat swallows once, and the body takes it in.
idle = {
    "hub": {0: [], 20: [("scale", 1.04)], 45: [], 65: [("scale", 1.03)], 90: []},
    "ember": {0: [], 30: [("scale", 1.06)], 55: [("scale", 0.96)], 90: []},
}
for k, name in enumerate(CHIMNEYS):
    idle[name] = {0: [], 30 + 20 * k: [("scale", (1.0, 1.0, 1.05))], 90: []}
for k, (name, path) in enumerate(paths.items()):
    foot = path[-1]
    f0 = k * 11
    along = lambda t, foot=foot, path=path: tuple(path[int(t * (len(path) - 1))] - foot)
    idle[f"gulp.{k + 1}"] = {
        0: [] if f0 == 0 else [("scale", 1.0)],
        f0: [], f0 + 10: [("loc", along(0.68))], f0 + 20: [("loc", along(0.36))], f0 + 28: [("loc", along(0.08)), ("scale", 0.8)],
        f0 + 30: [("loc", along(0.06)), ("scale", 0.0)], f0 + 32: [("scale", 0.0)], f0 + 34: [],
    }
kit.track_clip(rig, "idle", 90, idle)

stats = kit.report(col)
print("siphon:", stats)
print("wrote", kit.export_rigged(col, CONTENT_ID))
print("wrote", kit.save_blend(CONTENT_ID))

if os.environ.get("RTS_PREVIEWS", "1") != "0":
    os.makedirs(PREVIEW_DIR, exist_ok=True)

    def pose(action, frame):
        return lambda: kit.set_pose(rig, bpy.data.actions[action], frame)

    pose("idle", 0)()
    print("previews", kit.previews(
        col, PREVIEW_DIR, "siphon", views=((35, -45), (35, 135), (20, -70)), frame=2.0,
        poses=[
            ("build30", pose("build", 36)),
            ("build60", pose("build", 72)),
            ("build90", pose("build", 108)),
            ("idle20", pose("idle", 20)),
        ],
    ))
