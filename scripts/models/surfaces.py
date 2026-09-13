"""
Procedural surfaces, and baking them into the textures a model ships with.

A model is built with as many materials as it has kinds of surface -- canvas,
leather, ceramic, iron, paint -- each a node tree that draws wear, grime and
relief from noise. None of that can run in the game, so it is baked with Cycles
into one set of images covering the whole model -- colour, roughness and a
normal map -- and the model is exported with a single material that reads them.
One material is one draw call, however many surfaces went into it.

What does not bake:

  - emission. Glowing parts keep their own untextured material, which is the
    one extra draw call a model pays for a light.
  - the team mask. It stays a vertex attribute (see kit.mesh_object); the paint
    surface here is 45% grey with its wear darker, and the game turns that into
    the owner's colour with the wear still showing.
  - metalness. The game has no environment to reflect, so metal is read from
    colour and roughness, and the exported material is almost dielectric.

Texture coordinates are object space in tiles, so a noise scale here is
features per tile: a figure half a tile tall wants scales in the hundreds.
"""

import math
import os

import bpy


# ---------------------------------------------------------------------------
# A small node-graph builder
# ---------------------------------------------------------------------------

class Graph:
    """Wraps one material's node tree. Inputs are set by name or index; a value
    that is a socket is linked, anything else is a default value."""

    def __init__(self, name):
        self.material = bpy.data.materials.new(name)
        self.material.use_nodes = True
        self.nt = self.material.node_tree
        self.nt.nodes.clear()
        self.out = self.nt.nodes.new("ShaderNodeOutputMaterial")
        self.bsdf = self.nt.nodes.new("ShaderNodeBsdfPrincipled")
        self.nt.links.new(self.bsdf.outputs["BSDF"], self.out.inputs["Surface"])
        self._coords = None

    def node(self, kind, inputs=None, **props):
        n = self.nt.nodes.new(kind)
        for key, value in props.items():
            setattr(n, key, value)
        for key, value in (inputs or {}).items():
            self.set(n.inputs[key], value)
        return n

    def set(self, socket, value):
        if isinstance(value, bpy.types.NodeSocket):
            self.nt.links.new(value, socket)
        else:
            socket.default_value = value

    # -- sources --------------------------------------------------------------

    def coords(self):
        if self._coords is None:
            self._coords = self.node("ShaderNodeTexCoord").outputs["Object"]
        return self._coords

    def stretched(self, x=1.0, y=1.0, z=1.0):
        """Object coordinates scaled per axis: streaks, runs, scratches."""
        return self.node("ShaderNodeMapping", {"Vector": self.coords(), "Scale": (x, y, z)}).outputs["Vector"]

    def noise(self, scale, detail=4.0, roughness=0.55, distortion=0.0, vector=None):
        return self.node("ShaderNodeTexNoise", {
            "Vector": vector if vector is not None else self.coords(),
            "Scale": scale, "Detail": detail, "Roughness": roughness, "Distortion": distortion,
        }).outputs["Factor"]

    def cracks(self, scale, width):
        """Thin lines along the cells of a Voronoi pattern, 1 on the line."""
        edge = self.node("ShaderNodeTexVoronoi", {"Vector": self.coords(), "Scale": scale},
                         feature="DISTANCE_TO_EDGE").outputs["Distance"]
        return self.band(edge, width, 0.0)

    def weave(self, scale):
        """Canvas: two perpendicular sets of bands, multiplied."""
        a = self.node("ShaderNodeTexWave", {"Vector": self.coords(), "Scale": scale, "Distortion": 0.6},
                      wave_type="BANDS", bands_direction="X").outputs["Factor"]
        b = self.node("ShaderNodeTexWave", {"Vector": self.coords(), "Scale": scale, "Distortion": 0.6},
                      wave_type="BANDS", bands_direction="Z").outputs["Factor"]
        return self.math("MULTIPLY", a, b)

    def occlusion(self, distance, inside=False):
        """Ambient occlusion: 0 in creases. With `inside`, 0 on convex edges."""
        n = self.node("ShaderNodeAmbientOcclusion", {"Distance": distance}, inside=inside, samples=16)
        return n.outputs["AO"]

    def edges(self, distance):
        """1 on sharp convex edges -- where paint chips and metal is polished."""
        return self.math("SUBTRACT", 1.0, self.occlusion(distance, inside=True))

    def height_from_z(self, low, high):
        """0 at `low`, 1 at `high`, object space: grime rising from the ground."""
        z = self.node("ShaderNodeSeparateXYZ", {"Vector": self.coords()}).outputs["Z"]
        return self.band(z, low, high)

    # -- arithmetic -----------------------------------------------------------

    def math(self, op, a, b=0.0, clamp=True):
        n = self.node("ShaderNodeMath", operation=op, use_clamp=clamp)
        self.set(n.inputs[0], a)
        self.set(n.inputs[1], b)
        return n.outputs[0]

    def band(self, value, start, end):
        """Linear 0 at `start` to 1 at `end`, clamped. Either direction."""
        return self.node("ShaderNodeMapRange", {
            "Value": value, "From Min": start, "From Max": end, "To Min": 0.0, "To Max": 1.0,
        }, clamp=True).outputs["Result"]

    def mix(self, factor, a, b):
        n = self.node("ShaderNodeMix", data_type="RGBA", clamp_factor=True)
        self.set(n.inputs[0], factor)
        self.set(n.inputs[6], rgba(a))
        self.set(n.inputs[7], rgba(b))
        return n.outputs[2]

    def mixf(self, factor, a, b):
        n = self.node("ShaderNodeMix", data_type="FLOAT", clamp_factor=True)
        self.set(n.inputs[0], factor)
        self.set(n.inputs[2], a)
        self.set(n.inputs[3], b)
        return n.outputs[0]

    # -- output ---------------------------------------------------------------

    def finish(self, colour, roughness, height=None, strength=0.3, distance=0.002, metallic=0.0):
        self.set(self.bsdf.inputs["Base Color"], rgba(colour))
        self.set(self.bsdf.inputs["Roughness"], roughness)
        self.set(self.bsdf.inputs["Metallic"], metallic)
        if height is not None:
            bump = self.node("ShaderNodeBump", {"Height": height, "Strength": strength, "Distance": distance})
            self.set(self.bsdf.inputs["Normal"], bump.outputs["Normal"])
        return self.material


def rgba(value):
    if isinstance(value, bpy.types.NodeSocket):
        return value
    return (*value, 1.0) if len(value) == 3 else value


# ---------------------------------------------------------------------------
# The Directorate's surfaces
# ---------------------------------------------------------------------------

def canvas(name="canvas", colour=(0.2, 0.17, 0.13)):
    """Heavy work canvas: a visible weave, ash ground into it low down, stains."""
    g = Graph(name)
    weave = g.weave(900)
    stains = g.noise(90, detail=6)
    ground_in = g.math("MULTIPLY", g.math("SUBTRACT", 1.0, g.height_from_z(0.0, 0.2)), 0.6)
    crease = g.math("SUBTRACT", 1.0, g.occlusion(0.005))

    c = g.mix(g.math("MULTIPLY", weave, 0.25), colour, [v * 0.7 for v in colour])
    c = g.mix(g.band(stains, 0.45, 0.75), c, (0.06, 0.055, 0.05))
    c = g.mix(ground_in, c, (0.16, 0.14, 0.12))
    c = g.mix(g.math("MULTIPLY", crease, 0.5), c, (0.02, 0.018, 0.015))
    height = g.math("ADD", g.math("MULTIPLY", weave, 0.5), g.math("MULTIPLY", stains, 0.5))
    return g.finish(c, g.mixf(stains, 0.92, 0.75), height, strength=0.25, distance=0.0008)


def leather(name="leather", colour=(0.16, 0.09, 0.045)):
    """Oiled leather: creases, scuffed pale on the edges."""
    g = Graph(name)
    creases = g.noise(260, detail=8, roughness=0.7, distortion=0.4)
    scuffs = g.math("MULTIPLY", g.edges(0.004), g.band(g.noise(160), 0.35, 0.6))
    crease = g.math("SUBTRACT", 1.0, g.occlusion(0.005))

    c = g.mix(g.band(creases, 0.4, 0.7), colour, [v * 0.6 for v in colour])
    c = g.mix(scuffs, c, (0.2, 0.14, 0.09))
    c = g.mix(g.math("MULTIPLY", crease, 0.5), c, (0.015, 0.01, 0.006))
    return g.finish(c, g.mixf(scuffs, 0.5, 0.8), creases, strength=0.35, distance=0.001)


def ceramic(name="ceramic", colour=(0.62, 0.55, 0.42)):
    """Heat ceramic, bone-coloured: hairline cracks, chipped edges, soot."""
    g = Graph(name)
    cracks = g.cracks(140, 0.012)
    chips = g.math("MULTIPLY", g.edges(0.006), g.band(g.noise(120, detail=3), 0.45, 0.55))
    soot = g.math("MULTIPLY", g.band(g.noise(40, detail=5), 0.55, 0.85), 0.5)
    grime = g.math("SUBTRACT", 1.0, g.occlusion(0.005))
    mottling = g.noise(300, detail=2)

    c = g.mix(g.math("MULTIPLY", mottling, 0.25), colour, [v * 0.82 for v in colour])
    c = g.mix(soot, c, (0.12, 0.1, 0.08))
    c = g.mix(g.math("MULTIPLY", cracks, 0.8), c, (0.1, 0.08, 0.06))
    c = g.mix(chips, c, (0.28, 0.24, 0.19))
    c = g.mix(g.math("MULTIPLY", grime, 0.5), c, (0.05, 0.04, 0.03))
    height = g.math("SUBTRACT", 1.0, g.math("MAXIMUM", cracks, chips))
    return g.finish(c, g.mixf(soot, 0.62, 0.9), height, strength=0.5, distance=0.0015)


def iron(name="iron", colour=(0.3, 0.25, 0.2)):
    """Worked iron: rust blooming in patches and running down, polished edges."""
    g = Graph(name)
    rust = g.band(g.noise(70, detail=6, distortion=0.3), 0.5, 0.72)
    runs = g.band(g.noise(40, vector=g.stretched(8, 8, 1)), 0.55, 0.8)
    polish = g.math("MULTIPLY", g.edges(0.004), 0.9)
    pitting = g.noise(500, detail=3)
    grime = g.math("SUBTRACT", 1.0, g.occlusion(0.005))

    c = g.mix(g.math("MULTIPLY", pitting, 0.3), colour, [v * 0.7 for v in colour])
    c = g.mix(g.math("MAXIMUM", rust, g.math("MULTIPLY", runs, 0.6)), c, (0.22, 0.085, 0.03))
    c = g.mix(polish, c, (0.42, 0.38, 0.33))
    c = g.mix(g.math("MULTIPLY", grime, 0.5), c, (0.03, 0.025, 0.02))
    roughness = g.mixf(polish, g.mixf(rust, 0.55, 0.9), 0.3)
    return g.finish(c, roughness, g.math("ADD", pitting, rust), strength=0.3, distance=0.0008, metallic=0.3)


def paint(name="paint"):
    """Team paint over iron: 45% grey, chipped through at edges, scratched, dusty.

    The chips are iron-coloured and so much darker, which the game turns into
    darker paint -- close enough to bare metal at the size anything is seen.
    """
    g = Graph(name)
    chips = g.math("MULTIPLY", g.edges(0.005), g.band(g.noise(140, detail=4), 0.4, 0.55))
    scratches = g.band(g.noise(60, detail=2, vector=g.stretched(1, 1, 25)), 0.62, 0.66)
    dust = g.band(g.noise(35, detail=5), 0.5, 0.85)
    grime = g.math("SUBTRACT", 1.0, g.occlusion(0.005))

    c = g.mix(g.math("MULTIPLY", dust, 0.4), (0.45, 0.45, 0.45), (0.36, 0.34, 0.31))
    c = g.mix(g.math("MAXIMUM", chips, g.math("MULTIPLY", scratches, 0.8)), c, (0.1, 0.085, 0.07))
    c = g.mix(g.math("MULTIPLY", grime, 0.5), c, (0.06, 0.055, 0.05))
    height = g.math("SUBTRACT", 1.0, g.math("MAXIMUM", chips, scratches))
    return g.finish(c, g.mixf(chips, 0.6, 0.45), height, strength=0.4, distance=0.001)


def rubber(name="rubber"):
    """Hoses, soles, seals: near black, matt, a little ash in the grain."""
    g = Graph(name)
    grain = g.noise(400, detail=3)
    c = g.mix(g.math("MULTIPLY", grain, 0.5), (0.045, 0.04, 0.036), (0.09, 0.085, 0.078))
    return g.finish(c, 0.88, grain, strength=0.15, distance=0.0005)


def directorate_surfaces():
    return {
        "canvas": canvas(),
        "leather": leather(),
        "ceramic": ceramic(),
        "iron": iron(),
        "paint": paint(),
        "rubber": rubber(),
    }


# ---------------------------------------------------------------------------
# Unwrapping and baking
# ---------------------------------------------------------------------------

def unwrap(obj, kit, margin=0.003):
    """One UV layout for the whole model, packed into a single texture."""
    kit.select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def bake(obj, kit, name, size=1024, keep=("lamp",), samples=32):
    """Bake every surface on `obj` into colour, roughness and normal images, then
    replace them with one material reading those images.

    Materials named in `keep` are left as they are -- lights, which cannot be
    baked into a colour -- and still exported as their own material.
    """
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.render.bake.margin = 6
    scene.render.bake.use_clear = True

    images = {}
    for kind, colour_space in (("color", "sRGB"), ("roughness", "Non-Color"), ("normal", "Non-Color")):
        image = bpy.data.images.new(f"{name}_{kind}", size, size, alpha=False)
        image.colorspace_settings.name = colour_space
        images[kind] = image

    materials = [slot.material for slot in obj.material_slots]
    targets = []
    for mat in materials:
        node = mat.node_tree.nodes.new("ShaderNodeTexImage")
        mat.node_tree.nodes.active = node
        targets.append(node)

    kit.select_only(obj)
    for kind, bake_type, passes in (
        ("color", "DIFFUSE", {"COLOR"}),
        ("roughness", "ROUGHNESS", set()),
        ("normal", "NORMAL", set()),
    ):
        for node in targets:
            node.image = images[kind]
        bpy.ops.object.bake(type=bake_type, pass_filter=passes)
    for image in images.values():
        image.pack()

    # The single material the game gets.
    g = Graph(name)
    tex = {k: g.node("ShaderNodeTexImage", image=img) for k, img in images.items()}
    normal = g.node("ShaderNodeNormalMap", {"Color": tex["normal"].outputs["Color"]})
    g.set(g.bsdf.inputs["Base Color"], tex["color"].outputs["Color"])
    g.set(g.bsdf.inputs["Roughness"], tex["roughness"].outputs["Color"])
    g.set(g.bsdf.inputs["Metallic"], 0.1)
    g.set(g.bsdf.inputs["Normal"], normal.outputs["Normal"])

    # Remap every face onto the baked material or the kept one it had.
    kept = [m for m in dict.fromkeys(materials) if m.name.split(".")[0] in keep]
    final = [g.material, *kept]
    index = [0 if m not in kept else 1 + kept.index(m) for m in materials]
    faces = [index[p.material_index] for p in obj.data.polygons]
    obj.data.materials.clear()
    for m in final:
        obj.data.materials.append(m)
    obj.data.polygons.foreach_set("material_index", faces)
    obj.data.update()
    return images


def save_images(images, directory):
    """Write the baked images beside the model's .blend, for looking at."""
    os.makedirs(directory, exist_ok=True)
    for image in images.values():
        image.save_render(os.path.join(directory, f"{image.name}.png"))
