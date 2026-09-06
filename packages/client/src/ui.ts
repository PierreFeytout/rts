/**
 * The one place the interface's colours, type and spacing are written down.
 *
 * They were previously retyped by hand in seven files -- the lobby's inline
 * `<style>`, the HUD, the minimap, the replay controls, the host panel, the
 * match banner and index.html -- as literal hex codes and `cssText` strings.
 * Six of those agreed. Changing an accent meant finding all of them.
 *
 * Injected once as custom properties on `:root`, so the values are reachable
 * from a stylesheet and from a `cssText` string alike, and a screen can be
 * restyled without being rewritten.
 */

/** Marker so repeated calls are cheap and idempotent. */
const STYLE_ID = "rts-ui";

const TOKENS = `
:root {
  /* Surfaces, darkest to lightest. */
  --bg:        #0b0f16;
  --bg-deep:   #070a10;
  --panel:     rgba(10, 15, 24, 0.92);
  --panel-2:   #0c1520;
  --raised:    #14283a;
  --raised-2:  #1b3a52;

  /* Lines. --line is chrome, --edge is anything interactive. */
  --line:      #1d2c3d;
  --line-2:    #24384f;
  --edge:      #2f6f8f;

  /* Text, brightest to dimmest. */
  --accent:    #8fe3ff;
  --accent-2:  #63d0ff;
  --text:      #cfe4ff;
  --muted:     #7fa8cc;
  --dim:       #62809f;

  --good:      #7dffb0;
  --warn:      #ffb4a0;
  --bad:       #ff8f8f;

  /* One team colour per player slot; the minimap and unit tints share these. */
  --team-0:    #63d0ff;
  --team-1:    #ff7a59;
  --team-2:    #9d7aff;
  --team-3:    #6ee7a8;

  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --radius: 6px;
  --radius-lg: 10px;
}
`;

/**
 * Shared chrome for the full-screen menu and setup screens.
 *
 * Scoped under `.rts-screen` so it cannot reach into the match HUD, which has
 * its own layout rules and is not a form.
 */
const SCREENS = `
.rts-screen {
  position: fixed; inset: 0; z-index: 20;
  display: grid; place-items: center;
  background: radial-gradient(circle at 50% 28%, #131c2b, var(--bg-deep) 72%);
  font: 14px/1.6 var(--mono);
  color: var(--text);
  overflow-y: auto;
}
.rts-panel {
  width: min(560px, 94vw);
  margin: 32px 0;
  padding: 28px;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55);
}
.rts-panel.wide { width: min(720px, 94vw); }
/* .quiet is exempt: it is what Back is, and a screen that is busy for fifteen
   seconds waiting on a connection timeout must not also be a screen nobody can
   leave. (No backticks in here -- this is inside a template literal.) */
.rts-panel.busy button:not(.quiet), .rts-panel.busy input, .rts-panel.busy select {
  opacity: 0.5; pointer-events: none;
}

.rts-screen h1 {
  margin: 0 0 4px;
  font-size: 22px; font-weight: 600; letter-spacing: 0.14em;
  color: var(--accent);
}
.rts-screen h2 {
  margin: 0 0 4px;
  font-size: 17px; font-weight: 600; letter-spacing: 0.06em;
  color: var(--accent);
}
.rts-screen p.sub { margin: 0 0 22px; color: var(--dim); font-size: 12px; }
.rts-screen hr { border: none; border-top: 1px solid var(--line); margin: 20px 0; }

.rts-screen button {
  padding: 11px 14px;
  border: 1px solid var(--edge); border-radius: var(--radius);
  background: var(--raised); color: var(--text);
  font: inherit; cursor: pointer;
  transition: background 90ms ease;
}
.rts-screen button:hover:not(:disabled) { background: var(--raised-2); }
.rts-screen button:disabled { opacity: 0.45; cursor: default; }
.rts-screen button.block { display: block; width: 100%; margin-bottom: 10px; }
.rts-screen button.primary {
  background: #1d5a78; border-color: #4aa8cf; color: #eaf7ff;
}
.rts-screen button.primary:hover:not(:disabled) { background: #26708f; }
.rts-screen button.quiet {
  background: transparent; border-color: var(--line-2); color: var(--muted);
}
.rts-screen button.quiet:hover:not(:disabled) { background: #101a26; }

.rts-screen input, .rts-screen select {
  padding: 10px 12px;
  border: 1px solid var(--edge); border-radius: var(--radius);
  background: var(--panel-2); color: var(--text); font: inherit;
}
.rts-screen select { cursor: pointer; }
.rts-screen input:disabled, .rts-screen select:disabled {
  opacity: 0.55; cursor: default; border-color: var(--line-2);
}

.rts-field { display: block; margin-bottom: 14px; }
.rts-field > span {
  display: block; margin-bottom: 5px;
  color: var(--dim); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
}
.rts-field > input, .rts-field > select { width: 100%; }

.rts-row { display: flex; gap: 8px; align-items: center; }
.rts-row > input { flex: 1; min-width: 0; }

.rts-status { min-height: 20px; margin-top: 14px; font-size: 12px; color: var(--accent); }
.rts-status.error { color: var(--bad); }
.rts-note { color: var(--dim); font-size: 12px; }
`;

/** Add the shared stylesheet to the document. Safe to call repeatedly. */
export function installStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = TOKENS + SCREENS;
  document.head.appendChild(style);
}

/**
 * A full-screen panel, mounted and ready to fill in.
 *
 * Returns the root so a caller can remove it, and the panel so it can add to
 * it. Screens are built and thrown away rather than hidden -- there is no state
 * worth keeping in a form that will be rebuilt from the config next time.
 */
export function screen(wide = false): { root: HTMLDivElement; panel: HTMLDivElement } {
  installStyles();
  const root = document.createElement("div");
  root.className = "rts-screen";
  const panel = document.createElement("div");
  panel.className = wide ? "rts-panel wide" : "rts-panel";
  root.appendChild(panel);
  document.body.appendChild(root);
  return { root, panel };
}

/** Escape text destined for an innerHTML template. */
export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}

/** The colour for a player slot, matching the minimap and unit tints. */
export const TEAM_COLOURS = ["#63d0ff", "#ff7a59", "#9d7aff", "#6ee7a8"];
