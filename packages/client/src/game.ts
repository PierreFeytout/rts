import { ReplayRecorder, type Replay } from "@rts/netcode";
import type { GuestSession, HostSession } from "@rts/netcode";
import { TICK_HZ, TICK_MS, hashToString, type Command, type World } from "@rts/sim";
import * as THREE from "three";
import type { AiDriver } from "./ai/driver.js";
import { MusicDirector, music } from "./audio/music.js";
import { CameraControls } from "./camera-controls.js";
import { ControlGroups } from "./control-groups.js";
import { Effects } from "./effects.js";
import { FogRenderer } from "./fog-renderer.js";
import { Hud } from "./hud.js";
import { CAMERA_DISTANCE, IsoCamera } from "./iso-camera.js";
import { groundGeometry, type TerrainMaterials } from "./materials.js";
import type { ModelLibrary } from "./model-library.js";
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
  /** Loaded once at startup; see materials.ts. */
  terrain: TerrainMaterials;
  /** Every unit and building model, authored or procedural. Loaded once at startup. */
  models: ModelLibrary;
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
  // The Ashworks: a low orange lid of a sky over ash that never settles. There
  // is no pure black anywhere in this palette -- airborne particulate scatters
  // the furnace light into every shadow. See UNIVERSE.md.
  scene.background = new THREE.Color(0x0a0806);
  // Fog distance is measured from the camera, which sits CAMERA_DISTANCE back
  // to frame the orthographic view. Ranges must straddle that, not start near
  // zero, or the whole scene renders as flat fog colour.
  // Heavy and warm. You should not be able to see the far side of a large map,
  // and the reason should read as ash in the air rather than as a draw distance.
  scene.fog = new THREE.Fog(0x1a1209, CAMERA_DISTANCE - 20, CAMERA_DISTANCE + 150);

  const rig = new IsoCamera({
    viewHeight: 44,
    bounds: { minX: 0, maxX: mapTiles, minZ: 0, maxZ: mapTiles },
  });

  const controls = new CameraControls(rig, canvas);

  // Ambient is the ash-scattered sky: weak, and tinted toward the ground it is
  // bouncing off rather than neutral grey.
  scene.add(new THREE.AmbientLight(0x3a2c22, 1.1));

  // The key is a furnace below the horizon, not a sun. Low angle, warm, and the
  // brightest thing in the world by a wide margin.
  const key = new THREE.DirectionalLight(0xe8a04a, 2.4);
  key.position.set(-60, 34, -26);
  scene.add(key);

  // One weak cold rim from overhead, and the only blue permitted anywhere. It
  // exists to separate a silhouette from the ground it is standing on; without
  // it every unit disappears into the floor, because both are the same warm
  // dark brown.
  const rim = new THREE.DirectionalLight(0x4a6a8a, 0.95);
  rim.position.set(40, 80, 55);
  scene.add(rim);

  const ground = new THREE.Mesh(
    groundGeometry(mapTiles, (tx, ty) => world.grid.inBounds(tx, ty) && world.grid.isBlocked(tx, ty)),
    options.terrain.groundMaterial(mapTiles),
  );
  ground.position.set(mapTiles / 2, 0, mapTiles / 2);
  ground.receiveShadow = false;
  scene.add(ground);

  // The per-tile GridHelper is gone. It was an M0 debugging aid, and a bright
  // blue lattice over every surface is the single most out-of-place thing that
  // could be drawn in this palette. Build placement has its own ghost.

  const terrain = new TerrainRenderer(scene, options.terrain);
  const units = new WorldRenderer(scene, rig.camera, options.models);
  const effects = new Effects(scene);
  const fog = new FogRenderer(scene, mapTiles, localPlayer);
  const selection = new Selection(world, rig, canvas, localPlayer, (command: Command) =>
    session.submitLocal(command),
  );
  const hud = new Hud(world, localPlayer, selection, (command: Command) =>
    session.submitLocal(command),
    options.models,
  );
  const groups = new ControlGroups(world, selection, rig, localPlayer);
  // Built after the HUD, because the console owns the bay it mounts into.
  const minimap = new Minimap(world, rig, localPlayer, hud.minimapBay);

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

  // The score follows the match. Reads events only, touches no simulation
  // state, and is in no hash -- two players can run completely different music
  // and still agree on every tick.
  music.scene("match");
  const conductor = new MusicDirector(localPlayer);

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
      // Shots, so a unit that fired plays its firing clip.
      units.ingest(w);
      hud.ingest(w);
      conductor.ingest(w);
      conductor.update(TICK_MS);
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
      //
      // The terrain materials are the exception, and the reason this needs a
      // guard at all: they own the generated textures, they are loaded once for
      // the life of the process, and disposing them here would leave the next
      // match rendering its ground with a destroyed texture.
      const shared = new Set<THREE.Material>([
        options.terrain.slag,
        options.terrain.groundMaterial(mapTiles),
      ]);
      scene.traverse((object) => {
        const mesh = object as Partial<THREE.Mesh>;
        const material = mesh.material;
        if (Array.isArray(material)) {
          for (const m of material) if (!shared.has(m)) m.dispose();
        } else if (material && !shared.has(material)) {
          material.dispose();
        }
        // The ground's geometry is per-map and per-match; only its material is
        // shared. Disposing it is correct.
        mesh.geometry?.dispose();
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
