# RTS

A futuristic real-time strategy game. 2.5D isometric, peer-hosted multiplayer —
everyone runs the same executable, and the player who creates the game hosts it.
There is no server to deploy and no third party involved.

**Status: M9 complete — it has a front end.** A menu, a skirmish against the
computer, and a real multiplayer lobby: friends join, everyone picks a race, and
the host starts when the room is ready. Your machine opens the port and runs the
match; closing the window ends it.

Gather alloy, tap geothermal vents for plasma, build a base, train an army, and
destroy your opponent. Two playable races, two maps, fog of war, a minimap,
control groups, reconnect after a dropped connection, and a replay of every
match.

**The simulation has been verified bit-identical between Node v22.15 and
Chrome 148** across 600 ticks — see "Cross-runtime determinism check" below.
A real host-and-guest match over real sockets is part of the test suite, and
ends with both worlds reporting the same hash and zero desyncs.

## Quick start

```bash
npm install
npm run desktop    # build everything, then launch the game
```

**Skirmish** starts a game against the computer immediately. **Multiplayer →
Host** opens a port, asks your router to forward it, and shows two addresses:
one for friends on your network and one for friends anywhere else. They paste it
into **Join**, appear in your lobby, pick their race, and you press Start.

To build installers:

```bash
npm run package    # writes to release/
```

The Electron main process is **bundled** (`scripts/build-desktop.mjs`) rather
than shipped as separate files. That is not a size optimisation: npm workspaces
link local packages by symlink, symlinks do not survive into an `app.asar`, and
the first packaged build installed cleanly and then died on launch with
`ERR_MODULE_NOT_FOUND: Cannot find package '@rts/transport'`. Bundling resolves
every workspace and npm import at build time, so the shipped main process
imports nothing but `electron` and Node built-ins.

To check a build without clicking anything:

```bash
RTS_SMOKE=1 npx electron release/win-unpacked/resources/app.asar
```

It opens the listening socket, reports the addresses and the port-forwarding
outcome, and quits. That is the check that would have caught the packaging bug:
the failure only appeared once a real build tried to open a real socket.

**How to actually play:** pick a faction lineup, drag a box over your workers,
right-click an amber ore crystal to start mining, then click a worker and use
the command card at the bottom to place a supply building and a factory. Select
the factory to train soldiers, select the army, press `A`, and click the enemy
base.

The default lineup is **mixed** — one race per slot — so a guest joining slot 1
is playing the Verdant Concord without configuring anything.

For development, with hot reload:

```bash
npm run dev        # renderer on :5173, in a browser
```

A browser can join a game and watch replays but cannot host one — accepting
incoming connections is the one thing it cannot do, and the reason this is a
desktop application at all. To iterate on the shell itself:

```bash
npm run build && npm run build:preload
RTS_DEV_SERVER=http://localhost:5173 npx electron packages/desktop/dist/main.js
```

```bash
npm test           # 338 tests
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

The host gets a **save replay** button in the corner; anyone can load one from
the main menu with **Watch a replay**. **Leave match** returns to the menu.

Right-click is deliberately contextual — the same button means move, attack,
gather or rally depending on what is under the cursor. That is the genre
convention, and it is what keeps the command card optional rather than
mandatory.

## Layout

| Package | Role |
|---|---|
| `packages/sim` | Deterministic simulation. **Zero dependencies, no DOM, no Node APIs.** |
| `packages/content` | Race and map definitions, zod schemas, id interning, content hashing |
| `packages/transport` | `Transport` interface + in-memory virtual network. No DOM, no Node. |
| `packages/protocol` | Wire messages and MessagePack codec |
| `packages/netcode` | Host arbiter, guest session, replay. No DOM, no Node. |
| `packages/desktop` | The Electron shell: the window, and the listening socket |
| `packages/client` | Vite + Three.js renderer, menus, lobby, input |

Inside `packages/sim`: `fixed` (Q16.16 math), `rng`, `clock` (tick pacing),
`hash` (state hashing), `entities` (SoA store), `grid` (passability),
`flowfield` (Dijkstra pathing), `spatial` (neighbour queries), `vision` (fog of
war), `commands`, `types` (the *shape* of content, and the damage matrix),
`players` (resources, supply, defeat), `combat`, `economy`, `production`,
`events` (derived output for the renderer), `snapshot` (serialisation),
`fixture-types` and `scenario` (the determinism fixture), and `world` (`step()`
is the only mutator).

Inside `packages/client`: `screens/` (menu, match setup, join, and the router
that loops between them), `lobby-host` and `lobby-guest` (the pre-match
protocol), `match` (building a world from a lobby configuration), `game` (the
match screen), `ui` (the design tokens, in one place at last), and the
renderers.

Four packages — `sim`, `content`, `protocol`, `netcode` — and `transport` too
deliberately avoid both DOM and Node types. That constraint is what made this
milestone cheap: moving from a browser tab to a desktop executable changed the
transport and the lobby and touched nothing else. `packages/desktop` is the only
place Node APIs are allowed, because it is the only place that owns a socket.

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

Two pieces, and no third party:

1. **The relay** (`packages/transport/src/relay.ts`) runs inside the hosting
   player's own process. It accepts connections, assigns peer ids, and forwards
   frames. It reads a five-byte header to route and never looks at the payload,
   so it cannot disagree with the simulation about anything — there is nothing
   in there for it to disagree with.
2. **One WebSocket per player**, including the host, whose game connects to its
   own relay over loopback. That means one transport implementation rather than
   a client one and a server one that have to agree, and it is why the host is
   just another peer everywhere above this layer.

Ordered, reliable delivery comes free with TCP. Lockstep requires it: a dropped
position update is a cosmetic glitch, a dropped command puts two players in
different worlds permanently.

**The routing rule is the only security-relevant line in the relay:** a guest
may address the host and nothing else. Without it a modified client could send
tick schedules directly to another guest and split the match in two. The relay
also refuses control frames from clients — only it may say who joined — and
caps the player count, because player ids index fixed-size arrays in the
simulation and a fifth would read past the end of every one of them.

### The lobby

Before a match exists there is a conversation over the same socket the match
will use. Five messages (`MSG_LOBBY_*` in `packages/protocol/src/messages.ts`),
and one rule running through all of them: **the host owns the configuration and
guests send requests.** A guest asks to play the Concord and waits to be told
what the lobby now looks like; it never updates its own copy optimistically.

That is the same rule the arbiter follows for commands, for the same reason. A
lobby where two people can both change the map is a lobby where they disagree
about which map they are on, and find out at the loading screen.

The connection is handed from `LobbyGuest` to `GuestSession` at Start, on the
same socket — no second handshake, and no window in which the host has begun and
the guest is still dialling. `LobbyGuest` detaches its listener *before* telling
the caller the match started, because the host's first match message can arrive
in the very next frame and would otherwise be eaten.

**The lobby closes at Start.** From then on `HostSession` accepts only the
tokens the lobby agreed on (`HostOptions.roster`), and gives each one the player
id the lobby assigned rather than the next free number. Both halves matter: a
match that kept accepting newcomers would hand somebody a slot whose base was
never placed, and first-come numbering would renumber a player who reconnected
after someone else had already returned. Reconnect and initial join are the same
code path, so this is the one change most able to break reconnect — which is why
`roster.test.ts` asserts a dropped player still lands on their own army.

### Being reachable

This is the cost of having no server. Nothing is deployed anywhere, but the
hosting player's machine has to be reachable, and home routers forward nothing
by default.

The app tries to open the port itself, using **NAT-PMP** first and then
**UPnP IGD**, both implemented directly in `packages/desktop/src/port-forward.ts`.
The obvious npm packages for this depend on `request` — deprecated since 2020 —
and on an `xml2js` old enough to have its own CVEs; shipping that inside a
desktop binary is a worse trade than a few hundred lines of well-specified
protocol with no dependencies.

Every failure path is soft. A router that refuses, or lies, or does not answer
leaves the player with the LAN address, the exact port to forward by hand, and a
game that still starts:

```
your router did not accept an automatic port opening (no reply from router;
no UPnP router answered). Forward TCP port 47654 by hand, or play on a LAN.
```

The port is checkable without a friend to test against:

```bash
npm run build && node scripts/check-port-forward.mjs
```

### What the port exposes

One thing: the lobby protocol. Anything that is not a WebSocket upgrade gets a
flat `426` and a one-line explanation. The earlier browser build served the
client over the same port; a player's home machine should not be a web server as
well.

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

### Maps

Two ship: **Rift Basin** (256×256, four corners) and **Sprawl** (1024×1024, a
very long walk). They are content, exactly like a race — validated data files
under `packages/content/src/maps/`, folded into the content hash, so a peer with
a different idea of "Rift Basin" is refused at the door instead of desyncing on
the first order.

Terrain is a list of **blocked rectangles** rather than one entry per tile. A
1024-tile map is a million tiles; as JSON that is tens of megabytes of mostly
zeroes and an unreadable diff. Rectangles are compact, editable by hand, and map
one-to-one onto the `fillRect` the loader already calls. The files are produced
by `scripts/generate-map.mjs`, which is committed alongside them — hand-typing
three hundred rectangles is data entry, not authoring — and re-running it
reproduces them byte for byte.

zod proves each field is well-formed. It cannot prove a map is *playable*, so
`packages/content/src/map.ts` checks the rest: every start has room for a
headquarters, nothing walls a player in before the match begins, ore is not
buried under a cliff, two patches do not overlap (the second `placeStructure`
would silently fail and the map would be one rock short of what its author
drew), and every start can reach both an ore patch and a vent. Each of those is
a map that loads cleanly and is unplayable.

**1024 is the ceiling, and it is not a round number.** Q16.16 world coordinates
must stay under `FX_MAX_OPERAND` (2^26), which is 1024.0 world units, and one
tile is one world unit. See "The magnitude bound".

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
  hundred stamped circles costs **0.21 ms per tick at 400 units**, and it stays
  that cheap on a 1024-tile map — the stamping is per unit, not per tile.
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

## What a big map costs

Three things in the engine scale with map *area*, and a 1024-tile map is 64x the
area of the 128-tile map everything was tuned on. Two of them needed fixing, and
the numbers below are measured on Sprawl in Chrome 148.

**Flow fields are windowed.** A field is a Dijkstra pass from the destination,
and unwindowed on a 1024 map that is a million cells and five megabytes *per
cached destination* — tens of milliseconds against a 50 ms tick budget, for one
order. `FLOW_WINDOW` caps a field at 256 tiles square, centred on the goal and
clamped to the map, so the cost of a field is now the same on every map size:
**15.7 ms** for a fresh destination, against a **2.0 ms** steady-state tick.

A unit outside the window reads no direction and steers straight at its
destination until it enters — the same fallback already used by a unit standing
in the goal tile, so this narrows the field rather than adding a code path.
Crossing half a continent is navigated crudely and the last few hundred tiles
precisely, which is the right way round.

The window is derived from the **goal alone**. That is what keeps a field a pure
function of (grid, goal): the cache key is unchanged, and two peers cannot
window differently. 256 is also the size of the largest map that predates
windowing, so every map at or below it is covered whole and behaves exactly as
before — the determinism fixture's hash did not move.

**The fog texture is capped.** It is rebuilt and re-uploaded every simulation
tick; at one texel per tile a 1024 map is four megabytes twenty times a second,
more bandwidth than everything else the renderer does put together. Capped at
256 texels it is **256 kB**, the same on every map. Sampling at a stride is safe
because the smallest sight radius in the content is 6 tiles, so a visible patch
of ground is at least a dozen tiles across and cannot slip between samples.

**What did not need fixing:** vision (0.23 ms/tick — stamping is per unit),
terrain rendering (already one `InstancedMesh`; 20,315 instances draw in 0.53 ms
per frame), and the minimap, which only needed its fog sampled at a stride
because the canvas is 190 px across and was sampling five tiles per pixel.

**What was accepted rather than fixed:** the snapshot carries the raw cost grid,
so on Sprawl it is **1 MB**. That is a one-off on join and on reconnect, and a
Sprawl replay file is 1 MB before it contains a single command. Compressing it
is future work; the grid is mostly zeroes and would run-length encode to almost
nothing.

## Reconnecting

A connection dies for reasons that have nothing to do with either player: a
laptop sleeps, a phone changes network, a router drops a NAT binding after a
quiet minute. Without reconnect support any of those ends the match for that
person and leaves their army standing on the field being shot.

Three earlier decisions are what make it work:

- The host keeps a disconnected player's slot, keyed by a **token the client
  generates** rather than by the peer id. A peer id is the identity of a
  *socket*; reconnecting produces a new one, so keying on it would hand a
  returning player a fresh empty slot.
- Match state is exchanged as a snapshot rather than replayed, so catching up
  after any length of absence costs one message.
- The host's address does not change while it is hosting, so there is nothing to
  rediscover: the retry is the original connection attempt, verbatim.

The token has **no default**, deliberately. A shared default is worse than none:
two guests carrying the same one are, to the host, the same player reconnecting,
so the second silently takes over the first's slot and army. That is exactly
what happened the first time it had one, and the test suite now pins it.

It is not a credential. Anyone who can reach the host can claim any token they
have seen; the guarantee is "the same browser gets the same slot", not "nobody
else can take it". A four-player game between friends has no account system to
check it against, and inventing one would be security theatre.

Joining and rejoining are literally the same function, which is what stops
reconnect from being a subtly different, less-tested version of joining.

**The host still cannot be replaced.** If the host leaves, the match ends. Host
migration is genuinely tractable — under lockstep every peer already holds
bit-identical state, so it is a matter of re-electing the clock owner rather
than transferring a world — but it is not built.

## Replays

Replays cost nothing to record, which is a direct dividend of lockstep: **the
command log the arbiter already broadcasts *is* the replay**. A file is the
initial snapshot plus that log, so nothing has to be captured during play except
the occasional checkpoint hash — and a hash cannot be recovered afterwards,
which is the one thing that does have to happen live.

A 32-second match with a running economy is about 22 kB, and almost all of that
is the initial snapshot. The marginal cost per tick is a few bytes.

Playback reuses the **entire** match screen. `HostSession`, `GuestSession` and
`ReplaySession` all satisfy one narrow interface — `update`, `alpha`,
`submitLocal`, two tick hooks — so the renderer, fog, minimap and HUD are the
real ones and none of them knows the difference. Seeking backwards replays from
the start, because a simulation step is not invertible; there is no way to
un-kill a unit.

Replays are also the sharpest determinism test available. `__rts.verifyReplay()`
round-trips the current match through the file format and re-simulates it: if
the recorded and replayed hashes differ, the simulation has a non-determinism,
and one that fails reproducibly is far easier to find than a desync report from
a friend.

A replay is only meaningful against the build that recorded it — it is a command
stream, and the simulation is what turns commands into a match. The file carries
the format version, the snapshot version and the content hash, and loading
refuses on any mismatch. A replay that loaded but diverged would look exactly
like a simulation bug, and someone would reasonably spend a day chasing it.

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

- **A window index is not a map index.** A flow field covers a 256-tile window
  around its goal, so on a larger map the two index spaces differ by an offset.
  Reading one with the other does not go out of bounds — it returns a perfectly
  plausible direction for entirely the wrong tile. `dirAt`/`distAt` take map
  indices and are the only supported way in.
- **A slot vacated in the lobby is not a slot vacated mid-match.** Before the
  match there is nothing built, so the seat is freed for whoever is next. After
  it, the slot is held by token, because there is an army standing on the field
  that belongs to somebody. Treating the two the same either strands a returning
  player or blocks a seat forever.
- **`inPlay` is what stops a two-player match ending on tick one.** An
  unoccupied slot owns nothing, and owning nothing is exactly how the defeat
  check recognises a beaten player. Slots used to be filled unconditionally,
  which hid this; now that empty slots are real, the flag is load-bearing.
- **`startGame` returns a `stop()`, and it must actually be called.** Nothing
  called it while the match screen was the last thing that ever happened. Once
  you can return to a menu and start another match, skipping it leaks every
  geometry, material and texture of the previous match into the next.
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
- **A peer id identifies a socket, not a player.** Reconnecting produces a new
  one, so anything keyed on it forgets who you were. Player slots are keyed on
  a client-generated token instead.
- **An identity with a default is not an identity.** Three guests sharing a
  default token collapsed into one player slot, each silently evicting the last.
  `token` is now required, which makes the mistake impossible rather than
  merely documented.
- **A re-welcome must empty the schedule buffer.** Those ticks are already baked
  into the snapshot the host sends on rejoining; merging the old buffer back in
  runs their commands a second time, which is a desync that looks like a
  simulation bug.
- **Close the old transport before opening the new one.** Two live peer
  connections to the same host both receive tick schedules, and the session that
  loses the race keeps stepping a world nobody is watching.
- **Reject an out-of-range player slot at the door.** Player ids index
  fixed-size per-player arrays in the simulation; a fifth player would read past
  the end of every one of them.
- **A browser cannot accept an incoming connection.** That single fact is what
  forced a broker into the earlier design, and removing it is what a desktop
  build actually buys. Everything else about hosting was already possible.
- **The `Transport` interface paid for itself here.** Swapping WebRTC and a
  signalling broker for direct sockets changed the transport and the lobby and
  touched no simulation, netcode, protocol or content code at all. Keeping four
  packages free of both DOM and Node types from M0 is what made that true.
- **A guest must learn the host exists at handshake, not from traffic.**
  Inferring membership from the first message received leaves a connection
  looking empty until the host says something -- and a guest that drops before
  then never reports the loss. Membership now comes only from control frames.
- **Never infer peer membership from a data frame.** Doing so papers over a
  routing bug by inventing whatever peer the stray frame claimed to be from, and
  routing bugs are exactly the ones worth failing loudly on.
- **Buffered pipes make timestamps lie.** A renderer that appeared to crash the
  instant it loaded had in fact run happily for seventeen seconds: `grep` was
  buffering, so every line got stamped at flush. `--line-buffered` turned a
  phantom crash into a non-event. Measure the thing, then check the measurement.
- **`prefer-const` and mutually-referential closures.** Two ends of one pipe each
  need the other; a holder object breaks the cycle without either being
  reassigned, which is clearer than silencing the rule.
- **Listing a workspace package's files is not the same as making it
  resolvable.** `packages/transport/dist` was inside the asar and the app still
  could not `import "@rts/transport"`, because nothing created a `node_modules`
  entry for it. Bundling the main process is the fix; a comment claiming two
  electron-builder flags handled it was simply wrong.
- **A packaged app is a different program.** It worked from source, from `dist`,
  and unpacked; it failed only once assembled into an archive. Anything that
  can only break at packaging time has to be tested at packaging time, which is
  what `RTS_SMOKE=1` is for.
- **Many consumer routers reject a UPnP lease duration outright**, answering 500
  to any non-zero value and accepting only permanent mappings. Retrying with a
  lease of zero is the difference between "your router refused" and a game that
  works.

## Debug tooling

In development the client exposes `window.__rts`:

```js
__rts.step(n)            // advance n ticks through the arbiter
__rts.renderFrame()      // render once, without waiting for rAF
__rts.capture('name')    // save a PNG to .captures/ via the dev server
__rts.determinism()      // run the cross-runtime fixture, print its hash trace
__rts.reveal(true)       // lift the fog, for watching what an opponent is doing
__rts.verifyReplay()     // round-trip this match through the file format and re-simulate
__rts.saveReplay()       // the match so far, as a Replay object (host only)
```

And from a terminal:

```bash
node scripts/check-port-forward.mjs   # can my friends actually reach me?
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
- **M3** — Lobby and connection diagnostics ✅ *(originally WebRTC + a signaling broker; replaced in M8)*
- **M4** — Gameplay: harvesting, construction, production, combat, victory ✅
- **M5** — Content system: zod-validated race definitions, behaviour registry, race #2 ✅
- **M6** — Presentation: fog of war, minimap, control groups, command UI, art pass ✅
- **M7** — Ship: deployment, reconnect, replay playback ✅
- **M8** — Desktop: direct connections, Electron shell, automatic port forwarding ✅
- **M9** — Front end: menu, skirmish, multiplayer lobby, authored maps ✅

Next, in no committed order: a computer player that actually plays (the seam is
`packages/client/src/ai/driver.ts`), a map editor, host migration, and authored
`.glb` models in place of the procedural silhouettes.
