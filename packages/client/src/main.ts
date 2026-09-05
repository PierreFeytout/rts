import { enableDevChecks, runDeterminismScenario, type Command } from "@rts/sim";
import { startGame, type RunningGame } from "./game.js";
import { showLobby } from "./lobby.js";
import { MAP_TILES } from "./match.js";

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
