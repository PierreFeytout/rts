"""
Shared tooling for building unit and building models in headless Blender.

Every model in the game is a Python script, run with

    blender -b --factory-startup --python scripts/models/<model>.py

which builds the model from nothing, exports the .glb the game loads, saves a
.blend an artist can open and keep working on, and renders preview images.

The same bargain as the terrain textures and the soundtrack: generated rather
than hand-authored, the generator committed beside its output, and the output an
ordinary file that can be replaced by a hand-made one without touching code.
A script is reviewable and diffable in a way a .blend never is, and running it
again reproduces the model exactly.

The rules every model must follow are in packages/client/assets/models/README.md
and are checked by the game at load. This module exists so that each model script
follows them without having to know them.
"""

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MODELS_OUT = os.path.join(REPO, "packages", "client", "assets", "models")
BLEND_OUT = os.path.join(REPO, "art", "models")

TEAM_MASK = "_TEAMMASK"


# ---------------------------------------------------------------------------
# Scene
# ---------------------------------------------------------------------------

def fresh_scene():
    """Start from an empty file.

    `--factory-startup` gives the default cube, camera and light. They are
    removed rather than hidden: anything left in the file is something the
    exporter can pick up, and the one scene this file has is the only one
    exported -- the multiple-scene trap the model README warns about cannot
    happen in a file that never has a second scene.
    """
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)
    for material in list(bpy.data.materials):
        bpy.data.materials.remove(material)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    return scene


def collection(name):
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col


# ---------------------------------------------------------------------------
# Materials
#
# Linear colours, which is what Blender's colour sockets and three.js's material
# colours both mean. Metalness is kept low on purpose: the game has no
# environment map, and a highly metallic surface with nothing to reflect renders
# nearly black -- a model that looks right in Blender's viewport, which does
# have an environment, would come out as a silhouette in the match.
# ---------------------------------------------------------------------------

def material(name, colour, roughness=0.6, metallic=0.2, emission=None, strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    return mat


def directorate_palette():
    """The Ashen Directorate's materials. See UNIVERSE.md.

    `paint` is the 45% grey the game turns into exactly the owning player's
    colour; its brightness is the paint's, its hue is the player's.
    """
    return {
        # Lighter than a real iron would be. Seen from the game camera, against
        # dark ground under a low warm key, the first Servitor's hull vanished
        # into the floor and only its paint was visible.
        "iron": material("iron", (0.23, 0.18, 0.13), roughness=0.58, metallic=0.25),
        "dark": material("dark", (0.032, 0.027, 0.023), roughness=0.72, metallic=0.18),
        "paint": material("paint", (0.45, 0.45, 0.45), roughness=0.62, metallic=0.08),
        # Bone-coloured heat shielding. The only near-neutral in the palette, and
        # used in quantity only where ceramic is what the thing is made of.
        "ceramic": material("ceramic", (0.62, 0.55, 0.42), roughness=0.78, metallic=0.0),
        "lamp": material(
            "lamp", (0.9, 0.52, 0.16), roughness=0.4, metallic=0.0,
            # Strength 2.5, not more. At 6 the lamp saturated to white in the game,
            # and white is the one colour the palette reserves for nothing at all.
            emission=(1.0, 0.55, 0.15), strength=2.5,
        ),
    }


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------

def mesh_object(name, bm, mat, col, painted=False):
    """Turn a bmesh into an object with one material, and mark it if painted.

    One material per part keeps the team mask trivial: a painted part is 1
    everywhere and anything else carries no mask at all, which the game reads as
    0. The exporter splits by material regardless, so nothing is lost by it.
    """
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    if painted:
        attr = me.attributes.new(name=TEAM_MASK, type="FLOAT", domain="POINT")
        attr.data.foreach_set("value", [1.0] * len(me.vertices))
    obj = bpy.data.objects.new(name, me)
    col.objects.link(obj)
    return obj


def box(size, centre=(0, 0, 0), rotation=None):
    """A box as a bmesh: `size` is full extents, `centre` its middle."""
    bm = bmesh.new()
    verts = bmesh.ops.create_cube(bm, size=1.0)["verts"]
    bmesh.ops.scale(bm, vec=Vector(size), verts=verts)
    if rotation is not None:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=rotation, verts=verts)
    bmesh.ops.translate(bm, vec=Vector(centre), verts=verts)
    return bm


def cylinder(radius, depth, segments=10, centre=(0, 0, 0), axis="Z", cap_top=True):
    """A cylinder along `axis`. Low segment counts on purpose; see the budget."""
    bm = bmesh.new()
    verts = bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=segments,
        radius1=radius, radius2=radius, depth=depth,
    )["verts"]
    if axis == "X":
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "Y"), verts=verts)
    elif axis == "Y":
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "X"), verts=verts)
    bmesh.ops.translate(bm, vec=Vector(centre), verts=verts)
    return bm


def beam(start, end, thickness, width=None):
    """A square-section bar from `start` to `end`: arms, struts, frames."""
    a, b = Vector(start), Vector(end)
    direction = b - a
    length = direction.length
    bm = box((length, width if width is not None else thickness, thickness))
    rot = direction.to_track_quat("X", "Z").to_matrix()
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=rot, verts=bm.verts)
    bmesh.ops.translate(bm, vec=(a + b) / 2, verts=bm.verts)
    return bm


def frustum(bottom, top, z0, z1, centre=(0, 0)):
    """A box tapering from `bottom` (x, y) at z0 to `top` (x, y) at z1: limbs, torsos."""
    bm = bmesh.new()
    verts = bmesh.ops.create_cube(bm, size=1.0)["verts"]
    for v in verts:
        size = top if v.co.z > 0 else bottom
        v.co.x = centre[0] + v.co.x * size[0]
        v.co.y = centre[1] + v.co.y * size[1]
        v.co.z = z1 if v.co.z > 0 else z0
    return bm


def rod(start, end, radius, segments=8, radius_end=None):
    """A round bar from `start` to `end`: hoses, barrels, sleeves, rivets."""
    a, b = Vector(start), Vector(end)
    direction = b - a
    bm = bmesh.new()
    verts = bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=segments,
        radius1=radius, radius2=radius if radius_end is None else radius_end, depth=direction.length,
    )["verts"]
    rot = direction.to_track_quat("Z", "Y").to_matrix()
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=rot, verts=verts)
    bmesh.ops.translate(bm, vec=(a + b) / 2, verts=verts)
    return bm


def ellipsoid(radii, centre=(0, 0, 0), segments=12, rings=8):
    """A squashed sphere: helmet crowns, domes, knuckles."""
    bm = bmesh.new()
    verts = bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1.0)["verts"]
    bmesh.ops.scale(bm, vec=Vector(radii), verts=verts)
    bmesh.ops.translate(bm, vec=Vector(centre), verts=verts)
    return bm


def prism(points, z0, z1, top_scale=1.0, centre=(0, 0), open_top=False):
    """A polygon (x, y points, anticlockwise) extruded from z0 to z1, the top
    scaled about the centre: hulls with sloped walls, towers, hoppers (a
    `top_scale` above 1 flares out, and `open_top` leaves the mouth open)."""
    bm = bmesh.new()
    cx, cy = centre
    bottom = [bm.verts.new((cx + x, cy + y, z0)) for x, y in points]
    top = [bm.verts.new((cx + x * top_scale, cy + y * top_scale, z1)) for x, y in points]
    bm.faces.new(list(reversed(bottom)))
    if not open_top:
        bm.faces.new(top)
    for i in range(len(points)):
        j = (i + 1) % len(points)
        bm.faces.new((bottom[i], bottom[j], top[j], top[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def octagon(half, chamfer):
    """A square of half-width `half` with its corners cut back by `chamfer`."""
    h, c = half, chamfer
    return [(h, -h + c), (h, h - c), (h - c, h), (-h + c, h), (-h, h - c), (-h, -h + c), (-h + c, -h), (h - c, -h)]


def bevel(obj, width=0.008, segments=1, angle=40):
    """Chamfer the hard edges.

    The single change that most makes a low-poly model read as manufactured
    rather than assembled from primitives: a bevelled edge catches the light, so
    the silhouette of every plate is drawn with a thin highlight. Limited by
    angle so flat faces are left alone and the triangle count stays sane.
    """
    mod = obj.modifiers.new("bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(angle)
    mod.harden_normals = False
    return mod


# ---------------------------------------------------------------------------
# Checks, export, previews
# ---------------------------------------------------------------------------

def scale_all(col, factor):
    """Scale a finished model about the origin, which keeps its base on the ground.

    Models are built at a convenient size and then sized for the game in one
    place, after they have been looked at from the game's camera -- which is the
    only place a unit's size can actually be judged.
    """
    for obj in col.objects:
        obj.scale = (factor, factor, factor)
        obj.location = obj.location * factor
    bpy.context.view_layer.update()


def report(col):
    """Triangles and bounds after modifiers -- what the game will actually get."""
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    triangles = 0
    lo = Vector((math.inf, math.inf, math.inf))
    hi = Vector((-math.inf, -math.inf, -math.inf))
    materials = set()
    for obj in col.objects:
        if obj.type != "MESH":
            continue
        evaluated = obj.evaluated_get(depsgraph)
        me = evaluated.to_mesh()
        me.calc_loop_triangles()
        triangles += len(me.loop_triangles)
        for v in me.vertices:
            w = obj.matrix_world @ v.co
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
        materials.update(m.name for m in obj.data.materials)
        evaluated.to_mesh_clear()
    return {
        "triangles": triangles,
        "materials": sorted(materials),
        "min": [round(c, 3) for c in lo],
        "max": [round(c, 3) for c in hi],
    }


def export(col, content_id):
    """Write the .glb the game loads, with exactly the settings the README gives."""
    os.makedirs(MODELS_OUT, exist_ok=True)
    path = os.path.join(MODELS_OUT, f"{content_id}.glb")
    for obj in bpy.context.scene.objects:
        obj.select_set(obj.name in col.objects)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_attributes=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
    )
    return path


def save_blend(content_id):
    os.makedirs(BLEND_OUT, exist_ok=True)
    path = os.path.join(BLEND_OUT, f"{content_id}.blend")
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
    return path


def previews(col, out_dir, name, views=((35, 30), (35, 210), (60, 120)), poses=(), frame=1.15):
    """Render the model from a few angles, lit like the game.

    Not for the player -- for checking the model without opening Blender. The
    light is the game's: a low warm key and a cold rim, on a dark warm ground,
    because a model judged under a bright neutral studio light will not look
    the same in the Ashworks.

    `poses` is a list of `(label, setup)` for a rigged model: each `setup()`
    poses it, and it is rendered again from the first view. `frame` is how
    much of the scene the camera takes in, in the model's own units.
    """
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 720
    scene.render.resolution_y = 720
    scene.render.film_transparent = False
    scene.world = scene.world or bpy.data.worlds.new("world")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.02, 0.016, 0.012, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6

    helpers = collection("preview")

    ground = bpy.data.meshes.new("ground")
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=2.0)
    bm.to_mesh(ground)
    bm.free()
    ground.materials.append(material("ground", (0.06, 0.045, 0.032), roughness=0.95, metallic=0.0))
    helpers.objects.link(bpy.data.objects.new("ground", ground))

    key = bpy.data.lights.new("key", "SUN")
    key.energy = 4.5
    key.color = (1.0, 0.68, 0.38)
    key_obj = bpy.data.objects.new("key", key)
    key_obj.rotation_euler = (math.radians(58), 0, math.radians(-40))
    helpers.objects.link(key_obj)

    rim = bpy.data.lights.new("rim", "SUN")
    rim.energy = 1.6
    rim.color = (0.5, 0.62, 0.85)
    rim_obj = bpy.data.objects.new("rim", rim)
    rim_obj.rotation_euler = (math.radians(55), 0, math.radians(150))
    helpers.objects.link(rim_obj)

    cam = bpy.data.cameras.new("camera")
    cam.type = "ORTHO"
    cam.ortho_scale = frame
    cam_obj = bpy.data.objects.new("camera", cam)
    helpers.objects.link(cam_obj)
    scene.camera = cam_obj

    stats = report(col)
    centre = Vector([(a + b) / 2 for a, b in zip(stats["min"], stats["max"])])

    written = []
    for elevation, azimuth in views:
        el, az = math.radians(elevation), math.radians(azimuth)
        offset = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el))) * 5
        cam_obj.location = centre + offset
        cam_obj.rotation_euler = (centre - cam_obj.location).to_track_quat("-Z", "Y").to_euler()
        path = os.path.join(out_dir, f"{name}_{elevation}_{azimuth}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        written.append(path)

    elevation, azimuth = views[0]
    el, az = math.radians(elevation), math.radians(azimuth)
    offset = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el))) * 5
    cam_obj.location = centre + offset
    cam_obj.rotation_euler = (centre - cam_obj.location).to_track_quat("-Z", "Y").to_euler()
    for label, setup in poses:
        setup()
        path = os.path.join(out_dir, f"{name}_{label}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        written.append(path)

    # Out of the file again, so a saved .blend holds the model and nothing else.
    for obj in list(helpers.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(helpers)
    return written


# ---------------------------------------------------------------------------
# Rigs and animation
#
# The game bakes every clip into a texture at load (packages/client/src/
# skinned-parts.ts) and has three rules for a rigged model, which these helpers
# follow so that a model script cannot break them:
#
#   - one armature, and everything drawn is skinned to it -- nothing parented
#     to a bone, which the game leaves out;
#   - clips are actions named for what they are: "idle" and "walk" loop, "fire"
#     plays once;
#   - a squad is a custom property `rts_squad` on the armature, exported as a
#     glTF extra.
# ---------------------------------------------------------------------------

def select_only(*objects):
    """Select exactly `objects`, the first one active, as operators expect.

    Walks the scene's objects after a view-layer update rather than the view
    layer's list directly: straight after objects are removed, that list still
    holds empty entries for them.
    """
    view_layer = bpy.context.view_layer
    view_layer.update()
    for other in bpy.context.scene.objects:
        other.select_set(False)
    for obj in objects:
        obj.select_set(True)
    view_layer.objects.active = objects[0]


def armature(name, col, bones):
    """Build an armature from `(name, head, tail, parent)` tuples, in Blender axes."""
    data = bpy.data.armatures.new(name)
    obj = bpy.data.objects.new(name, data)
    col.objects.link(obj)

    select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    made = {}
    for bone_name, head, tail, parent in bones:
        eb = data.edit_bones.new(bone_name)
        eb.head = Vector(head)
        eb.tail = Vector(tail)
        eb.roll = 0.0
        if parent is not None:
            eb.parent = made[parent]
            eb.use_connect = False
        made[bone_name] = eb
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def rigid_part(name, bm, mat, col, bone, painted=False):
    """One piece of a rigged model, weighted entirely to one bone.

    Rigid skinning -- every vertex of a piece follows one bone -- is exactly how
    armour behaves, and at the size a unit is drawn nobody can see a knee that
    does not deform. It also keeps the weights trivially correct, which automatic
    weighting on a figure a few centimetres tall is not.
    """
    obj = mesh_object(name, bm, mat, col, painted=painted)
    group = obj.vertex_groups.new(name=bone)
    group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    return obj


def join(parts, name):
    """Merge rigid parts into one mesh. Vertex groups, materials and the team
    mask are merged by name, so each part keeps its bone and its paint."""
    # Bevels and the like are applied first. A rigged model is exported without
    # applying modifiers -- applying the armature would bake a pose -- so any
    # other modifier still on the mesh would silently never reach the game.
    for obj in parts:
        select_only(obj)
        for modifier in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=modifier.name)
    select_only(*parts)
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = name
    joined.data.name = name
    return joined


def bind(mesh, rig):
    """Skin a mesh to an armature: parent it, and let the armature deform it."""
    mesh.parent = rig
    modifier = mesh.modifiers.new("rig", "ARMATURE")
    modifier.object = rig


def pose_rotation(rig, bone_name, axis, degrees):
    """A pose rotation given in *armature* space, as the quaternion Blender stores.

    Pose rotations live in each bone's own rest frame, whose axes depend on
    which way the bone points. Converting from armature axes here means a clip
    can say "swing the thigh forward about Y" for every bone in the same terms,
    instead of working out each bone's local frame by hand.
    """
    rest = rig.data.bones[bone_name].matrix_local.to_3x3()
    rotation = Matrix.Rotation(math.radians(degrees), 3, axis if isinstance(axis, str) else Vector(axis).normalized())
    return (rest.inverted() @ rotation @ rest).to_quaternion()


def pose_location(rig, bone_name, offset):
    """A pose translation given in armature space, as the bone-local vector Blender stores."""
    rest = rig.data.bones[bone_name].matrix_local.to_3x3()
    return rest.inverted() @ Vector(offset)


def pose_scale(rig, bone_name, factors):
    """A pose scale given along armature axes, as bone-local factors.

    Exact for bones that lie along an armature axis, which is every bone a
    structure has: an upright bone's own Y is the armature's Z, so "squash it
    vertically" has to be written to Y.
    """
    if isinstance(factors, (int, float)):
        return Vector((factors, factors, factors))
    rest = rig.data.bones[bone_name].matrix_local.to_3x3()
    local = Vector((1.0, 1.0, 1.0))
    for axis in range(3):
        column = rest.col[axis]
        dominant = max(range(3), key=lambda k: abs(column[k]))
        local[axis] = factors[dominant]
    return local


def clip(rig, name, frames, keys):
    """Keyframe one action.

    `keys` maps a frame number to `{bone: [entry, ...]}`. An entry is
    `(axis, degrees)`, a rotation about an armature axis ("X", or any vector),
    and rotations on one bone are composed in order; `("loc", (x, y, z))`, an
    offset in armature space; `("scale", s)`, uniform or `(x, y, z)` along
    armature axes; or `("stretch", s)`, along the bone's own length.
    Structures need all three -- a hull dropping onto its feet is a move, and a
    shutter rolling up into its housing is a squash. Every bone of the rig is
    keyed on every listed frame, at rest where the frame does not mention it,
    so a clip never inherits a pose left behind by another.

    Keyed at 30 frames per second, the rate the game bakes at, so a frame in a
    script is a frame in the game.

    The action is pushed to its own muted NLA track, which is how several actions
    on one armature all reach the exporter.
    """
    scene = bpy.context.scene
    scene.render.fps = 30
    scene.render.fps_base = 1.0
    rig.animation_data_create()
    action = bpy.data.actions.new(name)
    rig.animation_data.action = action

    bones = [pb.name for pb in rig.pose.bones]
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"

    for frame in sorted(keys):
        for bone in bones:
            key_pose(rig, bone, frame, keys[frame].get(bone, []))

    return _finish_clip(rig, action, name, frames)


def track_clip(rig, name, frames, tracks, linear=()):
    """Keyframe one action from per-bone tracks.

    `tracks` maps a bone to `{frame: [entry, ...]}`, entries as for `clip`.
    Each bone is keyed only on its own frames, so it moves on its own schedule
    and eases between its own keys -- a structure unfolding is a dozen parts
    each doing one thing in turn, and keying every bone on every frame anyone
    moves would make each of them stutter through everyone else's timing.

    Every bone is also keyed on the first and last frames, holding its first
    and last pose, so nothing leaks in from another clip. Bones named in
    `linear` interpolate linearly: a spinning beacon should not ease in and out
    of every quarter turn.
    """
    scene = bpy.context.scene
    scene.render.fps = 30
    scene.render.fps_base = 1.0
    rig.animation_data_create()
    action = bpy.data.actions.new(name)
    rig.animation_data.action = action
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"

    for pb in rig.pose.bones:
        track = tracks.get(pb.name, {})
        frames_here = sorted(track)
        first = track[frames_here[0]] if frames_here else []
        last = track[frames_here[-1]] if frames_here else []
        schedule = {0: first, frames: last, **track}
        for frame in sorted(schedule):
            key_pose(rig, pb.name, frame, schedule[frame])

    if linear:
        for fcurve in _fcurves(action):
            if any(f'"{bone}"' in fcurve.data_path for bone in linear):
                for point in fcurve.keyframe_points:
                    point.interpolation = "LINEAR"

    return _finish_clip(rig, action, name, frames)


def _fcurves(action):
    """An action's curves. Blender 4.4 moved them under layers, strips and
    channelbags; older files still have them on the action."""
    if hasattr(action, "fcurves") and len(action.fcurves) > 0:
        return list(action.fcurves)
    curves = []
    for layer in getattr(action, "layers", []):
        for strip in layer.strips:
            for bag in strip.channelbags:
                curves.extend(bag.fcurves)
    return curves


def key_pose(rig, bone, frame, entries):
    """Key one bone's rotation, location and scale at `frame`, at rest unless
    `entries` says otherwise."""
    q = Matrix.Identity(3).to_quaternion()
    location = Vector((0.0, 0.0, 0.0))
    scale = Vector((1.0, 1.0, 1.0))
    for kind, value in entries:
        if kind == "loc":
            location = pose_location(rig, bone, value)
        elif kind == "scale":
            scale = pose_scale(rig, bone, value)
        elif kind == "stretch":
            # Along the bone itself, toward its head: a telescoping leg, a mast
            # run out of its housing, a shutter rolled up.
            scale = Vector((1.0, value, 1.0))
        else:
            q = pose_rotation(rig, bone, kind, value) @ q
    pb = rig.pose.bones[bone]
    pb.rotation_quaternion = q
    pb.location = location
    pb.scale = scale
    pb.keyframe_insert("rotation_quaternion", frame=frame)
    pb.keyframe_insert("location", frame=frame)
    pb.keyframe_insert("scale", frame=frame)


def _finish_clip(rig, action, name, frames):
    action.use_frame_range = True
    action.frame_start = 0
    action.frame_end = frames

    track = rig.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 0, action)
    track.mute = True
    rig.animation_data.action = None
    return action


def export_rigged(col, content_id, directory=MODELS_OUT):
    """Export a rigged model: skin, every action as a clip, and custom properties."""
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, f"{content_id}.glb")
    for obj in bpy.context.scene.objects:
        obj.select_set(obj.name in col.objects)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        # Not applied: the only modifier on a rigged mesh is its armature, which
        # the exporter turns into the skin. Applying it would bake a pose instead.
        export_apply=False,
        export_attributes=True,
        export_materials="EXPORT",
        export_skins=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_extras=True,
        # JPEG rather than PNG: baked noise barely compresses losslessly, and
        # three textures a model as PNG weighed more than the whole soundtrack.
        export_image_format="JPEG",
        export_image_quality=90,
        export_cameras=False,
        export_lights=False,
    )
    return path


def set_pose(rig, action, frame):
    """Show an action at a frame, for a preview render."""
    rig.animation_data.action = action
    bpy.context.scene.frame_set(frame)
