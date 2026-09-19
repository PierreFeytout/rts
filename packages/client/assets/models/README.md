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

## The quality bar

**No model ships below the level of detail of the Conscript**
(`scripts/models/conscript.py`). That applies to every unit and building, for
both races, new or reworked. The bar is:

- **Modelled detail, not blocks.** The Conscript is about ninety pieces and uses
  its whole triangle budget: hood, hinged visor, filter and hose, shingled
  apron, straps, pouches, pads, boots, and a weapon with a drum, a shroud and
  coils. A model assembled from a dozen boxes is a placeholder, not a model.
- **Baked textures, never flat colours.** Colour, roughness and normal maps
  baked from the procedural surfaces in `scripts/models/surfaces.py`, with wear,
  grime, chipped edges and relief.
- **One baked material, plus one for anything that glows**, with the team mask
  kept as a vertex attribute.
- **Checked in the game**, at playing zoom and close up, before it is called
  done. Previews rendered in Blender are not enough.

The built-in silhouettes are below the bar by design: they are the floor a
type stands on before it has a model, never a reference.

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
wrong. `scripts/models/beast.py` holds what the Verdigris's beasts share:
jointed legs, tails, the crust along a spine, and the poses a leg takes in
a stride. `scripts/models/growth.py` holds what its structures share: tubes
swept along curves, lathes, the terraces a crust grows in, blobs, bubbles,
drips and the bloom's crystals -- the organic geometry a colonised machine is
grown from.

**Textures are baked, not painted.** `scripts/models/surfaces.py` has the
factions' surfaces as procedural node trees — canvas with a weave, leather,
cracked ceramic, rusting iron, chipped team paint, rubber — drawing wear from
noise and edge detection. A script builds a model in those, unwraps it once,
and bakes everything with Cycles into a colour, roughness and normal map. The
model ships with a single material reading them, plus one untextured material
for anything that glows, so however many surfaces a model has it costs two draw
calls. A bake takes under a minute for a figure, and runs on the GPU when Cycles
finds one -- a building's larger texture needs it (`RTS_BAKE_DEVICE=CPU`
forces the CPU). `RTS_TEXTURE_SIZE=256` makes trial runs quicker, and the
images are also written to `art/previews/textures/`.

**Structures are built at their real footprint** and shrunk into the unit box
at the end (see Size below), so that the surfaces' wear is sized in tiles like
everything else; `surfaces.structure_surfaces(scale=...)` enlarges every noise
and distance by that factor, and adds settled ash on everything facing up.

Two things to know when writing surfaces. Texture coordinates are object space
in tiles, so noise scales run into the hundreds on a figure half a tile tall.
And pieces of a scripted model interpenetrate, so baked ambient occlusion has
to reach only millimetres, or anything seated in anything else bakes black.

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

A structure with no `build` clip rises out of the ground while under
construction by being scaled from the base up, so it should read sensibly
squashed. One with a `build` clip is drawn at full size and the clip shows the
construction instead -- which every shipped building should have; see
Structures below.

## Budget

| | Triangles | Materials |
|---|---|---|
| Unit | 36,000 | 4 |
| Structure | 36,000 | 4 |

Four hundred units can be on screen at once, and **triangles are the cheap
axis**: every copy of a model is one instanced draw call per material however
detailed it is, and a skinned figure's bones are read from a baked texture
rather than solved per copy. A squad of three heavy troopers costs the same
number of draw calls as one light one. Spend the triangles.

Each **material**, on the other hand, is a separate draw call for every
distinct model on screen, and that is what falls over at four hundred units:
three materials is fine, a material per panel is not. The triangle numbers
above are there to catch a model that has gone somewhere absurd, not to stop
one being detailed. Both figures are sized for the Verdigris: its beasts are
scaled and spiked all over and run to thirty thousand, and its structures are
grown from tubes, lathes and terraces -- nothing on them is a box -- and run
about the same. An army never fields four hundred of those, and a few million
triangles a frame is what the instanced renderer is for.

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

  Any clip named `fire`, `attack`, `death`, `die`, `build` or `release` plays
  once; every other name loops. A missing clip falls back to `idle`, and a model
  with no clips at all is drawn in its bind pose.

  Structures are rigged the same way, and have clips of their own:

  | Clip | When | Plays |
  |---|---|---|
  | `build` | under construction | **scrubbed by construction progress**, not played in time: a site half built shows the clip's middle frame, however long it has taken. Its last frame should be the finished building at rest |
  | `idle` | standing | looped |
  | `produce` | anything in its production queue | looped |
  | `release` | each time a unit it made comes out | once, then back to `produce` or `idle` |

  A structure that attacks also has, by what it is:

  | Clip | When | Plays |
  |---|---|---|
  | `aim` | a turret, standing | **chosen by heading**, not played: one full turn of the turret, anticlockwise seen from above, starting facing +X. The renderer shows the frame for the direction to its target, traversing at a limited rate, and sweeps slowly either side of its last heading when it has none |
  | `aim_fire` | each shot | the same turn with the barrel recoiled, blended in at the same heading for the shot's kick. Same length as `aim`, and differing from it only by the recoil |
  | `fire` | each shot, for anything that attacks but does not aim | once, then back to what it was doing |

  `aim` is how a turret turns independently of its base, which a clip shared by
  every copy of a model otherwise cannot do: every turret on the map is still
  one draw call (packages/client/src/aim.ts). Key it every 30 degrees or so,
  linear; `scripts/models/gun_nest.py` is the example.

  A structure with a `build` clip is drawn at full size throughout its
  construction, and the clip is the whole of how progress is shown; one without
  rises out of the ground as before. `scripts/models/bastion.py` is the
  example: its hull drops onto the apron, the legs deploy, the tower runs up.
- **Key at 30 frames per second.** That is the rate clips are baked at; a
  one-frame recoil keyed at 24 fps falls between two baked frames.
- **Rotation is what animates well.** Keys are baked exactly, but the shader
  blends between baked frames linearly, which is invisible for a limb and
  noticeable for a whole figure spinning through half a turn in one frame.
  Location and scale bake exactly too, and blend without any such artefact: a
  hull dropping from the sky or a shutter squashed up into its housing is fine.
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

### Smoke

A structure says where it smokes with a custom property **`rts_smoke`** on
its armature, three numbers per stack in Blender axes and in the unit box:

    [forward, left, up,  forward, left, up, ...]

the mouth of each stack after the rig is shrunk to `1 / footprint`. While the
building stands finished and in view, the game draws soft puffs rising from
each point, a few a second per stack and twice as many while it has work
queued (`packages/client/src/chimney-smoke.ts`). Presentation only: nothing
in the simulation knows. `scripts/models/foundry.py` is the example.

## Structures

`scripts/models/bastion.py` is the reference for every building: read it before
starting one. What it established, and what each new structure follows:

**Scale and textures**

- **Built in tiles at the real footprint** (a footprint of 4 is ±2), textured
  and baked there, then shrunk by setting the armature's scale to
  `1 / footprint`. The game multiplies it back up.
- **`surfaces.structure_surfaces(scale=6.0)` for every structure**, whatever its
  footprint. The scale is the size of wear relative to a figure, not to the
  building, so one value keeps rust, chips and grime the same size across the
  whole base.
- **Texture size follows footprint**, to keep the texel density the same:
  2048 for a footprint of 3 or 4, 1024 for 2.
- **Every Directorate building carries its motifs** (UNIVERSE.md, Surfaces):
  the plate grid and its bolts come from the textures, on every face of
  every part, for nothing. Hazard edging the length of the two apron edges
  the camera sees, and a strip of `lamp` let into a lintel or an eave, are
  modelled -- a few boxes each -- and every shipped building has both.
- **A Verdigris structure is grown, not assembled.** `scripts/models/heartrot.py`
  is its reference: `surfaces.verdigris_surfaces(scale=4.0)`, geometry from
  `scripts/models/growth.py` (nothing on it is a box), crust terraces and
  veins to the footprint's edges, the bloom's crystals as its paint, the cold
  `lamp` from `kit.verdigris_palette` as its light, and something breathing in
  `idle`. Its `build` is emergence, never a drop: veins first, the machine
  rising in their grip, crust swelling over it, the blooms last.
- The game camera looks from **+X and -Y** (Blender axes). Doors, intakes,
  lights, paint and the finest detail go on those two faces; the far faces
  carry pipes and plates for the silhouette, cheaply.

**Readable at playing zoom**

At the default zoom a tile is about 25 pixels on a 1080p screen; fully zoomed
in, about 135. Anything that has to read in a match -- legs, a conveyor, a
ramp, a stack -- is at least 0.15 tiles thick. Rails, rivets and weld beads are
close-up detail and are allowed to vanish at playing zoom.

- Team paint on large, camera-facing surfaces: the Bastion's cab, lintel and
  leg struts. A stripe too small to see is no paint at all.
- Emissive windows and lamps are what make a building read as working and
  whose it is at a glance; every building has some.

**Budget**

The budget fills up fast with bevels and, on a Verdigris structure, with
tubes and lathes. Pieces nobody can see -- under the hull, inside another
piece, on the far side -- get no bevel, fewer segments, or are left out.
Count with `kit.report` before baking.

**Clips**

Every structure has `build`, `idle`, and, if it produces, `produce` and
`release`. They are keyed with `kit.track_clip`: one bone per moving assembly,
each piece weighted wholly to one bone, and location, scale and `stretch` (along
a bone) as well as rotation.

- **`build` says what the race is.** UNIVERSE.md: the Directorate's buildings
  are dropped, not built, so they arrive -- land, unfold, bolt down, run up.
  The Verdigris does not build, it grows through: its structures should
  spread over and out of what was already there.
- **`build` starts with something on the ground.** Progress 0 is visible the
  moment a site is placed: the Bastion's apron is there before its hull.
- **`build` keeps the building over its own footprint.** Anything hovering high
  above reads as a different building further up the screen; the Bastion's hull
  starts 3.2 tiles up, and at 6 it was mistaken for a second one.
- **`build` ends exactly at rest**, because it blends straight into `idle`.
- **Parts that only appear during a clip are hidden inside the model at rest**
  (the Bastion's thruster flames sit inside the hull), or scaled to 0 in every
  clip. The bind pose is what the portrait shows.
- **`produce` loops cleanly**: its first and last keys are the same pose, and
  anything that spins is keyed `linear` so it does not ease through every
  quarter turn.
- **The door is on +X, and so is `release`.** Units come out of a producing
  structure on its +X side, from the middle of that face outward
  (`spawnFromBuilding` in packages/sim/src/production.ts), so whatever opens
  to let them out -- a shutter, doors, a birth sac -- is there, centred. It is
  short: under two seconds, since a queue can finish a unit every few.

A research clip will follow the same pattern once the simulation has research.

## Checking a model in the game

`npm run dev`, start a skirmish, and drive the match from the console through
`window.__rts` (development builds only):

```js
const g = window.__rts;
g.rig.lookAtGround(x, z);            // centre on a tile
g.rig.viewHeight = 8; g.rig.zoomBy(1); // 8 is fully zoomed in, 44 the default; zoomBy applies it
g.step(n, commands);                  // advance the simulation n ticks, with commands
await g.capture("name", 1400);        // writes .captures/name.png
```

- **Render frames across real time before capturing an animation.** A hidden
  window does not run `requestAnimationFrame`, and each frame advances clips
  by at most 0.1 s; call `g.renderFrame()` every ~16 ms for as long as the
  clip should have played.
- **Construction** can be checked at any stage by writing
  `g.world.entities.buildRemaining[i]` for a site in a local skirmish: it is
  presentation-only checking, in a match nobody else is in.
- **Writing a `.glb` into this folder reloads the page** under the dev server,
  which ends the match. Rebuild first, then start the skirmish.
- The console logs each model's bones and clips at load, and warns about
  anything that breaks the rules here.

## Not supported yet

- **A unit's turret turning independently of its hull.** Structures can, with an
  `aim` clip (see above); units cannot yet, since their clips are already
  chosen by what the unit is doing and the renderer blends only two frames.
- **Death animations.** A unit that dies is removed from the world at once, and
  there is not yet anything to keep drawing its corpse.
- Multiple materials on one mesh. Split the mesh per material, or let the
  exporter do it; only the first material of a multi-material mesh is used.
- Transparency.
