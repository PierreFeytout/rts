"""
What the Verdigris's structures share: the organic geometry a building grows
in, and the collector a script builds it with.

UNIVERSE.md, "What its structures look like": a recognisable machine
underneath, growth imitating mechanism badly, three materials and the bloom,
wet and dripping, a rare cold light. And over all of it, alive: a Verdigris
structure is a colonised thing that swells, drinks and breathes, and the
reason it is modelled here rather than with kit's boxes is that nothing
alive is a box. So:

  - a **tube** is swept along a curve, with its radius wandering: a vein, a
    throat, a rib, a coiled spine, each with the swellings that say something
    is moving through it;
  - a **lathe** revolves a profile whose radius wanders round the
    circumference: a tower's stump, a tank's shell, a sac;
  - a **shelf** is the terrace a mineral crust grows in, a lumpy disc with a
    rounded lip and an undercut for the drips to hang from;
  - a **blob** is an ellipsoid pushed about by noise: a heart, a gestation
    pit, a knot;
  - **bubbles** are the crust's blisters, **drips** its stalactites, and
    **crystals** the bloom in the brood's colour -- hexagonal, clustered,
    and the one painted thing on a Verdigris building.

Dense on purpose, like beast.py: triangles are the cheap axis on this
renderer and an organism is sold by roundness. Every tube and lathe here is
high-segment, and the budget for a structure is what limits a script.

Blender axes: +X toward the camera, +Y left, +Z up, one unit is one tile.
Structures are built at their real footprint (the model README, Structures)
and shrunk into the unit box by the script.
"""

import math
import random

import bmesh
from mathutils import Matrix, Vector, noise

import kit


def rot(axis, degrees):
    return Matrix.Rotation(math.radians(degrees), 3, axis)


# ---------------------------------------------------------------------------
# Curves
# ---------------------------------------------------------------------------

def curve(controls, per_segment=6):
    """A Catmull-Rom spline through `controls`, `per_segment` points between
    each pair: the smooth path a tube is swept along."""
    pts = [Vector(p) for p in controls]
    n = len(pts)
    out = []
    for i in range(n - 1):
        p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, n - 1)]
        for j in range(per_segment):
            t = j / per_segment
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(pts[-1])
    return out


def swell(n, base, at=(), amount=0.5, width=0.1, taper=(1.0, 1.0)):
    """Radii for `n` points along a tube: `base`, tapering from `taper[0]` at
    the start to `taper[1]` at the end, with a bulge of `amount` at each
    fraction in `at` -- what is being swallowed, or grown."""
    radii = []
    for i in range(n):
        t = i / max(n - 1, 1)
        r = base * (taper[0] + (taper[1] - taper[0]) * t)
        for a in at:
            r *= 1 + amount * math.exp(-((t - a) / width) ** 2)
        radii.append(r)
    return radii


def frames(points):
    """Parallel-transport frames along a polyline, so a tube swept along it
    does not twist: `(points, tangents, normals)`."""
    pts = [Vector(p) for p in points]
    n = len(pts)
    tangents = []
    for i in range(n):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == n - 1:
            t = pts[-1] - pts[-2]
        else:
            t = pts[i + 1] - pts[i - 1]
        tangents.append(t.normalized() if t.length > 1e-9 else Vector((0, 0, 1)))
    t0 = tangents[0]
    ref = Vector((0, 0, 1)) if abs(t0.z) < 0.9 else Vector((1, 0, 0))
    normals = [(ref - t0 * ref.dot(t0)).normalized()]
    for i in range(1, n):
        a, b = tangents[i - 1], tangents[i]
        axis = a.cross(b)
        if axis.length < 1e-6:
            normals.append(normals[-1])
        else:
            angle = math.acos(max(-1.0, min(1.0, a.dot(b))))
            normals.append((Matrix.Rotation(angle, 3, axis.normalized()) @ normals[-1]).normalized())
    return pts, tangents, normals


# ---------------------------------------------------------------------------
# Meshes
# ---------------------------------------------------------------------------

def _face(bm, verts):
    """A face from verts that may repeat (poles), skipped if degenerate."""
    unique = []
    for v in verts:
        if v not in unique:
            unique.append(v)
    if len(unique) >= 3:
        try:
            return bm.faces.new(unique)
        except ValueError:
            return None
    return None


def tube(points, radii, segments=12, caps=True, wobble=0.0, rng=None, wall=None):
    """A tube swept along `points` with a radius per point (or one for all):
    veins, throats, ribs, tails. `wobble` knocks each ring's vertices about
    by that fraction of the radius, for a tube that has grown rather than
    been drawn. With `wall`, the tube is hollow with that wall thickness and
    open at both ends -- a throat or a chimney the camera can look into."""
    pts, tangents, normals = frames(points)
    if isinstance(radii, (int, float)):
        radii = [radii] * len(pts)
    bm = bmesh.new()

    def rings_at(shrink):
        rings = []
        for p, t, nrm, r in zip(pts, tangents, normals, radii):
            binormal = t.cross(nrm)
            ring = []
            for k in range(segments):
                a = 2 * math.pi * k / segments
                rr = max(r - shrink, 0.002)
                if wobble and rng is not None:
                    rr *= 1 + rng.uniform(-wobble, wobble)
                ring.append(bm.verts.new(p + (nrm * math.cos(a) + binormal * math.sin(a)) * rr))
            rings.append(ring)
        return rings

    def skin(rings, inside=False):
        for r0, r1 in zip(rings, rings[1:]):
            for k in range(segments):
                j = (k + 1) % segments
                quad = (r0[k], r0[j], r1[j], r1[k])
                f = _face(bm, tuple(reversed(quad)) if inside else quad)
                if f is not None:
                    f.smooth = True

    outer = rings_at(0.0)
    skin(outer)
    if wall is not None:
        inner = rings_at(wall)
        skin(inner, inside=True)
        for a, b, flip in ((outer[0], inner[0], True), (outer[-1], inner[-1], False)):
            for k in range(segments):
                j = (k + 1) % segments
                quad = (a[k], a[j], b[j], b[k])
                _face(bm, quad if flip else tuple(reversed(quad)))
    elif caps:
        _face(bm, list(reversed(outer[0])))
        _face(bm, outer[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def lathe(profile, segments=24, centre=(0, 0, 0), angles=(0, 360), radial=None, lift=None, floor=None):
    """Revolve a closed `(r, z)` profile about a vertical axis through
    `centre`, over `angles` degrees of it (a partial turn is capped with the
    profile at both ends, so a split shell shows its wall). `radial(theta,
    z)` scales the radius at each angle and `lift(theta, z)` raises the
    profile there: how a stump that nothing built stops being round.

    Profile points at r = 0 become a single pole vertex, so a solid can
    close over its top and bottom."""
    cx, cy, cz = centre
    a0, a1 = math.radians(angles[0]), math.radians(angles[1])
    full = abs((angles[1] - angles[0]) % 360) < 1e-6
    count = segments if full else segments + 1
    bm = bmesh.new()
    poles = {}
    rings = []
    for k in range(count):
        theta = a0 + (a1 - a0) * k / segments
        ring = []
        for i, (r, z) in enumerate(profile):
            if r < 1e-6:
                if i not in poles:
                    poles[i] = bm.verts.new((cx, cy, cz + z))
                ring.append(poles[i])
                continue
            rr = r * (radial(theta, z) if radial is not None else 1.0)
            zz = z + (lift(theta, z) if lift is not None else 0.0)
            ring.append(bm.verts.new((cx + math.cos(theta) * rr, cy + math.sin(theta) * rr, cz + zz)))
        rings.append(ring)
    n = len(profile)
    for k in range(count if full else count - 1):
        r0, r1 = rings[k], rings[(k + 1) % count]
        for i in range(n):
            j = (i + 1) % n
            f = _face(bm, (r0[i], r1[i], r1[j], r0[j]))
            if f is not None:
                f.smooth = True
    if not full:
        _face(bm, rings[0])
        _face(bm, list(reversed(rings[-1])))
    if floor is not None:
        for v in bm.verts:
            v.co.z = max(v.co.z, floor)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def lump(bm, amount, scale=3.0, seed=0.0, floor=None):
    """Push a mesh's vertices along their normals by Perlin noise: the
    unevenness of something grown. `scale` is features per tile."""
    bm.normal_update()
    offset = Vector((seed * 7.31, seed * 3.17, seed * 1.93))
    for v in bm.verts:
        n = noise.noise(v.co * scale + offset)
        v.co += v.normal * (n * amount)
    if floor is not None:
        for v in bm.verts:
            v.co.z = max(v.co.z, floor)
    for f in bm.faces:
        f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def blob(radii, centre, amount=0.12, scale=3.0, seed=0.0, segments=16, rings=10, floor=None):
    """An ellipsoid pushed about by noise: a heart, a pit, a knot, a sac."""
    bm = kit.ellipsoid(radii, centre, segments=segments, rings=rings)
    return lump(bm, amount * min(radii), scale, seed, floor)


def shelf(centre, r, thickness, seed=0.0, segments=20, undercut=0.35, floor=None):
    """One terrace of crust: a lumpy disc with a rounded lip and an undercut
    beneath it, its edge wandering in and out round the circumference."""
    t = thickness
    profile = [
        (0.0, t), (r * 0.55, t), (r * 0.82, t * 0.92), (r * 0.96, t * 0.62), (r, t * 0.25),
        (r * 0.9, -t * 0.1), (r * (1 - undercut), -t * 0.18), (0.0, -t * 0.18),
    ]
    s1, s2, s3 = seed * 1.7, seed * 2.9, seed * 0.6

    def radial(theta, z):
        return 1 + 0.11 * math.sin(3 * theta + s1) + 0.07 * math.sin(5 * theta + s2) + 0.045 * math.sin(8 * theta + s3)

    def lift(theta, z):
        return t * 0.12 * math.sin(2 * theta + s2)

    return lathe(profile, segments=segments, centre=centre, radial=radial, lift=lift, floor=floor)


def half(bm, co, no):
    """Keep the side of a mesh on the `no` side of the plane through `co`,
    and close the cut: one half of a sac that splits."""
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    cut = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=Vector(co), plane_no=Vector(no), clear_outer=False,
                                 clear_inner=True)
    edges = [e for e in cut["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
    if edges:
        bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def crystal(size, height, centre, rotation=None):
    """One hexagonal crystal tapering to a point, grown along +Z from its
    base at `centre`, then turned by `rotation`."""
    points = [(math.cos(math.radians(60 * k + 30)) * size, math.sin(math.radians(60 * k + 30)) * size) for k in range(6)]
    bm = kit.prism(points, 0.0, height, top_scale=0.42)
    if rotation is not None:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=rotation, verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(centre), verts=bm.verts)
    return bm


def facing(up):
    """The rotation that turns +Z onto `up`: what a cluster grown on a wall
    or a rib is turned by."""
    return Vector(up).to_track_quat("Z", "Y").to_matrix()


# ---------------------------------------------------------------------------
# The collector
# ---------------------------------------------------------------------------

class Growth:
    """The bones and pieces of one structure, collected as the script adds
    them, with the organic parts every Verdigris structure is grown from."""

    def __init__(self, col, s, glow, seed=1):
        self.col = col
        self.s = s
        self.glow = glow
        self.rng = random.Random(seed)
        self.bones = [("root", (0, 0, 0), (0, 0, 0.5), None)]
        self.parts = []
        self.count = 0

    def bone(self, name, head, tail, parent):
        self.bones.append((name, tuple(head), tuple(tail), parent))

    def rig(self, name="rig"):
        return kit.armature(name, self.col, self.bones)

    # -- pieces ---------------------------------------------------------------

    def piece(self, bm, mat, bone, painted=False, bevel=None, segments=1):
        self.count += 1
        obj = kit.rigid_part(f"{bone}.{self.count}", bm, mat, self.col, bone, painted=painted)
        if bevel is not None:
            kit.bevel(obj, width=bevel, segments=segments)
        self.parts.append(obj)
        return obj

    def box(self, size, centre, mat, bone, rotation=None, **kw):
        return self.piece(kit.box(size, centre, rotation), mat, bone, **kw)

    def ball(self, radii, centre, mat, bone, segments=16, rings=9, smooth=True):
        bm = kit.ellipsoid(radii, centre, segments=segments, rings=rings)
        if smooth:
            for f in bm.faces:
                f.smooth = True
        return self.piece(bm, mat, bone)

    def tube(self, points, radii, mat, bone, segments=12, wobble=0.0, caps=True, wall=None, **kw):
        return self.piece(tube(points, radii, segments=segments, caps=caps, wobble=wobble, rng=self.rng, wall=wall),
                          mat, bone, **kw)

    def blob(self, radii, centre, mat, bone, amount=0.12, scale=3.0, segments=16, rings=10, floor=None, **kw):
        return self.piece(blob(radii, centre, amount, scale, self.rng.uniform(0, 10), segments, rings, floor), mat,
                          bone, **kw)

    def shelf(self, centre, r, thickness, mat, bone, segments=20, floor=None, **kw):
        return self.piece(shelf(centre, r, thickness, self.rng.uniform(0, 10), segments, floor=floor), mat, bone,
                          **kw)

    # -- growths --------------------------------------------------------------

    def vein(self, controls, r, bone, mat=None, at=(), amount=0.45, taper=(1.0, 0.55), segments=12, per_segment=6,
             wobble=0.04):
        """A vein of wet bronze along `controls`, tapering, with a swelling at
        each fraction in `at`: a pipe that has become something else. Returns
        the points it was swept along, for laying other things on it."""
        pts = curve(controls, per_segment)
        radii = swell(len(pts), r, at=at, amount=amount, taper=taper)
        self.tube(pts, radii, mat or self.s["bronze"], bone, segments=segments, wobble=wobble)
        return pts

    def drips(self, bone, points, r, length=None, mat=None):
        """Mineral stalactites hanging from `points`: nothing here is dry."""
        mat = mat or self.s["crust"]
        for p in points:
            p = Vector(p)
            ln = length if length is not None else r * 4
            self.piece(kit.rod(p + Vector((0, 0, r * 0.3)), p + Vector((0.004, 0, -ln)), r, segments=8,
                               radius_end=r * 0.25), mat, bone)
            self.piece(kit.rod(p + Vector((r * 1.4, r * 0.8, r * 0.2)), p + Vector((r * 1.5, r * 0.9, -ln * 0.55)),
                               r * 0.55, segments=6, radius_end=r * 0.18), mat, bone)

    def bubbles(self, bone, points, size, mat=None, spread=0.3):
        """The crust's blisters: small lumps of it at `points`, each a little
        different in size."""
        mat = mat or self.s["crust"]
        for p in points:
            k = self.rng.uniform(1 - spread, 1 + spread)
            radii = (size * k, size * k * self.rng.uniform(0.8, 1.1), size * k * 0.7)
            self.piece(kit.ellipsoid(radii, p, segments=9, rings=5), mat, bone)

    def crystals(self, bone, centre, size, count, up=(0, 0, 1), spread=0.7, tilt=30, painted=True):
        """A cluster of the bloom's crystals growing along `up` from
        `centre`, the biggest in the middle: where the brood's colour is."""
        base = facing(up)
        centre = Vector(centre)
        for k in range(count):
            a = self.rng.uniform(0, 2 * math.pi)
            d = self.rng.uniform(0, 1) ** 0.6 * spread * size
            local = Vector((math.cos(a) * d, math.sin(a) * d, -size * 0.25))
            scale = 1.0 - 0.45 * (d / max(spread * size, 1e-6)) + self.rng.uniform(-0.1, 0.15)
            height = size * self.rng.uniform(1.6, 2.6) * scale
            width = size * self.rng.uniform(0.3, 0.5) * scale
            turn = rot("Z", self.rng.uniform(0, 360)) @ rot("X", self.rng.uniform(-tilt, tilt)) @ rot(
                "Y", self.rng.uniform(-tilt, tilt))
            self.piece(crystal(width, height, centre + base @ local, base @ turn), self.s["bloom"], bone,
                       painted=painted)

    def spines(self, bone, points, r, length, direction=(0, 0, 1), mat=None):
        """Bronze spikes rising from `points`: the barbs and teeth every
        Verdigris opening grows."""
        mat = mat or self.s["bronze"]
        d = Vector(direction).normalized()
        for p in points:
            p = Vector(p)
            self.piece(kit.rod(p - d * r * 0.4, p + d * length, r, segments=8, radius_end=r * 0.08), mat, bone)
            self.ball((r * 1.3, r * 1.3, r * 1.0), p, self.s["crust"], bone, segments=8, rings=5)


def ring(centre, r, count, z=0.0, start=0.0):
    """`count` points on a circle: where teeth, drips or veins go round something."""
    cx, cy = centre[0], centre[1]
    return [Vector((cx + math.cos(math.radians(start + 360 * k / count)) * r,
                    cy + math.sin(math.radians(start + 360 * k / count)) * r, z)) for k in range(count)]
