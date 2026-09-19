"""
The Heartrot -- the Verdigris's headquarters. Content id: concord.heartwood.

    blender -b --factory-startup --python scripts/models/heartrot.py

WHAT IT IS (UNIVERSE.md, Structures, "The Verdigris")
--------------------------------------------------------
It was the stump of one of the Ashworks' cooling towers. It is that shell
split open down one side, and inside it a heart of fused copper coil,
swollen, wet, slowly working -- the place where the brood's mind runs
thickest. Creepers feed scrap into a mouth at its foot, and new Creepers come
out of a birth sac beside the split. It grows Creepers, receives alloy and
provides supply: the one Verdigris shape with a tower's outline, and the
largest.

WHAT IT LOOKS LIKE
------------------
Alive first, machine second. The stump is still a hyperboloid of rotten
concrete and iron, taller at the back where it broke, but everything on it
has grown: crust terraces climbing the walls in shelves, bubbles between
them, stalactites under every lip, veins of wet bronze running up the shell
and out across the ground to the footprint's edges, with the swellings of
something moving through them.

  - **The split** faces the camera (+X), narrow at the foot and torn wide
    above, its edges broken into chunks and hung with crust. Through it, the
    **heart**: a knot of bronze coils round a cold-lit core, membrane
    chambers under it, a trunk going down into the floor. It breathes.
  - **The birth sac** at the split's foot (+X): a membrane egg gripped by
    bronze ribs, in two halves that part when a Creeper comes out, a cold
    glow inside and teeth round the seam.
  - **The feeding mouth** on -Y: a membrane throat flared open toward the
    trough where Creepers drop their scrap, teeth round its lip, the
    hive's light down its gullet.
  - **The bloom**, in the brood's colour, in crystal clusters on the split's
    edges, on the rim and along the veins.

ANIMATION. `build` is emergence: the veins break the ash first and crawl out
to the edges, the stump rises out of the ground in their grip, crust swells
up its walls, the heart grows in the split, the sac and the mouth fill, and
the blooms open last. `idle` -- the heart swells and eases, slowly, like
breathing; the sac and the mouth with it. `produce` -- faster, and the sac
fills. `release` -- the sac parts and folds back.

Built in tiles at its real footprint (+-2) and shrunk into the unit box at
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

CONTENT_ID = "concord.heartwood"
FOOTPRINT = 4
PREVIEW_DIR = os.environ.get("RTS_PREVIEW_DIR", os.path.join(kit.REPO, "art", "previews"))
TEXTURE_SIZE = int(os.environ.get("RTS_TEXTURE_SIZE", "2048"))

kit.fresh_scene()
col = kit.collection("Heartrot")
s = surfaces.verdigris_surfaces(scale=4.0)
glow = kit.verdigris_palette()["glow"]
g = growth.Growth(col, s, glow, seed=5)
rng = g.rng

# ---------------------------------------------------------------------------
# Proportions, in tiles. The footprint is +-2.
# ---------------------------------------------------------------------------

TOWER = Vector((-0.3, 0.3))
TOP = 2.7
WALL = 0.13
# The rim broke higher at the back (+Y/-X) than over the split.
BACK = math.radians(135)
RIM_TILT = 0.5
# The stump's outer radius up its height: a hyperboloid's waist.
RADII = [(0.0, 1.08), (0.6, 0.94), (1.2, 0.84), (1.7, 0.8), (2.2, 0.83), (TOP, 0.9)]
# The split, centred on +X: a narrow tear at the foot, wide above.
LOWER, UPPER = 0.9, TOP
SPLIT_LOW, SPLIT_HIGH = 16, 46
# Crust closed over the shell in sheets: (angles, heights) of each.
SKINS = (((55, 150), (0.25, 1.7)), ((190, 290), (0.7, 2.3)), ((290, 338), (0.2, 1.1)), ((60, 125), (1.9, 2.62)))

HEART = Vector((TOWER.x + 0.3, TOWER.y - 0.1, 1.55))
SAC = Vector((1.25, -0.05, 0.36))
SAC_R = Vector((0.42, 0.36, 0.34))
MOUTH = [Vector((TOWER.x + 0.1, TOWER.y - 0.55, 0.42)), Vector((TOWER.x + 0.05, TOWER.y - 0.95, 0.36)),
         Vector((TOWER.x, TOWER.y - 1.25, 0.3)), Vector((TOWER.x - 0.05, TOWER.y - 1.42, 0.34))]
TROUGH = Vector((-0.3, -1.6))
VEINS = (30, 75, 125, 170, 215, 255, -40)
CRUST = {"crust.1": (80, 20, 140), "crust.2": (200, 140, 260), "crust.3": (300, 260, 380)}
BLOOMS = {"bloom.1": (SPLIT_HIGH, 2.1, (1, 0.35)), "bloom.2": (-SPLIT_HIGH, 1.5, (1, 0.3)),
          "bloom.3": (120, TOP, (0, 1))}


def r_at(z):
    for (z0, r0), (z1, r1) in zip(RADII, RADII[1:]):
        if z <= z1:
            return r0 + (r1 - r0) * (z - z0) / (z1 - z0)
    return RADII[-1][1]


def lift(theta, z):
    tilt = (z / TOP) * RIM_TILT * math.cos(theta - BACK)
    # The rim broke jagged, not level.
    jag = 0.14 * (z / TOP) ** 8 * (math.sin(11 * theta + 1) + 0.5 * math.sin(23 * theta + 2)
                                   + 0.3 * math.sin(41 * theta))
    return tilt + jag


def lumps(theta, z):
    return 1 + 0.04 * math.sin(3 * theta + 0.5) + 0.03 * math.sin(5 * theta + 2) + 0.02 * math.sin(9 * theta) \
        + 0.02 * math.sin(4 * z + theta)


def on_wall(degrees, z, out=0.0):
    """A point on the stump's outer surface, `out` beyond it."""
    theta = math.radians(degrees)
    r = r_at(z) * lumps(theta, z) + out
    return Vector((TOWER.x + math.cos(theta) * r, TOWER.y + math.sin(theta) * r, z + lift(theta, z)))


def crust_bone(degrees):
    degrees %= 360
    for name, (_, a0, a1) in CRUST.items():
        if a0 <= degrees < a1 or a0 <= degrees + 360 < a1:
            return name
    return "crust.1"


# ---------------------------------------------------------------------------
# Skeleton. Every moving assembly is one bone; every piece is weighted wholly
# to one of them.
# ---------------------------------------------------------------------------

g.bone("mat", (0, 0, 0), (0, 0, 0.3), "root")
g.bone("tower", (TOWER.x, TOWER.y, 0), (TOWER.x, TOWER.y, TOP), "root")
g.bone("heart", (HEART.x, HEART.y, 1.0), (HEART.x, HEART.y, 2.1), "tower")
for name, (a, _, _) in CRUST.items():
    foot = on_wall(a, 0.02)
    g.bone(name, foot, foot + Vector((0, 0, 0.6)), "tower")
g.bone("mouth", (TOWER.x, TOWER.y - 0.85, 0.12), (TOWER.x, TOWER.y - 1.45, 0.12), "tower")
g.bone("trough", (TROUGH.x, TROUGH.y, 0), (TROUGH.x, TROUGH.y, 0.2), "root")
g.bone("sac", (0.84, SAC.y, 0.02), (0.84, SAC.y, 0.7), "root")
g.bone("sac.L", (0.86, SAC.y + 0.06, SAC.z), (1.3, SAC.y + 0.06, SAC.z), "sac")
g.bone("sac.R", (0.86, SAC.y - 0.06, SAC.z), (1.3, SAC.y - 0.06, SAC.z), "sac")
vein_paths = {}
for k, a in enumerate(VEINS):
    d = Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0))
    start = on_wall(a, 0.1, out=-0.05)
    # Out to the footprint's edge, and no further.
    length = min(1.9, (1.92 - TOWER.x * math.copysign(1, d.x)) / max(abs(d.x), 1e-6),
                 (1.92 - TOWER.y * math.copysign(1, d.y)) / max(abs(d.y), 1e-6))
    end = Vector((TOWER.x, TOWER.y, 0.045)) + d * length
    side = Vector((-d.y, d.x, 0)) * rng.uniform(-0.2, 0.2)
    mid1 = start.lerp(end, 0.35) + side + Vector((0, 0, 0.05))
    mid2 = start.lerp(end, 0.7) - side * 0.6 + Vector((0, 0, 0.03))
    vein_paths[f"vein.{k + 1}"] = [start, mid1, mid2, end]
    g.bone(f"vein.{k + 1}", start, end, "mat")
for name, (a, z, _) in BLOOMS.items():
    p = on_wall(a, z, out=-0.04)
    g.bone(name, p, p + Vector((0, 0, 0.3)), "tower")
rig = g.rig()

# ---------------------------------------------------------------------------
# The ground: crust spilled round the stump's foot, and the veins.
# ---------------------------------------------------------------------------

g.shelf((TOWER.x, TOWER.y, 0.0), 1.5, 0.1, s["crust"], "mat", segments=22, floor=0.0)
g.shelf((TOWER.x + 0.15, TOWER.y - 0.1, 0.07), 1.3, 0.12, s["crust"], "mat", segments=22, floor=0.0)
g.shelf((TOWER.x + 0.25, TOWER.y - 0.15, 0.16), 1.15, 0.12, s["crust"], "mat", segments=22, floor=0.0)
for name, path in vein_paths.items():
    pts = g.vein(path, 0.085, name, at=(0.3, 0.68), amount=0.5, taper=(1.0, 0.45), segments=10, per_segment=5)
    for t in (0.3, 0.68):
        p = pts[int(t * (len(pts) - 1))]
        g.crystals(name, p + Vector((0, 0, 0.07)), 0.08, 6, spread=0.8)
    end = pts[-1]
    g.bubbles(name, [end + Vector((rng.uniform(-0.08, 0.08), rng.uniform(-0.08, 0.08), 0.0)) for _ in range(3)],
              0.05)

# ---------------------------------------------------------------------------
# The stump: two bands of shell round the split, the rim broken into chunks.
# ---------------------------------------------------------------------------


def band(z0, z1, steps):
    zs = [z0 + (z1 - z0) * k / steps for k in range(steps + 1)]
    return [(r_at(z), z) for z in zs] + [(r_at(z) - WALL, z) for z in reversed(zs)]


for (z0, z1, steps), half_split in (((0.0, LOWER, 3), SPLIT_LOW), ((LOWER, UPPER, 6), SPLIT_HIGH)):
    g.piece(growth.lathe(band(z0, z1, steps), segments=40, centre=(TOWER.x, TOWER.y, 0),
                         angles=(half_split, 360 - half_split), radial=lumps, lift=lift), s["rot"], "tower")

# The rim, broken: chunks of the shell tilted every which way, crust
# bubbling over the edge and hanging under it.
for a in range(SPLIT_HIGH + 10, 360 - SPLIT_HIGH - 6, 19):
    a += rng.uniform(-6, 6)
    kind = rng.random()
    if kind < 0.2:
        continue
    p = on_wall(a, TOP, out=-0.07)
    size = (rng.uniform(0.12, 0.36), rng.uniform(0.12, 0.26), rng.uniform(0.06, 0.26))
    turn = rot("Z", a + rng.uniform(-25, 25)) @ rot("X", rng.uniform(-30, 30)) @ rot("Y", rng.uniform(-28, 28))
    if kind < 0.55:
        g.box(size, p + Vector((0, 0, size[2] * 0.25)), s["rot"], "tower", turn, bevel=0.008)
    else:
        g.blob((size[0] * 0.6, size[1] * 0.6, size[2] * 0.6), p + Vector((0, 0, size[2] * 0.2)), s["rot"], "tower",
               amount=0.25, scale=6, segments=10, rings=6)
for a in (70, 160, 250, 305):
    g.bubbles("tower", [on_wall(a + rng.uniform(-8, 8), TOP - rng.uniform(0.05, 0.2), out=0.03) for _ in range(3)],
              0.06)

# Crust closed over the shell in sheets, ragged at their edges, the metal
# showing through between them.
for (a0, a1), (z0, z1) in SKINS:
    zs = [z0 + (z1 - z0) * k / 4 for k in range(5)]
    skin = [(r_at(z) + 0.035, z) for z in zs] + [(r_at(z) + 0.004, z) for z in reversed(zs)]
    g.piece(growth.lathe(skin, segments=max(6, int((a1 - a0) / 6)), centre=(TOWER.x, TOWER.y, 0), angles=(a0, a1),
                         radial=lambda th, z: lumps(th, z) * (1 + 0.03 * math.sin(6 * z + 3 * th)),
                         lift=lambda th, z: lift(th, z) + 0.08 * math.sin(5 * th + 2 * z)),
            s["crust"], crust_bone((a0 + a1) / 2))
for sign in (1, -1):
    for z in (1.3, 1.95):
        g.ball((0.05, 0.05, 0.05), on_wall(sign * (SPLIT_HIGH - 3), z, out=-0.04), glow, "tower", segments=8,
               rings=5)

# The split's torn edges: chunks and crust lips down both sides.
for sign in (1, -1):
    for z in (1.05, 1.45, 1.85, 2.25, 2.6):
        a = sign * SPLIT_HIGH + rng.uniform(-3, 3)
        p = on_wall(a, z, out=-0.06)
        g.box((rng.uniform(0.14, 0.22), rng.uniform(0.12, 0.2), rng.uniform(0.16, 0.26)), p, s["rot"], "tower",
              rot("Z", a + sign * 20) @ rot("Y", rng.uniform(-15, 15)), bevel=0.008)
    for z in (0.35, 0.7):
        a = sign * SPLIT_LOW
        g.box((0.16, 0.14, 0.2), on_wall(a, z, out=-0.05), s["rot"], "tower", rot("Z", a) @ rot("X", sign * 12),
              bevel=0.008)
    for z in (1.25, 2.0):
        a = sign * (SPLIT_HIGH - 2)
        g.shelf(on_wall(a, z, out=-0.02), 0.2, 0.09, s["crust"], "tower", segments=14)
        g.drips("tower", [on_wall(a + sign * 4, z - 0.03, out=0.12)], 0.02, length=0.16)

# Crust terraces climbing the walls, bubbles between them, drips under
# every lip, and veins going up the shell.
TERRACES = ((60, 0.5, 0.36), (75, 1.3, 0.3), (100, 0.9, 0.4), (130, 1.9, 0.3), (150, 0.6, 0.42),
            (200, 1.2, 0.36), (230, 2.1, 0.28), (250, 0.45, 0.4), (275, 1.5, 0.34), (300, 0.8, 0.36),
            (320, 1.7, 0.3), (48, 2.2, 0.26), (310, 2.4, 0.24), (110, 2.45, 0.28))
for a, z, r in TERRACES:
    bone = crust_bone(a)
    g.shelf(on_wall(a, z, out=-0.03), r, 0.1, s["crust"], bone, segments=16)
    if a in (48, 60, 250, 275, 300, 320):
        g.crystals(bone, on_wall(a, z, out=r * 0.45) + Vector((0, 0, 0.08)), 0.12, 7, spread=0.7)
    g.bubbles(bone, [on_wall(a + rng.uniform(-14, 14), z + rng.uniform(-0.3, 0.3), out=0.02) for _ in range(3)],
              0.05)
    g.drips(bone, [on_wall(a + rng.uniform(-6, 6), z - 0.02, out=r * 0.85)], 0.018, length=0.13)
for a in (95, 215, 290):
    bone = crust_bone(a)
    path = [on_wall(a, 0.05, out=0.05), on_wall(a + 8, 0.6, out=0.05), on_wall(a + 14, 1.3, out=0.05),
            on_wall(a + 22, 1.95, out=0.04)]
    g.vein(path, 0.07, bone, at=(0.5,), amount=0.5, taper=(1.0, 0.4), segments=10, per_segment=5)

# ---------------------------------------------------------------------------
# The heart, in the split: coils of bronze round a cold core, chambers of
# membrane under it, a trunk into the floor. The floor is a wet hollow.
# ---------------------------------------------------------------------------

g.blob((0.6, 0.6, 0.18), (TOWER.x, TOWER.y, 0.1), s["membrane"], "tower", amount=0.3, scale=4, segments=18,
       rings=8, floor=0.01)
g.tube(growth.curve([(HEART.x, HEART.y, 0.12), (HEART.x - 0.05, HEART.y + 0.04, 0.5), (HEART.x, HEART.y, 0.95),
                     (HEART.x, HEART.y, HEART.z - 0.2)], 5),
       growth.swell(16, 0.13, at=(0.45,), amount=0.4, taper=(1.0, 0.7)), s["bronze"], "heart", segments=12,
       wobble=0.05)
g.ball((0.3, 0.3, 0.3), HEART, glow, "heart", segments=18, rings=10)
for radius, turns, r, z0, z1, phase in ((0.43, 2.5, 0.075, -0.38, 0.38, 0.0), (0.35, 1.8, 0.055, -0.3, 0.32, 2.0)):
    n = 46
    coil = [HEART + Vector((math.cos(phase + turns * 2 * math.pi * i / n) * radius,
                            math.sin(phase + turns * 2 * math.pi * i / n) * radius,
                            z0 + (z1 - z0) * i / n)) for i in range(n + 1)]
    g.tube(coil, growth.swell(n + 1, r, at=(0.3, 0.7), amount=0.45, width=0.08), s["bronze"], "heart", segments=10,
           wobble=0.04)
    for t in (0.3, 0.7):
        g.ball((r * 0.9,) * 3, coil[int(t * n)] + Vector((0, 0, r * 0.9)), glow, "heart", segments=8, rings=5)
g.blob((0.26, 0.24, 0.22), HEART + Vector((-0.1, 0.16, -0.44)), s["membrane"], "heart", amount=0.2, scale=5)
g.blob((0.22, 0.2, 0.2), HEART + Vector((0.16, -0.2, -0.38)), s["membrane"], "heart", amount=0.2, scale=5)
g.blob((0.16, 0.15, 0.14), HEART + Vector((0.05, 0.24, 0.32)), s["membrane"], "heart", amount=0.2, scale=6,
       segments=12, rings=7)

# Crust spilled out of the split's foot, cascading down toward the sac.
for c, r in (((TOWER.x + 0.95, TOWER.y - 0.05, 0.86), 0.3), ((TOWER.x + 1.1, TOWER.y - 0.12, 0.64), 0.34),
             ((TOWER.x + 1.2, TOWER.y - 0.2, 0.44), 0.3)):
    g.shelf(c, r, 0.1, s["crust"], "tower", segments=16)
g.drips("tower", [Vector((TOWER.x + 1.25, TOWER.y - 0.1, 0.84)), Vector((TOWER.x + 1.4, TOWER.y - 0.25, 0.62))],
        0.02, length=0.15)

# ---------------------------------------------------------------------------
# The birth sac at the split's foot: two halves of membrane held by bronze
# ribs, the hive's light and a ring of teeth inside the seam.
# ---------------------------------------------------------------------------


def sac_ry(x):
    return SAC_R.y * max(0.0, 1 - ((x - SAC.x) / SAC_R.x) ** 2) ** 0.5


for name, sign in (("sac.L", 1), ("sac.R", -1)):
    egg = growth.blob(tuple(SAC_R), SAC, 0.1, 3.5, rng.uniform(0, 10), 20, 12, floor=0.015)
    growth.half(egg, SAC, (0, sign, 0))
    g.piece(egg, s["membrane"], name)
    for x in (1.02, 1.25, 1.48):
        ry, rz = sac_ry(x) * 1.07, sac_ry(x) * (SAC_R.z / SAC_R.y) * 1.07
        arc = [Vector((x, SAC.y + sign * ry * math.cos(math.radians(phi)), SAC.z + rz * math.sin(math.radians(phi))))
               for phi in (88, 66, 44, 22, 4)]
        arc.append(Vector((x, SAC.y + sign * (ry + 0.04), 0.03)))
        g.tube(growth.curve(arc, 3), growth.swell(len(growth.curve(arc, 3)), 0.03, taper=(0.8, 1.2)), s["bronze"],
               name, segments=8)
    # Teeth along the seam, pointing out of it.
    for phi in (25, 55, 95, 135):
        p = Vector((SAC.x + SAC_R.x * 0.98 * math.cos(math.radians(phi)), SAC.y + sign * 0.06,
                    SAC.z + SAC_R.z * 0.98 * math.sin(math.radians(phi))))
        d = (p - SAC).normalized()
        g.piece(kit.rod(p - d * 0.02, p + d * 0.09, 0.02, segments=7, radius_end=0.003), s["bronze"], name)
g.ball((0.1, 0.16, 0.16), SAC + Vector((0.28, 0, 0)), glow, "sac", segments=10, rings=6)
# Where the sac meets the shell: a bronze collar and crust round its foot.
g.tube(growth.ring((SAC.x - 0.3, SAC.y), 0.28, 20, z=SAC.z) + [growth.ring((SAC.x - 0.3, SAC.y), 0.28, 20, z=SAC.z)[0]],
       0.045, s["bronze"], "sac", segments=8)
g.shelf((SAC.x - 0.05, SAC.y, 0.0), 0.55, 0.08, s["crust"], "sac", segments=16, floor=0.0)
g.bubbles("sac", [Vector((SAC.x + rng.uniform(-0.4, 0.3), SAC.y + rng.uniform(-0.45, 0.45), 0.04)) for _ in range(5)],
          0.045)

# ---------------------------------------------------------------------------
# The feeding mouth on -Y: a throat flared open over the trough, teeth round
# its lip, lit down the gullet.
# ---------------------------------------------------------------------------

throat = growth.curve(MOUTH, 5)
g.tube(throat, growth.swell(len(throat), 0.22, at=(0.4,), amount=0.3, taper=(1.0, 1.35)), s["membrane"], "mouth",
       segments=14, wall=0.045)
g.ball((0.14, 0.06, 0.12), MOUTH[2] + Vector((0, 0.06, -0.02)), glow, "mouth", segments=10, rings=6)
lip = MOUTH[-1]
for k in range(10):
    a = math.radians(k * 36 + 18)
    p = lip + Vector((math.cos(a) * 0.3, 0, math.sin(a) * 0.3))
    inward = (lip - p).normalized()
    g.piece(kit.rod(p, p + inward * 0.11 + Vector((0, -0.04, 0)), 0.022, segments=7, radius_end=0.003), s["bronze"],
            "mouth")
g.tube(growth.ring((lip.x, lip.y), 0.31, 16, z=lip.z), 0.035, s["bronze"], "mouth", segments=8)
g.bubbles("mouth", [MOUTH[1] + Vector((rng.uniform(-0.25, 0.25), rng.uniform(-0.1, 0.1), 0.2 + rng.uniform(0, 0.15)))
                    for _ in range(4)], 0.045)
g.shelf((TROUGH.x, TROUGH.y, 0.0), 0.36, 0.11, s["crust"], "trough", segments=16, floor=0.0)
for k in range(5):
    size = (rng.uniform(0.09, 0.16), rng.uniform(0.07, 0.13), rng.uniform(0.05, 0.09))
    g.box(size, (TROUGH.x + rng.uniform(-0.2, 0.2), TROUGH.y + rng.uniform(-0.18, 0.18), 0.1 + size[2] / 2),
          s["rot"], "trough", rot("Z", rng.uniform(0, 90)) @ rot("X", rng.uniform(-20, 20)), bevel=0.006)
g.drips("trough", [Vector((TROUGH.x + 0.3, TROUGH.y - 0.1, 0.1)), Vector((TROUGH.x - 0.25, TROUGH.y - 0.15, 0.1))],
        0.015, length=0.08)

# ---------------------------------------------------------------------------
# The bloom, in the brood's colour.
# ---------------------------------------------------------------------------

for name, (a, z, up) in BLOOMS.items():
    p = on_wall(a, z, out=-0.04)
    theta = math.radians(a)
    direction = Vector((math.cos(theta) * up[0], math.sin(theta) * up[0], up[1]))
    g.crystals(name, p, 0.18, 12, up=direction, spread=0.8)

body = kit.join(g.parts, "body")
print("heartrot geometry:", kit.report(col))
kit.ground_check([body])

# ---------------------------------------------------------------------------
# Textures, then into the unit box.
# ---------------------------------------------------------------------------

surfaces.unwrap(body, kit)
images = surfaces.bake(body, kit, "heartrot", size=TEXTURE_SIZE)
surfaces.save_images(images, os.path.join(PREVIEW_DIR, "textures"))

kit.bind(body, rig)
rig.scale = (1 / FOOTPRINT,) * 3

# ---------------------------------------------------------------------------
# Clips. Positions in tiles, before the rig is shrunk.
# ---------------------------------------------------------------------------

BUILD = 120
build = {
    "mat": {0: [("loc", (0, 0, -0.2))], 10: []},
    "tower": {0: [("loc", (0, 0, -3.1))], 24: [("loc", (0, 0, -3.1))], 66: []},
    "heart": {0: [("scale", 0.15)], 72: [("scale", 0.15)], 100: []},
    "mouth": {0: [("scale", 0.1)], 80: [("scale", 0.1)], 104: []},
    "trough": {0: [("loc", (0, 0, -0.2))], 40: [("loc", (0, 0, -0.2))], 52: []},
    "sac": {0: [("scale", 0.05)], 90: [("scale", 0.05)], 112: []},
}
for k, name in enumerate(vein_paths):
    build[name] = {0: [("stretch", 0.03)], 4 + 3 * k: [("stretch", 0.03)], 30 + 3 * k: []}
for k, name in enumerate(CRUST):
    build[name] = {0: [("scale", 0.02)], 60 + 4 * k: [("scale", 0.02)], 92 + 4 * k: []}
for k, name in enumerate(BLOOMS):
    build[name] = {0: [("scale", 0.0)], 100 + 4 * k: [("scale", 0.0)], 114 + 2 * k: []}
kit.track_clip(rig, "build", BUILD, build)

# Five seconds: one slow breath.
kit.track_clip(rig, "idle", 150, {
    "heart": {0: [], 75: [("scale", 1.07)], 150: []},
    "sac": {0: [], 60: [], 105: [("scale", 1.03)], 150: []},
    "mouth": {0: [("scale", (1.0, 1.0, 1.0))], 40: [("scale", (1.0, 1.03, 0.96))], 90: [], 150: []},
})

# Two seconds: quick breaths, and the sac filling.
kit.track_clip(rig, "produce", 60, {
    "heart": {0: [], 14: [("scale", 1.12)], 30: [], 44: [("scale", 1.1)], 60: []},
    "sac": {0: [], 30: [("scale", 1.22)], 60: []},
    "mouth": {0: [], 30: [("scale", (1.0, 1.05, 0.94))], 60: []},
})

kit.track_clip(rig, "release", 45, {
    "sac.L": {0: [], 12: [("Z", 42)], 28: [("Z", 42)], 45: []},
    "sac.R": {0: [], 12: [("Z", -42)], 28: [("Z", -42)], 45: []},
    "sac": {0: [("scale", 1.1)], 12: [], 45: []},
    "heart": {0: [], 10: [("scale", 0.92)], 30: []},
})

stats = kit.report(col)
print("heartrot:", stats)
print("wrote", kit.export_rigged(col, CONTENT_ID))
print("wrote", kit.save_blend(CONTENT_ID))

if os.environ.get("RTS_PREVIEWS", "1") != "0":
    os.makedirs(PREVIEW_DIR, exist_ok=True)

    def pose(action, frame):
        return lambda: kit.set_pose(rig, bpy.data.actions[action], frame)

    pose("idle", 0)()
    print("previews", kit.previews(
        col, PREVIEW_DIR, "heartrot", views=((35, -45), (35, 135), (20, -70)), frame=1.75,
        poses=[
            ("build25", pose("build", 30)),
            ("build50", pose("build", 60)),
            ("build80", pose("build", 96)),
            ("produce", pose("produce", 30)),
            ("release", pose("release", 20)),
        ],
    ))
