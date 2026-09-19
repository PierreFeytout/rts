"""
The Vent Tap -- the Ashen Directorate's plasma extractor. Content id: vanguard.extractor.

    blender -b --factory-startup --python scripts/models/vent_tap.py

From its sheet in UNIVERSE.md. It was a drop-rated wellhead cap, made to be
lowered onto a live bore; it is that cap clamped over a vent, drawing plasma
off the fire below into racked canisters. A vent is consumed when the Tap is
placed on it, so the model carries the vent too:

  - a mound of cracked slag around the bore, the fire's ember light leaking
    between the chunks, and four rockcrete footings the survey crew laid;
  - the cap: a squat drum banded with pressure rings and a bolted flange,
    intake grilles glowing at its base, a painted crown with lifting lugs,
    and a pump beam nodding on top;
  - four clamps from the flange down onto the footings;
  - relief valves, a gauge and a pressure wheel on the +X face;
  - a canister rack with a loading arm on its gantry on the -Y face;
  - a tall relief stack at the back with a flap valve and a warning lamp --
    the tallest thing for its size in a Directorate base, so a player's vents
    read at a glance.

Paint: the crown and the gantry's arm. The camera looks from +X and -Y.

ANIMATION. `build`: the footings rise; the cap comes down on its tether,
turning, and screws itself onto the vent; the clamps slam shut; the stack runs
up, the gantry and rack come up out of the ground; the flap valve vents; the
lamp lights. `idle` -- it works all the time, so this is its working clip: the
pump beam nods, the pressure wheel turns, the grille glow pulses, the arm
shifts. No `produce` or `release`: it trains nothing.

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

CONTENT_ID = "vanguard.extractor"
FOOTPRINT = 2
PREVIEW_DIR = os.environ.get("RTS_PREVIEW_DIR", os.path.join(kit.REPO, "art", "previews"))
TEXTURE_SIZE = int(os.environ.get("RTS_TEXTURE_SIZE", "1024"))

kit.fresh_scene()
col = kit.collection("VentTap")
s = surfaces.structure_surfaces(scale=6.0)
lamp = kit.directorate_palette()["lamp"]
rng = random.Random(23)


def rot(axis, degrees):
    return Matrix.Rotation(math.radians(degrees), 3, axis)


# ---------------------------------------------------------------------------
# Proportions, in tiles. The footprint is +-1.
# ---------------------------------------------------------------------------

CAP = Vector((-0.05, 0.05))
R = 0.44
BASE, TOP, CROWN = 0.14, 0.74, 0.88
STACK = Vector((-0.66, 0.62))
STACK_TOP = 2.3
GANTRY = Vector((0.66, -0.52))
RACK_Y = -0.76
WHEEL = Vector((CAP.x + R + 0.14, CAP.y - 0.12, 0.46))
CLAMP_ANGLES = {"NE": 45, "NW": 135, "SW": 225, "SE": 315}

# ---------------------------------------------------------------------------
# Skeleton.
# ---------------------------------------------------------------------------

bones = [
    ("root", (0, 0, 0), (0, 0, 0.5), None),
    ("footings", (0, 0, 0), (0, 0, 0.2), "root"),
    ("glow", (CAP.x, CAP.y, 0.02), (CAP.x, CAP.y, 0.3), "root"),
    ("cap", (CAP.x, CAP.y, BASE), (CAP.x, CAP.y, CROWN), "root"),
    ("tether", (CAP.x, CAP.y, CROWN + 0.05), (CAP.x, CAP.y, CROWN + 1.0), "cap"),
    ("wheel", tuple(WHEEL), (WHEEL.x + 0.2, WHEEL.y, WHEEL.z), "cap"),
    ("beam", (CAP.x, CAP.y, 1.24), (CAP.x + 0.4, CAP.y, 1.24), "cap"),
    ("stack", (STACK.x, STACK.y, 0.1), (STACK.x, STACK.y, STACK_TOP), "root"),
    ("flap", (STACK.x - 0.12, STACK.y, STACK_TOP + 0.08), (STACK.x + 0.12, STACK.y, STACK_TOP + 0.08), "stack"),
    ("lamp", (STACK.x, STACK.y, STACK_TOP + 0.2), (STACK.x, STACK.y, STACK_TOP + 0.35), "stack"),
    ("gantry", (GANTRY.x, GANTRY.y, 0.1), (GANTRY.x, GANTRY.y, 1.25), "root"),
    ("arm", (GANTRY.x, GANTRY.y, 1.2), (GANTRY.x - 0.8, GANTRY.y, 1.2), "gantry"),
    ("rack", (-0.1, RACK_Y, 0.1), (-0.1, RACK_Y, 0.5), "root"),
]
for name, a in CLAMP_ANGLES.items():
    d = Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0))
    hinge = Vector((CAP.x, CAP.y, 0.22)) + d * (R + 0.08)
    jaw = Vector((CAP.x, CAP.y, 0.1)) + d * 0.8
    bones.append((f"clamp.{name}", tuple(hinge), tuple(jaw), "cap"))
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


def rock(radii, centre, jitter=0.25, segments=7, rings=4):
    """A lump of clinker: a squashed sphere with every vertex knocked about."""
    bm = kit.ellipsoid(radii, centre, segments=segments, rings=rings)
    for v in bm.verts:
        offset = Vector((rng.uniform(-1, 1) * radii[0], rng.uniform(-1, 1) * radii[1],
                         rng.uniform(-0.6, 0.6) * radii[2])) * jitter
        v.co += offset
        v.co.z = max(v.co.z, 0.0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def around(a, r, z=0.0):
    return Vector((CAP.x + math.cos(math.radians(a)) * r, CAP.y + math.sin(math.radians(a)) * r, z))


# ---------------------------------------------------------------------------
# The vent: slag heaped round the bore, and the fire showing through it.
# ---------------------------------------------------------------------------

# The bore's glow is only a rim round the flange: a whole lit disc read as a
# clean white pool, not a fire under broken ground.
piece(kit.rod((CAP.x, CAP.y, 0.0), (CAP.x, CAP.y, 0.02), 0.62, segments=16), lamp, "glow")
# Heat cracks running out between the chunks.
for k in range(7):
    a = k * (360 / 7) + 12
    start, end = around(a, 0.5, 0.012), around(a + rng.uniform(-14, 14), rng.uniform(0.8, 0.92), 0.008)
    piece(kit.beam(start, end, 0.012, width=rng.uniform(0.025, 0.04)), lamp, "glow")
for k in range(15):
    a = k * (360 / 15) + rng.uniform(-8, 8)
    r = rng.uniform(0.58, 0.74)
    size = (rng.uniform(0.12, 0.19), rng.uniform(0.1, 0.16), rng.uniform(0.07, 0.14))
    c = around(a, r)
    piece(rock(size, (c.x, c.y, 0.02)), s["slag"], "root")
# Outer scatter, where the mound meets the ground.
for k in range(8):
    a = k * 45 + 20 + rng.uniform(-12, 12)
    c = around(a, rng.uniform(0.8, 0.86))
    piece(rock((0.07, 0.06, 0.045), (c.x, c.y, 0.0), segments=6, rings=3), s["slag"], "root")

# Rockcrete footings under the clamps.
for name, a in CLAMP_ANGLES.items():
    c = around(a, 0.8)
    box((0.26, 0.26, 0.07), (c.x, c.y, 0.035), s["rockcrete"], "footings", rot("Z", a), bevel=0.012)
    for dx in (-0.08, 0.08):
        p = Vector((c.x, c.y, 0.07)) + Vector((math.cos(math.radians(a + 90)), math.sin(math.radians(a + 90)), 0)) * dx
        piece(kit.rod(p, p + Vector((0, 0, 0.035)), 0.022, segments=5), s["iron"], "footings")

# ---------------------------------------------------------------------------
# The cap.
# ---------------------------------------------------------------------------

c = CAP
piece(kit.rod((c.x, c.y, BASE - 0.04), (c.x, c.y, BASE + 0.08), R + 0.12, segments=16), s["iron"], "cap", bevel=0.015)
for k in range(12):
    p = around(k * 30 + 15, R + 0.08, BASE + 0.08)
    piece(kit.rod(p, p + Vector((0, 0, 0.04)), 0.024, segments=5), s["iron"], "cap")
piece(kit.rod((c.x, c.y, BASE + 0.06), (c.x, c.y, TOP), R, segments=16), s["plate"], "cap")
for z in (0.34, 0.5, 0.64):
    piece(kit.rod((c.x, c.y, z - 0.03), (c.x, c.y, z + 0.03), R + 0.03, segments=16), s["plate"], "cap", bevel=0.008)
piece(kit.rod((c.x, c.y, TOP), (c.x, c.y, CROWN), R + 0.02, segments=16, radius_end=0.3), s["paint"], "cap",
      painted=True, bevel=0.01)
piece(kit.rod((c.x, c.y, CROWN), (c.x, c.y, CROWN + 0.05), 0.31, segments=16), s["iron"], "cap", bevel=0.008)
# A hazard band round the flange, and a ring of light round the crown.
piece(kit.rod((c.x, c.y, BASE + 0.045), (c.x, c.y, BASE + 0.08), R + 0.125, segments=16), s["hazard"], "cap")
piece(kit.rod((c.x, c.y, CROWN + 0.015), (c.x, c.y, CROWN + 0.04), 0.316, segments=16), lamp, "cap")
for a in (60, 180, 300):
    p = around(a, 0.2, CROWN + 0.05)
    box((0.08, 0.04, 0.09), (p.x, p.y, CROWN + 0.09), s["iron"], "cap", rot("Z", a + 90), bevel=0.008)

# Intake grilles round the base, on the faces the camera sees, glowing behind their bars.
for a in (-70, -30, 10, 50):
    p = around(a, R + 0.005, 0.24)
    face = rot("Z", a)
    box((0.03, 0.2, 0.13), (p.x, p.y, 0.24), s["iron"], "cap", face, bevel=0.006)
    inner = around(a, R + 0.02, 0.24)
    box((0.01, 0.16, 0.09), (inner.x, inner.y, 0.24), lamp, "glow", face)
    for dz in (-0.03, 0.0, 0.03):
        bar = around(a, R + 0.03, 0.24 + dz)
        box((0.015, 0.17, 0.012), (bar.x, bar.y, 0.24 + dz), s["grate"], "cap", face)

# Relief valves, a gauge, and the pressure wheel on +X.
for dy, z in ((0.14, 0.58), (-0.2, 0.62)):
    base = Vector((c.x + R, c.y + dy, z))
    piece(kit.rod(base, base + Vector((0.14, 0, 0)), 0.035, segments=8), s["iron"], "cap")
    box((0.08, 0.08, 0.1), (base.x + 0.14, base.y, z), s["iron"], "cap", bevel=0.01)
    piece(kit.rod((base.x + 0.14, base.y, z + 0.05), (base.x + 0.14, base.y, z + 0.14), 0.025, segments=6), s["iron"],
          "cap")
    piece(kit.rod((base.x + 0.14, base.y, z + 0.14), (base.x + 0.14, base.y, z + 0.16), 0.045, segments=8),
          s["rubber"], "cap")
gauge = Vector((c.x + R + 0.02, c.y + 0.02, 0.4))
piece(kit.rod(gauge, gauge + Vector((0.05, 0, 0)), 0.05, segments=10), s["iron"], "cap")
piece(kit.rod(gauge + Vector((0.05, 0, 0)), gauge + Vector((0.055, 0, 0)), 0.04, segments=10), lamp, "cap")

piece(kit.rod((c.x + R, WHEEL.y, WHEEL.z), (WHEEL.x, WHEEL.y, WHEEL.z), 0.04, segments=8), s["iron"], "cap")
piece(kit.rod((WHEEL.x, WHEEL.y, WHEEL.z), (WHEEL.x + 0.03, WHEEL.y, WHEEL.z), 0.04, segments=8), s["iron"], "wheel")
for k in range(10):
    a0, a1 = math.radians(k * 36), math.radians((k + 1) * 36)
    p0 = Vector((WHEEL.x + 0.015, WHEEL.y + math.cos(a0) * 0.13, WHEEL.z + math.sin(a0) * 0.13))
    p1 = Vector((WHEEL.x + 0.015, WHEEL.y + math.cos(a1) * 0.13, WHEEL.z + math.sin(a1) * 0.13))
    piece(kit.rod(p0, p1, 0.016, segments=4), s["paint"] if k % 5 == 0 else s["iron"], "wheel", painted=k % 5 == 0)
for k in range(3):
    a = math.radians(k * 120 + 30)
    piece(kit.beam((WHEEL.x + 0.015, WHEEL.y, WHEEL.z),
                   (WHEEL.x + 0.015, WHEEL.y + math.cos(a) * 0.13, WHEEL.z + math.sin(a) * 0.13), 0.018),
          s["iron"], "wheel")

# The pump beam on its A-frame, nodding over a plunger into the crown.
for dy in (-0.09, 0.09):
    piece(kit.beam((c.x - 0.12, c.y + dy, CROWN + 0.04), (c.x, c.y + dy * 0.3, 1.24), 0.035), s["iron"], "cap")
    piece(kit.beam((c.x + 0.12, c.y + dy, CROWN + 0.04), (c.x, c.y + dy * 0.3, 1.24), 0.035), s["iron"], "cap")
piece(kit.rod((c.x, c.y - 0.06, 1.24), (c.x, c.y + 0.06, 1.24), 0.03, segments=8), s["iron"], "cap")
piece(kit.beam((c.x - 0.36, c.y, 1.27), (c.x + 0.4, c.y, 1.27), 0.06, width=0.07), s["iron"], "beam", bevel=0.01)
box((0.12, 0.1, 0.16), (c.x + 0.44, c.y, 1.23), s["plate"], "beam", rot("Y", 20), bevel=0.012)
box((0.16, 0.12, 0.12), (c.x - 0.38, c.y, 1.22), s["iron"], "beam", bevel=0.012)
piece(kit.rod((c.x + 0.46, c.y, 1.15), (c.x + 0.46, c.y, CROWN + 0.03), 0.022, segments=6), s["iron"], "beam")

# The tether it came down on: there only while it does.
piece(kit.rod((c.x, c.y, CROWN + 0.06), (c.x, c.y, 5.0), 0.018, segments=5), s["iron"], "tether")
piece(kit.rod((c.x, c.y, CROWN + 0.06), (c.x, c.y, CROWN + 0.14), 0.05, segments=8), s["iron"], "tether")

# The clamps, from the flange down onto the footings.
for name, a in CLAMP_ANGLES.items():
    bone = f"clamp.{name}"
    hinge = around(a, R + 0.08, 0.22)
    jaw = around(a, 0.8, 0.1)
    box((0.1, 0.12, 0.1), (hinge.x, hinge.y, 0.2), s["iron"], "cap", rot("Z", a), bevel=0.01)
    piece(kit.beam(hinge, jaw + Vector((0, 0, 0.06)), 0.07, width=0.09), s["plate"], bone, bevel=0.012)
    box((0.14, 0.14, 0.07), (jaw.x, jaw.y, 0.105), s["iron"], bone, rot("Z", a), bevel=0.012)
    ram = around(a, R + 0.02, 0.36)
    piece(kit.rod(ram, hinge.lerp(jaw, 0.6) + Vector((0, 0, 0.05)), 0.022, segments=6), s["iron"], bone)

# ---------------------------------------------------------------------------
# The relief stack.
# ---------------------------------------------------------------------------

st = STACK
piece(kit.rod((st.x, st.y, 0.06), (st.x, st.y, STACK_TOP), 0.085, segments=10), s["iron"], "stack")
piece(kit.rod((st.x, st.y, 0.06), (st.x, st.y, 0.2), 0.13, segments=10), s["iron"], "stack", bevel=0.01)
for z in (0.7, 1.3, 1.9):
    piece(kit.rod((st.x, st.y, z), (st.x, st.y, z + 0.05), 0.105, segments=10), s["plate"], "stack")
piece(kit.rod((st.x, st.y, STACK_TOP - 0.3), (st.x, st.y, STACK_TOP - 0.2), 0.1, segments=10), s["hazard"], "stack")
piece(kit.rod((st.x, st.y, STACK_TOP), (st.x, st.y, STACK_TOP + 0.06), 0.13, segments=10, radius_end=0.11),
      s["iron"], "stack")
# The pipe from the cap across to the stack.
elbow = Vector((st.x, st.y, 0.52))
side = around(135, R, 0.52)
piece(kit.rod(side, elbow, 0.05, segments=8), s["iron"], "stack")
box((0.12, 0.12, 0.12), tuple(elbow), s["iron"], "stack", bevel=0.01)
# The flap valve on top, and the lamp over it on a bracket.
piece(kit.rod((st.x, st.y, STACK_TOP + 0.07), (st.x, st.y, STACK_TOP + 0.09), 0.12, segments=10), s["plate"], "flap")
piece(kit.beam((st.x + 0.1, st.y, STACK_TOP + 0.02), (st.x + 0.1, st.y, STACK_TOP + 0.24), 0.025), s["iron"], "stack")
box((0.06, 0.06, 0.03), (st.x + 0.1, st.y, STACK_TOP + 0.25), s["iron"], "stack")
piece(kit.ellipsoid((0.045, 0.045, 0.045), (st.x + 0.1, st.y, STACK_TOP + 0.29), segments=8, rings=5), lamp, "lamp")
for k in range(4):
    a = math.radians(45 + 90 * k)
    piece(kit.beam((st.x + math.cos(a) * 0.3, st.y + math.sin(a) * 0.3, 0.07),
                   (st.x + math.cos(a) * 0.08, st.y + math.sin(a) * 0.08, 0.9), 0.02), s["iron"], "stack")

# ---------------------------------------------------------------------------
# The gantry and its loading arm, and the canister rack.
# ---------------------------------------------------------------------------

g = GANTRY
for dx, dy in ((-0.07, -0.07), (0.07, -0.07), (0.07, 0.07), (-0.07, 0.07)):
    piece(kit.beam((g.x + dx * 1.6, g.y + dy * 1.6, 0.07), (g.x + dx, g.y + dy, 1.2), 0.03), s["iron"], "gantry")
for z in (0.45, 0.85):
    for (ax, ay), (bx, by) in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
        t = z / 1.2
        sp = 0.07 * (1.6 - 0.6 * t)
        piece(kit.beam((g.x + ax * sp, g.y + ay * sp, z), (g.x + bx * sp, g.y + by * sp, z), 0.02), s["iron"],
              "gantry")
box((0.18, 0.18, 0.06), (g.x, g.y, 1.2), s["iron"], "gantry", bevel=0.01)
box((0.16, 0.16, 0.05), (g.x, g.y, 0.08), s["rockcrete"], "gantry", bevel=0.01)
piece(kit.beam((g.x + 0.1, g.y, 1.26), (g.x - 0.78, g.y, 1.26), 0.06, width=0.07), s["paint"], "arm", painted=True,
      bevel=0.01)
box((0.14, 0.12, 0.12), (g.x + 0.16, g.y, 1.22), s["iron"], "arm", bevel=0.01)
piece(kit.rod((g.x - 0.74, g.y, 1.23), (g.x - 0.74, g.y, 0.72), 0.01, segments=4), s["iron"], "arm")
piece(kit.rod((g.x - 0.74, g.y, 0.74), (g.x - 0.74, g.y, 0.62), 0.05, segments=8), s["iron"], "arm")
piece(kit.rod((g.x - 0.74, g.y, 0.62), (g.x - 0.74, g.y, 0.6), 0.055, segments=8), s["rubber"], "arm")

for x in (-0.62, 0.18):
    for y in (RACK_Y - 0.1, RACK_Y + 0.1):
        piece(kit.beam((x, y, 0.06), (x, y, 0.5), 0.035), s["iron"], "rack")
for z in (0.12, 0.46):
    for y in (RACK_Y - 0.1, RACK_Y + 0.1):
        piece(kit.beam((-0.64, y, z), (0.2, y, z), 0.03), s["hazard"] if z > 0.3 else s["iron"], "rack")
for k, x in enumerate((-0.5, -0.34, -0.18, -0.02)):
    top = 0.44 if k != 2 else 0.4
    piece(kit.rod((x, RACK_Y, 0.14), (x, RACK_Y, top), 0.07, segments=10), s["plate"] if k % 2 else s["iron"], "rack",
          bevel=0.006)
    piece(kit.rod((x, RACK_Y, 0.24), (x, RACK_Y, 0.3), 0.074, segments=10), lamp, "rack")
    piece(kit.rod((x, RACK_Y, top), (x, RACK_Y, top + 0.04), 0.035, segments=8), s["rubber"], "rack")
hose = [around(-100, R, 0.3), Vector((-0.2, RACK_Y + 0.25, 0.2)), Vector((-0.02, RACK_Y + 0.04, 0.46))]
for i, (a, b) in enumerate(zip(hose, hose[1:])):
    piece(kit.rod(a, b, 0.022, segments=5), s["rubber"], "rack")

body = kit.join(parts, "body")
print("vent tap geometry:", kit.report(col))

surfaces.unwrap(body, kit)
images = surfaces.bake(body, kit, "vent_tap", size=TEXTURE_SIZE)
surfaces.save_images(images, os.path.join(PREVIEW_DIR, "textures"))

kit.bind(body, rig)
rig.scale = (1 / FOOTPRINT,) * 3

# ---------------------------------------------------------------------------
# Clips. Positions in tiles before the rig is shrunk.
# ---------------------------------------------------------------------------

# The tether exists only while the cap is coming down.
NO_TETHER = {"tether": {0: [("scale", 0.0)]}}

# The cap turns as it comes down its tether, and screws itself the last stretch
# onto the vent. Keyed a quarter turn at a time: kit.key_pose keeps successive
# keys continuous, but a single key more than half a turn from the last is
# still ambiguous.
LAND = 58
DROP = 3.0
cap = {0: [("loc", (0, 0, DROP)), ("Z", 1080)]}
for step in range(13):
    frame = 10 + step * 4
    t = step / 12
    height = DROP - (DROP - 0.55) * t * 2 if t <= 0.5 else 0.55 * (1 - (t - 0.5) * 2)
    cap[frame] = [("loc", (0, 0, height)), ("Z", 1080 - step * 90)] if step < 12 else []

build = {
    "footings": {0: [("loc", (0, 0, -0.1))], 2: [("loc", (0, 0, -0.1))], 10: []},
    "cap": cap,
    "tether": {0: [], LAND: [], LAND + 2: [("scale", 0.0)]},
    "stack": {0: [("stretch", 0.12)], 66: [("stretch", 0.12)], 82: []},
    "gantry": {0: [("stretch", 0.15)], 70: [("stretch", 0.15)], 84: []},
    # Folded up along its mast, clear of the pump beam.
    "arm": {0: [("Y", 85)], 84: [("Y", 85)], 94: []},
    "rack": {0: [("loc", (0, 0, -0.52))], 72: [("loc", (0, 0, -0.52))], 86: []},
    "flap": {0: [], 92: [], 96: [("Y", -55)], 104: []},
    "lamp": {0: [("scale", 0.0)], 100: [("scale", 0.0)], 104: []},
    "glow": {0: [], 96: [], 100: [("scale", 1.1)], 108: []},
}
for k, name in enumerate(CLAMP_ANGLES):
    a = CLAMP_ANGLES[name]
    across = (-math.sin(math.radians(a)), math.cos(math.radians(a)), 0)
    shut = LAND + 2 + k * 2
    build[f"clamp.{name}"] = {0: [(across, -75)], shut: [(across, -75)], shut + 4: [(across, 4)], shut + 6: []}
kit.track_clip(rig, "build", 120, build)

# Three seconds, looping; this is also how it looks working, all match long.
kit.track_clip(rig, "idle", 90, {
    **NO_TETHER,
    "beam": {0: [("Y", -11)], 45: [("Y", 11)], 90: [("Y", -11)]},
    "wheel": {f: [("X", f * 4)] for f in range(0, 91, 18)},
    "glow": {0: [("scale", 0.92)], 45: [("scale", 1.04)], 90: [("scale", 0.92)]},
    "arm": {0: [], 30: [("Z", -9)], 60: [("Z", -9)], 90: []},
}, linear=("wheel",))

stats = kit.report(col)
print("vent tap:", stats)
print("wrote", kit.export_rigged(col, CONTENT_ID))
print("wrote", kit.save_blend(CONTENT_ID))

if os.environ.get("RTS_PREVIEWS", "1") != "0":
    os.makedirs(PREVIEW_DIR, exist_ok=True)

    def pose(action, frame):
        return lambda: kit.set_pose(rig, bpy.data.actions[action], frame)

    pose("idle", 0)()
    print("previews", kit.previews(
        col, PREVIEW_DIR, "vent_tap", views=((35, -45), (35, 135), (20, -70)), frame=2.0,
        poses=[
            ("build20", pose("build", 24)),
            ("build45", pose("build", 50)),
            ("build65", pose("build", 70)),
            ("idle45", pose("idle", 45)),
        ],
    ))
