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
import time

import bpy


# ---------------------------------------------------------------------------
# A small node-graph builder
# ---------------------------------------------------------------------------

class Graph:
    """Wraps one material's node tree. Inputs are set by name or index; a value
    that is a socket is linked, anything else is a default value.

    `scale` is how many times larger than a figure the thing being textured is.
    Every noise scale and distance in a surface is written for the Conscript; a
    Bastion's plates are several times the size of a pauldron, so its rust
    patches, chipped edges and crevice grime have to be several times larger
    too, or they shrink to a fizz nobody can see from the game camera.

    `ash` turns on settled ash (see `settle`): buildings want it, figures --
    who move, and shed it -- do not.
    """

    def __init__(self, name, scale=1.0, ash=0.0):
        self.scale = scale
        self.ash = ash
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
            "Scale": scale / self.scale, "Detail": detail, "Roughness": roughness, "Distortion": distortion,
        }).outputs["Factor"]

    def cracks(self, scale, width):
        """Thin lines along the cells of a Voronoi pattern, 1 on the line."""
        edge = self.node("ShaderNodeTexVoronoi", {"Vector": self.coords(), "Scale": scale / self.scale},
                         feature="DISTANCE_TO_EDGE").outputs["Distance"]
        return self.band(edge, width, 0.0)

    def weave(self, scale):
        """Canvas: two perpendicular sets of bands, multiplied."""
        a = self.node("ShaderNodeTexWave", {"Vector": self.coords(), "Scale": scale / self.scale, "Distortion": 0.6},
                      wave_type="BANDS", bands_direction="X").outputs["Factor"]
        b = self.node("ShaderNodeTexWave", {"Vector": self.coords(), "Scale": scale / self.scale, "Distortion": 0.6},
                      wave_type="BANDS", bands_direction="Z").outputs["Factor"]
        return self.math("MULTIPLY", a, b)

    def occlusion(self, distance, inside=False):
        """Ambient occlusion: 0 in creases. With `inside`, 0 on convex edges."""
        n = self.node("ShaderNodeAmbientOcclusion", {"Distance": distance * self.scale}, inside=inside, samples=16)
        return n.outputs["AO"]

    def edges(self, distance):
        """1 on sharp convex edges -- where paint chips and metal is polished."""
        return self.math("SUBTRACT", 1.0, self.occlusion(distance, inside=True))

    def height_from_z(self, low, high):
        """0 at `low`, 1 at `high`, object space: grime rising from the ground."""
        z = self.node("ShaderNodeSeparateXYZ", {"Vector": self.coords()}).outputs["Z"]
        return self.band(z, low * self.scale, high * self.scale)

    def stripes(self, scale):
        """Diagonal bands, 1 on a stripe: hazard marking, on a face of any facing."""
        wave = self.node("ShaderNodeTexWave", {"Vector": self.coords(), "Scale": scale / self.scale},
                         wave_type="BANDS", bands_direction="DIAGONAL").outputs["Factor"]
        return self.band(wave, 0.46, 0.54)

    def facing_up(self, start=0.5, end=0.92):
        """1 on faces that point at the sky, 0 on walls and undersides."""
        normal = self.node("ShaderNodeNewGeometry").outputs["Normal"]
        z = self.node("ShaderNodeSeparateXYZ", {"Vector": normal}).outputs["Z"]
        return self.band(z, start, end)

    def settle(self, colour, roughness, height):
        """Ash, where ash would lie.

        UNIVERSE.md: ash collects in every horizontal crevice and nowhere
        vertical, and that one rule does more for the look than any amount of
        detail. So it is gated on the face pointing up, drifted by broad noise,
        and packed thickest where the surface is occluded -- a ledge against a
        wall, the floor of a trough.
        """
        drifts = self.band(self.noise(12, detail=5, distortion=0.4), 0.3, 0.75)
        crevices = self.math("SUBTRACT", 1.0, self.occlusion(0.02))
        cover = self.math("MULTIPLY", self.facing_up(),
                          self.math("ADD", self.math("MULTIPLY", drifts, 0.75), crevices))
        cover = self.math("MULTIPLY", cover, self.ash)
        ash = self.mix(self.noise(350, detail=2), (0.1, 0.075, 0.055), (0.16, 0.135, 0.11))
        colour = self.mix(cover, colour, ash)
        roughness = self.mixf(cover, roughness, 0.95)
        lifted = self.math("MULTIPLY", cover, 0.4)
        height = lifted if height is None else self.math("ADD", height, lifted)
        return colour, roughness, height

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
        if self.ash > 0:
            colour, roughness, height = self.settle(colour, roughness, height)
        self.set(self.bsdf.inputs["Base Color"], rgba(colour))
        self.set(self.bsdf.inputs["Roughness"], roughness)
        self.set(self.bsdf.inputs["Metallic"], metallic)
        if height is not None:
            bump = self.node("ShaderNodeBump", {"Height": height, "Strength": strength, "Distance": distance * self.scale})
            self.set(self.bsdf.inputs["Normal"], bump.outputs["Normal"])
        return self.material


def rgba(value):
    if isinstance(value, bpy.types.NodeSocket):
        return value
    return (*value, 1.0) if len(value) == 3 else value


# ---------------------------------------------------------------------------
# The Directorate's surfaces
# ---------------------------------------------------------------------------

def canvas(name="canvas", colour=(0.2, 0.17, 0.13), **world):
    """Heavy work canvas: a visible weave, ash ground into it low down, stains."""
    g = Graph(name, **world)
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


def leather(name="leather", colour=(0.16, 0.09, 0.045), **world):
    """Oiled leather: creases, scuffed pale on the edges."""
    g = Graph(name, **world)
    creases = g.noise(260, detail=8, roughness=0.7, distortion=0.4)
    scuffs = g.math("MULTIPLY", g.edges(0.004), g.band(g.noise(160), 0.35, 0.6))
    crease = g.math("SUBTRACT", 1.0, g.occlusion(0.005))

    c = g.mix(g.band(creases, 0.4, 0.7), colour, [v * 0.6 for v in colour])
    c = g.mix(scuffs, c, (0.2, 0.14, 0.09))
    c = g.mix(g.math("MULTIPLY", crease, 0.5), c, (0.015, 0.01, 0.006))
    return g.finish(c, g.mixf(scuffs, 0.5, 0.8), creases, strength=0.35, distance=0.001)


def ceramic(name="ceramic", colour=(0.62, 0.55, 0.42), **world):
    """Heat ceramic, bone-coloured: hairline cracks, chipped edges, soot."""
    g = Graph(name, **world)
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


def iron(name="iron", colour=(0.3, 0.25, 0.2), **world):
    """Worked iron: rust blooming in patches and running down, polished edges."""
    g = Graph(name, **world)
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


def paint(name="paint", **world):
    """Team paint over iron: 45% grey, chipped through at edges, scratched, dusty.

    The chips are iron-coloured and so much darker, which the game turns into
    darker paint -- close enough to bare metal at the size anything is seen.
    """
    g = Graph(name, **world)
    chips = g.math("MULTIPLY", g.edges(0.005), g.band(g.noise(140, detail=4), 0.4, 0.55))
    scratches = g.band(g.noise(60, detail=2, vector=g.stretched(1, 1, 25)), 0.62, 0.66)
    dust = g.band(g.noise(35, detail=5), 0.5, 0.85)
    grime = g.math("SUBTRACT", 1.0, g.occlusion(0.005))

    c = g.mix(g.math("MULTIPLY", dust, 0.4), (0.45, 0.45, 0.45), (0.36, 0.34, 0.31))
    c = g.mix(g.math("MAXIMUM", chips, g.math("MULTIPLY", scratches, 0.8)), c, (0.1, 0.085, 0.07))
    c = g.mix(g.math("MULTIPLY", grime, 0.5), c, (0.06, 0.055, 0.05))
    height = g.math("SUBTRACT", 1.0, g.math("MAXIMUM", chips, scratches))
    return g.finish(c, g.mixf(chips, 0.6, 0.45), height, strength=0.4, distance=0.001)


def rubber(name="rubber", **world):
    """Hoses, soles, seals: near black, matt, a little ash in the grain."""
    g = Graph(name, **world)
    grain = g.noise(400, detail=3)
    c = g.mix(g.math("MULTIPLY", grain, 0.5), (0.045, 0.04, 0.036), (0.09, 0.085, 0.078))
    return g.finish(c, 0.88, grain, strength=0.15, distance=0.0005)


def directorate_surfaces(**world):
    """The figure surfaces. A building passes `scale` and `ash`; see Graph."""
    return {
        "canvas": canvas(**world),
        "leather": leather(**world),
        "ceramic": ceramic(**world),
        "iron": iron(**world),
        "paint": paint(**world),
        "rubber": rubber(**world),
    }


# ---------------------------------------------------------------------------
# The Directorate's structures. UNIVERSE.md names these as the surfaces that
# arrive with the buildings: rockcrete for the apron, plate for the hull, grate
# for the decking. Hazard marking is the Directorate's, worn down to ghosts.
# ---------------------------------------------------------------------------

def plate(name="plate", colour=(0.25, 0.2, 0.155), **world):
    """Hull armour cut off something larger and welded back up.

    Nothing about it is new: neighbouring plates came off different wrecks and
    do not match in tone, rust bleeds down from every seam, the cut edges are
    torch-scorched, and wherever something rubs the metal shows through.
    """
    g = Graph(name, **world)
    tone = g.band(g.noise(6, detail=2), 0.3, 0.7)
    rust = g.band(g.noise(50, detail=6, distortion=0.4), 0.52, 0.75)
    runs = g.band(g.noise(30, vector=g.stretched(10, 10, 1)), 0.5, 0.78)
    scorch = g.math("MULTIPLY", g.edges(0.012), g.band(g.noise(25), 0.35, 0.65))
    polish = g.math("MULTIPLY", g.edges(0.003), 0.7)
    pitting = g.noise(400, detail=3)
    grime = g.math("SUBTRACT", 1.0, g.occlusion(0.008))

    c = g.mix(tone, [v * 1.18 for v in colour], [v * 0.72 for v in colour])
    c = g.mix(g.math("MULTIPLY", pitting, 0.25), c, [v * 0.6 for v in colour])
    c = g.mix(g.math("MAXIMUM", rust, g.math("MULTIPLY", runs, 0.7)), c, (0.2, 0.08, 0.03))
    c = g.mix(g.math("MULTIPLY", scorch, 0.8), c, (0.045, 0.032, 0.024))
    c = g.mix(polish, c, (0.4, 0.36, 0.31))
    c = g.mix(g.math("MULTIPLY", grime, 0.6), c, (0.025, 0.02, 0.015))
    roughness = g.mixf(polish, g.mixf(rust, 0.6, 0.9), 0.35)
    height = g.math("ADD", g.math("MULTIPLY", pitting, 0.5), rust)
    return g.finish(c, roughness, height, strength=0.3, distance=0.001)


def rockcrete(name="rockcrete", colour=(0.16, 0.12, 0.085), **world):
    """Poured slab: aggregate in the face, hairline cracks, oil and soot stains,
    corners knocked off. Laid in a grid, which here is the point."""
    g = Graph(name, **world)
    aggregate = g.noise(300, detail=2)
    mottle = g.band(g.noise(14, detail=4), 0.3, 0.7)
    cracks = g.cracks(14, 0.018)
    stains = g.band(g.noise(10, detail=6, distortion=0.5), 0.58, 0.8)
    knocks = g.math("MULTIPLY", g.edges(0.01), g.band(g.noise(60, detail=3), 0.4, 0.6))
    grime = g.math("SUBTRACT", 1.0, g.occlusion(0.01))

    c = g.mix(mottle, [v * 1.12 for v in colour], [v * 0.8 for v in colour])
    c = g.mix(g.band(aggregate, 0.55, 0.7), c, [v * 1.5 for v in colour])
    c = g.mix(g.math("MULTIPLY", stains, 0.85), c, (0.03, 0.025, 0.02))
    c = g.mix(g.math("MULTIPLY", cracks, 0.9), c, (0.02, 0.016, 0.012))
    c = g.mix(knocks, c, [v * 1.4 for v in colour])
    c = g.mix(g.math("MULTIPLY", grime, 0.6), c, (0.02, 0.016, 0.012))
    height = g.math("SUBTRACT", g.math("MULTIPLY", aggregate, 0.4), g.math("MAXIMUM", cracks, knocks))
    return g.finish(c, g.mixf(stains, 0.9, 0.6), height, strength=0.4, distance=0.002)


def grate(name="grate", colour=(0.14, 0.11, 0.085), **world):
    """Walkway decking: dark iron worn bright along the top of every bar."""
    g = Graph(name, **world)
    rust = g.band(g.noise(45, detail=5), 0.5, 0.75)
    worn = g.math("MULTIPLY", g.edges(0.004), g.facing_up(0.3, 0.8))
    grime = g.math("SUBTRACT", 1.0, g.occlusion(0.008))

    c = g.mix(rust, colour, (0.17, 0.07, 0.03))
    c = g.mix(worn, c, (0.36, 0.32, 0.27))
    c = g.mix(g.math("MULTIPLY", grime, 0.7), c, (0.015, 0.012, 0.01))
    return g.finish(c, g.mixf(worn, g.mixf(rust, 0.65, 0.9), 0.35), rust, strength=0.25, distance=0.001)


def hazard(name="hazard", **world):
    """Hazard stripes, bone on soot, scuffed down to ghosts where boots and
    loads have passed over them for years."""
    g = Graph(name, **world)
    stripes = g.stripes(12)
    wear = g.band(g.noise(30, detail=6, distortion=0.3), 0.42, 0.68)
    chips = g.math("MULTIPLY", g.edges(0.006), g.band(g.noise(120, detail=4), 0.4, 0.55))
    grime = g.math("SUBTRACT", 1.0, g.occlusion(0.008))

    painted = g.math("MULTIPLY", stripes, g.math("SUBTRACT", 1.0, g.math("MULTIPLY", wear, 0.8)))
    c = g.mix(painted, (0.05, 0.042, 0.035), (0.46, 0.39, 0.28))
    c = g.mix(g.math("MAXIMUM", chips, g.math("MULTIPLY", wear, 0.35)), c, (0.2, 0.15, 0.11))
    c = g.mix(g.math("MULTIPLY", grime, 0.6), c, (0.02, 0.016, 0.012))
    height = g.math("SUBTRACT", 1.0, chips)
    return g.finish(c, g.mixf(wear, 0.6, 0.85), height, strength=0.3, distance=0.001)


def slag(name="slag", colour=(0.035, 0.03, 0.027), **world):
    """Vitrified furnace waste (UNIVERSE.md): black clinker froth, glassy where it
    cooled fast, rust bled out of its iron, and cracked by the heat still under
    it. Dumped, not eroded."""
    g = Graph(name, **world)
    froth = g.noise(120, detail=6, distortion=0.6)
    glass = g.band(g.noise(40, detail=3), 0.55, 0.7)
    rust = g.band(g.noise(18, detail=5, distortion=0.5), 0.55, 0.8)
    cracks = g.cracks(20, 0.025)
    grime = g.math("SUBTRACT", 1.0, g.occlusion(0.01))

    c = g.mix(g.band(froth, 0.3, 0.7), colour, [v * 2.4 for v in colour])
    c = g.mix(g.math("MULTIPLY", rust, 0.8), c, (0.15, 0.055, 0.022))
    c = g.mix(cracks, c, (0.012, 0.01, 0.008))
    c = g.mix(g.math("MULTIPLY", grime, 0.5), c, (0.01, 0.008, 0.006))
    height = g.math("SUBTRACT", froth, g.math("MULTIPLY", cracks, 0.8))
    return g.finish(c, g.mixf(glass, 0.85, 0.25), height, strength=0.6, distance=0.002)


def structure_surfaces(scale, ash=1.0):
    """Everything a Directorate building is made of, sized for `scale`."""
    world = {"scale": scale, "ash": ash}
    return {
        **directorate_surfaces(**world),
        "plate": plate(**world),
        "rockcrete": rockcrete(**world),
        "grate": grate(**world),
        "hazard": hazard(**world),
        "slag": slag(**world),
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


def bake_device():
    """The GPU if Cycles can use one, else the CPU.

    Every surface samples ambient occlusion several times per texel, so a
    building's 2048 texture on the CPU is an afternoon. The noise is the same
    on either device; only the sampling grain differs, below what a texture
    this size can show. RTS_BAKE_DEVICE=CPU forces the CPU.
    """
    if os.environ.get("RTS_BAKE_DEVICE", "").upper() == "CPU":
        return "CPU"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
    except KeyError:
        return "CPU"
    for backend in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
        try:
            prefs.compute_device_type = backend
        except TypeError:
            continue
        prefs.get_devices()
        gpus = [d for d in prefs.devices if d.type == backend]
        if gpus:
            for device in prefs.devices:
                device.use = device.type == backend
            print(f"bake: {backend} on {', '.join(d.name for d in gpus)}")
            return "GPU"
    return "CPU"


def bake(obj, kit, name, size=1024, keep=("lamp",), samples=32):
    """Bake every surface on `obj` into colour, roughness and normal images, then
    replace them with one material reading those images.

    Materials named in `keep` are left as they are -- lights, which cannot be
    baked into a colour -- and still exported as their own material.
    """
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = bake_device()
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
        started = time.time()
        bpy.ops.object.bake(type=bake_type, pass_filter=passes)
        print(f"bake: {name} {kind} {size}px in {time.time() - started:.0f}s")
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
