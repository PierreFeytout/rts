"""
The Alloy Node -- neutral map scenery. Content id: map.alloy-node.

    blender -b --factory-startup --python scripts/models/alloy_node.py

From its sheet in UNIVERSE.md. Alloy is not mined, it is recovered: this is a
scarp of clinker that has slumped and cracked open, showing a cross-section of
what nine hundred years of dumped slag buried -- girders, gear wheels, plate, a
burst pipe. Not ore, not a crystal seam: compacted machinery, the same "reused,
not manufactured" idea as everything else in the Ashworks.

Scenery, not equipment: it belongs to the map, not to either race (see
packages/content/src/races/map-resources.ts), so it carries no faction's paint.
The exposed metal is its own colour -- a shine picked out of the ground, not a
faction's -- which the game also tints at draw time, distinctly from a
Geothermal Vent: see palette.ts's ALLOY_COLOUR, chosen well clear of both the
Verdigris's dusty green and the bright green in TEAM_COLOURS so this never
reads as either. Static: no armature, no clips. A node just sits on the map
from the first tick, so there is nothing to build or animate.

  - a scree of clinker rubble across most of the footprint, low enough to see
    over, thicker toward -X/-Y and breaking open toward +X/-Y where the
    camera looks;
  - the exposed face there: a jagged cut through the mound showing what it
    buried -- two girders crossing at an angle, a gear wheel half swallowed by
    slag, a torn plate standing proud, a burst pipe, scattered bolts, all of
    it the same worked, shining metal;
  - loose chunks of rubble at the foot of the scarp, breaking up the silhouette
    so a node reads as a piece of ground rather than a prop dropped on it.

Paint: the exposed metal only -- girders, gear, plate, pipe, bolts -- so it
reads as the alloy against the dead slag around it.

**The aura is not modelled here.** A first version baked a flat emissive shape
into this file, and it looked exactly like what it was: a painted shape with a
hard edge, not light. A glow is a falloff, and nothing in this pipeline can
bake one -- the game's renderer does not tone-map or bloom, so a mesh can only
ever be as bright as its own surface, uniformly, right up to where the surface
ends. The actual aura is `resource-glow.ts`: a soft, additively-blended sprite
the renderer draws under every resource node, coloured from the same
ALLOY_COLOUR this model is tinted with, so the two always agree without this
script knowing the other exists.

Built in tiles at its real footprint and shrunk into the unit box at the end,
exactly as a structure is (the game scales resource nodes by their footprint
the same way it scales buildings). Blender axes: +X, +Y left, +Z up.
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

CONTENT_ID = "map.alloy-node"
FOOTPRINT = 2
PREVIEW_DIR = os.environ.get("RTS_PREVIEW_DIR", os.path.join(kit.REPO, "art", "previews"))
TEXTURE_SIZE = int(os.environ.get("RTS_TEXTURE_SIZE", "1024"))

kit.fresh_scene()
col = kit.collection("AlloyNode")
s = surfaces.structure_surfaces(scale=6.0, ash=1.0)
# The alloy itself: `iron()` worked metal, same wear and rust as everywhere
# else in the kit, tinted with the game's own ALLOY_COLOUR (palette.ts)
# instead of the rust-brown every building's iron is. Its own material, not
# `s["iron"]` -- that one stays rust-brown for every building that uses it.
metal = surfaces.iron(name="alloy-metal", colour=(0.09, 0.4, 0.22), scale=6.0, ash=1.0)
rng = random.Random(7)

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


def rock(radii, centre, jitter=0.3, segments=7, rings=4):
    """A lump of clinker: a squashed sphere with every vertex knocked about."""
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


# ---------------------------------------------------------------------------
# Proportions, in tiles. The footprint is +-1. The machinery is the
# silhouette -- the ground is a low plinth behind it, not a hill in front of
# it, or the first render taught: a tall clean mound reads as a rock, and
# hides everything it was meant to expose.
# ---------------------------------------------------------------------------

CX, CY = 0.02, -0.06

# ---------------------------------------------------------------------------
# The ground: a low, cracked plinth across most of the footprint. Ankle
# height, so nothing on it is ever behind the horizon.
# ---------------------------------------------------------------------------

piece(rock((0.42, 0.36, 0.09), (-0.16, 0.12, 0.0), jitter=0.22), s["rockcrete"])
piece(rock((0.34, 0.3, 0.07), (0.32, -0.28, 0.0), jitter=0.22), s["rockcrete"])
piece(rock((0.3, 0.26, 0.06), (-0.34, -0.3, 0.0), jitter=0.22), s["slag"])

# Loose rubble at the rim, so the plinth's edge is ragged rather than a clean
# oval -- and low enough to frame the machinery, never to cover it.
for _ in range(7):
    r = rng.uniform(0.05, 0.1)
    a = rng.uniform(0, 360)
    d = rng.uniform(0.6, 0.86)
    c = (math.cos(math.radians(a)) * d, math.sin(math.radians(a)) * d, 0.0)
    piece(rock((r, r * rng.uniform(0.8, 1.1), r * 0.6), c, jitter=0.4, segments=6, rings=3), s["slag"])

# ---------------------------------------------------------------------------
# What it buried: two girders crossing, a gear standing on its rim, a torn
# plate behind them, a burst pipe underfoot. Raised clear of the plinth --
# this is what a player is meant to see first. All painted: this is the alloy.
# ---------------------------------------------------------------------------

box((0.86, 0.09, 0.075), (CX, CY, 0.24), metal, rot("Z", 28) @ rot("Y", -8), painted=True, bevel=0.01)
box((0.74, 0.08, 0.07), (CX + 0.04, CY - 0.02, 0.34), metal, rot("Z", -38) @ rot("Y", 10),
    painted=True, bevel=0.01)

# A gear wheel standing nearly on edge, tilted enough to read as fallen rather
# than mounted -- the widest, tallest single piece, so it is what a player's
# eye lands on.
GEAR_R = 0.26
gear_centre = Vector((CX - 0.16, CY + 0.18, GEAR_R * 0.96))
gear_tilt = Matrix.Rotation(math.radians(58), 3, "Y") @ Matrix.Rotation(math.radians(14), 3, "X")
gear = kit.cylinder(GEAR_R, 0.075, segments=12, centre=tuple(gear_centre), axis="X")
bmesh.ops.rotate(gear, cent=tuple(gear_centre), matrix=gear_tilt, verts=gear.verts)
for v in gear.verts:
    v.co.z = max(v.co.z, 0.01)
bmesh.ops.recalc_face_normals(gear, faces=gear.faces)
piece(gear, metal, painted=True, bevel=0.008)
for k in range(12):
    a = k * 30
    spoke = Vector((0, math.cos(math.radians(a)) * GEAR_R, math.sin(math.radians(a)) * GEAR_R))
    tooth_centre = gear_centre + gear_tilt @ spoke
    if tooth_centre.z < 0.02:
        continue
    tooth = kit.box((0.07, 0.06, 0.055), tuple(tooth_centre), gear_tilt @ rot("X", a))
    piece(tooth, metal, painted=True)

# A torn plate standing behind the gear, ragged along its top edge -- based on
# the ground, not floating over it.
SHARD_H = 0.4
shard = kit.box((0.025, 0.32, SHARD_H), (CX - 0.3, CY - 0.12, SHARD_H / 2), rot("Z", 20) @ rot("X", -6))
for v in shard.verts:
    if v.co.z > SHARD_H * 0.6:
        v.co.z += rng.uniform(-0.06, 0.09)
    v.co.z = max(v.co.z, 0.0)
bmesh.ops.recalc_face_normals(shard, faces=shard.faces)
piece(shard, metal, painted=True, bevel=0.008)

# A burst pipe, bent, resting across the plinth in front of the girders.
# The radius has to clear the ground at both ends of a rod, not just its centre.
pipe1 = kit.rod((CX + 0.2, CY - 0.42, 0.09), (CX + 0.34, CY - 0.18, 0.13), 0.055, segments=8)
pipe2 = kit.rod((CX + 0.34, CY - 0.18, 0.13), (CX + 0.4, CY - 0.02, 0.26), 0.05, segments=8, radius_end=0.035)
for bm in (pipe1, pipe2):
    for v in bm.verts:
        v.co.z = max(v.co.z, 0.0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
piece(pipe1, metal, painted=True, bevel=0.005)
piece(pipe2, metal, painted=True, bevel=0.005)

# A handful of bolts on the plate and the gear's rim -- small enough that only
# their paint has to read, not their shape.
for bx, by, bz in ((CX - 0.28, CY - 0.1, 0.3), (CX - 0.32, CY - 0.16, 0.16), (CX + 0.05, CY + 0.36, 0.12)):
    piece(kit.cylinder(0.02, 0.032, segments=6, centre=(bx, by, bz), axis="Y"), metal, painted=True)

# ---------------------------------------------------------------------------
body = kit.join(parts, "alloy-node")
print("alloy node geometry:", kit.report(col))

surfaces.unwrap(body, kit)
images = surfaces.bake(body, kit, "alloy-node", size=TEXTURE_SIZE)
surfaces.save_images(images, os.path.join(PREVIEW_DIR, "textures"))

body.scale = (1 / FOOTPRINT,) * 3
body.location = (0, 0, 0)

stats = kit.report(col)
print("alloy-node:", stats)
print("wrote", kit.export(col, CONTENT_ID))
print("wrote", kit.save_blend(CONTENT_ID))

if os.environ.get("RTS_PREVIEWS", "1") != "0":
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    print("previews", kit.previews(
        col, PREVIEW_DIR, "alloy-node", views=((45, -60), (45, 120), (65, 20)), frame=1.4,
    ))
