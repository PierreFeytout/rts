import type { GuestSession, HostSession } from "@rts/netcode";
import { TICK_HZ, TICK_MS, hashToString, type Command, type World } from "@rts/sim";
import * as THREE from "three";
import { CameraControls } from "./camera-controls.js";
import { Effects } from "./effects.js";
import { Hud } from "./hud.js";
import { CAMERA_DISTANCE, IsoCamera } from "./iso-camera.js";
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

export interface GameOptions {
  world: World;
  session: HostSession | GuestSession;
  localPlayer: number;
  isHost: boolean;
  mapTiles: number;
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
  session: HostSession | GuestSession;
  rig: IsoCamera;
  selection: Selection;
  renderFrame: () => void;
  capture: (name?: string, width?: number) => Promise<unknown>;
  stop: () => void;
}

export function startGame(options: GameOptions): RunningGame {
  const { world, session, localPlayer, isHost, mapTiles } = options;

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
  const selection = new Selection(world, rig, canvas, localPlayer, (command: Command) =>
    session.submitLocal(command),
  );
  const hud = new Hud(world, localPlayer, selection, (command: Command) =>
    session.submitLocal(command),
  );

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
  session.onBeforeTick = (w) => units.capturePrevious(w);
  session.onAfterTick = (w) => {
    effects.ingest(w);
    hud.ingest(w);
  };

  // Frame the player's own units, so a guest does not open looking at empty map.
  centreOnPlayerUnits(world, localPlayer, rig, mapTiles);

  // ---------------------------------------------------------------------------

  const debug = document.querySelector<HTMLDivElement>("#hud")!;
  let lastFrameMs = performance.now();
  let lastPumpMs = lastFrameMs;
  let framesThisSecond = 0;
  let fpsWindowStart = lastFrameMs;
  let fps = 0;
  let lastStepMs = 0;
  let running = true;

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
    units.update(world, session.alpha, selection.selected);
    effects.update(deltaSeconds);
    updateGhost();
    hud.update();
    renderer.render(scene, rig.camera);

    const peers = isHost
      ? (session as HostSession).players.filter((p) => p.connected).length - 1
      : (session as GuestSession).isJoined
        ? 1
        : 0;

    // Hashing walks the whole world; once per frame, reused for both consumers.
    const hash = hashToString(world.hash());

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
    session,
    rig,
    selection,
    renderFrame,
    capture,
    stop() {
      running = false;
      clearInterval(pumpTimer);
      controls.dispose();
      selection.dispose();
      hud.dispose();
      window.removeEventListener("resize", resize);
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
