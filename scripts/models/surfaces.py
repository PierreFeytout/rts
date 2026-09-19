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
        self._facing = None

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

    # -- plates ---------------------------------------------------------------
    #
    # A Directorate structure is plate: sheets cut off something larger and
    # welded back up in a grid, bolted at the corners (UNIVERSE.md, Surfaces).
    # The joints and the bolts are drawn here rather than modelled, so that
    # every plate of every building carries them at no triangle cost, in
    # object space so they are sized in tiles like the wear. Each face draws
    # only the two axes that run across it, chosen by its normal, so a wall,
    # a deck and a sloped hull are all gridded and none of them is streaked.

    def facing(self):
        """|nx|, |ny|, |nz| of the surface normal: how squarely a face looks down each axis."""
        if self._facing is None:
            normal = self.node("ShaderNodeNewGeometry").outputs["Normal"]
            sep = self.node("ShaderNodeSeparateXYZ", {"Vector": normal})
            self._facing = tuple(self.math("ABSOLUTE", sep.outputs[i]) for i in range(3))
        return self._facing

    def cells(self, scale, offset):
        """Object coordinates in plate units: `scale` plates per tile, at figure scale.

        Offset so that no joint runs through the origin planes, where most
        parts of a model are centred and a joint would split every one of
        them down the middle.
        """
        sep = self.node("ShaderNodeSeparateXYZ", {"Vector": self.coords()})
        return tuple(
            self.math("ADD", self.math("MULTIPLY", sep.outputs[i], scale / self.scale, clamp=False), offset,
                      clamp=False)
            for i in range(3)
        )

    def seams(self, scale, width, offset=0.37):
        """1 along the joints between plates, `width` tiles wide at figure scale."""
        lines = []
        for axis, square in zip(self.cells(scale, offset), self.facing()):
            f = self.math("FRACT", axis, clamp=False)
            d = self.math("MINIMUM", f, self.math("SUBTRACT", 1.0, f, clamp=False), clamp=False)
            line = self.band(d, width * scale, width * scale * 0.4)
            lines.append(self.math("MULTIPLY", line, self.math("SUBTRACT", 1.0, square)))
        return self.math("MAXIMUM", self.math("MAXIMUM", lines[0], lines[1]), lines[2])

    def studs(self, scale, radius, inset=0.09, offset=0.37):
        """1 in a round bolt head just inside each corner of every plate of `seams(scale)`."""
        near = []
        for axis in self.cells(scale, offset):
            f = self.math("FRACT", axis, clamp=False)
            a = self.math("ABSOLUTE", self.math("SUBTRACT", f, inset, clamp=False), clamp=False)
            b = self.math("ABSOLUTE", self.math("SUBTRACT", f, 1.0 - inset, clamp=False), clamp=False)
            near.append(self.math("MINIMUM", a, b, clamp=False))
        r = radius * scale
        heads = []
        for (u, v), square in zip(((1, 2), (0, 2), (0, 1)), self.facing()):
            d = self.math("SQRT", self.math("ADD", self.math("MULTIPLY", near[u], near[u], clamp=False),
                                             self.math("MULTIPLY", near[v], near[v], clamp=False), clamp=False),
                          clamp=False)
            heads.append(self.math("MULTIPLY", self.band(d, r, r * 0.5), square))
        return self.math("MAXIMUM", self.math("MAXIMUM", heads[0], heads[1]), heads[2])

    def plates(self, scale, offset=0.37):
        """A random value per plate of `seams(scale)`, constant across the plate:
        sheets off different wrecks do not match in tone."""
        cell = [self.math("FLOOR", a, clamp=False) for a in self.cells(scale, offset)]
        facing = self.facing()
        tones = []
        for (u, v), square in zip(((1, 2), (0, 2), (0, 1)), facing):
            vec = self.node("ShaderNodeCombineXYZ", {"X": cell[u], "Y": cell[v], "Z": float(u + v)}).outputs["Vector"]
            value = self.node("ShaderNodeTexWhiteNoise", {"Vector": vec}, noise_dimensions="3D").outputs["Value"]
            tones.append(self.math("MULTIPLY", value, square))
        total = self.math("ADD", self.math("ADD", facing[0], facing[1], clamp=False), facing[2], clamp=False)
        mixed = self.math("ADD", self.math("ADD", tones[0], tones[1], clamp=False), tones[2], clamp=False)
        return self.math("DIVIDE", mixed, total)

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
        # Grey with the furnace's warmth in it, not brown: on a structure's cold
        # steel a brown drift read as the metal itself having rusted through.
        ash = self.mix(self.noise(350, detail=2), (0.085, 0.075, 0.065), (0.14, 0.128, 0.115))
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


def iron(name="iron", colour=(0.3, 0.25, 0.2), bright=(0.42, 0.38, 0.33), rusted=(0.5, 0.72), **world):
    """Worked iron: rust blooming in patches and running down, polished edges.

    `bright` is the bare metal the polished edges show: warm for the figures'
    iron, neutral for a structure's steel. `rusted` is where in the noise the
    rust starts and is total; a structure's is set a little later, so a pod or
    a stack reads as steel with rust on it rather than the other way round.
    """
    g = Graph(name, **world)
    rust = g.band(g.noise(70, detail=6, distortion=0.3), *rusted)
    runs = g.band(g.noise(40, vector=g.stretched(8, 8, 1)), 0.55, 0.8)
    polish = g.math("MULTIPLY", g.edges(0.004), 0.9)
    pitting = g.noise(500, detail=3)
    grime = g.math("SUBTRACT", 1.0, g.occlusion(0.005))

    c = g.mix(g.math("MULTIPLY", pitting, 0.3), colour, [v * 0.7 for v in colour])
    c = g.mix(g.math("MAXIMUM", rust, g.math("MULTIPLY", runs, 0.6)), c, (0.22, 0.085, 0.03))
    c = g.mix(polish, c, bright)
    c = g.mix(g.math("MULTIPLY", grime, 0.5), c, (0.03, 0.025, 0.02))
    roughness = g.mixf(polish, g.mixf(rust, 0.55, 0.9), 0.3)
    return g.finish(c, roughness, g.math("ADD", pitting, rust), strength=0.3, distance=0.0008, metallic=0.3)


def paint(name="paint", panels=0, **world):
    """Team paint over iron: 45% grey, chipped through at edges, scratched, dusty.

    The chips are iron-coloured and so much darker, which the game turns into
    darker paint -- close enough to bare metal at the size anything is seen.

    With `panels`, the paint is over plate (see `plate`): the joints and bolts
    show through it, as dark and as slightly darker paint.
    """
    g = Graph(name, **world)
    chips = g.math("MULTIPLY", g.edges(0.005), g.band(g.noise(140, detail=4), 0.4, 0.55))
    scratches = g.band(g.noise(60, detail=2, vector=g.stretched(1, 1, 25)), 0.62, 0.66)
    dust = g.band(g.noise(35, detail=5), 0.5, 0.85)
    grime = g.math("SUBTRACT", 1.0, g.occlusion(0.005))

    c = g.mix(g.math("MULTIPLY", dust, 0.4), (0.45, 0.45, 0.45), (0.36, 0.34, 0.31))
    relief = g.math("MAXIMUM", chips, scratches)
    if panels:
        joints = g.seams(panels, 0.0045)
        bolts = g.studs(panels, 0.0055, inset=0.08)
        c = g.mix(bolts, c, (0.38, 0.38, 0.38))
        c = g.mix(joints, c, (0.04, 0.04, 0.04))
        relief = g.math("MAXIMUM", relief, g.math("SUBTRACT", joints, g.math("MULTIPLY", bolts, 0.8)))
    c = g.mix(g.math("MAXIMUM", chips, g.math("MULTIPLY", scratches, 0.8)), c, (0.1, 0.085, 0.07))
    c = g.mix(g.math("MULTIPLY", grime, 0.5), c, (0.06, 0.055, 0.05))
    height = g.math("SUBTRACT", 1.0, relief)
    return g.finish(c, g.mixf(chips, 0.6, 0.45), height, strength=0.4, distance=0.001)


def servo(name="servo", colour=(0.4, 0.39, 0.375), **world):
    """Machined steel: hydraulic rams, servo housings, actuator rods.

    The one surface on a Directorate figure that was made to a tolerance. Every
    other material here is worked, salvaged or worn -- iron rusts, canvas
    frays, ceramic chips -- and that is the whole reason this one exists: a
    powered frame reads as powered only if the mechanism in it is visibly
    finer than the armour bolted over it. So it is bright, nearly smooth, and
    sharply specular, with turning marks along its length and oil gathered
    where it enters a joint.

    Not clean, though. It is decades old and the ends of every ram, where the
    seal has given up, are rusting like everything else on this world.
    """
    g = Graph(name, **world)
    turning = g.band(g.noise(700, detail=2, vector=g.stretched(1, 1, 26)), 0.35, 0.65)
    scoring = g.band(g.noise(120, detail=2, vector=g.stretched(1, 1, 14)), 0.66, 0.78)
    polish = g.math("MULTIPLY", g.edges(0.003), 0.85)
    rust = g.math("MULTIPLY", g.band(g.noise(110, detail=5, distortion=0.3), 0.66, 0.86), 0.7)
    oil = g.math("SUBTRACT", 1.0, g.occlusion(0.006))

    c = g.mix(g.math("MULTIPLY", turning, 0.4), colour, [v * 0.76 for v in colour])
    c = g.mix(scoring, c, [v * 1.2 for v in colour])
    c = g.mix(rust, c, (0.21, 0.09, 0.035))
    c = g.mix(polish, c, (0.62, 0.6, 0.58))
    # Oil does not lighten steel, it darkens it and kills the reflection.
    c = g.mix(g.math("MULTIPLY", oil, 0.75), c, (0.035, 0.032, 0.03))
    roughness = g.mixf(polish, g.mixf(rust, 0.26, 0.8), 0.14)
    roughness = g.mixf(oil, roughness, 0.6)
    height = g.math("ADD", g.math("MULTIPLY", turning, 0.4), scoring)
    return g.finish(c, roughness, height, strength=0.15, distance=0.0005, metallic=0.85)


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


def armour_surfaces(**world):
    """A figure in a powered frame: the figure surfaces, plus the two a rig
    needs -- salvaged hull for the armour bolted over it, machined steel for
    the mechanism underneath. See the Conscript in UNIVERSE.md."""
    return {
        **directorate_surfaces(**world),
        # Warmer than a building's steel, and without its plate grid: this is
        # thinner stock, off smaller wrecks, cut to the figure rather than
        # welded up in sheets, and it has to separate from the ground a figure
        # stands on rather than from the sky a hull is seen against.
        "plate": plate(colour=(0.235, 0.215, 0.185), bright=(0.4, 0.36, 0.31), panels=0, **world),
        "servo": servo(**world),
    }


# ---------------------------------------------------------------------------
# The Directorate's structures. UNIVERSE.md names these as the surfaces that
# arrive with the buildings: rockcrete for the apron, plate for the hull, grate
# for the decking, hazard marking round every edge a Servitor could walk off.
#
# They are the one cold thing on Furnace Nine. The ground is warm ash under a
# warm key, and a building in the same browns vanished into it from the game
# camera; a base has to read from the air as something dropped onto the
# world, not grown out of it. So structure steel is gunmetal, blue-grey, and
# the warmth on it is the light, the rust and the hazard paint -- never the
# metal itself. See UNIVERSE.md, Palette, `steel`.
# ---------------------------------------------------------------------------

# Gunmetal: UNIVERSE.md's `steel`, in linear light.
STEEL = (0.115, 0.127, 0.145)
# The same, in the dark: fittings, pipes, frames, the underside of everything.
STEEL_DARK = (0.075, 0.082, 0.094)
# Bare metal where an edge is worn or a bolt is turned: what polished steel
# shows, cold, well short of white.
STEEL_BRIGHT = (0.36, 0.37, 0.38)
# Soot packed into a joint. Nothing on a structure is darker.
JOINT = (0.012, 0.012, 0.014)


def plate(name="plate", colour=STEEL, bright=STEEL_BRIGHT, panels=6, **world):
    """Hull armour cut off something larger and welded back up in a grid.

    Nothing about it is new: neighbouring plates came off different wrecks and
    do not match in tone, the joints between them are packed with soot, rust
    bleeds down from every joint and every bolt, the cut edges are worn
    bright, the corners torch-scorched. `panels` is how many plates to a tile
    at figure scale; 0 is a single sheet, which is what a figure's armour is.
    """
    g = Graph(name, **world)
    if panels:
        # Plates a tile across on a building, with joints and bolts sized to
        # still read at the middle zoom: a grid nobody can see from the game
        # camera is texture nobody paid for.
        tone = g.plates(panels)
        joints = g.seams(panels, 0.0045)
        bolts = g.studs(panels, 0.0055, inset=0.08)
    else:
        tone = g.band(g.noise(6, detail=2), 0.3, 0.7)
        joints = bolts = None
    rust = g.band(g.noise(50, detail=6, distortion=0.4), 0.6, 0.82)
    runs = g.math("MULTIPLY", g.band(g.noise(30, vector=g.stretched(10, 10, 1)), 0.5, 0.78),
                  g.band(g.noise(8, detail=3), 0.4, 0.7))
    scorch = g.math("MULTIPLY", g.edges(0.012), g.band(g.noise(25), 0.4, 0.7))
    polish = g.math("MULTIPLY", g.edges(0.003), 0.8)
    pitting = g.noise(400, detail=3)
    grime = g.math("SUBTRACT", 1.0, g.occlusion(0.008))

    c = g.mix(tone, [v * 0.68 for v in colour], [v * 1.3 for v in colour])
    c = g.mix(g.math("MULTIPLY", pitting, 0.2), c, [v * 0.6 for v in colour])
    c = g.mix(g.math("MAXIMUM", g.math("MULTIPLY", rust, 0.75), g.math("MULTIPLY", runs, 0.65)), c,
              (0.2, 0.08, 0.03))
    c = g.mix(g.math("MULTIPLY", scorch, 0.7), c, (0.03, 0.028, 0.026))
    height = g.math("MULTIPLY", pitting, 0.3)
    if panels:
        c = g.mix(bolts, c, [v * 1.15 for v in colour])
        c = g.mix(joints, c, JOINT)
        height = g.math("SUBTRACT", g.math("ADD", height, g.math("MULTIPLY", bolts, 0.7)), joints)
    c = g.mix(polish, c, bright)
    c = g.mix(g.math("MULTIPLY", grime, 0.6), c, (0.02, 0.02, 0.022))
    roughness = g.mixf(polish, g.mixf(rust, 0.55, 0.9), 0.3)
    if panels:
        roughness = g.mixf(joints, roughness, 0.95)
    return g.finish(c, roughness, height, strength=0.5, distance=0.0012)


def rockcrete(name="rockcrete", colour=(0.105, 0.108, 0.115), **world):
    """Poured slab, the way the Directorate lays a pad: cast in a grid of
    panels with the formwork ties still in the corners, cold grey under the
    ash, aggregate in the face, hairline cracks, oil and soot stains, the
    corners knocked off. Laid in a grid, which here is the point."""
    g = Graph(name, **world)
    tone = g.plates(8)
    joints = g.seams(8, 0.004)
    ties = g.studs(8, 0.0035, inset=0.08)
    aggregate = g.noise(300, detail=2)
    cracks = g.cracks(14, 0.018)
    stains = g.band(g.noise(10, detail=6, distortion=0.5), 0.58, 0.8)
    knocks = g.math("MULTIPLY", g.edges(0.01), g.band(g.noise(60, detail=3), 0.4, 0.6))
    grime = g.math("SUBTRACT", 1.0, g.occlusion(0.01))

    c = g.mix(tone, [v * 0.8 for v in colour], [v * 1.16 for v in colour])
    c = g.mix(g.band(aggregate, 0.55, 0.7), c, [v * 1.5 for v in colour])
    c = g.mix(g.math("MULTIPLY", stains, 0.85), c, (0.024, 0.023, 0.023))
    c = g.mix(g.math("MULTIPLY", cracks, 0.9), c, (0.015, 0.015, 0.016))
    c = g.mix(ties, c, (0.16, 0.09, 0.05))
    c = g.mix(joints, c, JOINT)
    c = g.mix(knocks, c, [v * 1.4 for v in colour])
    c = g.mix(g.math("MULTIPLY", grime, 0.6), c, (0.015, 0.015, 0.016))
    height = g.math("SUBTRACT", g.math("ADD", g.math("MULTIPLY", aggregate, 0.4), g.math("MULTIPLY", ties, 0.5)),
                    g.math("MAXIMUM", g.math("MAXIMUM", cracks, knocks), joints))
    return g.finish(c, g.mixf(stains, 0.9, 0.6), height, strength=0.4, distance=0.002)


def grate(name="grate", colour=STEEL_DARK, **world):
    """Walkway decking: a mesh of steel bars over nothing, the bars worn bright
    along their tops and black between them."""
    g = Graph(name, **world)
    bars = g.seams(60, 0.0032, offset=0.5)
    rust = g.band(g.noise(45, detail=5), 0.5, 0.75)
    worn = g.math("MULTIPLY", g.edges(0.004), g.facing_up(0.3, 0.8))
    grime = g.math("SUBTRACT", 1.0, g.occlusion(0.008))

    c = g.mix(rust, colour, (0.17, 0.07, 0.03))
    c = g.mix(worn, c, STEEL_BRIGHT)
    c = g.mix(g.math("SUBTRACT", 1.0, bars), c, (0.008, 0.008, 0.009))
    c = g.mix(g.math("MULTIPLY", grime, 0.7), c, (0.012, 0.012, 0.013))
    roughness = g.mixf(worn, g.mixf(rust, 0.6, 0.9), 0.35)
    return g.finish(c, roughness, bars, strength=0.6, distance=0.001)


def hazard(name="hazard", **world):
    """Hazard chevrons, furnace orange on soot black -- the Directorate paints
    its warnings in the one colour this world already glows -- scuffed down
    to ghosts where boots and loads have passed over them for years."""
    # Less ash than the rest of the building: a hazard mark under a full
    # drift was a brown line from the game camera, and the whole point of it
    # is to be the one thing on a pad that is seen from there.
    g = Graph(name, **{**world, "ash": world.get("ash", 0.0) * 0.35})
    stripes = g.stripes(14)
    wear = g.band(g.noise(30, detail=6, distortion=0.3), 0.5, 0.78)
    chips = g.math("MULTIPLY", g.edges(0.006), g.band(g.noise(120, detail=4), 0.4, 0.55))
    grime = g.math("SUBTRACT", 1.0, g.occlusion(0.008))

    painted = g.math("MULTIPLY", stripes, g.math("SUBTRACT", 1.0, g.math("MULTIPLY", wear, 0.55)))
    c = g.mix(painted, (0.03, 0.03, 0.03), (0.7, 0.3, 0.04))
    c = g.mix(g.math("MAXIMUM", chips, g.math("MULTIPLY", wear, 0.3)), c, (0.18, 0.12, 0.08))
    c = g.mix(g.math("MULTIPLY", grime, 0.6), c, (0.015, 0.014, 0.013))
    height = g.math("SUBTRACT", 1.0, chips)
    return g.finish(c, g.mixf(wear, 0.55, 0.85), height, strength=0.3, distance=0.001)


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


def vehicle_surfaces(scale):
    """A Directorate vehicle: a figure's surfaces for its frame, its rider and
    its rubber, and the structures' cold steel for everything that was cut off
    a hull -- a vehicle is a small building that moves, and it has to separate
    from the ground the same way. No settled ash: it moves, and sheds it.
    Plates finer than a building's, because the whole thing is a tile or two."""
    world = {"scale": scale, "ash": 0.0}
    return {
        "canvas": canvas(**world),
        "leather": leather(**world),
        "ceramic": ceramic(**world),
        "rubber": rubber(**world),
        "servo": servo(**world),
        "iron": iron(colour=STEEL_DARK, bright=STEEL_BRIGHT, rusted=(0.56, 0.78), **world),
        "paint": paint(panels=10, **world),
        "plate": plate(panels=10, **world),
        "grate": grate(**world),
        "hazard": hazard(**world),
    }


def structure_surfaces(scale, ash=0.6):
    """Everything a Directorate building is made of, sized for `scale`.

    The figure surfaces a building shares -- canvas, leather, ceramic, rubber
    -- as they are; iron and paint in the structures' cold steel; and the
    four that only a building has. Ash lies on it, but thinner than on the
    ground's scenery: a deck under a full drift was brown from the air, and
    the deck is most of what the camera sees of a building.
    """
    world = {"scale": scale, "ash": ash}
    return {
        "canvas": canvas(**world),
        "leather": leather(**world),
        "ceramic": ceramic(**world),
        "iron": iron(colour=STEEL_DARK, bright=STEEL_BRIGHT, rusted=(0.56, 0.78), **world),
        "paint": paint(panels=6, **world),
        "rubber": rubber(**world),
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
