# RTS

A futuristic real-time strategy game. 2.5D isometric, peer-hosted multiplayer —
the player who creates the game hosts it, with no dedicated server to deploy.

**Status: M6 complete — fog of war, a minimap, control groups, and units that
look like units.** Gather alloy, tap geothermal vents for plasma, build a base, train an
army, and destroy your opponent. Peer-hosted: one player creates the game, gets
a six-character code, and everyone else joins over a direct WebRTC connection
with no dedicated server anywhere.

Verified between two browser tabs playing a real match: the guest's harvesting,
construction and production all executed in the host's authoritative world, and
both peers hashed **byte-identically** at matched ticks with zero desyncs.

**The simulation has been verified bit-identical between Node v22.15 and
Chrome 148** across 600 ticks — see "Cross-runtime determinism check" below.

## Quick start

```bash
npm install
npm run serve      # build everything, then serve on http://localhost:8080
```

Open it, click **Host a game**, and share the six-character code. Friends open
the same address, type the code, and they are in. There is no waiting room —
guests join a match already in progress, because the welcome snapshot makes late
joining the natural case.

**How to actually play:** pick a faction lineup, drag a box over your workers,
right-click an amber ore crystal to start mining, then click a worker and use
the command card at the bottom to place a supply building and a factory. Select
the factory to train soldiers, select the army, press `A`, and click the enemy
base.

The default lineup is **mixed** — one race per slot — so a guest joining slot 1
is playing the Verdant Concord without configuring anything.

For development, with hot reload:

```bash
npm run build && npm run broker   # signaling on :8080
npm run dev                       # client on :5173, finds the broker automatically
```

```bash
npm test           # 295 tests
npm run typecheck
npm run lint       # includes the determinism rules
```

### Controls

| | |
|---|---|
| left click / drag | select (shift to add) |
| right click | contextual order — move, attack, gather, or set a rally point |
| `A` then click | attack-move: advance, engaging anything hostile on the way |
| `Ctrl+1`..`9` | assign a control group |
| `1`..`9` | recall a group; press twice to centre the camera on it |
| click/drag minimap | jump the camera |
| `S` / `H` | stop / hold position |
| `Esc` | cancel a pending build placement |
| `WASD`, arrows, middle-drag | pan |
| wheel | zoom |

Right-click is deliberately contextual — the same button means move, attack,
gather or rally depending on what is under the cursor. That is the genre
convention, and it is what keeps the command card optional rather than
mandatory.

## Layout

| Package | Role |
|---|---|
| `packages/sim` | Deterministic simulation. **Zero dependencies, no DOM, no Node APIs.** |
| `packages/content` | Race definitions, zod schemas, id interning, content hashing |
| `packages/transport` | `Transport` interface + in-memory virtual network. No DOM, no Node. |
| `packages/protocol` | Wire messages and MessagePack codec |
| `packages/netcode` | Host arbiter, guest session, replay. No DOM, no Node. |
| `packages/signaling` | The one always-on process: WebSocket broker + static file server |
| `packages/client` | Vite + Three.js renderer, lobby, input |

Inside `packages/sim`: `fixed` (Q16.16 math), `rng`, `clock` (tick pacing),
`hash` (state hashing), `entities` (SoA store), `grid` (passability),
`flowfield` (Dijkstra pathing), `spatial` (neighbour queries), `vision` (fog of
war), `commands`, `types` (the *shape* of content, and the damage matrix),
`players` (resources, supply, defeat), `combat`, `economy`, `production`,
`events` (derived output for the renderer), `snapshot` (serialisation),
`fixture-types` and `scenario` (the determinism fixture), and `world` (`step()`
is the only mutator).

Three packages deliberately avoid both DOM and Node types. That is what lets the
identical arbiter run in the host's browser tab today and in a headless
dedicated server later, with only the transport swapped.

`sim` depends on nothing; `content` depends on `sim`. The arrow points one way
on purpose — the engine cannot import a race, so it is structurally impossible
for the simulation to become specialised to one.

## The one rule that matters

**The simulation must be bit-identical on every machine.**

Multiplayer is deterministic lockstep: peers exchange only player commands, and
each independently simulates the result. Bandwidth stays flat whether there are
50 units or 5000. The cost is that any divergence — however small — compounds
into two players seeing different games.

Three things enforce this:

1. **All simulation state is integer.** Q16.16 fixed-point in `Int32Array`s. See
   `packages/sim/src/fixed.ts`.
2. **No implementation-defined math.** IEEE-754 mandates exact results for
   `+ - * /` and `sqrt`, and ECMA-262 specifies `Math.floor`/`round`/`abs`
   exactly — those are safe. `Math.sin`, `cos`, `atan2`, `pow`, `exp`, `log` are
   *not*, and differ between V8 versions and between V8 and SpiderMonkey. They
   are replaced by polynomial approximations built from `+ - * /` alone.
3. **Lint enforces it.** `eslint.config.js` bans `Math.random`, the
   transcendentals, `Date`, `Object.keys` iteration and `**` inside
   `packages/sim/src`. Tests are exempt — they use the real `Math` as an oracle
   to validate the replacements.

### The magnitude bound

`fxMul` computes `(a * b) / 65536` in float64, which is exact only while
`|a * b| < 2^53`. Keep spatial operands under **2^26 (1024.0 world units)**; a
256-tile map sits at 2^24. `enableDevChecks(true)` turns this into a hard
assertion and is on in development.

### Why the whole stack is TypeScript

So the host, every guest, and any future headless arbiter run *literally the
same simulation code*. A second implementation in another language would be the
single largest source of desync bugs.

## Cross-runtime determinism check

The single most valuable test in the project. Unit tests prove the simulation is
reproducible *within one process*; they cannot catch the failure that actually
ruins a match, which is two players on different engines drifting apart.

```bash
npm run build
node scripts/determinism-trace.mjs        # prints a hash trace
```

Then open the client and run `__rts.determinism()` in the browser console. The
`finalHash` and every entry of `trace` must match exactly.

The fixture is not a movement demo. Across 600 ticks it marches two 60-unit
armies into each other and resolves the engagement, works a harvesting round
trip, completes a construction site (which mutates the grid mid-run and
invalidates the flow-field cache under load), empties a production queue, and
runs a plasma tap whose fractional remainder carries in integer state the whole
way -- so every system that accumulates state over time is inside the
comparison. `scenario.test.ts` asserts that it still does all of that, because a
fixture that quietly decayed into a no-op would leave this check green while
testing nothing.

It runs on `fixtureTypes` rather than on shipped content, so a balance change
never churns the trace.

Current status: **Node v22.15 and Chrome 148 agree** on all 12 checkpoints and
`finalHash 3f2b7306`, across 600 ticks of pathfinding, crowd separation,
trigonometry, division, the damage matrix, death, harvesting, construction and
the fractional plasma accumulator.

Known gap: both are V8. That comparison does catch the "a new V8 changed
`Math.sin`" class of bug, but **SpiderMonkey is untested** — running
`__rts.determinism()` in Firefox and comparing is worth doing before shipping.

Automating this in CI needs Playwright, which is not yet a dependency.

## Netcode

Deterministic lockstep with the host as arbiter. Only player *intent* crosses
the wire, so a 400-unit battle costs the same bandwidth as an idle base.

Two properties do most of the work:

- **The match never stalls on a slow player.** Classic peer lockstep freezes
  everyone until the laggiest client's input arrives. Here the host owns the
  clock: when a tick comes due its command set is finalised and broadcast, and a
  player who has not been heard from contributes nothing that tick.
- **Input latency is equal for everyone.** Guests *propose* which tick their
  commands run at, and the host honours it whenever that tick is still open.
  Stamping commands on arrival instead would hand the host a full network trip
  of advantage — which players experience as "the host always wins fights".

Guests send a state hash every 30 ticks. A mismatch is caught within ~1.5
seconds and answered with an authoritative snapshot rather than a disconnect,
since a desync is usually a simulation bug rather than the player's fault.

Replays are close to free: the command log the arbiter already broadcasts *is*
the replay. `playReplay` reports the first diverging checkpoint rather than a
bare pass/fail, because "it ended wrong" is far less useful than "it went wrong
between tick 300 and 400".

## Connecting players

Three pieces, and it matters which is which when something fails:

1. **The signaling broker** (`packages/signaling`) — the only always-on process.
   It holds a map of join code to host connection and relays WebRTC offers,
   answers and ICE candidates between peers who cannot yet talk directly. It
   never sees a game command. Rooms are capped, messages are rate limited, and a
   guest may only address the host — one guest cannot signal another, so it can
   neither spray strangers nor probe who else is in the room.
2. **WebRTC DataChannels** — the actual gameplay path, ordered and fully
   reliable. Lockstep requires reliability: a dropped position update is a
   cosmetic glitch, a dropped command puts two players in different worlds
   permanently.
3. **STUN** — lets peers find their own public address and punch through most
   home NATs with nobody configuring a router.

**Once the DataChannel opens, the broker is irrelevant.** Verified by killing
the broker process mid-match: the guest issued an order afterwards, it reached
the host's authoritative log, all 40 units obeyed, and desyncs stayed at zero.
If the broker goes down, running games are unaffected — you just cannot start
new ones.

Roles are fixed and asymmetric — the host always offers, guests always answer —
so none of WebRTC's "perfect negotiation" glare handling is needed. That
machinery exists for peers that may both initiate at once, which cannot happen
in a star topology.

### When a connection fails

The lobby distinguishes the failure modes, because they need different fixes and
look identical to a player otherwise:

- *Cannot reach the lobby server* — the broker is down or the URL is wrong.
- *No game with that code* — mistyped, or the host restarted.
- ICE failure with only `host` candidates — STUN never returned a public
  address.
- ICE failure having seen `relay` — even TURN did not help.

**Known gap: no TURN server is configured.** STUN handles the large majority of
home-to-home connections, but symmetric NAT (some corporate networks, many
mobile carriers, CGNAT ISPs) needs a relay. This is affordable here in a way it
would not be for most games — lockstep sends only commands, a few KB/s per
player regardless of army size — so running `coturn` alongside the broker is
cheap. Worth adding once real-world success rates are known; add it to
`iceServers` in `webrtc-types.ts`.

**WebRTC requires a secure context**, so a deployed client must be served over
HTTPS. `localhost` is exempt, which is why local testing works without it.

## The game

Two races ship. **The Vanguard Directive** is human corporate-military —
hovertanks, mechs and drones, kinetic lines and explosive armour. **The Verdant
Concord** is grown rather than built: near-melee Thornlings that want to close,
long-range Sporecasters that fold if anything reaches them, and workers that
carry larger loads more slowly.

Everything about both of them lives in `packages/content` as *data*, reached
through `World.types` rather than imported by the systems that use it. No system
hardcodes a number, and the simulation cannot import a race even by accident —
see "Adding a race" below.

**Two resources, with deliberately different acquisition loops.** *Alloy* is a
round trip — a worker walks to an ore patch, mines for a second, and walks the
load back to a drop-off. *Plasma* is a passive trickle from a structure built on
a geothermal vent. Two genuinely different loops rather than the same loop in a
different colour, which is what stops the content system from being accidentally
specialised to one shape of economy.

### The Vanguard Directive

| Unit | Cost | Role |
|---|---|---|
| Drone | 50a | Harvests and builds. Never picks fights on its own. |
| Trooper | 60a | Cheap kinetic infantry. Strong against light, poor against armour. |
| Scout | 45a 10p | Fast, fragile, cheap map presence. |
| Hovertank | 120a 40p | Heavy armour, explosive damage. The thing that kills buildings. |

| Building | Cost | Role |
|---|---|---|
| Command Nexus | 400a | HQ. Trains Drones, receives alloy, +10 supply. |
| Extractor | 100a | Built on a vent. Trickles 3 plasma/second. |
| Foundry | 200a | Trains combat units. |
| Supply Pylon | 80a | +8 supply. |
| Turret | 120a 25p | Static plasma defence. |

### The Verdant Concord

| Unit | Cost | Role |
|---|---|---|
| Sporeling | 55a | Harvests and builds. Bigger loads, slower to fill. |
| Thornling | 65a | Near-melee brawler. Enormous damage if it survives the walk in. |
| Sporecaster | 70a 20p | Out-ranges everything the Vanguard fields, and dies to anything that closes. |
| Behemoth | 140a 50p | Heavy explosive armour. |

| Building | Cost | Role |
|---|---|---|
| Heartwood | 400a | HQ. +12 supply, where the Nexus gives 10. |
| Siphon | 110a | On a vent. 4 plasma/second, where the Extractor gives 3. |
| Grove | 200a | Trains combat units. |
| Bloom | 70a | +7 supply, where the Pylon gives 8. |
| Barb | 115a 25p | Static kinetic defence. |

The Concord opens with more supply and expands its cap more slowly, wants to
fight at close range, and ramps its economy later. None of that is a special
case in the engine; it is entirely the numbers.

**Damage is a matrix, not a list of "strong against" tags.** Three damage types
against three armour classes, as integer percentages:

| | vs Light | vs Heavy | vs Structure |
|---|---|---|---|
| Kinetic | 100% | 65% | 70% |
| Plasma | 85% | 135% | 60% |
| Explosive | 65% | 115% | 160% |

A matrix is the only form that stays comprehensible once a second race exists: a
new unit picks an existing damage type and immediately has sensible interactions
with everything already in the game, including units its author never saw. The
percentages are integers and damage is `floor(base * pct / 100)` with a floor of
1, so the result is exact on every engine -- a Q16.16 multiply would introduce
rounding that has to be re-reasoned about on every balance change.

You lose when you own nothing at all -- not "no buildings", which produces the
classic stalemate where a defeated player's last drone hides in a corner
forever. The last player standing wins; a mutual kill stays undecided rather
than crowning whoever died last.

## Fog of war

Fog is **simulation state, not a rendering filter**: a unit cannot acquire a
target it cannot see, so scouting is a real decision. That means every peer has
to agree on exactly who can see what, on every tick.

Two grids per player, and the distinction between them is the interesting part:

- **`visible`** is recomputed from scratch every tick and is what the simulation
  reads. Wholesale rather than incrementally — an incremental scheme has to
  subtract a unit's old circle before adding its new one, and getting that wrong
  leaves permanent phantom vision that nothing ever clears. A memset plus a few
  hundred stamped circles costs **0.21 ms per tick at 400 units**.
- **`explored`** only ever gains bits, and *nothing in the simulation reads it*.
  It exists so the renderer can draw terrain you have seen before. That makes it
  presentation state: not hashed, not snapshotted, and peers are **expected** to
  differ on it. A peer that resyncs keeps its own map memory, which is exactly
  right — being handed the host's would show a player ground they never scouted.
  Shipping it would also have cost 256 kB per resync on a 256-tile map, five
  times the rest of the snapshot combined, to transmit something the receiver
  has a better version of.

Neither grid is hashed. `visible` is a pure function of entity positions, which
are hashed already, so including it would cost a quarter-megabyte of hashing per
desync check to detect nothing new.

What the player sees follows from what fog *means*:

| | in sight | explored | never seen |
|---|---|---|---|
| your own things | drawn | drawn | drawn |
| enemy units | drawn | hidden | hidden |
| enemy buildings, ore | drawn | dimmed | hidden |

Enemy units vanish because a unit is where it is *right now* — drawing a
remembered one would be a lie. Buildings and ore do not move, so remembering
them is what a player expects. The same rule governs what can be clicked, so
nothing is ever visible-but-unclickable or clickable-but-invisible.

Auto-acquisition is gated by sight; an explicit attack order is not. The player
saw the target when they issued it, and having units abandon a chase the moment
it entered fog would be maddening. Return fire is gated too — being shot out of
the dark must not hand out free vision.

Content may set `visionRange`, and the loader derives one otherwise. It always
exceeds weapon range, and the loader **refuses** content where it does not: a
unit that can shoot further than it can see is blind inside its own firing
envelope and never engages, which reads as a broken weapon rather than as a
content mistake.

## Adding a race

The extensibility requirement was never "make it possible" — everything is
possible. It was that adding a race should be **cheap**, meaning it touches
content and nothing else. The Verdant Concord is the proof: it is one file,
`packages/content/src/races/concord.ts`, plus one entry in an array.
`concord.test.ts` checks the claim rather than asserting it, and would fail if a
future race needed engine work.

### How it fits together

Content is authored in units a designer can reason about — **tiles and
seconds**, never Q16.16 and ticks. The loader does four things:

1. **Validates** against a zod schema. Content is the part of the system meant
   to be edited by people who are not reading the engine source, so a strict
   schema at the boundary is worth more than it costs: a typo becomes a message
   naming the field, not a unit that quietly has zero health. The schema is
   `.strict()`, so a misspelled key is an error rather than a silently ignored
   one.
2. **Interns** string ids into dense integers, by *sorting the ids*. The
   simulation indexes a flat table every tick and stores the id in an
   `Int32Array`; the sort is what makes the numbering reproducible, so two peers
   that loaded the same content agree without exchanging anything. Definition
   order is an authoring accident and must not be able to matter.
3. **Converts** units: 2.6 tiles/second becomes Q16.16 per tick, 1.2 seconds
   becomes 24 ticks. Durations are clamped to a minimum of one tick — rounding a
   0.04-second cooldown down to zero would make a weapon fire every tick
   forever.
4. **Checks coherence.** zod proves each field is well-formed; it cannot prove
   that a Foundry produces something that exists, or that a race has any way to
   deliver alloy. Those checks live in the loader, because the failure mode is
   otherwise a race that loads cleanly and is unplayable.

### The behaviour registry

The engine implements a closed set of behaviours — `attack`, `gather`, `build`,
`produce`, `dropoff`, `needsVent` — and content picks from it by name. That is
deliberately not a plugin system: an ability no system reads would do nothing at
all and would look like a balance problem rather than a typo. A genuinely novel
mechanic means a new flag plus one system in `sim`, reusable by every race after
it — and at that point the "zero engine code" claim has to be re-earned rather
than assumed.

### The content hash

`defaultContent.hash` fingerprints the *resolved* content — the converted
numbers the simulation actually runs on, plus the string ids. Reformatting a
definition does not change it; changing a stat by one does. The lobby exchanges
it in the handshake and the host refuses a mismatch by name:

```
content mismatch: yours is 4b1f0a37, the host's is dfada7b3.
You are running a different build.
```

Without that check, two peers whose content differs by one number diverge on the
first purchase, and the desync report points at the simulation — which sends you
looking in exactly the wrong place. Blurbs and other presentation text are
excluded: refusing a friend's connection over a marketing sentence would be
absurd.

### Shots are hitscan, tracers are cosmetic

Damage resolves instantly within the tick. Travelling projectiles would be
entities -- 400 units firing every second churns through entity slots faster
than the units themselves -- and, worse, they would be *simulation state*:
hashed, snapshotted, and one more thing that can disagree between peers. A
resynced peer inherits no half-finished shots.

The renderer still draws travelling tracers, interpolated from the tick's shot
events. The appearance of a projectile without the state.

### Events are derived output, never state

`world.events` is rebuilt from scratch each tick and is not hashed, not
snapshotted, and never read back by the simulation. Because every peer runs the
same step over the same commands, every peer produces the same events anyway --
but nothing breaks if a headless arbiter ignores them entirely, and a peer that
resynced from a snapshot simply misses the flashes for the ticks it skipped.
That is exactly the right guarantee for a muzzle flash and exactly the wrong one
for anything gameplay-visible, which is why nothing gameplay-visible lives here.

## Things that are easy to get wrong

Learned while building this, recorded so they are not re-learned:

- **The simulation is not driven by `requestAnimationFrame`.** Browsers stop
  firing rAF for hidden tabs. Since the host client is also the lockstep
  arbiter, an rAF-driven sim would stall the match for everyone the moment the
  host alt-tabbed. It runs on a timer; rAF only renders.
- **Fog distances are measured from the camera**, which sits 400 units back to
  frame the orthographic view. Perspective-style fog ranges put the whole scene
  beyond the far plane and render the world as a flat sheet of fog colour.
- **Models face +X at rest**, because BAM angle 0 is +X. This differs from the
  Three.js habit of authoring models facing +Z, so imported `.glb` assets need a
  yaw correction baked in at export.
- **Negative zero is a distinct bit pattern.** `-0` reaching a state hash makes
  two peers with identical gameplay state report different hashes. Sim
  primitives canonicalise it.
- **Freed entity slots are zeroed.** Dead slots are still covered by the hash,
  so leftover values would make the hash depend on an entity's *history* rather
  than the current world.
- **A truncated neighbour query is a correctness bug, not a performance one.**
  `SpatialHash.queryInto` fills its buffer in cell-iteration order, so an
  overflow drops whichever neighbours come last — possibly the unit standing on
  top of you, while a harmless one two tiles away is kept. This produced
  permanently fused units and was invisible until the unit count was realistic.
  `SpatialHash.overflows` must stay zero; tests assert it.
- **Diagonal moves require both adjoining tiles clear.** The lenient rule lets
  units clip the corners of buildings, which reads as walking through a wall.
- **Entity slots are allocated lowest-free-first, never from a free list.** An
  explicit list carries allocation *order* as hidden state, so a peer that
  resynced from a snapshot would allocate differently from one that did not, and
  the two would desync on the very next spawn — making the resync look like it
  silently failed. Lowest-free makes allocation a pure function of the `alive`
  bitmap, so nothing about it needs serialising.
- **A guest is always a tick or two behind the host.** That is what lockstep over
  a real link looks like, not a bug. Hashes are only comparable at *equal tick
  numbers* — comparing `host.hash()` to `guest.hash()` at the same wall-clock
  moment compares two different ticks and is meaningless.
- **Snapshots arrive from the wire with no alignment guarantee.** An
  `Int32Array` view over a misaligned byte offset throws; `decodeSnapshot`
  re-copies when needed.
- **A peer connection reaching `connected` does not mean you can send.** The
  data channel has its own `open` event, and that is the one that gates the
  handshake. Starting earlier drops the first messages silently.
- **ICE candidates routinely arrive before the description they belong to.**
  `addIceCandidate` throws in that window, so they must be queued rather than
  discarded — dropping one is a classic cause of "works on my LAN, fails over
  the internet", because the discarded candidate was the only route that would
  have worked.
- **`send()` copies before handing bytes to the channel.** A `Uint8Array` view
  over a larger pooled buffer would otherwise be transmitted in full, silently
  corrupting the stream with neighbouring bytes.
- **Terrain is rendered from the cost grid, not from the rectangles that made
  it.** A guest receives a world snapshot containing the grid and never sees the
  generation inputs, so anything reconstructed from those would simply be
  missing on every peer but the host.
- **A building footprint is a different tile value from a cliff.** Both are
  impassable and `isBlocked` tests against `TILE_WALKABLE` rather than a
  specific value, so pathing does not care -- but the renderer derives its
  terrain blocks from the same grid, and without `TILE_STRUCTURE` every Nexus
  and ore patch was drawn as a rock with the actual building buried inside it.
- **`targetId` is shared by three systems.** For a soldier it is the enemy, for
  a harvester the ore patch, for a builder the site. Combat clearing it when a
  unit had no *enemy* silently cancelled every gather and build order in the
  game -- which presented as drones walking halfway to a patch and forgetting
  why. Combat now leaves working units strictly alone.
- **An explicit attack order must not be leashed.** Auto-acquired targets need a
  leash, or one scout wandering past a defensive line drags the whole line
  across the map; but a player who said "kill that" gets exactly that, however
  far it runs. Applying the leash to both made attack orders cancel themselves
  the instant the target sat further away than weapon range.
- **Buildings are skipped by the steering pass, not merely resisted.** They
  still appear in every unit's neighbour query -- that is how units get pushed
  out of a footprint -- but a Nexus that participates in separation is a Nexus
  that can be shoved out of its own building.
- **Supply is recomputed from scratch every tick, not maintained
  incrementally.** A counter has to be adjusted correctly at every spawn, death,
  cancellation and refund, and the failure mode of missing one is a player who
  slowly can no longer build anything, with no visible cause. A full pass over
  the entity store costs microseconds.
- **Queued units count against supply before they exist**, or a player queues
  twenty troopers into ten supply and finds out when they pop.
- **Production is charged on queue and refunded on cancel.** Charging on
  completion lets a player queue a dozen buildings they cannot afford and
  discover which ones failed minutes later.
- **"Finished but nowhere to put it" is a third production state.** A factory
  walled in by its own army must hold the finished unit and retry, not restart
  the timer -- otherwise the player pays the build time twice for one unit.
- **The Extractor's vent is consumed after the affordability check, not
  before.** Reversing them destroys the vent on a placement the player could not
  afford.
- **Fractional resource rates accumulate in integer state.** Three plasma per
  second at 20 ticks per second is not a whole number per tick, and rounding
  down each tick produces exactly nothing. The remainder is real simulation
  state, hashed and snapshotted, because a resynced peer restarting its
  accumulator from zero would drift permanently behind.
- **Renderer hooks must fire per *tick*, not per frame.** A renderer that
  sampled `world.events` after `session.update()` would see only the last tick
  of a catch-up burst -- which is precisely when the most is happening.
- **Engine tests must not run on shipped content.** Assertions like "the depot
  cost 100 alloy" break on every balance change, which teaches people to update
  them reflexively -- and a reflexively updated assertion is not a test. Engine
  tests run against `sim/fixture-types.ts`, a deliberately different eight-entry
  table; that they pass at all is a standing demonstration that nothing in the
  simulation is specialised to one race.
- **The determinism fixture owns its content too.** Its hashes are compared
  between runtimes by eye at the same commit. Tying them to shipped balance
  churns the trace on every tuning pass, and churn in a number people compare by
  eye is how a genuine divergence gets waved through.
- **A fixture that includes a shooting unit becomes a combat test.** Giving two
  owners the same armed type turned the movement and replay fixtures into
  battles that killed their own subjects halfway through -- one replay-tampering
  test started passing for the wrong reason, because the entity it tampered with
  was already dead. Those fixtures now use an explicitly unarmed unit.
- **Type id 0 is reserved.** A cleared entity slot reads back as type 0, so a
  real type there makes a dead slot look like a live entity. Interning starts at
  1 and `TypeTable` rejects anything lower.
- **Content ids are interned by sorting, not by definition order.** Definition
  order is an authoring accident; two peers whose content files were
  concatenated differently would otherwise disagree about which integer means
  "drone" -- while both reporting perfectly healthy content.
- **A weapon with no `attack` behaviour is a content bug, not a quirk.** The
  unit stands there being shot, which reads as a combat bug. The loader rejects
  it, and rejects the mirror case too. That check was missing for buildings
  until a test written to fail found that it was.
- **Coherence checks belong at load, not at first use.** A race with no drop-off
  loads perfectly and then mines alloy it can never bank: the workers walk home
  forever and the player watches an economy that produces nothing.
- **A `DataTexture` has no colour space, so three.js reads its bytes as
  linear.** Write the sRGB bytes of a near-black tone into one and it renders
  about four times brighter than intended — which for this palette landed almost
  exactly on the unlit ground colour. The fog was drawing perfectly and was
  invisible. Material colours go through the sRGB conversion properly, so the
  texture now carries alpha only and the tone lives on the material.
- **`flipY` has no effect on a `DataTexture` either**, because the data is
  uploaded straight from a typed array rather than decoded from an image. Row 0
  lands at the far edge of the plane, mirroring the fog north to south. It looks
  convincing right up until you notice the lit patch is over the enemy's base
  rather than your own.
- **`mergeGeometries` needs every input indexed, or none of them.** three.js
  primitives disagree: Box, Cylinder, Cone and Sphere are indexed, the polyhedra
  are not. Mixing one decorative shard into a model built from boxes throws
  during scene construction, so the whole game fails to start. Normalising
  inside the merge helper keeps it total.
- **Scene fog fights fog of war.** Distance fog blends everything toward the
  horizon tone, so nothing can be genuinely dark — unexplored map lifts to a
  visible grey the further from the camera it sits. The fog overlay and the
  terrain blocks opt out of it.
- **Silhouettes are picked from what a unit does, not what it is called.** A
  harvester gets the harvester shape because it has the `gather` behaviour, a
  brawler because its weapon is short-ranged. A race added tomorrow gets
  readable models with no art and no code — the same principle as the rest of
  the content system, applied to the one part that would otherwise need a
  hand-written table per race.
- **Two units with the same silhouette is a real bug, not a cosmetic one.** The
  Vanguard's Trooper and Scout both classified as "ranged" and were
  indistinguishable on the field, which matters for two units with different
  jobs. Fast movers now get their own shape.
- **The HUD must not hash the world every frame.** `world.hash()` walks every
  entity, every player and the full cost grid. That is cheap at 20 Hz and
  wasteful at 240; the debug readout refreshes a few times a second instead.

## Debug tooling

In development the client exposes `window.__rts`:

```js
__rts.step(n)            // advance n ticks through the arbiter
__rts.renderFrame()      // render once, without waiting for rAF
__rts.capture('name')    // save a PNG to .captures/ via the dev server
__rts.determinism()      // run the cross-runtime fixture, print its hash trace
__rts.reveal(true)       // lift the fog, for watching what an opponent is doing
__rts.scene              // the three.js scene: inspecting materials beats guessing
__rts.session            // the HostSession: .log, .tick, .inputDelay, .desyncs
```

`capture` exists because a browser cannot write files, and because in a hidden
or offscreen tab the compositor never produces frames — ordinary screenshot
tooling captures nothing there, while a WebGL readback still works.

## Roadmap

- **M0** — Skeleton, fixed-point math, tick loop, isometric renderer ✅
- **M1** — Simulation core: entity store, spatial hash, flow-field pathing, state hashing ✅
- **M2** — Netcode: protocol, transport interface, host arbiter, desync detection, replays ✅
- **M3** — WebRTC + lobby: signaling broker, join codes, connection diagnostics ✅
- **M4** — Gameplay: harvesting, construction, production, combat, victory ✅
- **M5** — Content system: zod-validated race definitions, behaviour registry, race #2 ✅
- **M6** — Presentation: fog of war, minimap, control groups, command UI, art pass ✅
- **M7** — Ship: broker deployment, reconnect, replay playback
