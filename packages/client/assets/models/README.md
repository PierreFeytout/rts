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

## Models built by script

The shipped models are Python scripts in `scripts/models/`, run in Blender
without its interface:

```bash
blender -b --factory-startup --python scripts/models/servitor.py
```

Each builds its model from nothing, exports the `.glb` here, saves a `.blend` to
`art/models/`, and renders preview images lit like the game (to
`art/previews/`, or wherever `RTS_PREVIEW_DIR` points). `scripts/models/kit.py`
holds what they share: the faction palettes, the team mask, bevels, and an
export using exactly the settings below — so a scripted model cannot get them
wrong.

**The script is the source, and it overwrites both files every run.** To take a
model further by hand, open its `.blend`, work on it there, export from Blender
with the settings below, and stop running its script — or the next run replaces
the hand work with the generated version.

`shipped-models.test.ts` loads every `.glb` in this folder and fails if one is
named after nothing the game draws, holds more than one scene, or breaks any
rule below.

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

## Animation and squads

A model with an armature is **skinned**, and animates. Everything else is static.

The game bakes every clip into a texture when it loads and plays them on the
GPU, so four hundred animated figures cost what four hundred static ones do. That
buys speed with a few rules:

- **One armature, and every mesh skinned to it.** A mesh merely parented to a
  bone is left out, with a warning naming it. For hard pieces -- a rifle, a
  helmet, a shoulder plate -- weight the whole piece to one bone at 1.0 instead
  of parenting it. `kit.rigid_part` in scripts/models does exactly that.
- **Clips are actions, named for what they are.** The game plays:

  | Clip | When | Plays |
  |---|---|---|
  | `idle` | standing | looped |
  | `walk` | moving | looped, sped up or slowed to match the unit's speed |
  | `fire` | on every shot | once, then back to `idle` or `walk` |

  Any clip named `fire`, `attack`, `death` or `die` plays once; every other name
  loops. A missing clip falls back to `idle`, and a model with no clips at all
  is drawn in its bind pose.
- **Key at 30 frames per second.** That is the rate clips are baked at; a
  one-frame recoil keyed at 24 fps falls between two baked frames.
- **Rotation is what animates well.** Keys are baked exactly, but the shader
  blends between baked frames linearly, which is invisible for a limb and
  noticeable for a whole figure spinning through half a turn in one frame.
- Export with **Animation → Mode: Actions**, **Skinning** on, and **Apply
  Modifiers off** -- applying the armature modifier bakes a pose into the mesh.
  Apply any other modifier (a bevel) by hand before exporting, or it is lost.
  Keep each action on its own NLA track so the exporter finds all of them.

### Squads

One entity can be drawn as several figures -- a squad of three Conscripts is one
unit with one health bar. Put a custom property **`rts_squad`** on the armature
(or any object) holding three numbers per figure:

    [forward, left, phase,  forward, left, phase, ...]

`forward` and `left` are the figure's offset from the unit's centre in Blender
axes; `phase` (0 to 1) starts its loops part-way through, so the squad does not
march in lockstep. Export with **Include → Custom Properties** on. As the unit
takes damage the squad thins, the last figure standing until it dies. The whole
squad has to fit the unit budget's width.

`scripts/models/calibration_rig.py` is the smallest complete example, and
`src/blender-rig.test.ts` checks what it exports.

## Not supported yet

- **Rigid-part animation without a skeleton** -- a turret that turns to face its
  target independently of its hull. Clips play the same for every copy of a
  model, so nothing can aim a bone per unit; for now a turret faces where its
  hull does.
- **Death animations.** A unit that dies is removed from the world at once, and
  there is not yet anything to keep drawing its corpse.
- Multiple materials on one mesh. Split the mesh per material, or let the
  exporter do it; only the first material of a multi-material mesh is used.
- Transparency.
