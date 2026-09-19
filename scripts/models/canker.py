"""
The Canker -- the Verdigris's war-beast nursery. Content id: concord.grove.

    blender -b --factory-startup --python scripts/models/canker.py

WHAT IT IS (UNIVERSE.md, Structures, "The Verdigris")
--------------------------------------------------------
It was the hull of a heavy war crawler, buried where it was knocked out in
the war -- the kind of wreck the hive first learned from, on the Sump. It is
that hull cankered open along its spine, its ribs bared and grown thick, and
gestation pits in its belly where what it grows takes shape. It grows
Flensers, Blightcasters and Behemoths: the Foundry's counterpart, and as
clearly a place that makes things.

WHAT IT LOOKS LIKE
------------------
A long, low, broken hull with ribs arching out of its back. The crawler is
still there -- rotten plate, its track and road wheels showing under the
crust on the -Y side -- but the growth has made it a body: the spine split
open into a trench of membrane with swollen lips, three gestation pits in it
lit from inside, and five pairs of bronze ribs curving up out of the deck
over them like a cage that has opened. Crust terraces step down its sides
and heap round its base, veins run out to the edges, everything drips. At
the +X end, where what it grows comes out, a birth opening: a bronze ring of
teeth round two membrane jaws, the hive's light behind them. The bloom is on
the ribs, where the camera sees it.

ANIMATION. `build` is emergence: the hull surfaces from the ash like a wreck
from water, the spine's lips part, the ribs lift out of the deck one pair
after another, crust climbs the sides, the pits swell, the blooms open last.
`idle` -- the ribs flex a little and the pits stir. `produce` -- the pits
churn and the ribs flex hard, the lips with them. `release` -- the birth
opening's jaws part and close.

Built in tiles at its real footprint (+-1.5) and shrunk into the unit box
at the end. Blender axes: +X toward the camera, +Y left, +Z up.
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

CONTENT_ID = "concord.grove"
FOOTPRINT = 3
PREVIEW_DIR = os.environ.get("RTS_PREVIEW_DIR", os.path.join(kit.REPO, "art", "previews"))
TEXTURE_SIZE = int(os.environ.get("RTS_TEXTURE_SIZE", "2048"))

kit.fresh_scene()
col = kit.collection("Canker")
s = surfaces.verdigris_surfaces(scale=4.0)
glow = kit.verdigris_palette()["glow"]
g = growth.Growth(col, s, glow, seed=21)
rng = g.rng

# ---------------------------------------------------------------------------
# Proportions, in tiles. The footprint is +-1.5.
# ---------------------------------------------------------------------------

HX0, HX1 = -1.3, 1.15
HY = 0.72
DECK = 0.62
GASH = 0.26
RIBS = (-0.78, -0.42, -0.06, 0.3, 0.66)
PITS = (-0.62, -0.02, 0.56)
MOUTH = Vector((HX1, 0.0, 0.36))
WHEELS = (-1.0, -0.66, -0.32, 0.02, 0.36, 0.7)
VEINS = ((-0.2, -0.75, -1.42, -0.55), (0.6, -0.72, 1.4, -1.35), (1.1, 0.4, 1.42, 1.3), (-1.2, 0.5, -1.42, 1.38),
         (-1.25, -0.4, -1.42, -1.3))


def rect(x0, x1, y0, y1, c=0.0):
    return [(x1, y0 + c), (x1, y1 - c), (x1 - c, y1), (x0 + c, y1), (x0, y1 - c), (x0, y0 + c), (x0 + c, y0),
            (x1 - c, y0)]


def rib_path(x, side):
    """A rib: out of the deck's edge, up, and curving in over the spine."""
    return growth.curve([(x, side * 0.6, 0.5), (x + 0.02, side * 0.74, 0.86), (x + 0.01, side * 0.58, 1.18),
                         (x - 0.02, side * 0.3, 1.4), (x - 0.04, side * 0.12, 1.44)], 4)


# ---------------------------------------------------------------------------
# Skeleton.
# ---------------------------------------------------------------------------

g.bone("mat", (0, 0, 0), (0, 0, 0.3), "root")
g.bone("hull", (0, 0, 0.05), (0, 0, DECK), "root")
g.bone("lip.L", (-0.05, GASH + 0.06, DECK), (0.9, GASH + 0.06, DECK), "hull")
g.bone("lip.R", (-0.05, -GASH - 0.06, DECK), (0.9, -GASH - 0.06, DECK), "hull")
for k, x in enumerate(PITS):
    g.bone(f"pit.{k + 1}", (x, 0, DECK - 0.05), (x, 0, DECK + 0.3), "hull")
rib_paths = {}
for k, x in enumerate(RIBS):
    for name, side in (("L", 1), ("R", -1)):
        bone = f"rib.{name}.{k + 1}"
        rib_paths[bone] = rib_path(x, side)
        g.bone(bone, rib_paths[bone][0], rib_paths[bone][0] + Vector((0, 0, 0.5)), "hull")
g.bone("crust.1", (0.2, -HY, 0.05), (0.2, -HY, 0.5), "hull")
g.bone("crust.2", (HX1, 0.3, 0.05), (HX1, 0.3, 0.5), "hull")
g.bone("jaw.L", (MOUTH.x, 0.3, MOUTH.z), (MOUTH.x + 0.2, 0.3, MOUTH.z), "hull")
g.bone("jaw.R", (MOUTH.x, -0.3, MOUTH.z), (MOUTH.x + 0.2, -0.3, MOUTH.z), "hull")
for k, (x0, y0, x1, y1) in enumerate(VEINS):
    g.bone(f"vein.{k + 1}", (x0, y0, 0.08), (x1, y1, 0.04), "mat")
BLOOMS = {"bloom.1": "rib.R.2", "bloom.2": "rib.R.4", "bloom.3": "rib.L.5", "bloom.4": "rib.L.1"}
for name, parent in BLOOMS.items():
    p = rib_paths[parent][12]
    g.bone(name, p, p + Vector((0, 0, 0.2)), parent)
rig = g.rig()

# ---------------------------------------------------------------------------
# The ground: crust heaped round the hull, and the veins.
# ---------------------------------------------------------------------------

g.shelf((-0.1, -0.1, 0.0), 1.3, 0.09, s["crust"], "mat", segments=24, floor=0.0)
g.shelf((0.35, -0.35, 0.06), 0.95, 0.1, s["crust"], "mat", segments=20, floor=0.0)
for k, (x0, y0, x1, y1) in enumerate(VEINS):
    name = f"vein.{k + 1}"
    mid = Vector(((x0 + x1) / 2 + rng.uniform(-0.1, 0.1), (y0 + y1) / 2 + rng.uniform(-0.1, 0.1), 0.06))
    mid.z = 0.1
    pts = g.vein([(x0, y0, 0.1), mid, (x1, y1, 0.045)], 0.07, name, at=(0.45,), amount=0.5, taper=(1.0, 0.45),
                 segments=10, per_segment=6)
    g.crystals(name, pts[len(pts) // 2] + Vector((0, 0, 0.07)), 0.07, 5, spread=0.8)
    g.bubbles(name, [pts[-1] + Vector((rng.uniform(-0.06, 0.06), rng.uniform(-0.06, 0.06), 0))], 0.045)

# ---------------------------------------------------------------------------
# The hull: rotten plate, the track and road wheels on -Y under the crust.
# ---------------------------------------------------------------------------

hull = kit.prism(rect(HX0, HX1, -HY, HY, 0.16), 0.06, DECK, top_scale=0.94)
g.piece(hull, s["rot"], "hull", bevel=0.03, segments=2)
g.piece(kit.prism(rect(HX0 + 0.1, HX1 - 0.1, -HY + 0.2, HY - 0.2, 0.1), DECK - 0.02, DECK + 0.05, top_scale=0.96),
        s["rot"], "hull", bevel=0.02, segments=2)
# The track: road wheels half in the hull's flank, pads round them, a sprocket.
for x in WHEELS:
    g.piece(kit.rod((x, -HY + 0.06, 0.2), (x, -HY - 0.1, 0.2), 0.15, segments=18), s["rot"], "hull", bevel=0.01)
    g.piece(kit.rod((x, -HY - 0.1, 0.2), (x, -HY - 0.13, 0.2), 0.06, segments=10), s["bronze"], "hull")
g.piece(kit.rod((HX1 - 0.15, -HY + 0.02, 0.32), (HX1 - 0.15, -HY - 0.12, 0.32), 0.18, segments=12), s["rot"], "hull")
for k in range(16):
    x = -1.15 + k * 0.15
    g.box((0.11, 0.08, 0.05), (x, -HY - 0.09, 0.04), s["rot"], "hull", rot("Y", rng.uniform(-6, 6)), bevel=0.005)
for k in range(11):
    x = -1.05 + k * 0.17
    g.box((0.11, 0.08, 0.05), (x, -HY - 0.12, 0.4 + 0.02 * math.sin(k)), s["rot"], "hull",
          rot("Y", rng.uniform(-8, 8)) @ rot("X", 20), bevel=0.005)
# Plate torn off the flanks, where the ribs came through.
for x, y, w in ((-0.9, HY, 0.4), (0.4, HY, 0.5), (-0.3, -HY, 0.36)):
    g.box((w, 0.05, 0.28), (x, y * 0.98, DECK - 0.24), s["rot"], "hull", rot("Y", rng.uniform(-6, 6)) @ rot(
        "X", rng.uniform(-8, 8) * math.copysign(1, y)), bevel=0.008)

# Crust closed over the hull in sheets and patches, terraces stepping down
# its sides, drips under every one.
for x, y, z, sx, sy, bone in ((-1.0, 0.45, DECK + 0.02, 0.5, 0.4, "crust.2"), (0.7, 0.5, DECK + 0.02, 0.6, 0.35, "crust.2"),
                              (-0.2, 0.55, DECK + 0.02, 0.5, 0.3, "crust.2"), (0.95, -0.5, DECK + 0.02, 0.4, 0.35, "crust.1"),
                              (-0.9, -0.5, DECK + 0.02, 0.55, 0.35, "crust.1"), (HX0 + 0.05, 0.0, 0.4, 0.08, 0.9, "crust.2")):
    g.blob((sx, sy, 0.05) if sx > sy else (sx, sy, 0.3), (x, y, z), s["crust"], bone, amount=0.7, scale=4, segments=14,
           rings=7)
g.shelf((-1.05, 0.5, DECK + 0.03), 0.3, 0.09, s["crust"], "crust.2", segments=16)
g.shelf((0.55, 0.52, DECK + 0.03), 0.26, 0.09, s["crust"], "crust.2", segments=16)
g.shelf((-0.75, -0.62, DECK + 0.02), 0.24, 0.09, s["crust"], "crust.1", segments=16)
for x, y, z, size, bone in ((0.9, -0.55, 0.45, 0.4, "crust.1"), (0.2, -0.6, 0.3, 0.5, "crust.1"),
                            (-0.55, -0.58, 0.5, 0.45, "crust.1"), (-1.1, -0.3, 0.4, 0.4, "crust.1"),
                            (1.05, 0.25, 0.4, 0.4, "crust.2"), (0.5, 0.62, 0.35, 0.5, "crust.2"),
                            (-0.4, 0.62, 0.5, 0.45, "crust.2"), (-1.1, 0.35, 0.35, 0.4, "crust.2")):
    flat = (0.06, size, size * 0.7) if abs(x) > 1.0 else (size, 0.06, size * 0.7)
    g.blob(flat, (x, y, z), s["crust"], bone, amount=0.6, scale=5, segments=12, rings=7)
for c, r, bone in (((0.75, -0.85, 0.0), 0.42, "crust.1"), ((0.6, -0.72, 0.16), 0.34, "crust.1"),
                   ((0.45, -0.62, 0.3), 0.26, "crust.1"), ((-0.5, -0.8, 0.0), 0.38, "crust.1"),
                   ((-0.62, -0.7, 0.15), 0.3, "crust.1"), ((HX1 + 0.05, -0.45, 0.0), 0.35, "crust.2"),
                   ((HX1 + 0.1, -0.35, 0.14), 0.26, "crust.2"), ((HX1 + 0.02, 0.5, 0.0), 0.38, "crust.2"),
                   ((HX1 + 0.08, 0.42, 0.16), 0.3, "crust.2"), ((-0.1, 0.85, 0.0), 0.4, "crust.2"),
                   ((-1.25, 0.6, 0.05), 0.3, "crust.2")):
    g.shelf(c, r, 0.1, s["crust"], bone, segments=16, floor=0.0)
    if c[2] > 0.1:
        g.drips(bone, [Vector((c[0] + r * 0.8, c[1] - r * 0.3, c[2] - 0.01))], 0.016, length=0.1)
g.bubbles("crust.1", [Vector((rng.uniform(-1.1, 1.0), -HY - rng.uniform(0.0, 0.12), rng.uniform(0.1, 0.55)))
                      for _ in range(9)], 0.045)
g.bubbles("crust.2", [Vector((HX1 + rng.uniform(-0.02, 0.1), rng.uniform(-0.55, 0.6), rng.uniform(0.1, 0.55)))
                      for _ in range(6)], 0.045)
g.drips("hull", [Vector((x, -HY - 0.06, DECK - 0.02)) for x in (-0.95, -0.15, 0.55)], 0.018, length=0.14)
g.drips("hull", [Vector((HX1 + 0.04, y, DECK - 0.02)) for y in (-0.5, 0.15, 0.55)], 0.018, length=0.14)

# ---------------------------------------------------------------------------
# The spine: a trench of membrane with swollen lips, the pits in it lit from
# inside, and the ribs curving up over it.
# ---------------------------------------------------------------------------

g.box((1.95, GASH * 2 + 0.06, 0.08), (-0.05, 0, DECK + 0.01), s["membrane"], "hull", bevel=0.02, segments=2)
for name, side in (("lip.L", 1), ("lip.R", -1)):
    g.blob((1.0, 0.12, 0.05), (-0.05, side * (GASH - 0.04), DECK + 0.07), s["membrane"], name, amount=0.5, scale=4,
           segments=18, rings=7)
    lip = growth.curve([(-1.02, side * (GASH + 0.06), DECK + 0.03), (-0.5, side * (GASH + 0.1), DECK + 0.06),
                        (0.0, side * (GASH + 0.08), DECK + 0.07), (0.5, side * (GASH + 0.1), DECK + 0.06),
                        (0.92, side * (GASH + 0.06), DECK + 0.03)], 5)
    g.tube(lip, growth.swell(len(lip), 0.06, at=(0.3, 0.7), amount=0.45, taper=(0.6, 0.6)), s["bronze"], "hull",
           segments=10, wobble=0.04)
for k, x in enumerate(PITS):
    name = f"pit.{k + 1}"
    g.blob((0.27, 0.19, 0.15), (x, 0, DECK + 0.02), s["membrane"], name, amount=0.18, scale=6, segments=18, rings=10)
    g.ball((0.1, 0.09, 0.08), (x + 0.03, 0.02, DECK + 0.14), glow, name, segments=10, rings=6)
    g.bubbles(name, [Vector((x + rng.uniform(-0.2, 0.2), rng.uniform(-0.12, 0.12), DECK + 0.1)) for _ in range(2)],
              0.03, mat=s["bronze"])
for bone, path in rib_paths.items():
    n = len(path)
    g.tube(path, growth.swell(n, 0.07, at=(0.35,), amount=0.35, taper=(1.05, 0.4)), s["bronze"], bone, segments=12,
           wobble=0.03)
    g.ball((0.09, 0.09, 0.08), path[0], s["bronze"], bone, segments=10, rings=6)
    g.ball((0.07, 0.07, 0.06), path[0] + Vector((0, 0, 0.05)), s["crust"], bone, segments=8, rings=5)
    for t in (0.3, 0.6):
        i = int(t * (n - 1))
        p = path[i]
        d = (path[i + 1] - path[i - 1]).normalized()
        r = 0.06 * (1.05 + (0.45 - 1.05) * t) * 1.15
        loop = [p + growth.facing(d) @ Vector((math.cos(math.radians(j * 30)) * r, math.sin(math.radians(j * 30)) * r, 0))
                for j in range(13)]
        g.tube(loop, 0.02, s["crust"], bone, segments=6)
    g.piece(kit.rod(path[-1], path[-1] + (path[-1] - path[-2]).normalized() * 0.1, 0.028, segments=7,
                    radius_end=0.003), s["bronze"], bone)
for name, parent in BLOOMS.items():
    p = rib_paths[parent][12]
    up = (p - rib_paths[parent][10]).normalized()
    g.crystals(name, p, 0.09, 8, up=up, spread=0.7)

# ---------------------------------------------------------------------------
# The birth opening at +X: a ring of teeth round two jaws of membrane, lit
# from behind.
# ---------------------------------------------------------------------------

collar = [MOUTH + Vector((0.02, math.cos(math.radians(a)) * 0.32, math.sin(math.radians(a)) * 0.3)) for a in
          range(0, 361, 20)]
g.tube(collar, growth.swell(len(collar), 0.05, at=(0.25, 0.75), amount=0.4), s["bronze"], "hull", segments=10)
for a in range(15, 360, 30):
    p = MOUTH + Vector((0.04, math.cos(math.radians(a)) * 0.29, math.sin(math.radians(a)) * 0.27))
    inward = (MOUTH - p).normalized()
    g.piece(kit.rod(p, p + inward * 0.09 + Vector((0.06, 0, 0)), 0.02, segments=7, radius_end=0.003), s["bronze"],
            "hull")
g.ball((0.02, 0.22, 0.2), MOUTH + Vector((-0.02, 0, 0)), glow, "hull", segments=12, rings=6)
for name, side in (("jaw.L", 1), ("jaw.R", -1)):
    g.blob((0.07, 0.17, 0.26), MOUTH + Vector((0.02, side * 0.14, 0)), s["membrane"], name, amount=0.3, scale=6,
           segments=12, rings=8)
g.bubbles("crust.2", [MOUTH + Vector((0.02, math.cos(math.radians(a)) * 0.4, math.sin(math.radians(a)) * 0.36))
                      for a in (60, 120, 200, 320)], 0.04)

body = kit.join(g.parts, "body")
print("canker geometry:", kit.report(col))
kit.ground_check([body])

surfaces.unwrap(body, kit)
images = surfaces.bake(body, kit, "canker", size=TEXTURE_SIZE)
surfaces.save_images(images, os.path.join(PREVIEW_DIR, "textures"))

kit.bind(body, rig)
rig.scale = (1 / FOOTPRINT,) * 3

# ---------------------------------------------------------------------------
# Clips. Positions in tiles before the rig is shrunk.
# ---------------------------------------------------------------------------

build = {
    "mat": {0: [("loc", (0, 0, -0.16))], 8: []},
    "hull": {0: [("loc", (0, 0, -0.95))], 6: [("loc", (0, 0, -0.95))], 50: []},
    "lip.L": {0: [("X", -78)], 52: [("X", -78)], 68: []},
    "lip.R": {0: [("X", 78)], 52: [("X", 78)], 68: []},
    "crust.1": {0: [("scale", 0.02)], 66: [("scale", 0.02)], 96: []},
    "crust.2": {0: [("scale", 0.02)], 74: [("scale", 0.02)], 104: []},
    "jaw.L": {0: [("scale", 0.1)], 88: [("scale", 0.1)], 104: []},
    "jaw.R": {0: [("scale", 0.1)], 88: [("scale", 0.1)], 104: []},
}
for k, name in enumerate(VEINS):
    build[f"vein.{k + 1}"] = {0: [("stretch", 0.03)], 4 + 4 * k: [("stretch", 0.03)], 30 + 4 * k: []}
for k in range(len(PITS)):
    build[f"pit.{k + 1}"] = {0: [("scale", 0.1)], 76 + 5 * k: [("scale", 0.1)], 98 + 5 * k: []}
for k in range(len(RIBS)):
    for side, sign in (("L", -1), ("R", 1)):
        start = 58 + 5 * k
        build[f"rib.{side}.{k + 1}"] = {0: [("X", sign * 86)], start: [("X", sign * 86)], start + 22: [("X", -sign * 4)],
                                        start + 28: []}
for k, name in enumerate(BLOOMS):
    build[name] = {0: [("scale", 0.0)], 102 + 4 * k: [("scale", 0.0)], 114 + 2 * k: []}
kit.track_clip(rig, "build", 120, build)

# Four seconds: the ribs breathe, the pits stir.
idle = {}
for k in range(len(RIBS)):
    for side, sign in (("L", -1), ("R", 1)):
        phase = (k * 17 + (0 if side == "L" else 8)) % 120
        idle[f"rib.{side}.{k + 1}"] = {0: [("X", sign * 2)], 60: [("X", -sign * 2)], 120: [("X", sign * 2)]} if phase == 0 else {
            0: [], phase: [("X", sign * 2.5)], (phase + 60) % 120 or 120: [("X", -sign * 2.5)], 120: []}
for k in range(len(PITS)):
    idle[f"pit.{k + 1}"] = {0: [], 30 + 20 * k: [("scale", 1.05)], 90 + 10 * k: [], 120: []}
kit.track_clip(rig, "idle", 120, idle)

# Two seconds: churning.
produce = {
    "lip.L": {0: [], 15: [("X", -9)], 30: [], 45: [("X", -6)], 60: []},
    "lip.R": {0: [], 15: [("X", 9)], 30: [], 45: [("X", 6)], 60: []},
}
for k in range(len(RIBS)):
    for side, sign in (("L", -1), ("R", 1)):
        f = (k * 6) % 30
        produce[f"rib.{side}.{k + 1}"] = {0: [], f: [], f + 12: [("X", sign * 9)], f + 24: [("X", -sign * 5)], f + 30: [],
                                          60: []}
for k in range(len(PITS)):
    produce[f"pit.{k + 1}"] = {0: [], 10 + 12 * k: [("scale", (1.1, 1.1, 1.22))], 30 + 12 * k: [("scale", 0.94)],
                               60: []}
kit.track_clip(rig, "produce", 60, produce)

kit.track_clip(rig, "release", 45, {
    "jaw.L": {0: [], 10: [("Z", 72)], 30: [("Z", 72)], 45: []},
    "jaw.R": {0: [], 10: [("Z", -72)], 30: [("Z", -72)], 45: []},
    "pit.3": {0: [], 8: [("scale", 0.85)], 30: []},
    "lip.L": {0: [], 12: [("X", -10)], 34: []},
    "lip.R": {0: [], 12: [("X", 10)], 34: []},
})

stats = kit.report(col)
print("canker:", stats)
print("wrote", kit.export_rigged(col, CONTENT_ID))
print("wrote", kit.save_blend(CONTENT_ID))

if os.environ.get("RTS_PREVIEWS", "1") != "0":
    os.makedirs(PREVIEW_DIR, exist_ok=True)

    def pose(action, frame):
        return lambda: kit.set_pose(rig, bpy.data.actions[action], frame)

    pose("idle", 0)()
    print("previews", kit.previews(
        col, PREVIEW_DIR, "canker", views=((35, -45), (35, 135), (20, -70)), frame=1.6,
        poses=[
            ("build30", pose("build", 36)),
            ("build60", pose("build", 72)),
            ("build85", pose("build", 102)),
            ("produce", pose("produce", 15)),
            ("release", pose("release", 20)),
        ],
    ))
