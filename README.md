# RTS

A futuristic real-time strategy game. 2.5D isometric, peer-hosted multiplayer —
the player who creates the game hosts it, with no dedicated server to deploy.

**Status: M1 complete.** Deterministic simulation core with flow-field
pathfinding, crowd separation and per-tick state hashing, driven from the client
by drag-select and right-click move orders. 200 units path around obstacles at
~0.7 ms/tick against a 50 ms budget. No networking yet.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # simulation test suite
npm run typecheck  # tsc project references
npm run lint       # includes the determinism rules
```

Controls: left click or drag to select (shift to add), right click to issue a
move order, `WASD`/arrows or middle-drag to pan, wheel to zoom.

## Layout

| Package | Role |
|---|---|
| `packages/sim` | Deterministic simulation. **Zero dependencies, no DOM, no Node APIs.** |
| `packages/client` | Vite + Three.js renderer, input, and (later) the host arbiter |

Inside `packages/sim`: `fixed` (Q16.16 math), `rng`, `clock` (tick pacing),
`hash` (state hashing), `entities` (SoA store), `grid` (passability),
`flowfield` (Dijkstra pathing), `spatial` (neighbour queries), `commands`,
and `world` (ties it together; `step()` is the only mutator).

Planned: `content` (race/unit definitions), `protocol` (wire format),
`transport` (WebRTC / WebSocket / in-memory), `signaling` (join-code broker).

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

## Debug tooling

In development the client exposes `window.__rts`:

```js
__rts.step(n)            // advance n simulation ticks
__rts.renderFrame()      // render once, without waiting for rAF
__rts.capture('name')    // save a PNG to .captures/ via the dev server
```

`capture` exists because a browser cannot write files, and because in a hidden
or offscreen tab the compositor never produces frames — ordinary screenshot
tooling captures nothing there, while a WebGL readback still works.

## Roadmap

- **M0** — Skeleton, fixed-point math, tick loop, isometric renderer ✅
- **M1** — Simulation core: entity store, spatial hash, flow-field pathing, state hashing ✅
- **M2** — Netcode: protocol, transport interface, host arbiter, desync detection, replays
- **M3** — WebRTC + lobby: signaling broker, join codes, connection diagnostics
- **M4** — Gameplay: harvesting, construction, production, combat, victory
- **M5** — Content system: zod-validated race definitions, behavior registry, stub race #2
- **M6** — Presentation: fog of war, minimap, control groups, command UI, art pass
- **M7** — Ship: broker deployment, reconnect, replay playback
