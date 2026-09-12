import { defaultContent } from "@rts/content";
import { decodeReplay, encodeReplay, playReplay } from "@rts/netcode";
import {
  enableDevChecks,
  runDeterminismScenario,
  snapshotMapTiles,
  type Command,
} from "@rts/sim";
import { startGame, type RunningGame } from "./game.js";
import { loadTerrain } from "./materials.js";
import { createEmptyWorld } from "./match.js";
import { Reconnector } from "./reconnect.js";
import { ReplayControls, downloadReplay } from "./replay-ui.js";
import { chooseMatch, type Launch } from "./screens/router.js";
import { installStyles } from "./ui.js";

/**
 * Entry point: menu, then a match, then the menu again.
 *
 * Host, guest and replay take the same path from here. The router hands back a
 * world and a session; nothing downstream branches on which kind it is.
 */

// Fixed-point assertions on in development, so a magnitude-bound violation
// surfaces at its source rather than as a desync minutes later.
enableDevChecks(import.meta.env.DEV);
installStyles();

// Decoded once, before the menu is even shown. Six PNGs take long enough to be
// a visible hitch, and the moment it would otherwise land is exactly when the
// player has just pressed Start.
const terrain = await loadTerrain();

for (;;) {
  const launch = await chooseMatch();
  await runMatch(launch);
  await launch.release();
}

/** Run one match, and resolve when the player is finished with it. */
async function runMatch(launch: Launch): Promise<void> {
  const game = startGame({
    world: launch.world,
    session: launch.session,
    localPlayer: launch.localPlayer,
    isHost: launch.isHost,
    mapTiles: launch.world.mapTiles,
    ai: launch.ai,
    terrain,
  });

  const cleanup: Array<() => void> = [];

  // Watching a recording: transport controls instead of a HUD command card, and
  // no netcode at all -- the match screen does not know the difference. See
  // MatchSession.
  if (launch.replay) {
    const controls = new ReplayControls(launch.replay);
    let running = true;
    const frame = (): void => {
      if (!running) return;
      controls.sync();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    cleanup.push(() => {
      running = false;
      controls.dispose();
    });
  } else if (game.saveReplay) {
    // Host only: a guest never sees the authoritative command log.
    cleanup.push(
      cornerButton("save replay", 34, () => downloadReplay(game.saveReplay!()), "saved"),
    );
  }

  // Guests survive a dropped connection. The host does not: there is nobody for
  // it to reconnect to, and its departure ends the match for everyone.
  if (launch.reconnect) {
    const { address, token, name, connection } = launch.reconnect;
    const reconnector = new Reconnector(
      {
        address,
        token,
        name,
        world: launch.world,
        onReconnected: (next) => {
          game.setSession(next.session);
          game.setBanner(null);
        },
        onStatus: (message, tone) => {
          game.setBanner(tone === "error" ? message : null);
        },
      },
      connection,
    );
    const stop = (): void => reconnector.stop();
    window.addEventListener("beforeunload", stop);
    cleanup.push(() => {
      stop();
      window.removeEventListener("beforeunload", stop);
    });
  }

  exposeDevHandle(game, launch);

  await new Promise<void>((resolve) => {
    cleanup.push(cornerButton("leave match", 10, () => resolve()));
  });

  for (const undo of cleanup) undo();
  game.stop();
  delete window.__rts;
}

/**
 * A button in the **top-right** corner of the match screen.
 *
 * It was the bottom-right corner until the console moved in there and put the
 * command card underneath both of these. Stacked by offset rather than laid
 * out, because there are two of them and a container would be more code than
 * the thing it contained. Returns its own remover, so the match teardown is a
 * list of undos rather than a list of queries.
 *
 * `top` is measured from below the resource readout, which owns that corner.
 */
function cornerButton(
  label: string,
  top: number,
  onClick: () => void,
  confirmation?: string,
): () => void {
  const button = document.createElement("button");
  button.textContent = label;
  button.style.cssText =
    `position:fixed;top:${top + 38}px;right:12px;z-index:13;padding:4px 10px;` +
    "border:1px solid var(--line-2);border-radius:4px;background:rgba(16,12,9,0.8);" +
    "color:var(--muted);font:11px/1.5 var(--mono);cursor:pointer";
  button.onclick = () => {
    onClick();
    // Saving reports back in place, because nothing else visibly happens.
    // Leaving does not: the button is about to be removed.
    if (confirmation === undefined) return;
    button.textContent = confirmation;
    setTimeout(() => (button.textContent = label), 1500);
  };
  document.body.appendChild(button);
  return () => button.remove();
}

// ---------------------------------------------------------------------------
// Debug handle for headless verification and screenshot tooling.
// A hidden or offscreen tab never fires rAF, so automated checks cannot rely on
// the render loop having run.
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __rts?: RunningGame & {
      isHost: boolean;
      localPlayer: number;
      step: (n: number, commands?: Command[]) => void;
      determinism: () => unknown;
    };
  }
}

function exposeDevHandle(game: RunningGame, launch: Launch): void {
  if (!import.meta.env.DEV) return;

  window.__rts = Object.assign(game, {
    isHost: launch.isHost,
    localPlayer: launch.localPlayer,
    reveal: (on = true) => game.revealMap(on),
    /**
     * Round-trip the match through the replay file format and re-simulate it.
     *
     * The sharpest determinism check available, and cheap to run: if a recorded
     * match does not reproduce its own final hash, the simulation has a
     * non-determinism -- and one that fails reproducibly here is far easier to
     * find than a desync report from a friend.
     */
    verifyReplay: () => {
      if (!game.saveReplay) return { ok: false, reason: "guests have no command log" };
      const replay = game.saveReplay();
      const bytes = encodeReplay(replay, defaultContent.hash, Date.now());
      const decoded = decodeReplay(bytes, defaultContent.hash);
      const result = playReplay(createEmptyWorld(snapshotMapTiles(decoded.initialSnapshot)), decoded);
      return {
        bytes: bytes.byteLength,
        ticks: replay.commands.length,
        checkpoints: replay.checkpoints.length,
        recordedHash: replay.finalHash.toString(16),
        replayedHash: result.finalHash.toString(16),
        ok: result.ok && result.finalHash === replay.finalHash,
        divergedAtTick: result.divergedAtTick,
      };
    },
    replayBytes: () =>
      game.saveReplay ? encodeReplay(game.saveReplay(), defaultContent.hash, Date.now()) : null,
    step: (n: number, commands?: Command[]) => {
      // Goes through the session, so stepping exercises the real scheduling
      // path rather than bypassing the arbiter.
      if (commands) for (const command of commands) game.session.submitLocal(command);
      const host = game.session as { advanceOneTick?: () => void };
      if (!host.advanceOneTick) return;
      for (let i = 0; i < n; i++) host.advanceOneTick();
    },
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
  });
}
