# The Ashworks

The setting, and the art direction that follows from it. This document is the
specification the assets implement — if a texture, a model or a colour does not
answer to something here, it is wrong.

---

## The world

A forge-world at the end of its usefulness.

In the Directorate's registry it is **Furnace Nine**: a world assigned to
metallurgy, and for nine hundred years it did nothing else. To everyone who has
lived on it, it is the Ashworks.

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

#### Map resources

Scenery, not equipment -- there before either side arrived and belonging to
neither. Nothing here is painted a faction's colour, because no faction has
touched it yet; the only colour is what the thing itself is.

##### Alloy Node -- `map.alloy-node`

*Footprint 2. Yields alloy.*

- **Was:** whatever stood here nine hundred years ago. **Is:** a low scarp of
  clinker that has slumped and cracked open, showing a cross-section of what
  it buried: girders, gear wheels, plate, a burst pipe -- compacted machinery,
  not ore.
- **Silhouette:** an irregular mound, not a crystal cluster -- a patch of
  ground that has come apart, low enough to see over.
- **Detail:** the exposed face is the point: a jumble of half-buried structure
  cut through at an angle, torn plate edges, a gear half swallowed by slag,
  loose rubble at the foot of the scarp.
- **Paint:** the exposed metal only -- girders, gears, plate, pipe -- so it
  reads as the alloy against the dead slag around it.
- **Modelled** -- `scripts/models/alloy_node.py`.

##### Geothermal Vent -- `map.vent`

*Footprint 2. A marker: nothing to mine, but an Extractor or a Siphon can be
built on it.*

- **Was:** and **is:** a fissure where the furnaces below reach the surface --
  nothing built it and nothing has capped it yet.
- **Silhouette:** broken crust tilted up around a dark opening, low and
  irregular, easy to miss until the glow is seen.
- **Detail:** cracked slag radiating from the hole, ember light leaking
  through the cracks and pooling faintly at the rim. Whichever race caps it
  inherits this glow -- the Vent Tap and the Siphon both carry it into their
  own model, because the vent is consumed when either is built.
- **Paint:** the crust immediately around the opening, so the heat reads as
  part of the rock and not just the light sitting on top of it.
- **Modelled** -- `scripts/models/vent.py`.

### The war, and the moon

The Directorate did not keep Furnace Nine to itself. Another power disputed
it, and the planet became the ground they fought over -- a war long
enough to leave its own stratum in the clinker: wrecked war machines buried
where they stopped, gun-lines filled in by ash, hulls brought down out of orbit.
*That power is not described here yet; this document leaves room for it.*

Above the Ashworks hangs its moon, which the foundry crews called **the Sump**.
For centuries the forge-world fired its effluent there by mass driver -- spent
coolant, heavy-metal slurry, the sludge nothing on the surface could hold -- until
the Sump was a toxic sea under a poisoned sky. During the war the wreckage fell
on it too: ships, drop-hulls, the dead of both sides, and all their metal.

In that sea, over the generations since, something evolved. It is the
Verdigris, and it has come down.

---

## Other fronts

Furnace Nine is not the only claim in dispute. The Directorate runs an
administration the size of several star systems (see Who they are, below),
and its war with the Verdigris follows both of them wherever they have a
reason to be. Different maps can be different worlds -- not the same ash
with a new coat of paint, but a sector with its own weather, its own
geology, and its own reason for what is lying around on it. Two armies
built for one climate should look like they are visiting the other.

**The palette rule bends per world, not per whim.** Furnace Nine's "no
blue, no green" (see Art direction) is what nine hundred years of furnace
smoke does to a sky and a ground -- it is not a law of the setting itself.
A world with its own colour needs its own reason for it, argued the same
way Furnace Nine's was: what it was, what happened to it, and where the
wear collects. Not picked for contrast against the last map's tan.

The map resources stay the same everywhere -- Alloy recovered, Plasma
tapped -- because what a world's ground is made of changes and what two
armies need from it does not. Only the excuse for finding them changes
from world to world.

#### Cistern Four -- "the Deepfreeze"

In the registry, a cryo-reserve: built to keep in cold storage what could
not survive a furnace world's heat -- coolant stock for the whole
administration's forges, seed banks, war material mothballed against a
future nobody expected to need it. It held for centuries. A drifting orbit
and its own quakes have started cracking its seals, and what is inside is
worth exactly as much as anything under Furnace Nine's ash.

**What was it, what happened to it.** A world was chosen because it was
cold and stayed cold, and everything on it was buried in that cold on
purpose, in neat rows, to be found later. Later arrived as a war instead
of a requisition order. The rows are still there, but the ice that was
supposed to keep them safe is now what is cracking open to expose them --
the same story as Furnace Nine's slag, told in the opposite material.

**Where the wear collects.** Not ash -- rime, the frost that grows on
anything left out, thickest where the wind has had centuries to work.
Crevices fill with packed snow instead of soot; standing water does not
stain, it refreezes, which is its own kind of stain over enough winters.
The one warmth anywhere is where a reactor seal has failed: cracked ice
lit from underneath, ember-orange against blue-white, which reads as more
dangerous here than the same fire ever did against Furnace Nine's warm
ground -- because here it means something is not supposed to be burning.

**Alloy Nodes** here are exactly what they are on Furnace Nine -- exposed
strata of compacted machinery -- except what a scarp exposes is mothballed
war material still in its storage cradle, packed in rime instead of slag.
**Geothermal Vents** are not geothermal at all: they are where one of the
reserve's own cooling reactors has breached containment and is melting its
way out through the ice from below. Tapping one works exactly the same.
Standing near one is, if anything, a worse idea than on Furnace Nine.

**Surfaces.** The same five parts Furnace Nine's ground plays, in this
world's own material (see Art direction → Surfaces): `rime` is the ground,
the frost that grows on anything left out and fills every crevice. `ice` is
the coolant lakes frozen a long way down — plates of clear ice over deep
blue, buckled into white pressure ridges, the one glossy ground in the game.
`meltrock` is what a breached reactor has exposed underneath: dark wet slate
in angular plates, standing in meltwater, with the reactor's own heat in the
deepest cracks. `rockcrete` is the same Directorate pad as anywhere else,
glazed with frost in its joints. `scree` is the same collapse as Furnace
Nine's rubble with no shelling in it — nothing was fought over here yet, the
ice simply gave way — rimed on every upward face and bare underneath.

**Palette.** Furnace Nine's `void`, `iron`, `rust` and `warning` are
unchanged -- unlit metal is unlit metal and rust does not care what planet
it is on. `ash` becomes `rime`: a pale, cold blue-grey (`#7a8a94`) instead
of soot-black, standing in for the drift, the crevice-fill and the frost
everything is glazed in. `rockcrete` becomes `meltrock`: the exposed
ground under the ice, a darker slate-blue (`#2a343c`) rather than baked
earth. `dust` becomes `frost-bloom`, a lighter near-white blue-grey
(`#a8b8bc`) for raised surfaces rimed thickest. `ember` and `flame` stay
exactly as warm as they are on Furnace Nine -- the one deliberate colour
clash in the world, because a breached reactor should look like it does
not belong. This is the one blue permitted outside a rim light, and it is
permitted because it has just been argued for, the same as every other
colour in this document has to be.

---

## The two powers

Mechanics, costs and behaviours are unchanged — this is a reskin, not a
rebalance. What changes is what the player is told they are.

### The Ashen Directorate

The power that owns the paperwork. Furnace Nine is one of its worlds, spent,
and it has come back to strip what is left before the world is struck off the
registry. It fields conscripted labour under contracted officers, and it is
very good at the narrow problem of removing material from a place.

Institutional, bureaucratic, and cruel in the way a schedule is cruel. Its units
are numbered before they are named. Its buildings are prefabricated bastions
dropped onto cleared ground and bolted to whatever was underneath.

**Kinetic lines and explosive armour.** Iron, rust-bleed, hazard stripes worn
down to ghosts, stencilled serial numbers. Warm greys against the ash.

#### Who they are

The Directorate is not an army and does not think of itself as one. It is an
administration the size of several star systems, and it runs them the way a
registry runs anything: by function. **Every world is assigned a task and
named for it.** Furnace worlds smelt. Quarry worlds are dug for ore. Granary
worlds are farmed to the horizon to feed the rest. And the **city worlds**,
where the trillions live, are covered pole to pole in stacked habitation --
the reservoir every other world draws its labour from.

Each function has its own directorate, and the Directorate is all of them. The
**Ashen Directorate** is the office nobody asks to join: the one that takes
over a world once its function is spent, strips it, and closes the file.

Its frontier is worked by **prospectors** -- survey ships that go out to
systems nobody has visited, flag the worlds worth having, and drop the first
modules of a colony onto ground no one has stood on. The Ashen Directorate
uses the same ships and the same doctrine in reverse. Over Furnace Nine sits
**the Tender**, a prospecting hauler the size of a town, and it lowers
everything: prefabricated modules on drop-rated hulls, dropped onto ground a
survey crew has flagged, anchored, and switched on. When a sector is stripped
the modules are unbolted and lifted to the next one. A Directorate base is
never finished and never meant to be. It is a dig site with guns.

What reaches the surface is the **Contract Office** -- assessors,
quartermasters and contracted officers, each on a term, each paid on what
their sector ships before the term runs out. The office itself never comes
down.

**Labour is an asset class.** The city worlds export people the way Granary
worlds export grain, on labour contracts, numbered at embarkation. Furnace
Nine's workforce has been there for generations, born to the furnaces, and
was kept on for the strip-back with the rest of the inventory -- listed in the
same ledger as the machinery: a number, a grade, a depreciation schedule. Servitors are labourers wired into the harness of a
hauling rig until there is little to tell apart; Conscripts are the ones still
fit to carry a weapon. Nobody is paid. Everybody is owed.

**The schedule is the culture.** Shift sirens, not bugles. Quota boards, not
banners. Every object carries a stencilled number, and the officer reads the
number before the face. Cruelty here is never passion -- it is a line in a
spreadsheet that happens to be a person.

It has fought for this claim before, against the power that disputed it, and
it expects to again. It also fights itself: sectors are awarded to Contract
Offices that are paid against each other, and when two claims overlap they are
settled on the ground.

**What it wants** is simple: to ship more than the next sector before the term
ends. Alloy is the quota. Plasma powers the drop-hulls and the guns. The
Verdigris is, on paper, a **contamination event**: anything it touches is
written off, and anything written off is burned. Off the record it is the
thing the Directorate fears most, because every hauler that leaves Furnace Nine
goes somewhere -- and some of them go to city worlds.

**What its buildings look like** follows from all of that:

- **Dropped modules on drop-rated hulls.** Sloped armour, re-entry ceramic
  still on the lower edges, retro-thruster bells, lifting lugs where the Tender
  grapples them. Nothing is built on site.
- **Anchored to whatever is under them.** Landing legs, clamps, bolts driven
  through a rockcrete apron laid by the survey crew.
- **Reused, never new.** Plate from other wrecks welded over holes, mismatched
  panels, patches over patches. Serial numbers stencilled over older numbers.
- **Worked by people on shift.** Lit windows, work lamps, warning beacons,
  railings, ladders, hatches. A lit window means someone is on the clock.
- **Paint is ownership.** The owner's colour goes on the parts the Contract
  Office issues -- cabs, lintels, hull plates, leg struts -- never on salvage.
- **Construction is arrival**: the module comes down, unfolds, bolts itself
  in, and switches on.

#### The Conscript

They were foundry hands, welders, slag-sorters. When Furnace Nine was handed to
the Ashen Directorate its workforce was handed over with it, and a contracted
labourer costs less than a soldier. They were given a weapon and a number, in
that order.

A Conscript wears what they worked in, armoured. **A foundry hand does not
carry hull plate in their arms** — they wear a **loader frame** to do it, the
same class of powered exoskeleton a Servitor is wired into permanently, and
every one of them has spent their life in one. So when the Directorate armed
the workforce it did not issue armour. It bolted plate onto the frame they
already had, and issued the number.

That is what a Conscript is: **an old machine with new plate on it.**

- **The frame is older than the war.** Machined rams, servo housings and
  actuator rods at every joint — bright steel, the one thing on this world
  made to a tolerance, and rusting at every seal it has outlived.
- **The armour is salvage**, cut from hulls, mismatched panel to panel,
  scorched along the torch cuts, bolted over a frame it was never made for.
  Nothing is fitted. Everything laps and overhangs.
- **The helmet is still a welder's hood**, sealed now, with one horizontal
  lens burning ember where the eyes are.
- **The pack is a foundry pack**, vented hot over the shoulders.
- The weapon is still a site tool — a **rivet driver** re-bored to fire
  white-hot bolts, and heavy enough now that the frame is what holds it
  level. The contract number is stencilled on the backplate, where the
  officer reads it.

The silhouette is the point: **shoulders far wider than the hips, a small
sealed head sunk between them, and a heavy plant at the feet.** It should read
as something that weighs a great deal and was not built for this.

They fight in **squads of three**, and a squad thins as it takes losses. On the
field: bone-coloured helmets and aprons, the visor and shoulder plates in the
owner's paint, the visor lens and the driver's heating coils glowing ember. The
gun is long and held level, far out in front, because range is everything this
unit has.

### The Verdigris

Something is growing back, and it is not plants.

The Verdigris is corrosion that learned to think together. It evolved on the
Sump, in a sea of the Ashworks' own poison, feeding on the wreckage of a war, and
it has spent generations learning the shape of the things it consumes — which is
why it now walks. It is green the way a corpse is green: oxide bloom, wet bronze,
the powdery blue-green that eats a statue.

It does not build. It *grows through*. A Verdigris structure is a piece of the
Ashworks that has been colonised and is now doing something else. Its soldiers
close to touching distance because that is how corrosion spreads.

**The one cold colour in the world**, and deliberately so. Verdigris green
against ember orange is the only strong contrast the palette allows, and it
always means the enemy is here.

#### What it is

**Where it came from.** The Sump's sea was nothing but poison until the war
rained metal into it. Something in the slurry began eating the wrecks -- copper
first, then everything -- faster than chemistry should allow, and every body it
grew shared the same chemistry as every other. Over generations those bodies
stopped being separate. What lives on the Sump now is **one hive**: a single
slow mind distributed through every crust, vein and walking thing it has grown,
thinking in chemical signal the way a sea thinks in currents.

**It remembers shapes.** Whatever the hive corrodes, it learns, and rebuilds
out of its own crust -- approximately, and wrong. Its first teachers were the
wrecks of the war: it learned hulls, guns, drop-legs and treads before it ever
saw a pump. A crane it has eaten becomes something that reaches. A tank hull
becomes something that carries young. Every Verdigris form is an echo of a
machine, recast in oxide and wet bronze by a mind that understood what the
machine did but not how.

**It came down on purpose.** When the Sump's wrecks were eaten, the hive
reached for the place they had fallen from -- a whole planet of buried metal
and open heat. It rode down in what fell and what was hauled: salvage lifted
off the Sump's orbit and dropped onto the Ashworks by the Directorate's own
haulers. The Contract Office's official position is that this did not happen.

**A hive that splits.** The mind is chemical, and chemistry is slow. A colony
that grows far enough from the rest stops hearing it in time, and begins to
think for itself: **a brood**. Broods are the same hive and do not know it --
each is certain it is the whole, and competes for metal with every other brood
as fiercely as with the Directorate. That is what a Verdigris player is: one
brood.

**What it wants** is metal and heat. Alloy is food: its Creepers haul scrap
back to be dissolved. Plasma is warmth, and growth runs faster near a vent. The
hive does not hate the Directorate. It has noticed that the Directorate is a
great deal of metal that shoots back, and it has learned the shape of guns.

**Its units** are machinery it has digested and learned to walk: the
**Creeper**, a crawling hauler dragging scrap into its own body; the
**Flenser**, which closes to touching distance because corrosion spreads by
contact; the **Blightcaster**, which spits a slurry of spores and acid over
range; the **Behemoth**, a war machine's carcass it has fully grown into.

**What its structures look like** follows from that:

- **A recognisable machine underneath.** A cooling tower, a war machine's hull,
  a valve manifold -- buried Ashworks machinery or wreckage of the war, pulled
  up out of the ash and colonised. From a distance the silhouette still reads
  as the machine.
- **Growth imitating mechanism, badly.** Pipes swollen into veins, coils fused
  into ribs, rivets become polyps, gears grown shut. Nothing is a plant: no
  leaves, no wood, no petals of flesh.
- **Three materials.** Powdery blue-green **verdigris crust** in bubbled,
  layered shelves; dark, glossy **wet bronze** where the growth is alive; and
  the pitted, red-brown **rotten metal** of the machine it is eating, showing
  through wherever the crust has not yet closed.
- **Wet, and dripping.** Mineral stalactites under every overhang, slick runs
  down every wall. Ash does not settle on it -- it is absorbed.
- **Light is rare and cold.** A faint verdigris phosphorescence in wet hollows
  and in the throats of its openings. Never bright, never warm.
- **The brood's colour is its bloom.** Each brood's chemistry drifts, and it
  oxidises its own colour: the crystalline oxide blooms bursting through the
  crust carry the owner's colour, where the Directorate would carry paint.
- **Construction is emergence**: tendrils break the ash, the buried machine
  rises out of the ground in their grip, crust swells over it, and the blooms
  open last.

---

## Structures

One sheet per building: what it was, what it is now, and what it does in the
match, then how that is shown. The gameplay line is from the content files and
is not negotiable here; everything else is the brief a model script implements
(see the Structures section of packages/client/assets/models/README.md for the
technical rules). The silhouette line is what has to survive at playing zoom,
where a tile is about 25 pixels.

Clips: `build` is scrubbed by construction progress, `idle` loops, `produce`
loops while anything is queued, `release` plays as a unit comes out. A
structure that attacks either aims -- `aim` and `aim_fire`, a turret turning
to face its target -- or plays `fire` on every shot.

**Units come out on the +X side**, from the middle of that face, so every
producing structure puts its door there -- whatever that door is. From there
they walk to the building's rally point, which the player sets by
right-clicking with the building selected, and which is drawn as a flag in
their colour while the building is selected.

### The Ashen Directorate

#### Bastion -- `vanguard.nexus`

*Footprint 4. Headquarters: trains Servitors, receives alloy, provides supply.*
**Modelled** -- `scripts/models/bastion.py` is the reference implementation.

- **Was:** a site-office module from the Tender's hold. **Is:** the sector's
  command post, set down on four legs over a rockcrete apron.
- **Silhouette:** squat armoured hull, a command tower with a lit cab, a mast.
- **Detail:** Servitor bay with a roller shutter and ramp (+X); alloy intake
  with trough, conveyor and hopper (-Y); stacks and pipes on the far faces.
- **Paint:** cab, door lintel, leg struts, hull plates.
- **Clips:** `build` -- apron rises, hull descends on thrusters, legs deploy on
  touchdown, tower and stacks run up, ramp and conveyor drop, lights on. `idle`
  -- dish sweeps, mast lamp blinks. `produce` -- beacons spin, deck hammers
  pump. `release` -- the shutter rolls up and down.

#### Vent Tap -- `vanguard.extractor`

*Footprint 2. Built on a vent; yields plasma.*

- **Was:** a drop-rated wellhead cap, made to be lowered onto a live bore.
  **Is:** a pressure cap clamped over the vent, drawing plasma off the fire
  below into racked canisters.
- **Silhouette:** a squat, heavily banded drum with a tall relief stack and a
  side gantry -- the tallest thing for its size in a Directorate base, so a
  player's vents read at a glance.
- **Detail:** stacked pressure rings and clamp bolts; relief valves and a
  pressure wheel (+X); a canister rack with a loading arm (-Y); the vent's glow
  leaking ember-orange through intake grilles at the base.
- **Paint:** the cap's crown and the gantry arm.
- **Clips:** `build` -- the cap drops on its tether and screws down onto the
  vent, clamps slam shut, the stack telescopes up, a valve vents. `idle` -- it
  works all the time: a pump beam nods, the pressure wheel turns, the grille
  glow pulses. No `produce` or `release`.
  **Modelled** -- `scripts/models/vent_tap.py`. The vent is consumed when the
  Tap is placed, so the model carries it: slag heaped round the bore, the
  fire's light leaking between the chunks.

#### Foundry -- `vanguard.foundry`

*Footprint 3. Trains Conscripts, Outriders and Breakers.*

- **Was:** a section of a mobile smelter, cut out of a hauler's hull with its
  crucible still in it. **Is:** the sector's armoury -- plate is poured, pressed
  into armour and rivet stock, and whatever comes out walks or drives away.
- **Silhouette:** a long, low hall under a gantry crane, with a crucible and
  two chimneys at one end. It has to read as industry, never as command.
- **Detail:** a wide vehicle door big enough for a Breaker (+X); the crucible,
  its pouring lip and glowing mould line (-Y); plate stock stacked outside;
  the crane's trolley and hook over the roof.
- **Paint:** the crane, the door frame, the hall's roof plates.
- **Clips:** `build` -- the hall lands folded flat, its walls hinge up, the
  roof closes over, the crane unfolds and the chimneys run up. `idle` -- the
  crucible glows low, the crane trolley rests. `produce` -- the crucible tips
  and pours, the trolley runs along the gantry, a press hammer strikes.
  `release` -- the vehicle doors swing open on the lit hall, and a beacon over
  them turns.
  **Modelled** -- `scripts/models/foundry.py`.

#### Habstack -- `vanguard.pylon`

*Footprint 2. Provides supply. "Where the conscripts are kept."*

- **Was:** cargo pods from the Tender, the kind freight travels in. **Is:**
  the same pods stacked four high and fitted with bunks, a ladder tower and
  a ration chute. People travel in them now. Nothing else changed.
- **Silhouette:** a tall, slightly skewed stack of boxes beside a narrow stair
  tower, topped by a floodlight. The tall thin building in a Directorate base.
- **Detail:** numbered hatches and slit windows, a few lit (+X, -Y); external
  ladder and landings; the ration chute and a hanging roll of cable; the
  floodlight and a siren horn on top.
- **Paint:** the stencilled pod ends and the tower's frame.
- **Clips:** `build` -- pods come down one at a time onto the stack, the ladder
  tower unfolds, the floodlight comes on. `idle` -- windows go light and dark
  as shifts change, the floodlight sweeps, a vent fan turns. No `produce` or
  `release`.
  **Modelled** -- `scripts/models/habstack.py`.

#### Gun Nest -- `vanguard.turret`

*Footprint 2. Attacks: plasma, range 7.*

- **Was:** a point-defence mount unbolted from a hauler's flank. **Is:** that
  mount set in a ring of salvaged armour plate and slag-filled gabions, fed by
  a plasma line.
- **Silhouette:** a low, wide ring with a single long barrel over it. Obviously
  a weapon, obviously fixed.
- **Detail:** the projector's ember coils and heat-sink fins on the barrel; a
  gunner's shield plate; coolant tanks and the plasma line behind the ring
  (-Y); ammunition lockers and a ladder into the ring (+X).
- **Paint:** the turret's shield plate and mantlet.
- **Clips:** `build` -- the mount is lowered into its ring, the ring's plates
  hinge up and lock, the barrel elevates into position. `aim` and `aim_fire`
  -- the mount traverses to face what it shoots, sweeps slowly when it has
  nothing, and the barrel kicks back on every shot.
  **Modelled** -- `scripts/models/gun_nest.py`.

### The Verdigris

Its surfaces do not exist yet: verdigris crust, wet bronze and rotten metal
have to be written in scripts/models/surfaces.py before the first of these
is modelled.

#### Heartrot -- `concord.heartwood`

*Footprint 4. Headquarters: grows Creepers, receives alloy, provides supply.*

- **Was:** the stump of one of the Ashworks' cooling towers. **Is:** that
  shell split open down one side, and inside it a heart of fused copper coil,
  swollen, wet, slowly working -- the place where the brood's mind runs
  thickest, the knot its chemistry is thought in. Creepers feed scrap into a
  mouth at its foot.
- **Silhouette:** a broken hyperboloid tower, taller on one side, with crust
  spilling out of the split. The largest Verdigris shape, and the only one
  with a tower's outline.
- **Detail:** the split and the heart behind it, faintly lit, with a birth sac
  at its foot where Creepers come out (+X); the feeding mouth where scrap goes
  in (-Y); veins -- once pipes -- running out across the ground to the
  footprint's edges; stalactites under every lip.
- **Colour (bloom):** oxide blooms around the split and along the veins.
- **Clips:** `build` -- veins break the ash and crawl out to the edges, the
  tower's stump rises from the ground in their grip, crust swells up its walls,
  the split tears open, the blooms open. `idle` -- the heart swells and eases,
  slowly, like breathing. `produce` -- faster, and the birth sac fills.
  `release` -- the sac splits and folds back.

#### Siphon -- `concord.siphon`

*Footprint 2. Built on a vent; yields plasma.*

- **Was:** a heat-exchanger manifold, a bank of pipes that once carried
  coolant past the furnaces. **Is:** those pipes, grown into a cluster of
  throats plunged into the vent, drinking the heat.
- **Silhouette:** a knot of thick, curved tubes bent over and down into the
  ground, like a hand gripping the vent.
- **Detail:** swellings along the tubes; crust chimneys venting heat-shimmer;
  the vent's ember glow visible between the tubes where they enter the ground
  -- the one warm light on a Verdigris building, because it is stolen.
- **Colour (bloom):** crystal blooms on the tubes' upper bends.
- **Clips:** `build` -- tubes push up out of the ash and arch over, their ends
  bore down into the vent, crust closes over the joints. `idle` -- swallowing:
  bulges travel up each tube in turn. No `produce` or `release`.

#### Canker -- `concord.grove`

*Footprint 3. Grows Flensers, Blightcasters and Behemoths.*

- **Was:** the hull of a heavy war crawler, buried where it was knocked out
  in the war -- the kind of wreck the hive first learned from, on the Sump.
  **Is:** the hull cankered open along its spine, its ribs bared and grown
  thick, and gestation pits in its belly where what it grows takes the shape
  of the machines it has eaten.
- **Silhouette:** a long, low, broken hull with ribs arching out of its back;
  the Foundry's counterpart, and as clearly a place that makes things.
- **Detail:** the opened spine and the pits inside, faintly lit (+X); the tank's
  track and road wheels still visible under the crust (-Y); crust shelves
  stepping down its sides; a birth opening at its +X end, where what it grows
  comes out.
- **Colour (bloom):** blooms along the ribs.
- **Clips:** `build` -- the hull surfaces from the ash like a wreck from water,
  the spine splits, ribs lift out of it, crust climbs the sides, blooms open.
  `idle` -- the ribs flex a little. `produce` -- the pits churn and the ribs
  flex hard. `release` -- the birth opening parts and closes.

#### Bloom -- `concord.bloom`

*Footprint 2. Provides supply.*

- **Was:** a ruptured storage tank. **Is:** an efflorescence -- the spill has
  crystallised into a mound of oxide shelves and blooms heaped over the tank's
  crumpled shell.
- **Silhouette:** a low mound of layered shelves with a crown of crystal blooms.
  Cheap and many, so it must never be mistaken for a Heartrot.
- **Detail:** the tank's torn plating and a valve wheel showing through (+X);
  shelves stepping down to the ground; drips pooling at the base.
- **Colour (bloom):** the crown -- most of what can be seen from above.
- **Clips:** `build` -- crust spreads from a point, shelves stack up over the
  rising tank shell, the crown blooms. `idle` -- the blooms open and close,
  very slowly. No `produce` or `release`.

#### Barb -- `concord.barb`

*Footprint 2. Attacks: kinetic, range 6.5.*

- **Was:** the jib of a scrap crane, riveted girders and a winch drum. **Is:**
  the jib grown into a coiled spine, bent back under tension, its tip crusted
  with barbed shards that it flings.
- **Silhouette:** a single curved spine rising from a crusted base and bent
  back over itself, like a scorpion's tail.
- **Detail:** girder lattice still visible inside the crust; the winch drum
  grown into a knot at the base; shards clustered at the tip; a faint glow in
  the knot where the tension is held.
- **Colour (bloom):** blooms along the spine's outer curve.
- **Clips:** `build` -- the base surfaces, the spine uncoils upward and bends
  back under tension, the shards grow at the tip. `aim` and `aim_fire` -- the
  spine swings round its base to bear on the target, and flicks forward as it
  throws.

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

**A world has several surfaces, and a map paints with them.** One ground
texture across a whole map is a floor, not a place: the player learns it in
thirty seconds and then it is wallpaper. Every biome has a ground that covers
most of it and four more that say what happened somewhere — and a map paints
each of its tiles with one of them, so the ground changes as you cross it and
the change means something. See `scripts/generate-terrain.mjs` for how they
are made and `scripts/generate-map.mjs` for the rules that place them.

Furnace Nine:

| Surface | What it is |
|---|---|
| `ash` | The ground, and most of every map. Not a floor — the original surface is four hundred metres down. Compacted ash and slag fines, drifted and trodden, cracked by the heat still coming up through it, with clinker fragments and grit pressed into the top. |
| `cinder` | Where the fires below come close enough to bake the ashfield into a crust. Dark clinker plates split along their seams, the seams packed with fines, rust bleeding from the edges and the odd deep crack still showing a red line. |
| `ember` | The same crust where the seams have not cooled. Rock split open with lava in the gaps, and lakes where the crust has foundered into rafts. The only ground in the game that gives light. Painted around the vents, because that is where it would be. |
| `rockcrete` | Poured slabs, the way the Directorate lays a pad: expansion joints, rivets where the formwork was tied, a hazard band on one edge, a corner bitten off, all of it filthy. The one laid surface, painted under a base. |
| `rubble` | Where something stood and does not any more. Broken masonry and cut plate in heaps, shell craters between them, the ash blown off to show what was under it. Painted at the foot of the spoil heaps. |
| `slag` | The spoil heaps themselves — not painted, because they stand on the ground rather than being part of it. Vitrified furnace waste, cooled into clinker and glassy black froth, shot through with rust bleed and still warm in the deep cracks. Sharp-edged and unnatural: these are dumped, not eroded. |

Cistern Four answers the same five questions in its own material — `rime` for
the ground, `ice` for the frozen coolant lakes, `meltrock` for what a breached
reactor has exposed, `rockcrete` for the same pads under a glaze of frost, and
`scree` for the same collapse without the shelling. See Other fronts.

**No straight lines in the ground surface.** The first version of `ash` was
poured rockcrete slabs with expansion joints, which is a perfectly good
industrial floor and was completely wrong for the job. A texture that tiles a
hundred times across a map cannot contain a regular grid: at any zoom the joints
line up into a lattice stretching to the horizon, and no amount of macro
variation hides it. Organic noise has no such failure mode. The same rule will
apply to any future ground surface.

Rockcrete returns as a **building apron** — a few tiles under a Bastion,
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
