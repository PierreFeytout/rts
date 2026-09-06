import { ReplayRecorder, type Replay } from "@rts/netcode";
import type { GuestSession, HostSession } from "@rts/netcode";
import { TICK_HZ, TICK_MS, hashToString, type Command, type World } from "@rts/sim";
import * as THREE from "three";
import type { AiDriver } from "./ai/driver.js";
import { CameraControls } from "./camera-controls.js";
import { ControlGroups } from "./control-groups.js";
import { Effects } from "./effects.js";
import { FogRenderer } from "./fog-renderer.js";
import { Hud } from "./hud.js";
import { CAMERA_DISTANCE, IsoCamera } from "./iso-camera.js";
import { Minimap } from "./minimap.js";
import { Selection } from "./selection.js";
import { TerrainRenderer } from "./terrain-renderer.js";
import { WorldRenderer } from "./world-renderer.js";

/**
 * The running match: renderer, input, and the loop that drives the session.
 *
 * Host and guest differ only in which session object is passed in. Everything
 * below treats them identically -- both expose `update`, `alpha` and
 * `submitLocal` -- so there is no branch anywhere in the render or input path
 * on who is arbitrating.
 */

/**
 * What the match screen needs from whatever is driving ticks.
 *
 * Narrow on purpose. `HostSession`, `GuestSession` and `ReplaySession` all
 * satisfy it, which is why watching a replay reuses the entire match screen --
 * the renderer, fog, minimap and HUD are the real ones and none of them knows
 * the difference.
 */
export interface MatchSession {
  update(deltaMs: number): number;
  readonly alpha: number;
  submitLocal(command: Command): void;
  onBeforeTick?: ((world: World) => void) | undefined;
  onAfterTick?: ((world: World) => void) | undefined;
}

export interface GameOptions {
  world: World;
  session: MatchSession;
  localPlayer: number;
  isHost: boolean;
  mapTiles: number;
  /**
   * Computer players, by slot. Host only.
   *
   * They live here rather than beside the session because their output is
   * commands and this is where commands are submitted. A guest is given none:
   * the host runs every computer player and broadcasts what they decided, so
   * all peers execute identical orders. See ai/driver.ts.
   */
  ai?: Map<number, AiDriver>;
  /** Rendered in the HUD so a player can read their code back out mid-game. */
  joinCode?: string;
  onStatus?: (status: GameStatus) => void;
}

export interface GameStatus {
  tick: number;
  fps: number;
  peers: number;
  hash: string;
}

export interface RunningGame {
  world: World;
  session: MatchSession;
  /**
   * Swap in a new session after a reconnect.
   *
   * The world object is unchanged -- the renderer, selection and HUD all hold
   * a reference to it -- so only the thing driving ticks is replaced.
   */
  setSession: (next: MatchSession) => void;
  /**
   * The match so far, as a replay. Host only -- a guest never sees the
   * authoritative command log, and reconstructing one from its own schedules
   * would be a second, less trustworthy source of truth.
   */
  saveReplay: (() => Replay) | null;
  /** Shown over the match while a reconnect is in progress. */
  setBanner: (message: string | null) => void;
  rig: IsoCamera;
  selection: Selection;
  /** Exposed for the dev console: inspecting materials beats guessing. */
  scene: THREE.Scene;
  /** Reveal the whole map. Debugging aid; see VisionGrid.enabled. */
  revealMap: (on: boolean) => void;
  renderFrame: () => void;
  capture: (name?: string, width?: number) => Promise<unknown>;
  stop: () => void;
}

export function startGame(options: GameOptions): RunningGame {
  const { world, localPlayer, isHost, mapTiles } = options;
  let session = options.session;

  const canvas = document.querySelector<HTMLCanvasElement>("#viewport")!;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f16);
  // Fog distance is measured from the camera, which sits CAMERA_DISTANCE back
  // to frame the orthographic view. Ranges must straddle that, not start near
  // zero, or the whole scene renders as flat fog colour.
  scene.fog = new THREE.Fog(0x121a26, CAMERA_DISTANCE - 30, CAMERA_DISTANCE + 190);

  const rig = new IsoCamera({
    viewHeight: 44,
    bounds: { minX: 0, maxX: mapTiles, minZ: 0, maxZ: mapTiles },
  });

  const controls = new CameraControls(rig, canvas);

  scene.add(new THREE.AmbientLight(0x4a5a78, 1.4));
  const key = new THREE.DirectionalLight(0xcfe4ff, 2.2);
  key.position.set(-40, 70, -30);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xff9a5c, 0.5);
  fill.position.set(50, 25, 40);
  scene.add(fill);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(mapTiles, mapTiles),
    new THREE.MeshStandardMaterial({ color: 0x1b2433, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(mapTiles / 2, 0, mapTiles / 2);
  scene.add(ground);

  const grid = new THREE.GridHelper(mapTiles, mapTiles, 0x24506b, 0x1a2534);
  grid.position.set(mapTiles / 2, 0.01, mapTiles / 2);
  scene.add(grid);

  const terrain = new TerrainRenderer(scene);
  const units = new WorldRenderer(scene, rig.camera);
  const effects = new Effects(scene);
  const fog = new FogRenderer(scene, mapTiles, localPlayer);
  const selection = new Selection(world, rig, canvas, localPlayer, (command: Command) =>
    session.submitLocal(command),
  );
  const hud = new Hud(world, localPlayer, selection, (command: Command) =>
    session.submitLocal(command),
  );
  const groups = new ControlGroups(world, selection, rig, localPlayer);
  const minimap = new Minimap(world, rig, localPlayer);

  // Translucent footprint preview shown while placing a building.
  const ghost = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    new THREE.MeshBasicMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.35 }),
  );
  ghost.visible = false;
  scene.add(ghost);

  // Interpolation needs the pre-step transforms, and effects need the events
  // that a step produced -- both per tick, not per frame. A renderer that
  // sampled after `update()` would miss every tick but the last of a catch-up
  // burst, which is exactly when the most is happening.
  const ai = options.ai ?? new Map<number, AiDriver>();

  function wireTickHooks(target: MatchSession): void {
    target.onBeforeTick = (w) => {
      // Through `submitLocal`, so a computer player's orders are scheduled at
      // T+delay exactly like a human's and every peer runs the same ones.
      for (const [player, driver] of ai) {
        driver.onTick(w, player, (command) => session.submitLocal(command));
      }
      units.capturePrevious(w);
    };
    target.onAfterTick = (w) => {
      effects.ingest(w);
      hud.ingest(w);
      recorder?.checkpoint(w);
    };
  }
  wireTickHooks(session);

  // Frame the player's own units, so a guest does not open looking at empty map.
  centreOnPlayerUnits(world, localPlayer, rig, mapTiles);

  // Replay recording, host only. The host's command log IS the replay -- that
  // is the dividend lockstep pays -- so the only thing that has to be captured
  // during play is the state it started from, plus the occasional checkpoint
  // hash so a divergence can be bisected rather than merely detected.
  const recorder = isHost ? new ReplayRecorder(world) : null;

  // ---------------------------------------------------------------------------

  const debug = document.querySelector<HTMLDivElement>("#hud")!;

  // Match-level status, shown over everything. Distinct from the HUD's own
  // transient toasts: this one stays up until the situation resolves.
  const banner = document.createElement("div");
  banner.style.cssText =
    "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:16;display:none;" +
    "padding:14px 26px;border:1px solid #5a2f2a;border-radius:8px;background:rgba(8,12,20,0.92);" +
    "color:#ffb4a0;backdrop-filter:blur(4px);" +
    "font:15px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
  document.body.appendChild(banner);
  let lastFrameMs = performance.now();
  let lastPumpMs = lastFrameMs;
  let framesThisSecond = 0;
  let fpsWindowStart = lastFrameMs;
  let fps = 0;
  let lastStepMs = 0;
  let running = true;
  let cachedHash = "";
  let lastHashMs = 0;

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
   * Deliberately not driven by requestAnimationFrame. Browsers stop firing rAF
   * for hidden tabs, and the host client is also the lockstep arbiter -- an
   * rAF-driven simulation would stall the match for every player the moment the
   * host alt-tabbed. Idempotent in elapsed time, so calling it from both the
   * timer and the render loop is safe.
   */
  function pump(nowMs: number): void {
    const deltaMs = nowMs - lastPumpMs;
    lastPumpMs = nowMs;

    const started = performance.now();
    const steps = session.update(deltaMs);
    if (steps === 0) return;
    lastStepMs = (performance.now() - started) / steps;
    selection.pruneDead();
  }

  const pumpTimer = setInterval(() => {
    if (running) pump(performance.now());
  }, TICK_MS / 2);

  function updateGhost(): void {
    const tile = selection.ghostTile;
    if (selection.buildType === 0 || !tile) {
      ghost.visible = false;
      return;
    }
    const type = world.types.get(selection.buildType);
    const span = type.footprint;

    let clear = true;
    for (let y = tile.y; y < tile.y + span && clear; y++) {
      for (let x = tile.x; x < tile.x + span; x++) {
        if (!world.grid.inBounds(x, y) || world.grid.isBlocked(x, y)) {
          clear = false;
          break;
        }
      }
    }

    ghost.visible = true;
    ghost.position.set(tile.x + span / 2, 0, tile.y + span / 2);
    ghost.scale.set(span, span * 0.7, span);
    // Green for a legal placement, red otherwise. Note that "clear" here is the
    // client's own read of the grid; the simulation re-checks it when the
    // command executes a few ticks later, and can still refuse.
    (ghost.material as THREE.MeshBasicMaterial).color.setHex(clear ? 0x7dffb0 : 0xff7a59);
  }

  function renderFrame(deltaSeconds = 0): void {
    terrain.sync(world.grid);
    terrain.applyFog(world, localPlayer);
    fog.update(world);
    units.update(world, session.alpha, selection.selected, localPlayer);
    effects.update(deltaSeconds);
    updateGhost();
    hud.update();
    minimap.draw(performance.now());
    renderer.render(scene, rig.camera);

    const peers = isHost
      ? (session as HostSession).players.filter((p) => p.connected).length - 1
      : (session as GuestSession).isJoined
        ? 1
        : 0;

    // Hashing walks the whole world -- entities, players, and the full cost
    // grid. That is cheap at 20 Hz and wasteful at 240, so the HUD's copy is
    // refreshed a few times a second rather than every frame.
    const now = performance.now();
    if (now - lastHashMs > 400) {
      lastHashMs = now;
      cachedHash = hashToString(world.hash());
    }
    const hash = cachedHash;

    debug.textContent =
      `${fps} fps   tick ${world.tick} @ ${TICK_HZ}Hz   step ${lastStepMs.toFixed(2)}ms` +
      `\n${world.entities.count} entities   ${selection.selected.size} selected` +
      `   ${isHost ? "hosting" : "guest"}   ${peers} peer${peers === 1 ? "" : "s"}` +
      (options.joinCode ? `   code ${options.joinCode}` : "") +
      `\nhash ${hash}   player ${localPlayer}`;

    options.onStatus?.({ tick: world.tick, fps, peers, hash });
  }

  function frame(nowMs: number): void {
    if (!running) return;
    requestAnimationFrame(frame);
    const deltaMs = nowMs - lastFrameMs;
    lastFrameMs = nowMs;

    controls.update(deltaMs / 1000);
    pump(nowMs);
    renderFrame(deltaMs / 1000);

    framesThisSecond++;
    if (nowMs - fpsWindowStart >= 500) {
      fps = Math.round((framesThisSecond * 1000) / (nowMs - fpsWindowStart));
      framesThisSecond = 0;
      fpsWindowStart = nowMs;
    }
  }
  requestAnimationFrame(frame);

  /**
   * Render one frame and save it through the dev server's capture endpoint.
   *
   * The readback must share a synchronous block with the render: the WebGL
   * drawing buffer is cleared on present, so a deferred copy comes back blank.
   */
  async function capture(name = "frame", width = 1200): Promise<unknown> {
    renderFrame();
    const off = document.createElement("canvas");
    off.width = width;
    off.height = Math.round((width * canvas.height) / canvas.width);
    off.getContext("2d")!.drawImage(canvas, 0, 0, off.width, off.height);
    const res = await fetch("/__capture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, dataUrl: off.toDataURL("image/png") }),
    });
    return res.json();
  }

  return {
    world,
    get session() {
      return session;
    },
    setSession(next: MatchSession) {
      session = next;
      wireTickHooks(next);
      // The clock restarts from now. Without this the first pump after a
      // reconnect is handed however many seconds the player spent offline and
      // tries to run every one of those ticks at once.
      lastPumpMs = performance.now();
    },
    saveReplay: recorder
      ? () => recorder.finishFrom(world, (session as HostSession).log)
      : null,
    setBanner(message: string | null) {
      banner.textContent = message ?? "";
      banner.style.display = message === null ? "none" : "block";
    },
    rig,
    selection,
    scene,
    renderFrame,
    capture,
    revealMap(on: boolean) {
      // Flipping this on one peer only would desync a match, since fog gates
      // target acquisition. It is for looking at a solo game.
      world.vision.enabled = !on;
    },
    stop() {
      running = false;
      clearInterval(pumpTimer);
      controls.dispose();
      selection.dispose();
      hud.dispose();
      banner.remove();
      groups.dispose();
      minimap.dispose();
      fog.dispose();
      terrain.dispose();
      window.removeEventListener("resize", resize);

      // The scene's own resources. Nothing used to call `stop` at all, so this
      // never mattered; now that a match can end and another begin, skipping it
      // leaks every geometry, material and texture of the previous match into
      // the next one -- and on the third or fourth match that is visible as a
      // browser tab using a gigabyte.
      scene.traverse((object) => {
        const mesh = object as Partial<THREE.Mesh>;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) for (const m of material) m.dispose();
        else material?.dispose();
      });
      scene.clear();
      renderer.dispose();
      // Leaves the canvas holding the last frame, which is what the menu
      // fading in over it should cover rather than a flash of white.
    },
  };
}

/** Point the camera at the local player's units, or the map centre if it has none. */
function centreOnPlayerUnits(
  world: World,
  localPlayer: number,
  rig: IsoCamera,
  mapTiles: number,
): void {
  const e = world.entities;
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let i = 0; i < e.highWater; i++) {
    if (e.alive[i] !== 1 || e.owner[i] !== localPlayer) continue;
    sumX += e.posX[i] / 65536;
    sumY += e.posY[i] / 65536;
    count++;
  }
  if (count === 0) rig.lookAtGround(mapTiles / 2, mapTiles / 2);
  else rig.lookAtGround(sumX / count, sumY / count);
}
