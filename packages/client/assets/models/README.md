# Unit and building models

Drop a `.glb` in this folder and the game uses it. Nothing to register, nothing
to rebuild by hand beyond the normal build. Any type without a file is drawn as
its built-in silhouette, so a model can be added one unit at a time and the game
is never incomplete.

The game checks every file against the rules below when it loads, and prints
what is wrong as a warning naming the file — in the browser console, or in the
terminal when the desktop build runs with `RTS_VERBOSE=1`. A model that breaks a
rule still loads. It just looks wrong in the specific way the warning describes.

See UNIVERSE.md for what things should *look* like. This file is only about what
the engine needs.

---

## Naming

The file name is what the model replaces. The most specific one that exists wins.

| File | Draws | Use for |
|---|---|---|
| `vanguard.drone.glb` | exactly that unit | Almost everything. The name is the unit's **content id**, not its display name — see `packages/content/src/races/`. |
| `vanguard@worker.glb` | anything of that race in that role that has no model of its own | A faction's generic look, so a unit added later is drawn as that faction before anyone models it. |
| *(no file)* | the built-in silhouette for the role | Nothing to do. |

Roles: `worker`, `brawler`, `ranged`, `scout`, `heavy`, `hq`, `factory`,
`turret`, `extractor`, `support`, `resource`. A unit's role comes from what it
can do, not from its name — see `modelFor` in `packages/client/src/models.ts`.

Scenery is named the same way: `map.alloy-node.glb`, `map.vent.glb`.

Content ids are the internal names and never change, which is why files are named
after them. Display names do change — the Drone is called the Servitor now — and
a model named after one would silently stop matching.

## Exporting from Blender

*File → Export → glTF 2.0*, with:

| Setting | Value | Why |
|---|---|---|
| Format | glTF Binary (`.glb`) | One file, textures embedded. |
| Include → Limit to | Selected Objects | |
| Transform → +Y Up | on | The default. |
| Data → Mesh → Apply Modifiers | on | Bevels, mirrors and arrays are otherwise lost. |
| Data → Mesh → **Attributes** | **on** | Off by default, and without it the team mask is silently dropped. |

**Export from a scene that contains only the model, or with nothing selected in
any other scene.** Blender writes one glTF scene per Blender scene that has a
selection, and the game loads only the first. Which one comes first is not
something you choose, so when it is the wrong one the wrong model loads with no
error. The game warns about any file with more than one scene.

All of this was checked against a real export from Blender 5.2 rather than
assumed; the file is kept as a test fixture at
`packages/client/src/__fixtures__/blender-calibration.glb`, and
`blender-export.test.ts` fails if any of it stops being true.

## Axes and origin

- **+Y is up.** Blender's glTF exporter converts from Blender's Z-up by default;
  leave "+Y Up" ticked.
- **Units face +X.** In Blender that is facing along the red axis, to the right
  in the front view. A unit modelled facing -Y drives sideways.
- **The origin is the centre of the base, on the ground.** Nothing below y = 0,
  or it sinks into the terrain.

## Size

**Units are modelled at their real size**, in world units where one tile is one
unit. Roughly 0.6–0.9 across for infantry and light vehicles, up to about 1.4 for
the heaviest. Anything over 1.6 across is flagged: it will not fit through a gap
its own collision radius fits through, and it will overlap its neighbours in
every formation.

**Structures are modelled inside a 1 × 1 box**, ±0.5 on X and Z, and the game
scales them to their footprint. A Bastion with a footprint of 4 is authored one
unit wide and drawn four wide. Height is free, and is scaled by the same factor.
Modelling a structure at its real size is the likeliest mistake to make, and it
produces a building four times too large.

Structures rise out of the ground while under construction by being scaled from
the base up, so a structure should read sensibly squashed.

## Budget

| | Triangles | Materials |
|---|---|---|
| Unit | 3,000 | 4 |
| Structure | 8,000 | 4 |

Four hundred units can be on screen at once. Each **material** is a separate draw
call for every distinct model on screen, which costs far more than triangles do:
three materials is fine, a material per panel is not.

## Team colour

A model marks where it is painted in the owner's colour with a float attribute
named **`_TEAMMASK`** — 0 for bare material, 1 for paint.

In Blender: add an attribute in *Object Data Properties → Attributes*, named
`_TEAMMASK`, type *Float*, domain *Point* or *Face Corner*, and paint or set it
in Edit Mode. Export with **Include → Data → Attributes** enabled, or the
attribute is silently dropped. The leading underscore is not optional: glTF only
carries custom attributes whose names begin with one.

The paint takes its brightness from the surface underneath. Painted areas
authored at about **45% grey** come out as exactly the team colour; darker areas
come out as darker paint. So scratched, sooty or shadowed paint in a texture
stays scratched, sooty and shadowed in every player's colour — which is the point.
Paint the base colour grey under the mask, not blue or red.

Every unit and building needs *some* paint, or nobody can tell whose it is. The
game warns when a model has none.

## Materials

- Principled BSDF. It exports as a glTF PBR material and arrives in the game as
  exactly that. Other shaders are converted and will look different.
- Textures **embedded** in the `.glb` (the exporter's default for binary glTF).
- Vertex colours are honoured, and multiply with the base colour.
- Emission is honoured, and dims correctly in fog.

## Not supported yet

- **Animation of any kind.** Every mesh in the file is merged into its model's
  parts at load, transforms and all, so a turret parented to a hull is baked in
  place and cannot turn. Rigid-part animation (turret yaw, hover bob) needs named
  pivots and is the next thing to add. Skeletal animation — anything that walks —
  needs changes to how units are drawn, because four hundred instanced units and
  per-unit skeletons do not go together cheaply.
- Multiple materials on one mesh. Split the mesh per material, or let the
  exporter do it; only the first material of a multi-material mesh is used.
- Transparency.
