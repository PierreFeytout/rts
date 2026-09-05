# RTS

A futuristic real-time strategy game. 2.5D isometric, peer-hosted multiplayer —
the player who creates the game hosts it, with no dedicated server to deploy.

**Status: M3 complete — it is now actually multiplayer.** Host a game, get a
six-character code, send it to a friend, and play over a direct WebRTC
connection. Verified between two browsers: a command issued in one moved units
in the other's world with zero desyncs, and the match kept running after the
signaling server was killed outright.

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

For development, with hot reload:

```bash
npm run build && npm run broker   # signaling on :8080
npm run dev                       # client on :5173, finds the broker automatically
```

```bash
npm test           # 201 tests
npm run typecheck
npm run lint       # includes the determinism rules
```

Controls: left click or drag to select (shift to add), right click to issue a
move order, `WASD`/arrows or middle-drag to pan, wheel to zoom.

## Layout

| Package | Role |
|---|---|
| `packages/sim` | Deterministic simulation. **Zero dependencies, no DOM, no Node APIs.** |
| `packages/transport` | `Transport` interface + in-memory virtual network. No DOM, no Node. |
| `packages/protocol` | Wire messages and MessagePack codec |
| `packages/netcode` | Host arbiter, guest session, replay. No DOM, no Node. |
| `packages/signaling` | The one always-on process: WebSocket broker + static file server |
| `packages/client` | Vite + Three.js renderer, lobby, input |

Inside `packages/sim`: `fixed` (Q16.16 math), `rng`, `clock` (tick pacing),
`hash` (state hashing), `entities` (SoA store), `grid` (passability),
`flowfield` (Dijkstra pathing), `spatial` (neighbour queries), `commands`,
`snapshot` (serialisation), `scenario` (determinism fixture), and `world`
(`step()` is the only mutator).

Three packages deliberately avoid both DOM and Node types. That is what lets the
identical arbiter run in the host's browser tab today and in a headless
dedicated server later, with only the transport swapped.

Planned: `content` (race/unit definitions).

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

Current status: **Node v22.15 and Chrome 148 agree** on all 12 checkpoints
across 600 ticks of pathfinding, crowd separation, trigonometry and division.

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

## Things that are easy to get wrong

Learned while building M0, recorded so they are not re-learned:

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

## Debug tooling

In development the client exposes `window.__rts`:

```js
__rts.step(n)            // advance n ticks through the arbiter
__rts.renderFrame()      // render once, without waiting for rAF
__rts.capture('name')    // save a PNG to .captures/ via the dev server
__rts.determinism()      // run the cross-runtime fixture, print its hash trace
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
- **M4** — Gameplay: harvesting, construction, production, combat, victory
- **M5** — Content system: zod-validated race definitions, behavior registry, stub race #2
- **M6** — Presentation: fog of war, minimap, control groups, command UI, art pass
- **M7** — Ship: broker deployment, reconnect, replay playback
