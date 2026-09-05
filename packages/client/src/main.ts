import { defaultContent } from "@rts/content";
import { decodeReplay, encodeReplay, playReplay } from "@rts/netcode";
import { enableDevChecks, runDeterminismScenario, type Command } from "@rts/sim";
import { startGame, type RunningGame } from "./game.js";
import { showLobby } from "./lobby.js";
import { MAP_TILES, createEmptyWorld } from "./match.js";
import { Reconnector } from "./reconnect.js";
import { ReplayControls, downloadReplay } from "./replay-ui.js";

/**
 * Entry point: show the lobby, then run whatever match it produced.
 *
 * Host and guest take the same path from here. The lobby hands back a world and
 * a session; nothing downstream branches on which kind it is.
 */

// Fixed-point assertions on in development, so a magnitude-bound violation
// surfaces at its source rather than as a desync minutes later.
enableDevChecks(import.meta.env.DEV);

const setup = await showLobby();

const game = startGame({
  world: setup.world,
  session: setup.session,
  localPlayer: setup.localPlayer,
  isHost: setup.isHost,
  mapTiles: MAP_TILES,
  ...(setup.joinCode !== undefined ? { joinCode: setup.joinCode } : {}),
});

if (setup.joinCode && setup.isHost) {
  showJoinCode(setup.joinCode);
}

// Watching a recording: transport controls instead of a lobby, and no netcode
// at all -- the match screen does not know the difference. See MatchSession.
if (setup.replay) {
  const controls = new ReplayControls(setup.replay);
  const tick = (): void => {
    controls.sync();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
} else if (game.saveReplay) {
  // Host only: a guest never sees the authoritative command log.
  addSaveReplayButton(() => downloadReplay(game.saveReplay!()));
}

// Guests survive a dropped connection. The host does not: there is nobody for
// it to reconnect to, and its departure ends the match for everyone.
if (setup.reconnect) {
  const { brokerUrl, code, token, name, connection } = setup.reconnect;
  const reconnector = new Reconnector(
    {
      brokerUrl,
      code,
      token,
      name,
      world: setup.world,
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
  window.addEventListener("beforeunload", () => reconnector.stop());
}

/**
 * Persistent banner with the join code and a copy-link button.
 *
 * Deliberately not a one-off dialog: players routinely need the code again a
 * minute later when someone else wants in, and hunting for it is a bad moment
 * in an otherwise smooth flow.
 */
function showJoinCode(code: string): void {
  const link = `${location.origin}${location.pathname}?join=${encodeURIComponent(code)}`;
  const banner = document.createElement("div");
  banner.style.cssText =
    "position:fixed;top:12px;right:12px;z-index:15;padding:10px 14px;border:1px solid #234;" +
    "border-radius:6px;background:rgba(8,12,20,0.78);color:#8fe3ff;backdrop-filter:blur(4px);" +
    "font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-align:right";
  banner.innerHTML =
    `<div style="color:#62809f">share this code</div>` +
    `<div style="font-size:22px;letter-spacing:0.3em;margin:2px 0 6px">${code}</div>` +
    `<button id="copy-link" style="border:1px solid #2f6f8f;border-radius:4px;background:#14283a;` +
    `color:#cfe4ff;font:inherit;padding:4px 10px;cursor:pointer">copy link</button>`;
  document.body.appendChild(banner);

  const button = banner.querySelector<HTMLButtonElement>("#copy-link")!;
  button.onclick = async () => {
    try {
      await navigator.clipboard.writeText(link);
      button.textContent = "copied";
    } catch {
      // Clipboard access needs a secure context and can be refused outright.
      // Selecting the link is a worse experience but always available.
      button.textContent = link;
    }
    setTimeout(() => (button.textContent = "copy link"), 2000);
  };
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

if (import.meta.env.DEV) {
  window.__rts = Object.assign(game, {
    isHost: setup.isHost,
    localPlayer: setup.localPlayer,
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
      const result = playReplay(createEmptyWorld(), decoded);
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

/**
 * A corner button that writes the match so far to a file.
 *
 * Always available rather than offered at the end, because a match ends when
 * somebody closes the tab at least as often as it ends in a victory screen.
 */
function addSaveReplayButton(onClick: () => void): void {
  const button = document.createElement("button");
  button.textContent = "save replay";
  button.style.cssText =
    "position:fixed;bottom:12px;right:12px;z-index:13;padding:6px 12px;" +
    "border:1px solid #2f6f8f;border-radius:5px;background:#14283a;color:#cfe4ff;" +
    "font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;cursor:pointer";
  button.onclick = () => {
    onClick();
    button.textContent = "saved";
    setTimeout(() => (button.textContent = "save replay"), 1500);
  };
  document.body.appendChild(button);
}
