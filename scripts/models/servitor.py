"""
The Servitor -- the Ashen Directorate's worker. Content id: vanguard.drone.

    blender -b --factory-startup --python scripts/models/servitor.py

"Labour, not a machine" (UNIVERSE.md). Not a drone: a salvage hauler with a
conscript in it. It has to read at a glance, at twenty pixels long, as the thing
that cuts metal out of the ground and carries it home -- so the silhouette is
built from the three shapes that say that, and everything else is secondary:

  - a cutting arm out front, offset to one side, which is what makes its facing
    readable even when it is standing still;
  - an open hopper at the back, with scrap in it, which is its cargo;
  - a cramped cage on top with a hunched operator, which is who is doing the
    work.

Salvaged, not manufactured: mismatched plates, a bolted-on bumper, a guard over
the cutter that was clearly somebody else's part first.

Blender axes: +X forward, +Y left, +Z up, one unit is one tile. The content gives
it a collision radius of 0.32, so the body stays within about 0.8 by 0.5.
"""

import math
import os
import sys

import bmesh
from mathutils import Matrix

sys.path.insert(0, os.path.dirname(__file__))
import kit  # noqa: E402

CONTENT_ID = "vanguard.drone"
PREVIEW_DIR = os.environ.get("RTS_PREVIEW_DIR", os.path.join(kit.REPO, "art", "previews"))

scene = kit.fresh_scene()
col = kit.collection("Servitor")
m = kit.directorate_palette()
RIGHT = -1  # the arm's side. Blender +Y is the unit's left.


def part(name, bm, mat, painted=False, bevel=None):
    obj = kit.mesh_object(name, bm, mat, col, painted=painted)
    if bevel is not None:
        kit.bevel(obj, width=bevel)
    return obj


# ---------------------------------------------------------------------------
# Running gear: two short tracks. Chosen over wheels or legs because tracks say
# "site vehicle" and need no animation to look like they could move.
# ---------------------------------------------------------------------------

for side in (1, -1):
    y = 0.18 * side

    # A track with rounded ends: bevel only the four edges that run across it
    # at the front and back, so the run of the track stays flat and the ends
    # curl like a tread over its sprockets.
    bm = kit.box((0.50, 0.10, 0.14), centre=(-0.02, y, 0.07))
    ends = [
        e for e in bm.edges
        if abs(e.verts[0].co.x - e.verts[1].co.x) < 1e-6
        and abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-6
    ]
    bmesh.ops.bevel(bm, geom=ends, offset=0.055, segments=3, affect="EDGES", profile=0.5)
    part(f"track_{side}", bm, m["dark"])

    # Guard plate over the track.
    part(f"track_guard_{side}", kit.box((0.44, 0.12, 0.022), centre=(-0.02, y, 0.152)), m["iron"], bevel=0.006)

    # Road wheel hubs on the outside face: small, but the one detail that tells
    # a track from a skirt at game distance.
    for x in (-0.17, -0.02, 0.13):
        part(
            f"hub_{side}_{x}",
            kit.cylinder(0.034, 0.02, segments=8, centre=(x, y + 0.058 * side, 0.068), axis="Y"),
            m["iron"],
        )

# ---------------------------------------------------------------------------
# Chassis and bumper.
# ---------------------------------------------------------------------------

part("chassis", kit.box((0.44, 0.26, 0.17), centre=(-0.02, 0, 0.145)), m["iron"], bevel=0.012)

# A dozer blade bolted to the front, tilted back. It is not the tool -- the arm
# is -- but it is what a thing that shoves scrap around would have.
part(
    "bumper",
    kit.box((0.045, 0.40, 0.085), centre=(0.232, 0, 0.068), rotation=Matrix.Rotation(math.radians(-18), 3, "Y")),
    m["iron"],
    bevel=0.008,
)

# ---------------------------------------------------------------------------
# Hopper: an open bin at the back, with its load showing.
# ---------------------------------------------------------------------------

HX, HLEN, HW, HZ0, HH, T = -0.18, 0.26, 0.40, 0.23, 0.18, 0.02
hz = HZ0 + HH / 2

for side in (1, -1):
    part(f"hopper_side_{side}", kit.box((HLEN, T, HH), centre=(HX, (HW / 2 - T / 2) * side, hz)), m["iron"], bevel=0.005)
    # The team colour. A panel welded over each side of the bin -- the largest
    # flat areas on the model, and so the ones that stay readable at distance.
    part(
        f"hopper_panel_{side}",
        kit.box((0.20, 0.008, 0.11), centre=(HX, (HW / 2 + 0.004) * side, hz + 0.01)),
        m["paint"],
        painted=True,
    )

part("hopper_back", kit.box((T, HW, HH), centre=(HX - HLEN / 2 + T / 2, 0, hz)), m["iron"], bevel=0.005)
part("hopper_front", kit.box((T, HW, HH * 0.8), centre=(HX + HLEN / 2 - T / 2, 0, HZ0 + HH * 0.4)), m["iron"], bevel=0.005)
part("hopper_floor", kit.box((HLEN, HW, 0.02), centre=(HX, 0, HZ0 + 0.01)), m["dark"])

# Painted rim along the top of the bin. The game camera looks down on units, so
# the surfaces that face up are the ones a player actually sees -- and a bin with a
# coloured rim reads, from above, as a rectangle in the owner's colour.
RIM_Z = HZ0 + HH + 0.006
for side in (1, -1):
    part(f"hopper_rim_{side}", kit.box((HLEN, T + 0.008, 0.012), centre=(HX, (HW / 2 - T / 2) * side, RIM_Z)), m["paint"], painted=True)
part("hopper_rim_back", kit.box((T + 0.008, HW, 0.012), centre=(HX - HLEN / 2 + T / 2, 0, RIM_Z)), m["paint"], painted=True)

# The load: scrap heaped above the rim, at odd angles. This is what makes it a
# hopper rather than a box -- an empty bin reads as a crate.
scrap = [
    ((0.09, 0.08, 0.05), (-0.22, 0.07, 0.385), (12, 25, 30)),
    ((0.07, 0.10, 0.04), (-0.14, -0.06, 0.38), (-20, 8, -15)),
    ((0.06, 0.06, 0.06), (-0.12, 0.09, 0.37), (30, -10, 45)),
    ((0.10, 0.05, 0.035), (-0.24, -0.08, 0.375), (5, -22, 60)),
]
for i, (size, centre, (rx, ry, rz)) in enumerate(scrap):
    rot = Matrix.Rotation(math.radians(rz), 3, "Z") @ Matrix.Rotation(math.radians(ry), 3, "Y") @ Matrix.Rotation(math.radians(rx), 3, "X")
    part(f"scrap_{i}", kit.box(size, centre=centre, rotation=rot), m["iron"] if i % 2 else m["dark"])

# ---------------------------------------------------------------------------
# Cab: a cage on the left, with the conscript in it.
# ---------------------------------------------------------------------------

CAB_X0, CAB_X1, CAB_Y0, CAB_Y1, CAB_Z0, CAB_Z1 = 0.0, 0.16, 0.0, 0.13, 0.23, 0.40

for i, (x, y) in enumerate([(CAB_X0, CAB_Y0), (CAB_X1, CAB_Y0), (CAB_X0, CAB_Y1), (CAB_X1, CAB_Y1)]):
    part(f"cage_post_{i}", kit.beam((x, y, CAB_Z0), (x, y, CAB_Z1), 0.018), m["dark"])

# Bars across the front. A cage, not a cab: nobody spent money on this seat.
part("cage_bar_a", kit.beam((CAB_X1, CAB_Y0, CAB_Z0 + 0.02), (CAB_X1, CAB_Y1, CAB_Z1 - 0.01), 0.012), m["dark"])
part("cage_bar_b", kit.beam((CAB_X1, CAB_Y1, CAB_Z0 + 0.02), (CAB_X1, CAB_Y0, CAB_Z1 - 0.01), 0.012), m["dark"])

# Painted roof: the second team-colour area, and the one seen from the camera's
# height.
# Pulled back over the rear of the cage so the operator's head shows in front of
# it. With a full roof the conscript -- the whole point of "labour, not a machine"
# -- was invisible from every angle the game has.
part(
    "cab_roof",
    kit.box((0.12, 0.17, 0.022), centre=(CAB_X0 + 0.05, (CAB_Y0 + CAB_Y1) / 2, CAB_Z1 + 0.011)),
    m["paint"],
    painted=True,
    bevel=0.005,
)

# The operator, hunched forward over the controls.
part(
    "operator_torso",
    kit.box((0.065, 0.075, 0.10), centre=(0.1, 0.065, 0.3), rotation=Matrix.Rotation(math.radians(28), 3, "Y")),
    m["dark"],
)
head = bmesh.new()
bmesh.ops.create_icosphere(head, subdivisions=1, radius=0.03)
bmesh.ops.translate(head, vec=(0.135, 0.065, 0.365), verts=head.verts)
part("operator_helmet", head, m["iron"])

# ---------------------------------------------------------------------------
# Cutting arm: out front on the right, folded down to the cutter.
# ---------------------------------------------------------------------------

AY = 0.08 * RIGHT
SHOULDER = (0.15, AY, 0.28)
ELBOW = (0.30, AY, 0.38)
WRIST = (0.40, AY, 0.15)

part("arm_base", kit.box((0.075, 0.075, 0.06), centre=(0.15, AY, 0.26)), m["iron"], bevel=0.006)
# Thick enough to survive the distance. At first these were 0.036 and 0.03, and
# from the game camera the arm read as a stick poking out of the hull.
part("arm_upper", kit.beam(SHOULDER, ELBOW, 0.05), m["iron"], bevel=0.005)
part("arm_lower", kit.beam(ELBOW, WRIST, 0.042), m["iron"], bevel=0.005)
# The hydraulic ram alongside the upper arm.
part("arm_ram", kit.beam((0.10, AY + 0.028 * RIGHT, 0.25), (0.25, AY + 0.028 * RIGHT, 0.35), 0.016), m["dark"])
part("arm_elbow", kit.cylinder(0.028, 0.065, segments=8, centre=ELBOW, axis="Y"), m["dark"])

# The cutter: a disc saw, edge-on to the direction of travel.
part("cutter", kit.cylinder(0.066, 0.012, segments=14, centre=(0.40, AY, 0.125), axis="Y"), m["dark"])
part("cutter_hub", kit.cylinder(0.02, 0.03, segments=6, centre=(0.40, AY, 0.125), axis="Y"), m["iron"])
# A guard over the top of the blade, in team colour: the business end is where a
# player's eye goes, so it carries paint too.
part(
    "cutter_guard",
    kit.box((0.10, 0.03, 0.022), centre=(0.39, AY, 0.2), rotation=Matrix.Rotation(math.radians(12), 3, "Y")),
    m["paint"],
    painted=True,
    bevel=0.004,
)

# Work lamp on the elbow, facing forward. The only light on the model; it dims in
# fog with everything else.
part("work_lamp", kit.box((0.022, 0.034, 0.024), centre=(0.325, AY, 0.405)), m["lamp"])

# ---------------------------------------------------------------------------
# Exhaust stack, between the cab and the hopper.
# ---------------------------------------------------------------------------

part("exhaust", kit.cylinder(0.018, 0.21, segments=8, centre=(-0.03, -0.115, 0.335)), m["dark"])
part("exhaust_cap", kit.cylinder(0.026, 0.03, segments=8, centre=(-0.03, -0.115, 0.44)), m["iron"])

# ---------------------------------------------------------------------------

# Sized for the game after it was looked at from the game's camera: at the size
# above, five of them standing together read as one dark smudge next to the
# Bastion. Still well inside the 1.6 a unit may span.
kit.scale_all(col, 1.25)

stats = kit.report(col)
glb = kit.export(col, CONTENT_ID)
blend = kit.save_blend(CONTENT_ID)
os.makedirs(PREVIEW_DIR, exist_ok=True)
images = kit.previews(col, PREVIEW_DIR, "servitor")

print("RTS_MODEL", CONTENT_ID, stats)
print("RTS_GLB", glb, os.path.getsize(glb))
print("RTS_BLEND", blend)
for image in images:
    print("RTS_PREVIEW", image)
