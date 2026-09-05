import { HostSession } from "@rts/netcode";
import {
  TICK_HZ,
  TICK_MS,
  TILE_BLOCKED,
  World,
  enableDevChecks,
  fxFromFloat,
  hashToString,
  runDeterminismScenario,
  spawnUnit,
  type Command,
} from "@rts/sim";
import { VirtualNetwork } from "@rts/transport";
import * as THREE from "three";
import { CameraControls } from "./camera-controls.js";
import { CAMERA_DISTANCE, IsoCamera } from "./iso-camera.js";
import { Selection } from "./selection.js";
import { UnitRenderer } from "./units-renderer.js";

/**
 * M2 milestone scene: a single-player match played through the full netcode.
 *
 * The local player is the host of a match with no guests. Input is not applied
 * directly -- it goes through the arbiter, is scheduled at `tick + inputDelay`,
 * and is executed from the broadcast tick schedule, exactly as it will be with
 * other players connected. The only thing still missing is a transport that
 * reaches another machine, which is M3.
 *
 * Running the real path in single player is deliberate: netcode that is only
 * exercised once remote peers exist is netcode whose bugs all surface at the
 * worst possible moment.
 */

enableDevChecks(true);

const MAP_TILES = 64;
const LOCAL_PLAYER = 0;
const UNITS_PER_PLAYER = 100;

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

const world = new World({ mapTiles: MAP_TILES, seed: 0xc0ffee });

// Obstacles, laid out with the world's seeded RNG so the map is identical on
// every machine -- the same discipline map generation will run under later.
const obstacles: Array<[number, number, number, number]> = [];
for (let i = 0; i < 14; i++) {
  const w = world.rng.nextRange(2, 6);
  const h = world.rng.nextRange(2, 6);
  const x = world.rng.nextRange(8, MAP_TILES - 8 - w);
  const y = world.rng.nextRange(8, MAP_TILES - 8 - h);
  world.grid.fillRect(x, y, w, h, TILE_BLOCKED);
  obstacles.push([x, y, w, h]);
}

function spawnCluster(player: number, originX: number, originY: number, count: number): void {
  let placed = 0;
  let attempt = 0;
  while (placed < count && attempt < count * 40) {
    attempt++;
    const x = originX + (placed % 12) * 0.8 + world.rng.nextRange(0, 40) / 100;
    const y = originY + Math.floor(placed / 12) * 0.8;
    if (world.grid.isBlocked(Math.floor(x), Math.floor(y))) continue;
    spawnUnit(world.entities, {
      x: fxFromFloat(x),
      y: fxFromFloat(y),
      radius: fxFromFloat(0.32),
      moveSpeed: fxFromFloat(0.16),
      turnRate: 3600,
      owner: player,
      typeId: 1,
      health: 100,
    });
    placed++;
  }
}

spawnCluster(0, 4, 4, UNITS_PER_PLAYER);
spawnCluster(1, MAP_TILES - 16, MAP_TILES - 12, UNITS_PER_PLAYER);

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const canvas = document.querySelector<HTMLCanvasElement>("#viewport")!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f16);
// Fog distance is measured from the camera, which sits CAMERA_DISTANCE back to
// frame the orthographic view. Ranges must straddle that, not start near zero.
scene.fog = new THREE.Fog(0x121a26, CAMERA_DISTANCE - 30, CAMERA_DISTANCE + 190);

const rig = new IsoCamera({
  viewHeight: 44,
  bounds: { minX: 0, maxX: MAP_TILES, minZ: 0, maxZ: MAP_TILES },
});
rig.lookAtGround(12, 12);

const controls = new CameraControls(rig, canvas);

scene.add(new THREE.AmbientLight(0x4a5a78, 1.4));
const key = new THREE.DirectionalLight(0xcfe4ff, 2.2);
key.position.set(-40, 70, -30);
scene.add(key);
const fill = new THREE.DirectionalLight(0xff9a5c, 0.5);
fill.position.set(50, 25, 40);
scene.add(fill);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(MAP_TILES, MAP_TILES),
  new THREE.MeshStandardMaterial({ color: 0x1b2433, roughness: 0.95 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.set(MAP_TILES / 2, 0, MAP_TILES / 2);
scene.add(ground);

const grid = new THREE.GridHelper(MAP_TILES, MAP_TILES, 0x24506b, 0x1a2534);
grid.position.set(MAP_TILES / 2, 0.01, MAP_TILES / 2);
scene.add(grid);

// Obstacles are drawn from the same rectangles that blocked the cost grid, so
// what the player sees and what pathfinding believes cannot drift apart.
const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x2c3a4f, roughness: 0.85 });
for (const [x, y, w, h] of obstacles) {
  const height = 1.2 + ((x * 7 + y * 13) % 10) / 10;
  const rock = new THREE.Mesh(new THREE.BoxGeometry(w, height, h), rockMaterial);
  rock.position.set(x + w / 2, height / 2, y + h / 2);
  scene.add(rock);
}

const units = new UnitRenderer(scene, 1024);

/**
 * The local player hosts a one-player match.
 *
 * Even with nobody connected, input goes through the full lockstep path:
 * commands are scheduled at `tick + inputDelay` and executed from the broadcast
 * schedule, exactly as they will be with guests present. Running the real path
 * in single player means M3 changes only which transport gets constructed,
 * rather than discovering then that the netcode had never actually been driven.
 *
 * The virtual network here holds a single peer and no links, so `broadcast` is
 * a no-op until a real transport replaces it.
 */
const network = new VirtualNetwork();
const session = new HostSession({
  world,
  transport: network.addPeer(0),
  // Snapshot transforms before each step so the renderer can interpolate.
  onBeforeTick: (w) => units.capturePrevious(w),
});

function emitCommand(command: Command): void {
  session.submitLocal(command);
}

const selection = new Selection(world, rig, canvas, LOCAL_PLAYER, emitCommand);

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

const hud = document.querySelector<HTMLDivElement>("#hud")!;

let lastFrameMs = performance.now();
let lastPumpMs = lastFrameMs;
let framesThisSecond = 0;
let fpsWindowStart = lastFrameMs;
let fps = 0;
let lastStepMs = 0;

function resize(): void {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  rig.setViewport(w, h);
}
window.addEventListener("resize", resize);
resize();

/**
 * Advance the simulation by however many whole ticks are due.
 *
 * Deliberately not driven by requestAnimationFrame: browsers stop firing rAF
 * for hidden tabs, and since the host client is also the lockstep arbiter, an
 * rAF-driven simulation would stall the match for everyone the moment the host
 * alt-tabbed. Idempotent in elapsed time, so calling it from both the timer and
 * the render loop is safe.
 */
function pumpSimulation(nowMs: number): void {
  const deltaMs = nowMs - lastPumpMs;
  lastPumpMs = nowMs;

  const started = performance.now();
  const steps = session.update(deltaMs);
  if (steps === 0) return;

  lastStepMs = (performance.now() - started) / steps;
  selection.pruneDead();
}

setInterval(() => pumpSimulation(performance.now()), TICK_MS / 2);

function renderFrame(): void {
  units.update(world, session.alpha, selection.selected);
  renderer.render(scene, rig.camera);

  hud.textContent =
    `${fps} fps   tick ${world.tick} @ ${TICK_HZ}Hz   step ${lastStepMs.toFixed(2)}ms` +
    `\n${world.entities.count} units   ${selection.selected.size} selected` +
    `   fields built ${world.flowFields.builds}` +
    `\nhash ${hashToString(world.hash())}   input delay ${session.inputDelay}t`;
}

function frame(nowMs: number): void {
  requestAnimationFrame(frame);
  const deltaMs = nowMs - lastFrameMs;
  lastFrameMs = nowMs;

  controls.update(deltaMs / 1000);
  pumpSimulation(nowMs);
  renderFrame();

  framesThisSecond++;
  if (nowMs - fpsWindowStart >= 500) {
    fps = Math.round((framesThisSecond * 1000) / (nowMs - fpsWindowStart));
    framesThisSecond = 0;
    fpsWindowStart = nowMs;
  }
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------------------
// Debug handle for headless verification and screenshot tooling.
// Needed because a hidden or offscreen tab never fires rAF, so automated checks
// cannot rely on the render loop having run.
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __rts?: {
      world: World;
      rig: IsoCamera;
      session: HostSession;
      selection: Selection;
      renderFrame: () => void;
      step: (n: number, commands?: Command[]) => void;
      capture: (name?: string, width?: number) => Promise<unknown>;
      /**
       * Run the cross-runtime determinism fixture and print its hash trace.
       * Compare against `node scripts/determinism-trace.mjs`, and against the
       * same call in another browser engine.
       */
      determinism: () => unknown;
    };
  }
}

async function capture(name = "frame", width = 1200): Promise<unknown> {
  renderFrame();
  const off = document.createElement("canvas");
  off.width = width;
  off.height = Math.round((width * canvas.height) / canvas.width);
  // The readback must share a synchronous block with the render: the WebGL
  // drawing buffer is cleared on present, so a deferred copy comes back blank.
  off.getContext("2d")!.drawImage(canvas, 0, 0, off.width, off.height);
  const dataUrl = off.toDataURL("image/png");

  const res = await fetch("/__capture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, dataUrl }),
  });
  return res.json();
}

if (import.meta.env.DEV) {
  window.__rts = {
    world,
    rig,
    session,
    selection,
    renderFrame,
    step: (n: number, commands?: Command[]) => {
      // Goes through the arbiter, so stepping here exercises the same
      // scheduling path as real input rather than bypassing it.
      if (commands) for (const command of commands) session.submitLocal(command);
      for (let i = 0; i < n; i++) session.advanceOneTick();
    },
    capture,
    determinism: () => {
      const result = runDeterminismScenario();
      const out = {
        runtime: navigator.userAgent,
        ticks: result.ticks,
        units: result.unitCount,
        finalHash: result.finalHash.toString(16).padStart(8, "0"),
        trace: result.hashes.map((h) => h.toString(16).padStart(8, "0")),
      };
       
      console.log("[determinism]", JSON.stringify(out, null, 2));
      return out;
    },
  };
}
