# The Ashworks

The setting, and the art direction that follows from it. This document is the
specification the assets implement — if a texture, a model or a colour does not
answer to something here, it is wrong.

---

## The world

A forge-world at the end of its usefulness.

For nine hundred years the Ashworks rendered a planet into materiel. The crust
was opened, cooked and poured; the slag went back onto the surface faster than
the surface could take it, until the original ground was a rumour somewhere
under four hundred metres of clinker. What you fight over is not land. It is the
accumulated waste of an industry that has already left.

The furnaces are not all out. That is the important part. Enough of them still
burn — unattended, fed by seams nobody mapped — that the sky is a low orange lid
and the night never gets properly dark. Ash falls continuously, the way snow
falls somewhere gentler. Everything is under a film of it.

**Nothing here is being built. Everything here is being taken apart.** A base is
not construction, it is salvage arranged into a shape that shoots. Armour is
plate cut off something larger. This is the single idea the art has to carry: if
a thing looks manufactured for its purpose, it is wrong. It should look *reused*.

### What you are fighting over

**Alloy** is not mined, it is *recovered* — scrap seams where a facility was
buried standing and its bones can be cut back out. The ore patches on a map are
exposed strata of compacted machinery.

**Plasma** comes from vents where the fires below reach the surface. Tapping one
is straightforward. Standing near one is not.

Neither is renewable and neither is enough. The Ashworks is not worth holding;
it is worth stripping before somebody else does.

---

## The two powers

Mechanics, costs and behaviours are unchanged — this is a reskin, not a
rebalance. What changes is what the player is told they are.

### The Ashen Directorate

The combine that owns the paperwork. It arrived to decommission the Ashworks,
found the decommissioning more profitable than the closure, and never left. It
fields conscripted labour under contracted officers, and it is very good at the
narrow problem of removing material from a place.

Institutional, bureaucratic, and cruel in the way a schedule is cruel. Its units
are numbered before they are named. Its buildings are prefabricated bastions
dropped onto cleared ground and bolted to whatever was underneath.

**Kinetic lines and explosive armour.** Iron, rust-bleed, hazard stripes worn
down to ghosts, stencilled serial numbers. Warm greys against the ash.

### The Verdigris

Something is growing back, and it is not plants.

The Verdigris is corrosion that has organised. It began in the cooling ponds as
a rot that ate copper, and it has spent a century learning the shape of the
things it consumes — which is why it now walks. It is green the way a corpse is
green: oxide bloom, wet bronze, the powdery blue-green that eats a statue.

It does not build. It *grows through*. A Verdigris structure is a piece of the
Ashworks that has been colonised and is now doing something else. Its soldiers
close to touching distance because that is how corrosion spreads.

**The one cold colour in the world**, and deliberately so. Verdigris green
against ember orange is the only strong contrast the palette allows, and it
always means the enemy is here.

---

## Art direction

### Palette

Everything is built from this. Nothing in the world is fully saturated and
nothing is pure black — ash scatters the furnace light into every shadow.

| Role | Hex | Where |
|---|---|---|
| `void` | `#0a0806` | Sky, background, the bottom of everything |
| `ash` | `#14100d` | Deepest surface tone, soot packed into crevices |
| `iron` | `#221b15` | Unlit metal, structure shadow |
| `rockcrete` | `#3a2a1c` | The buried ground, showing through thin ash. The most common colour in the game |
| `dust` | `#5a483a` | Raised surfaces catching ambient, ash drifts |
| `rust` | `#7a4a22` | Corrosion, oxidised iron, the second most common colour |
| `ember` | `#c46a28` | Furnace light, hot metal, the key light itself |
| `flame` | `#e8a04a` | Highlights only. Use sparingly or it stops meaning heat |
| `bone` | `#b8a894` | Stencils, markings, bare ceramic. The only near-neutral |
| `verdigris` | `#4a7a5e` | The Verdigris faction, and nothing else |
| `warning` | `#c4443a` | Damage, alarms, hazard. Never decorative |

**Rules.** No blues except as a weak cold rim to separate silhouettes from the
ground. No greens except Verdigris. No pure white anywhere — `bone` is the
ceiling. Saturation lives in the light, not in the surfaces: an object is drab
and the fire on it is not.

### Light

One warm key from a low angle, as though the horizon itself is the furnace. A
weak cold fill from above, which is the ash-scattered sky. Deep shadow that is
never neutral grey — always tinted toward `ash`.

Distance fog is warm and heavy. You should not be able to see the far side of a
large map, and the reason should read as airborne particulate rather than as a
render distance.

### Surfaces

Three questions any surface has to answer: **what was it, what happened to it,
and where has the ash settled.** Ash collects in every horizontal crevice and
nowhere vertical — that single rule does more for the look than any amount of
detail.

| Surface | What it is |
|---|---|
| `ashfield` | The ground. Not a floor — the original surface is four hundred metres down. Compacted ash and slag fines, drifted and trodden, cracked by the heat still coming up through it, with clinker fragments pressed into the top. |
| `slag` | The spoil heaps. Vitrified furnace waste, cooled into clinker and glassy black froth. Shot through with rust bleed where iron content weathered out, and still warm in the deep cracks. Sharp-edged and unnatural — these are dumped, not eroded. |

**No straight lines in the ground surface.** The first version of `ashfield` was
poured rockcrete slabs with expansion joints, which is a perfectly good
industrial floor and was completely wrong for the job. A texture that tiles a
hundred times across a map cannot contain a regular grid: at any zoom the joints
line up into a lattice stretching to the horizon, and no amount of macro
variation hides it. Organic noise has no such failure mode. The same rule will
apply to any future ground surface.

Rockcrete returns later as a **building apron** — a few tiles under a Bastion,
where it covers a small area, reads as deliberately laid, and the grid is an
asset rather than a liability. Along with it: `plate` (cut and rewelded hull
armour), `grate` (walkway decking over nothing), and `ceramic` (heat shielding,
the only place `bone` appears in quantity).

---

## Naming

All applied. They are display strings, and the content hash deliberately
ignores those — `content.test.ts` has a test named for it — so renaming them
changes nothing on the wire, invalidates no replay, and cannot desync a match.
Content *ids* (`vanguard.drone`, `map.alloy-node`) are unchanged and stay that
way: they are internal, no player sees them, and churning them would break every
saved replay for no visible gain.

### Maps

| Was | Is |
|---|---|
| Rift Basin | **Cinder Reach** |
| Sprawl | **The Long Sprawl** |

### The Ashen Directorate

| Was | Is | Why |
|---|---|---|
| Drone | **Servitor** | Labour, not a machine |
| Trooper | **Conscript** | Numbered before named |
| Scout | **Outrider** | |
| Hovertank | **Breaker** | Named for what it does to buildings |
| Command Nexus | **Bastion** | Dropped, not built |
| Extractor | **Vent Tap** | |
| Foundry | **Foundry** | Already correct |
| Supply Pylon | **Habstack** | Where the conscripts are kept |
| Turret | **Gun Nest** | |

### The Verdigris

| Was | Is | Why |
|---|---|---|
| Sporeling | **Creeper** | |
| Thornling | **Flenser** | It closes to touching distance |
| Sporecaster | **Blightcaster** | |
| Behemoth | **Behemoth** | Already correct |
| Heartwood | **Heartrot** | |
| Siphon | **Siphon** | Already correct |
| Grove | **Canker** | |
| Bloom | **Bloom** | Grim enough in this context |
| Barb | **Barb** | |

---

## Asset pipeline

Textures are **generated, not painted** — `scripts/generate-terrain.mjs` writes
seamlessly-tiling PNG sets into `packages/client/assets/terrain/`, the same way
`scripts/generate-map.mjs` writes the maps. The generator is committed alongside
its output, so a surface can be re-tuned by changing a number rather than by
repainting, and the files are ordinary PNGs that an artist can replace one at a
time without touching any code.

Every surface is built as a **height field first**, and its colour, normals and
occlusion are all derived from that. This is what makes the three maps agree:
author an albedo and a normal map separately and you get a surface where the
lighting and the staining describe different rock. Derive them and the ash is
*in* the crack it is drawn in.

Each surface ships three maps, which is the glTF convention:

| File | Channels | Read as |
|---|---|---|
| `*_albedo.png` | RGB | Base colour, sRGB |
| `*_normal.png` | RGB | Tangent-space normal |
| `*_orm.png` | R / G / B | Ambient occlusion / roughness / metalness |

Packing occlusion, roughness and metalness into one image is not a size trick —
three.js reads exactly those channels from `aoMap`, `roughnessMap` and
`metalnessMap`, so one file and one texture unit serves all three.

**Nothing about any of this reaches the simulation.** Materials, textures and
lighting are presentation, like fog memory and the minimap. The cost grid still
knows only `walkable`, `blocked` and `structure`, and two peers rendering the
same match with different graphics settings still agree on every hash.
