"""
The Bloom -- the Verdigris's supply structure. Content id: concord.bloom.

    blender -b --factory-startup --python scripts/models/bloom.py

WHAT IT IS (UNIVERSE.md, Structures, "The Verdigris")
--------------------------------------------------------
It was a ruptured storage tank. It is an efflorescence: the spill has
crystallised into a mound of oxide shelves and blooms heaped over the tank's
crumpled shell. It provides supply; it trains nothing. Cheap and many, so it
must never be mistaken for a Heartrot: low, no tower, and the crown of
crystals is most of what can be seen of it from above.

WHAT IT LOOKS LIKE
------------------
A low mound of crust terraces stepping down to the ground, heaped over and
through a tank whose rotten shell still shows on the camera's side (+X):
the plating torn open there, a valve wheel on the wall beside the tear, and
in the tear a swollen gall of membrane pushing out of the tank with the
hive's light behind it. Drips hang from every terrace and pool at the foot.
On top, the crown: the biggest cluster of the bloom's crystals on any
Verdigris structure, in the brood's colour, with smaller clusters down the
terraces the camera sees.

ANIMATION. `build` is emergence: crust spreads from a point, the tank's
shell rises through it, the terraces stack up over it one tier after
another, the gall fills, and the crown blooms last. `idle` -- the crown
opens and closes, very slowly, the two halves out of step; the gall
breathes. No `produce` or `release`.

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

CONTENT_ID = "concord.bloom"
FOOTPRINT = 2
PREVIEW_DIR = os.environ.get("RTS_PREVIEW_DIR", os.path.join(kit.REPO, "art", "previews"))
TEXTURE_SIZE = int(os.environ.get("RTS_TEXTURE_SIZE", "1024"))

kit.fresh_scene()
col = kit.collection("Bloom")
s = surfaces.verdigris_surfaces(scale=4.0)
glow = kit.verdigris_palette()["glow"]
g = growth.Growth(col, s, glow, seed=34)
rng = g.rng

# ---------------------------------------------------------------------------
# Proportions, in tiles. The footprint is +-1.
# ---------------------------------------------------------------------------

TANK = Vector((-0.12, 0.12))
TANK_R, TANK_TOP = 0.5, 0.74
TEAR = 32
GALL = Vector((TANK.x + 0.42, TANK.y - 0.1, 0.3))
# The terraces, by tier: (centre, radius, height).
TIERS = {
    "tier.1": (((-0.2, 0.15, 0.1), 0.8), ((0.3, -0.3, 0.09), 0.5)),
    "tier.2": (((-0.3, 0.22, 0.22), 0.64), ((0.05, -0.4, 0.2), 0.36)),
    "tier.3": (((-0.32, 0.24, 0.36), 0.54), ((-0.3, 0.2, 0.5), 0.45)),
    "tier.4": (((-0.24, 0.16, 0.64), 0.38), ((-0.15, 0.12, 0.78), 0.31)),
}
CROWN = Vector((-0.15, 0.12, 0.86))


def lumpy(theta, z):
    return 1 + 0.06 * math.sin(4 * theta + 1) + 0.04 * math.sin(9 * theta) + 0.03 * math.sin(3 * theta + 5 * z)


def torn(theta, z):
    f = (z / TANK_TOP) ** 6
    return 0.1 * math.cos(theta) * (z / TANK_TOP) + 0.1 * f * (math.sin(9 * theta) + 0.5 * math.sin(17 * theta + 1))


def on_tank(degrees, z, out=0.0):
    theta = math.radians(degrees)
    r = TANK_R * lumpy(theta, z) + out
    return Vector((TANK.x + math.cos(theta) * r, TANK.y + math.sin(theta) * r, z + torn(theta, z)))


# ---------------------------------------------------------------------------
# Skeleton.
# ---------------------------------------------------------------------------

g.bone("mat", (0, 0, 0), (0, 0, 0.3), "root")
g.bone("tank", (TANK.x, TANK.y, 0.02), (TANK.x, TANK.y, TANK_TOP), "root")
g.bone("gall", (GALL.x - 0.1, GALL.y, GALL.z), (GALL.x + 0.2, GALL.y, GALL.z), "tank")
for name, shelves in TIERS.items():
    (x, y, z), _ = shelves[0]
    g.bone(name, (x, y, z), (x, y, z + 0.2), "root")
g.bone("crown", tuple(CROWN), tuple(CROWN + Vector((0, 0, 0.3))), "tier.4")
g.bone("crown.2", tuple(CROWN), tuple(CROWN + Vector((0, 0, 0.3))), "tier.4")
g.bone("bloom.1", (0.32, -0.32, 0.18), (0.32, -0.32, 0.4), "tier.1")
g.bone("bloom.2", (0.15, -0.42, 0.28), (0.15, -0.42, 0.5), "tier.2")
rig = g.rig()

# ---------------------------------------------------------------------------
# The ground: crust spread from the tank's foot, pools of what dripped.
# ---------------------------------------------------------------------------

g.shelf((-0.08, 0.08, 0.0), 0.96, 0.1, s["crust"], "mat", segments=24, floor=0.0)
for c, r in (((0.75, -0.42), 0.18), ((0.55, 0.62), 0.14), ((-0.2, -0.85), 0.16)):
    g.blob((r, r * 0.8, 0.03), (c[0], c[1], 0.02), s["membrane"], "mat", amount=0.4, scale=8, segments=12, rings=4,
           floor=0.006)
for a in (-70, -20, 40, 160, 230):
    p = Vector((-0.08 + math.cos(math.radians(a)) * 0.9, 0.08 + math.sin(math.radians(a)) * 0.9, 0.04))
    g.bubbles("mat", [p, p + Vector((rng.uniform(-0.1, 0.1), rng.uniform(-0.1, 0.1), 0))], 0.045)
for a in (-55, 20):
    path = [Vector((-0.08 + math.cos(math.radians(a)) * 0.55, 0.08 + math.sin(math.radians(a)) * 0.55, 0.14)),
            Vector((-0.08 + math.cos(math.radians(a + 6)) * 0.78, 0.08 + math.sin(math.radians(a + 6)) * 0.78, 0.09)),
            Vector((-0.08 + math.cos(math.radians(a + 2)) * 0.96, 0.08 + math.sin(math.radians(a + 2)) * 0.96, 0.04))]
    g.vein(path, 0.05, "mat", at=(0.5,), amount=0.5, taper=(1.0, 0.5), segments=9, per_segment=5)

# ---------------------------------------------------------------------------
# The tank: a crumpled shell of rotten plate, torn open toward the camera,
# the valve wheel beside the tear, the gall pushing out of it.
# ---------------------------------------------------------------------------

zs = [0.0, 0.2, 0.42, 0.6, TANK_TOP]
shell = [(TANK_R, z) for z in zs] + [(TANK_R - 0.05, z) for z in reversed(zs)]
g.piece(growth.lathe(shell, segments=36, centre=(TANK.x, TANK.y, 0.03), angles=(TEAR, 360 - TEAR), radial=lumpy,
                     lift=torn, floor=0.0), s["rot"], "tank")
g.piece(growth.lathe([(0.0, 0.03), (TANK_R - 0.04, 0.03), (TANK_R - 0.04, 0.07), (0.0, 0.07)], segments=24,
                     centre=(TANK.x, TANK.y, 0.0), radial=lumpy), s["rot"], "tank")
# The torn edges, bent out: plate chunks down both sides of the tear.
for sign in (1, -1):
    for z in (0.16, 0.38, 0.58):
        a = sign * (TEAR + rng.uniform(-2, 4))
        p = on_tank(a, z, out=0.02)
        g.box((rng.uniform(0.08, 0.14), rng.uniform(0.1, 0.16), rng.uniform(0.12, 0.2)), p, s["rot"], "tank",
              rot("Z", a + sign * 35) @ rot("Y", sign * rng.uniform(5, 25)), bevel=0.006)
# Plate torn off the top and lying on the ground where it fell.
flap = growth.lathe([(0.34, 0.0), (0.4, 0.0), (0.4, 0.05), (0.34, 0.05)], segments=10, centre=(0, 0, 0),
                    angles=(200, 320), radial=lambda th, z: 1 + 0.08 * math.sin(5 * th))
import bmesh  # noqa: E402
bmesh.ops.rotate(flap, cent=(0, 0, 0), matrix=rot("X", 8) @ rot("Y", -14), verts=flap.verts)
bmesh.ops.translate(flap, vec=Vector((0.62, -0.6, 0.12)), verts=flap.verts)
for v in flap.verts:
    v.co.z = max(v.co.z, 0.0)
g.piece(flap, s["rot"], "mat", bevel=0.005)
# The valve wheel on the wall beside the tear.
WHEEL = on_tank(-TEAR - 22, 0.46, out=0.1)
axis = (WHEEL - Vector((TANK.x, TANK.y, WHEEL.z))).normalized()
g.piece(kit.rod(WHEEL - axis * 0.1, WHEEL, 0.03, segments=8), s["rot"], "tank")
frame = growth.facing(axis)
for k in range(12):
    a0, a1 = math.radians(k * 30), math.radians((k + 1) * 30)
    p0 = WHEEL + frame @ Vector((math.cos(a0) * 0.12, math.sin(a0) * 0.12, 0))
    p1 = WHEEL + frame @ Vector((math.cos(a1) * 0.12, math.sin(a1) * 0.12, 0))
    g.piece(kit.rod(p0, p1, 0.014, segments=6), s["rot"] if k % 2 else s["bronze"], "tank")
for k in range(4):
    a = math.radians(k * 90 + 45)
    g.piece(kit.beam(WHEEL, WHEEL + frame @ Vector((math.cos(a) * 0.12, math.sin(a) * 0.12, 0)), 0.014), s["rot"],
            "tank")
# Inside: a wet hollow, lit, and the gall swelling out of the tear.
g.blob((0.36, 0.36, 0.07), (TANK.x, TANK.y, 0.08), s["membrane"], "tank", amount=0.4, scale=6, segments=16, rings=5,
       floor=0.04)
g.ball((0.12, 0.12, 0.04), (TANK.x + 0.1, TANK.y - 0.05, 0.12), glow, "tank", segments=10, rings=5)
g.blob((0.22, 0.2, 0.17), GALL, s["membrane"], "gall", amount=0.2, scale=6, segments=18, rings=10)
g.blob((0.12, 0.11, 0.1), GALL + Vector((0.12, 0.1, 0.1)), s["membrane"], "gall", amount=0.25, scale=8, segments=12,
       rings=7)
g.ball((0.05, 0.05, 0.05), GALL + Vector((0.14, -0.08, 0.06)), glow, "gall", segments=8, rings=5)
for a in (-30, 20, 60):
    p = GALL + Vector((math.cos(math.radians(a)) * 0.2, math.sin(math.radians(a)) * 0.18, 0.06))
    d = (p - GALL).normalized()
    g.piece(kit.rod(p - d * 0.03, p + d * 0.08, 0.018, segments=7, radius_end=0.003), s["bronze"], "gall")
g.drips("tank", [on_tank(a, TANK_TOP - 0.02, out=0.02) for a in (-60, -100, 300, 60)], 0.016, length=0.12)

# ---------------------------------------------------------------------------
# The mound: terraces in tiers over the shell, bubbles between them, drips
# under every lip, the bloom on the ones the camera sees.
# ---------------------------------------------------------------------------

for name, shelves in TIERS.items():
    for (x, y, z), r in shelves:
        g.shelf((x, y, z), r, 0.11, s["crust"], name, segments=20, floor=0.0 if z < 0.12 else None)
        for _ in range(3):
            a = rng.uniform(-120, 60)
            g.bubbles(name, [Vector((x + math.cos(math.radians(a)) * r * rng.uniform(0.5, 0.95),
                                     y + math.sin(math.radians(a)) * r * rng.uniform(0.5, 0.95), z + 0.1))], 0.04)
        for a in (rng.uniform(-100, -40), rng.uniform(-20, 40)):
            g.drips(name, [Vector((x + math.cos(math.radians(a)) * r * 0.86, y + math.sin(math.radians(a)) * r * 0.86,
                                   z - 0.005))], 0.014, length=0.09 if z > 0.15 else 0.03)
g.crystals("crown", CROWN, 0.23, 10, spread=0.8, tilt=28)
g.crystals("crown.2", CROWN + Vector((0.06, -0.05, -0.02)), 0.18, 8, spread=1.0, tilt=32)
g.crystals("bloom.1", (0.32, -0.32, 0.19), 0.11, 7, spread=0.7)
g.crystals("bloom.2", (0.15, -0.42, 0.3), 0.09, 6, spread=0.7)
g.ball((0.035, 0.035, 0.035), (0.02, -0.5, 0.24), glow, "tier.2", segments=8, rings=5)

body = kit.join(g.parts, "body")
print("bloom geometry:", kit.report(col))
kit.ground_check([body])

surfaces.unwrap(body, kit)
images = surfaces.bake(body, kit, "bloom", size=TEXTURE_SIZE)
surfaces.save_images(images, os.path.join(PREVIEW_DIR, "textures"))

kit.bind(body, rig)
rig.scale = (1 / FOOTPRINT,) * 3

# ---------------------------------------------------------------------------
# Clips. Positions in tiles before the rig is shrunk.
# ---------------------------------------------------------------------------

build = {
    "mat": {0: [("scale", 0.05)], 12: []},
    "tank": {0: [("loc", (0, 0, -0.8))], 8: [("loc", (0, 0, -0.8))], 46: []},
    "gall": {0: [("scale", 0.08)], 80: [("scale", 0.08)], 100: []},
    "crown": {0: [("scale", 0.0)], 100: [("scale", 0.0)], 116: []},
    "crown.2": {0: [("scale", 0.0)], 106: [("scale", 0.0)], 120: []},
    "bloom.1": {0: [("scale", 0.0)], 96: [("scale", 0.0)], 110: []},
    "bloom.2": {0: [("scale", 0.0)], 102: [("scale", 0.0)], 114: []},
}
for k, name in enumerate(TIERS):
    build[name] = {0: [("scale", 0.02)], 38 + 12 * k: [("scale", 0.02)], 64 + 12 * k: []}
kit.track_clip(rig, "build", 120, build)

# Six seconds: the crown opens and closes, its two halves out of step.
kit.track_clip(rig, "idle", 180, {
    "crown": {0: [], 90: [("scale", 1.06)], 180: []},
    "crown.2": {0: [("scale", 1.05)], 90: [], 180: [("scale", 1.05)]},
    "gall": {0: [], 70: [("scale", 1.07)], 140: [], 180: []},
})

stats = kit.report(col)
print("bloom:", stats)
print("wrote", kit.export_rigged(col, CONTENT_ID))
print("wrote", kit.save_blend(CONTENT_ID))

if os.environ.get("RTS_PREVIEWS", "1") != "0":
    os.makedirs(PREVIEW_DIR, exist_ok=True)

    def pose(action, frame):
        return lambda: kit.set_pose(rig, bpy.data.actions[action], frame)

    pose("idle", 0)()
    print("previews", kit.previews(
        col, PREVIEW_DIR, "bloom", views=((35, -45), (35, 135), (20, -70)), frame=2.0,
        poses=[
            ("build30", pose("build", 36)),
            ("build60", pose("build", 72)),
            ("build90", pose("build", 108)),
        ],
    ))
