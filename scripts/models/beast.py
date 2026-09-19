"""
What the Verdigris's beasts share: legs, tails, the crust along a spine, the
scales over a flank, and the poses a leg takes in a stride.

UNIVERSE.md, "The beasts": the hive's units are corrupted animals, saurian
predators from the Sump's sea, and they are built from the same parts -- a
hide, a spine of crust with the bloom on it, jointed legs ending in bronze
claws, a tail. A script builds the body, the head and the clips, and takes the
rest from here, so that four beasts read as one blood.

Dense on purpose. Triangles are the cheap axis on this renderer (see the
model README's budget), and an animal is sold by roundness: a thigh is a
muscle over a bone, not a tube, and a flank is rows of scales rather than one
smooth shell. So every rod and ellipsoid here is high-segment, joints are
their own knuckles, and claws have phalanges.

Every leg is two bones, `name.upper` from the hip to the knee and `name.lower`
from the knee to the foot, each piece weighted wholly to one of them
(kit.rigid_part). Two kinds of leg:

  - **columnar** (the Behemoth, the Flenser): the upper bone points down, so
    a rotation about the armature's Y swings it fore and aft -- negative is
    forward -- and the knee bends by turning the lower bone about Y too.
  - **sprawled** (the Creeper, the Blightcaster): the upper bone points out to
    the side and up, a lizard's, so it swings fore and aft about Z (a left
    leg forward is -Z, a right leg +Z) and lifts about X (a left leg up is
    +X, a right -X); the lower bone points down and bends about Y.

Blender axes: +X forward, +Y left, +Z up, one unit is one tile.
"""

import math

from mathutils import Matrix, Vector

import kit


def rot(axis, degrees):
    return Matrix.Rotation(math.radians(degrees), 3, axis)


class Beast:
    """The bones and pieces of one beast, collected as the script adds them."""

    def __init__(self, col, s, glow):
        self.col = col
        self.s = s
        self.glow = glow
        self.bones = [("root", (0, 0, 0), (0, 0, 0.3), None)]
        self.parts = []
        self.count = 0

    def bone(self, name, head, tail, parent):
        self.bones.append((name, tuple(head), tuple(tail), parent))

    def piece(self, bm, mat, bone, painted=False, bevel=None, segments=1):
        self.count += 1
        obj = kit.rigid_part(f"{bone}.{self.count}", bm, mat, self.col, bone, painted=painted)
        if bevel is not None:
            kit.bevel(obj, width=bevel, segments=segments)
        self.parts.append(obj)
        return obj

    def box(self, size, centre, mat, bone, rotation=None, **kw):
        return self.piece(kit.box(size, centre, rotation), mat, bone, **kw)

    def ball(self, radii, centre, mat, bone, segments=16, rings=9):
        return self.piece(kit.ellipsoid(radii, centre, segments=segments, rings=rings), mat, bone)

    def rig(self, name="rig"):
        return kit.armature(name, self.col, self.bones)


# ---------------------------------------------------------------------------
# Legs
# ---------------------------------------------------------------------------

def leg(b, name, parent, hip, knee, foot, r, claws=4, sprawl=False):
    """A jointed leg: a thigh that is a muscle over a bone, a bronze knuckle
    at the knee and the ankle, a padded foot and bronze claws with phalanges,
    crust scales grown over the outside of the thigh."""
    hip, knee, foot = Vector(hip), Vector(knee), Vector(foot)
    up, lo = f"{name}.upper", f"{name}.lower"
    b.bone(up, hip, knee, parent)
    b.bone(lo, knee, foot, up)
    s = b.s
    side = 1 if hip.y >= 0 else -1

    # Thigh: the bone, the muscle over it, the hip joint under the hide.
    b.ball((r * 1.7, r * 1.55, r * 1.45), hip, s["hide"], up)
    b.piece(kit.rod(hip, knee, r * 1.1, segments=16, radius_end=r * 0.9), s["hide"], up)
    b.ball((r * 1.45, r * 1.15, r * 1.1), hip.lerp(knee, 0.38), s["hide"], up, segments=14, rings=8)
    b.ball((r * 1.0, r * 0.9, r * 0.85), hip.lerp(knee, 0.72), s["hide"], up, segments=12, rings=7)
    # Scales and a crust shelf on the outside, where the growth has had time.
    for t in (0.2, 0.42, 0.64):
        p = hip.lerp(knee, t) + Vector((0, side * r * 1.05, r * 0.2))
        b.box((r * 1.1, r * 0.35, r * 0.8), p, s["crust"], up, rot("X", -14 * side) @ rot("Z", (t - 0.4) * 30),
              bevel=r * 0.08, segments=2)
    for t in (0.3, 0.55, 0.8):
        p = hip.lerp(knee, t) + Vector((r * 0.9, 0, r * 0.1))
        b.box((r * 0.3, r * 0.9, r * 0.7), p, s["hide"], up, rot("Y", 20), bevel=r * 0.06, segments=2)

    # Knee: a bronze knuckle, a cap of crust over it.
    b.ball((r * 1.25, r * 1.25, r * 1.1), knee, s["bronze"], lo, segments=14, rings=8)
    b.box((r * 1.2, r * 1.0, r * 0.5), knee + Vector((r * 0.5, 0, r * 0.7)), s["crust"], lo, rot("Y", -35),
          bevel=r * 0.08, segments=2)
    # Shin: the bone, the calf over it, the tendon down the back.
    b.piece(kit.rod(knee, foot + Vector((0, 0, r * 0.6)), r * 0.85, segments=16, radius_end=r * 0.6), s["hide"], lo)
    b.ball((r * 1.05, r * 0.95, r * 0.9), knee.lerp(foot, 0.3), s["hide"], lo, segments=12, rings=7)
    b.piece(kit.rod(knee + Vector((-r * 0.6, 0, -r * 0.3)), foot + Vector((-r * 0.9, 0, r * 0.9)), r * 0.28,
                    segments=10, radius_end=r * 0.2), s["bronze"], lo)
    # Ankle and foot.
    b.ball((r * 0.95, r * 0.95, r * 0.75), foot + Vector((0, 0, r * 0.75)), s["bronze"], lo, segments=12, rings=7)
    b.ball((r * 1.5, r * 1.3, r * 0.5), foot + Vector((r * 0.2, 0, r * 0.42)), s["hide"], lo, segments=14, rings=6)
    b.piece(kit.rod(foot + Vector((0, 0, r * 0.5)), foot + Vector((-r * 1.3, 0, r * 0.35)), r * 0.35, segments=8,
                    radius_end=r * 0.12), s["bronze"], lo)
    if sprawl:
        forward = Vector((foot.x - hip.x, foot.y - hip.y, 0))
        forward = forward.normalized() if forward.length > 1e-6 else Vector((1, 0, 0))
        forward = (forward + Vector((0.8, 0, 0))).normalized()
    else:
        forward = Vector((1, 0, 0))
    for k in range(claws):
        a = (k - (claws - 1) / 2) * (100 / claws)
        d = rot("Z", a) @ forward
        base = foot + Vector((0, 0, r * 0.45)) + d * r * 0.9
        mid = foot + d * r * 1.9 + Vector((0, 0, r * 0.35))
        tip = foot + d * r * 2.8 + Vector((0, 0, r * 0.12))
        b.ball((r * 0.4, r * 0.4, r * 0.35), base, s["hide"], lo, segments=8, rings=5)
        b.piece(kit.rod(base, mid, r * 0.32, segments=8, radius_end=r * 0.26), s["hide"], lo)
        b.ball((r * 0.3, r * 0.3, r * 0.26), mid, s["bronze"], lo, segments=8, rings=5)
        b.piece(kit.rod(mid, tip, r * 0.24, segments=8, radius_end=r * 0.04), s["bronze"], lo)


def column_pose(name, swing, bend):
    """A columnar leg mid-stride: `swing` degrees forward, the knee bent `bend`."""
    return {f"{name}.upper": [("Y", -swing)], f"{name}.lower": [("Y", bend)]}


def sprawl_pose(name, side, swing, lift, bend):
    """A sprawled leg mid-stride: `swing` forward, `lift` up, the knee bent
    `bend`. `side` is +1 on the left, -1 on the right."""
    return {f"{name}.upper": [("Z", -swing * side), ("X", lift * side)], f"{name}.lower": [("Y", bend)]}


# ---------------------------------------------------------------------------
# Tails, spines, scales and drips
# ---------------------------------------------------------------------------

def tail(b, parent, start, end, r, segments=3, spikes=True, rise=0.0):
    """A tapering tail of hide in `segments` bones, `tail.1` at the body, a
    knuckle at every joint, scales down its sides and bronze spikes along its
    top. Returns the bone names."""
    start, end = Vector(start), Vector(end)
    names = []
    prev = parent
    s = b.s
    for k in range(segments):
        t0, t1 = k / segments, (k + 1) / segments
        a = start.lerp(end, t0) + Vector((0, 0, rise * math.sin(t0 * math.pi)))
        c = start.lerp(end, t1) + Vector((0, 0, rise * math.sin(t1 * math.pi)))
        name = f"tail.{k + 1}"
        b.bone(name, a, c, prev)
        ra, rc = r * (1 - t0 * 0.8), r * (1 - t1 * 0.8)
        b.piece(kit.rod(a, c, ra, segments=14, radius_end=rc), s["hide"], name)
        b.ball((ra * 1.15, ra * 1.15, ra * 1.05), a, s["hide"], name, segments=12, rings=7)
        along = (c - a).normalized()
        for j in range(3):
            m = a.lerp(c, (j + 0.5) / 3)
            rm = ra + (rc - ra) * (j + 0.5) / 3
            for side in (1, -1):
                b.box((rm * 0.9, rm * 0.25, rm * 0.7), m + Vector((0, side * rm * 0.95, rm * 0.15)), s["hide"], name,
                      rot("X", -25 * side), bevel=rm * 0.06, segments=2)
            if spikes:
                b.piece(kit.rod(m + Vector((0, 0, rm * 0.6)), m + Vector((-rm * 0.7, 0, rm * 2.4)), rm * 0.32,
                                segments=8, radius_end=rm * 0.05), s["bronze"], name)
                b.ball((rm * 0.4, rm * 0.4, rm * 0.3), m + Vector((0, 0, rm * 0.75)), s["crust"], name, segments=8,
                       rings=5)
        prev = name
        names.append(name)
    return names


def spine(b, bone, points, width, painted=True):
    """Crust shelves along the back, three terraces each, with bronze nodules
    round their feet and the bloom's crystals rising between them. `points`
    are (x, y, z) along the spine; `width` is how wide the shelves are."""
    s = b.s
    for k, p in enumerate(points):
        p = Vector(p)
        spin = (k % 3 - 1) * 14
        for layer in range(3):
            b.box((width * (0.95 - layer * 0.22), width * (0.72 - layer * 0.18), width * 0.14),
                  p + Vector((0, 0, layer * width * 0.11)), s["crust"], bone, rot("Z", spin + layer * 9),
                  bevel=width * 0.035, segments=2)
        for j in range(4):
            a = math.radians(j * 90 + 45 + spin)
            b.ball((width * 0.11, width * 0.09, width * 0.08),
                   p + Vector((math.cos(a) * width * 0.5, math.sin(a) * width * 0.4, -width * 0.02)), s["bronze"],
                   bone, segments=8, rings=5)
        if painted and k % 2 == 1:
            size = width * 0.45
            for j, (dx, dy, h) in enumerate(((0, 0.1, 1.7), (0.25, -0.15, 1.1), (-0.2, 0.3, 0.8))):
                b.box((size * 0.55, size * 0.55, size * h), p + Vector((dx * width, dy * width, width * 0.3)),
                      s["bloom"], bone, rot("Y", spin + j * 15) @ rot("Z", spin * 3 + j * 40), painted=True)


def scales(b, bone, centre, radii, rows=4, per_row=12, size=0.03, lat=(-5, 55), lon=(20, 160)):
    """Rows of hide scales over an ellipsoid's flanks: `rows` of `per_row`
    plates on each side, between `lat` degrees of elevation and `lon`
    degrees round from the front, each lying on the surface."""
    centre, radii = Vector(centre), Vector(radii)
    s = b.s
    for i in range(rows):
        phi = math.radians(lat[0] + (lat[1] - lat[0]) * (i + 0.5) / rows)
        for j in range(per_row):
            for side in (1, -1):
                theta = math.radians(lon[0] + (lon[1] - lon[0]) * (j + 0.5 + (i % 2) * 0.5) / per_row) * side
                n = Vector((math.cos(phi) * math.cos(theta), math.cos(phi) * math.sin(theta), math.sin(phi)))
                p = centre + Vector((n.x * radii.x, n.y * radii.y, n.z * radii.z)) * 1.01
                b.box((size, size * 0.8, size * 0.28), p, s["hide"], bone,
                      rot("Z", math.degrees(theta)) @ rot("Y", 90 - math.degrees(phi)), bevel=size * 0.08)


def drips(b, bone, points, r):
    """Mineral stalactites under an overhang: the beast never dries."""
    for p in points:
        p = Vector(p)
        b.piece(kit.rod(p, p + Vector((0.004, 0, -r * 4)), r, segments=7, radius_end=r * 0.3), b.s["crust"], bone)
        b.piece(kit.rod(p + Vector((r * 1.5, r, 0)), p + Vector((r * 1.6, r, -r * 2.5)), r * 0.6, segments=6,
                        radius_end=r * 0.2), b.s["crust"], bone)
