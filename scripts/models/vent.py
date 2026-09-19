"""
The Geothermal Vent -- neutral map scenery. Content id: map.vent.

    blender -b --factory-startup --python scripts/models/vent.py

From its sheet in UNIVERSE.md. A fissure where the furnaces below reach the
surface: nothing built it and nothing has capped it yet. Broken crust tilted up
around a dark throat, ember light leaking through the cracks and pooling at the
rim. A marker, not a mine -- `resourceAmount` is zero
(packages/content/src/races/map-resources.ts); the model is what says "build
here" before either race's Extractor or Siphon consumes it.

Scenery, not equipment: no faction's paint, because no faction has touched it
yet. The game tints the crust at draw time to tell a vent from an Alloy Node --
see palette.ts's VENT_COLOUR -- and the ember glow itself is genuinely
emissive, the same technique `vent_tap.py` uses for the vent it inherits.
Static: no armature, no clips. A vent just sits on the map from the first
tick.

  - six slabs of crust broken open and tilted up around a throat, thickest
    toward -X/-Y and lowest toward +X/-Y where the camera looks in;
  - the throat: a flared opening down to a dark floor, with cracks running out
    from it across the crust and a glow filling the floor and leaking along
    the cracks;
  - a scatter of loose, shattered crust at the footprint's edge.

Paint: the crust immediately around the throat, so the heat reads as part of
the rock and not just the light sitting on top of it.

Built in tiles at its real footprint and shrunk into the unit box at the end,
exactly as a structure is. Blender axes: +X, +Y left, +Z up.
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

CONTENT_ID = "map.vent"
FOOTPRINT = 2
PREVIEW_DIR = os.environ.get("RTS_PREVIEW_DIR", os.path.join(kit.REPO, "art", "previews"))
TEXTURE_SIZE = int(os.environ.get("RTS_TEXTURE_SIZE", "1024"))

kit.fresh_scene()
col = kit.collection("Vent")
s = surfaces.structure_surfaces(scale=6.0, ash=0.6)
lamp = kit.directorate_palette()["lamp"]
rng = random.Random(41)

parts = []
count = [0]


def piece(bm, mat, painted=False, bevel=None):
    count[0] += 1
    obj = kit.mesh_object(f"part.{count[0]}", bm, mat, col, painted=painted)
    if bevel is not None:
        kit.bevel(obj, width=bevel)
    parts.append(obj)
    return obj


def box(size, centre, mat, rotation=None, **kw):
    return piece(kit.box(size, centre, rotation), mat, **kw)


def rock(radii, centre, jitter=0.35, segments=6, rings=3):
    bm = kit.ellipsoid(radii, centre, segments=segments, rings=rings)
    for v in bm.verts:
        offset = Vector((
            rng.uniform(-1, 1) * radii[0],
            rng.uniform(-1, 1) * radii[1],
            rng.uniform(-0.5, 0.5) * radii[2],
        )) * jitter
        v.co += offset
        v.co.z = max(v.co.z, 0.0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def rot(axis, degrees):
    return Matrix.Rotation(math.radians(degrees), 3, axis)


def around(cx, cy, a, r, z=0.0):
    return Vector((cx + math.cos(math.radians(a)) * r, cy + math.sin(math.radians(a)) * r, z))


# ---------------------------------------------------------------------------
# Proportions, in tiles. The footprint is +-1; the throat sits slightly off
# centre, thickest crust toward -X/-Y and lowest toward +X/-Y, camera side.
# ---------------------------------------------------------------------------

CX, CY = -0.06, 0.08
R_THROAT = 0.16
R_RIM = 0.58

# ---------------------------------------------------------------------------
# The crust: six slabs broken open and tilted back around the throat.
# ---------------------------------------------------------------------------

SLAB_ANGLES = (18, 78, 140, 205, 262, 322)
for i, a in enumerate(SLAB_ANGLES):
    # Facing the camera (+X/-Y, roughly a = -45) sits lower and further back,
    # so nothing hides the glow from the angle the player actually looks from.
    facing = abs(((a - (-45) + 180) % 360) - 180)
    tilt = 22 + (facing / 180) * 20
    height = 0.16 - (facing / 180) * 0.06
    d = R_RIM - 0.16
    centre = around(CX, CY, a, d * 0.62, height * 0.4)
    size = (0.5, 0.34, height)
    matrix = rot("Z", a) @ rot("Y", -tilt)
    slab = kit.box(size, tuple(centre), matrix)
    # A tilted box centred above ground can still dip a corner below it.
    for v in slab.verts:
        v.co.z = max(v.co.z, 0.0)
    bmesh.ops.recalc_face_normals(slab, faces=slab.faces)
    piece(slab, s["slag"] if i % 2 else s["rockcrete"], painted=(i % 3 == 0), bevel=0.014)

# Loose shattered crust scattered at the footprint's edge.
for _ in range(7):
    r = rng.uniform(0.05, 0.11)
    a = rng.uniform(0, 360)
    d = rng.uniform(0.62, 0.92)
    c = around(CX, CY, a, d)
    piece(rock((r, r * rng.uniform(0.8, 1.1), r * 0.6), tuple(c)), s["slag"])

# ---------------------------------------------------------------------------
# The throat: a flared opening down to a dark floor. Painted where the crust
# meets it, so the heat reads as the rock's own colour, not a light on top.
# ---------------------------------------------------------------------------

throat = kit.prism(
    kit.octagon(R_THROAT, R_THROAT * 0.25), 0.02, 0.15,
    top_scale=(R_RIM * 0.42) / R_THROAT, centre=(CX, CY), open_top=True,
)
piece(throat, s["slag"], painted=True, bevel=0.006)

# The floor: a short glowing cylinder, taller than the throat's own floor cap
# so it fully covers it -- the fire seen from directly above.
piece(kit.cylinder(R_THROAT * 0.82, 0.05, segments=10, centre=(CX, CY, 0.025)), lamp)

# Cracks running out from the throat, riding just above the crust's own
# surface rather than buried at its foot -- the slabs are one near-solid ring,
# not vent_tap.py's loose scattered rocks, so a crack at ground level simply
# disappears under them. Each one starts at the throat's rim height and drops
# as it runs out to where the crust is thinner.
for k in range(6):
    a = k * 60
    start = around(CX, CY, a, R_THROAT * 1.05, 0.11)
    end = around(CX, CY, a + rng.uniform(-8, 8), rng.uniform(0.34, 0.5), 0.03)
    piece(kit.beam(tuple(start), tuple(end), 0.012, width=rng.uniform(0.022, 0.034)), lamp)
for _ in range(3):
    a = rng.uniform(0, 360)
    c = around(CX, CY, a, rng.uniform(0.36, 0.48), 0.03)
    piece(kit.cylinder(rng.uniform(0.02, 0.035), 0.014, segments=6, centre=tuple(c)), lamp)

# ---------------------------------------------------------------------------
body = kit.join(parts, "vent")
print("vent geometry:", kit.report(col))

surfaces.unwrap(body, kit)
images = surfaces.bake(body, kit, "vent", size=TEXTURE_SIZE)
surfaces.save_images(images, os.path.join(PREVIEW_DIR, "textures"))

body.scale = (1 / FOOTPRINT,) * 3
body.location = (0, 0, 0)

stats = kit.report(col)
print("vent:", stats)
print("wrote", kit.export(col, CONTENT_ID))
print("wrote", kit.save_blend(CONTENT_ID))

if os.environ.get("RTS_PREVIEWS", "1") != "0":
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    print("previews", kit.previews(
        col, PREVIEW_DIR, "vent", views=((45, -60), (45, 120), (65, 20)), frame=1.4,
    ))
