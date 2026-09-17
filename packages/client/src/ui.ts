import { TEAM_COLOURS as PALETTE_TEAMS, css } from "./palette.js";

/**
 * The one place the interface's colours, type and spacing are written down.
 *
 * They were previously retyped by hand in seven files -- the lobby's inline
 * `<style>`, the HUD, the minimap, the replay controls, the host panel, the
 * match banner and index.html -- as literal hex codes and `cssText` strings.
 * Six of those agreed. Changing an accent meant finding all of them.
 *
 * The values answer to UNIVERSE.md by way of palette.ts, which is what keeps
 * the interface and the world the same colour.
 *
 * Injected once as custom properties on `:root`, so the values are reachable
 * from a stylesheet and from a `cssText` string alike, and a screen can be
 * restyled without being rewritten.
 */

/** Marker so repeated calls are cheap and idempotent. */
const STYLE_ID = "rts-ui";

const TOKENS = `
:root {
  /* Surfaces, darkest to lightest. Everything here is warm: there is no
     neutral grey anywhere in the Ashworks, because ash scatters the furnace
     light into every shadow. See UNIVERSE.md. */
  --bg:        #0a0806;
  --bg-deep:   #060504;
  --panel:     rgba(16, 12, 9, 0.93);
  --panel-2:   #14100d;
  --raised:    #241a13;
  --raised-2:  #34261a;

  /* Lines. --line is chrome, --edge is anything interactive. */
  --line:      #221b15;
  --line-2:    #33261c;
  --edge:      #5e3f23;
  --edge-hot:  #8a5a2a;

  /* Text, brightest to dimmest. */
  --accent:    #e8a04a;
  --accent-2:  #c46a28;
  --text:      #cbbba6;
  --muted:     #94816a;
  --dim:       #6d5c4a;

  /* Signal, not material. Deliberately outside the world's palette. */
  --good:      #7ac26a;
  --warn:      #d98a3a;
  --bad:       #c4443a;

  /* Resources, so the two readouts never drift from the icons. */
  --alloy:     #d2b073;
  --plasma:    #6fc9c0;

  /* One per player slot; the single definition is palette.ts. */
  --team-0:    #4ec9ff;
  --team-1:    #ff5d47;
  --team-2:    #b77dff;
  --team-3:    #7de88a;

  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --radius: 4px;
  --radius-lg: 8px;
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
  /* The low orange lid of the Ashworks sky, seen from under it. */
  background: radial-gradient(circle at 50% 26%, #2a1a0f, var(--bg-deep) 74%);
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
  background: #6d3a12; border-color: var(--accent); color: #f6e0c0;
}
.rts-screen button.primary:hover:not(:disabled) { background: #8a4a17; }
.rts-screen button.quiet {
  background: transparent; border-color: var(--line-2); color: var(--muted);
}
.rts-screen button.quiet:hover:not(:disabled) { background: #1c150f; }

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


/**
 * The menus themselves: the title, the lists of choices, and the settings rows.
 *
 * A menu is a stage -- the game's name, one card, a footer -- and the card is
 * the only part that changes as a player walks down into a sub-menu. That is
 * what makes the tree read as one place with rooms in it rather than as five
 * unrelated screens that happen to share a background.
 *
 * Every rule here is written under `.rts-screen` rather than on its own class,
 * because the generic `.rts-screen button` above would otherwise win on
 * specificity and put a menu entry back into a form button's clothes.
 */
const MENUS = `
.rts-stage {
  display: grid; gap: 22px; justify-items: center; align-content: center;
  width: 100%; padding: 32px 16px;
}
.rts-brand { text-align: center; }
.rts-brand h1 {
  margin: 0 0 7px;
  font-size: 34px; font-weight: 600;
  /* Tracked wide and shifted right by one gap, so the letter-spacing after the
     last letter does not pull the whole word off centre. */
  letter-spacing: 0.34em; text-indent: 0.34em;
  color: var(--accent);
  text-shadow: 0 0 30px rgba(232, 160, 74, 0.22);
}
.rts-brand p {
  color: var(--dim); font-size: 11px;
  letter-spacing: 0.2em; text-transform: uppercase;
}

.rts-entries { display: grid; gap: 8px; }
.rts-screen .rts-entry {
  position: relative;
  display: block; width: 100%; text-align: left;
  padding: 12px 14px 12px 17px;
  border: 1px solid var(--line-2); border-radius: var(--radius);
  /* Lit from above, like the console bays: the menu is made of the same metal
     as the interface it leads to. */
  background: linear-gradient(180deg, #1b140e, #120d09);
  color: var(--text);
  transition: background 90ms ease, border-color 90ms ease;
}
/* The marker for "this is the one" -- hover and keyboard focus are the same
   state, so a player who arrows down sees exactly what a player who points
   sees. */
.rts-screen .rts-entry::before {
  content: ""; position: absolute; left: 0; top: 9px; bottom: 9px; width: 2px;
  background: transparent; transition: background 90ms ease;
}
.rts-screen .rts-entry:hover:not(:disabled),
.rts-screen .rts-entry:focus-visible {
  background: #241a12; border-color: var(--edge); outline: none;
}
.rts-screen .rts-entry:hover:not(:disabled)::before,
.rts-screen .rts-entry:focus-visible::before { background: var(--accent); }
.rts-screen .rts-entry:disabled { opacity: 0.4; }
.rts-entry .label { display: block; letter-spacing: 0.06em; }
/* The obvious choice is marked by its edge and its title, not by being filled
   in: a solid block would be brighter than the hover state and the highlight
   would have nowhere left to go on the one entry most likely to be hovered. */
.rts-screen .rts-entry.primary {
  background: linear-gradient(180deg, #221710, #17100b);
  border-color: var(--edge);
}
.rts-screen .rts-entry.primary:hover:not(:disabled),
.rts-screen .rts-entry.primary:focus-visible { background: #2b1e13; }
.rts-entry.primary .label { color: var(--accent); }
.rts-entry .note { display: block; margin-top: 3px; color: var(--dim); font-size: 11px; }

.rts-actions {
  display: flex; gap: 8px; align-items: center; justify-content: flex-end;
  margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--line);
}
.rts-actions .left { margin-right: auto; }
.rts-foot { color: var(--dim); font-size: 11px; letter-spacing: 0.1em; }

/* -- one setting, one row ------------------------------------------------ */

.rts-setting {
  display: grid; grid-template-columns: 1fr minmax(140px, 200px) 54px;
  gap: 4px 14px; align-items: center;
  padding: 11px 0; border-bottom: 1px solid var(--line);
}
.rts-setting:last-child { border-bottom: none; }
.rts-setting .name { letter-spacing: 0.04em; }
.rts-setting .note { margin-top: 3px; color: var(--dim); font-size: 11px; }
.rts-setting .value { color: var(--muted); font-size: 12px; text-align: right; }
.rts-setting input, .rts-setting select { width: 100%; }
.rts-screen .rts-setting button { width: 100%; padding: 8px 12px; }
.rts-screen .rts-setting button[aria-pressed="true"] {
  border-color: var(--accent); background: #2a1c10; color: var(--accent);
}

/* A slider, built rather than tinted. The browser's own is a light grey bar
   with a blue thumb whatever accent-color says about the fill, and one pale
   rounded rectangle is enough to make a whole page look like a form.
   (No backticks in here -- this is inside a template literal.) */
.rts-screen input[type="range"], .rts-replay input[type="range"] {
  appearance: none; -webkit-appearance: none;
  height: 5px; padding: 0;
  border: 1px solid var(--line-2); border-radius: 3px;
  background: #0d0a07; cursor: pointer;
}
.rts-screen input[type="range"]::-webkit-slider-thumb,
.rts-replay input[type="range"]::-webkit-slider-thumb {
  appearance: none; -webkit-appearance: none;
  width: 15px; height: 15px;
  border: 1px solid var(--bg-deep); border-radius: 50%;
  background: var(--accent);
}
.rts-screen input[type="range"]::-moz-range-thumb,
.rts-replay input[type="range"]::-moz-range-thumb {
  width: 15px; height: 15px;
  border: 1px solid var(--bg-deep); border-radius: 50%;
  background: var(--accent);
}

/* -- over a running match ------------------------------------------------ */

/* No gradient: the match is still there, and the point of the in-game menu is
   that you can see what you are going back to. */
.rts-screen.overlay { background: rgba(7, 5, 4, 0.74); backdrop-filter: blur(3px); }
.rts-screen.overlay .rts-panel { box-shadow: 0 26px 70px rgba(0, 0, 0, 0.7); }
`;

/**
 * The match console.
 *
 * Overlaid on the rendered world rather than cutting into it, so the map keeps
 * its full height and the corners of the screen stay bare. The bar itself is
 * transparent and ignores the mouse -- only the three bays inside it are solid,
 * which is what lets a player drag a selection box across the gap between them.
 */
const CONSOLE = `
.rts-console {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 12;
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 12px; padding: 10px 12px;
  font: 12px/1.5 var(--mono); color: var(--text);
  /* The bar is a layout device, not a surface. Without this it would eat every
     click aimed at the ground between the minimap and the command card. */
  pointer-events: none;
}
.rts-console > * { pointer-events: auto; }

.rts-bay {
  border: 1px solid var(--line-2);
  /* A lit top edge and a dark underside: the whole frame reads as a plate of
     metal catching the key light, with two declarations rather than a texture. */
  border-top-color: var(--edge);
  border-radius: var(--radius);
  background: var(--panel);
  box-shadow:
    inset 0 1px 0 rgba(232, 160, 74, 0.09),
    0 0 0 1px rgba(0, 0, 0, 0.55),
    0 10px 34px rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(6px);
}

/* -- the middle bay: who is selected ------------------------------------- */

.rts-bust {
  width: 92px; height: 92px; flex: none;
  border: 1px solid var(--line-2);
  border-radius: 3px;
  background-color: #100c09;
  background-repeat: no-repeat;
  background-position: center;
  background-size: 88%;
  box-shadow: inset 0 0 22px rgba(0, 0, 0, 0.8);
}
.rts-selected { display: flex; gap: 10px; padding: 8px; align-items: stretch; min-width: 260px; }
.rts-selected .body { display: flex; flex-direction: column; justify-content: center; gap: 5px; min-width: 0; }
.rts-selected .name {
  color: var(--accent); font-size: 14px; letter-spacing: 0.05em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.rts-selected .sub { color: var(--dim); font-size: 11px; }

/* A bar that means one thing: how much of something is left. */
.rts-meter { width: 150px; height: 7px; background: #0d0a07; border: 1px solid var(--line-2); }
.rts-meter > i { display: block; height: 100%; background: var(--good); }

/* -- the right bay: the command card ------------------------------------- */

.rts-grid { display: grid; grid-template-columns: repeat(3, 58px); gap: 4px; padding: 7px; }
.rts-slot {
  position: relative;
  width: 58px; height: 58px; padding: 0;
  border: 1px solid var(--line-2); border-radius: 3px;
  background-color: var(--raised);
  /* The icon sits high in the cell, leaving the bottom strip for the name.
     The models are not yet distinctive enough to identify a building on
     silhouette alone, so the name is doing real work rather than decorating. */
  background-repeat: no-repeat; background-position: center top 1px; background-size: 40px 40px;
  color: var(--text); font: inherit; cursor: pointer;
  transition: border-color 80ms ease, background-color 80ms ease;
}
.rts-slot:hover { border-color: var(--edge-hot); background-color: var(--raised-2); }
.rts-slot.active { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
/* Dimmed, never disabled: a dim button that still says "not enough alloy"
   teaches the player why, where a dead one teaches nothing. */
.rts-slot.poor { opacity: 0.45; }
.rts-slot.blank {
  background-color: rgba(0, 0, 0, 0.22);
  border-style: dashed; border-color: var(--line);
  cursor: default; pointer-events: none;
}
.rts-slot .key {
  position: absolute; top: 1px; left: 3px;
  color: var(--muted); font-size: 9px; letter-spacing: 0.06em;
  text-shadow: 0 1px 2px #000;
}
.rts-slot .cost {
  position: absolute; top: 1px; right: 3px;
  font-size: 9px; color: var(--alloy); text-shadow: 0 1px 2px #000, 0 0 3px #000;
}
.rts-slot .label {
  position: absolute; bottom: 0; left: 0; right: 0;
  padding: 1px 2px;
  font-size: 9px; line-height: 1.2; color: var(--text); text-align: center;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  background: linear-gradient(transparent, rgba(8, 6, 4, 0.85) 45%);
}

/* -- resources, top right ------------------------------------------------ */

.rts-resources {
  position: fixed; top: 10px; right: 12px; z-index: 12;
  display: flex; gap: 18px; padding: 7px 14px;
  font: 13px/1.5 var(--mono);
}
.rts-resources b { font-weight: 600; }
.rts-resources .tag { color: var(--dim); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; }

/* -- transient messages -------------------------------------------------- */

.rts-toast {
  position: fixed; top: 58px; left: 50%; transform: translateX(-50%); z-index: 13;
  padding: 7px 16px; color: var(--warn); border-color: #5a3222;
  font: 12px/1.5 var(--mono);
}
.rts-outcome {
  position: fixed; top: 34%; left: 50%; transform: translateX(-50%); z-index: 14;
  padding: 18px 44px; font: 24px/1.4 var(--mono);
  letter-spacing: 0.16em; text-align: center;
}

/* Something the match needs to say and hold on screen, as opposed to a toast:
   a lost connection, and what is being done about it. */
.rts-alert {
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 16;
  padding: 14px 26px; border-color: #5a3226; color: var(--warn);
  font: 15px/1.6 var(--mono);
}

/* -- what the match writes over the world -------------------------------- */

/* Off by default and toggled with the key above Tab; see settings.ts. Nothing
   here is part of playing, and a wall of numbers over the corner of the map is
   the fastest way to make a game look unfinished. */
#rts-stats {
  position: fixed; top: 10px; left: 12px; z-index: 12;
  padding: 8px 12px;
  border: 1px solid var(--line-2); border-radius: var(--radius);
  background: rgba(16, 12, 9, 0.72);
  color: var(--muted); font: 12px/1.55 var(--mono);
  white-space: pre; pointer-events: none; backdrop-filter: blur(4px);
}
/* Above the console, not beside it: the console owns the whole bottom edge. */
#rts-hints {
  position: fixed; bottom: 124px; left: 50%; transform: translateX(-50%); z-index: 11;
  /* Wraps rather than running off both edges: the line is longer than a narrow
     window, and the half of it that is cut off is not the half that matters. */
  width: min(860px, 88vw); text-align: center;
  color: var(--dim); font: 11px/1.6 var(--mono);
  pointer-events: none;
}

/* -- watching a recording ------------------------------------------------ */

.rts-replay {
  position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%); z-index: 13;
  display: flex; gap: 10px; align-items: center;
  width: min(680px, 88vw); padding: 8px 14px;
  font: 12px/1.5 var(--mono); color: var(--text);
}
.rts-replay button {
  padding: 4px 9px;
  border: 1px solid var(--line-2); border-radius: 3px;
  background: var(--raised); color: var(--text); font: inherit; cursor: pointer;
}
.rts-replay button:hover { border-color: var(--edge-hot); }
.rts-replay button.on { border-color: var(--accent); background: #2a1c10; color: var(--accent); }
.rts-replay input[type="range"] { flex: 1; }
.rts-replay .at { min-width: 104px; text-align: right; color: var(--muted); }
`;

/** Add the shared stylesheet to the document. Safe to call repeatedly. */
export function installStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = TOKENS + SCREENS + MENUS + CONSOLE;
  document.head.appendChild(style);
}

/** Escape text destined for an innerHTML template. */
export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}

/** The colour for a player slot, as CSS. The numbers live in palette.ts. */
export const TEAM_COLOURS = PALETTE_TEAMS.map(css);
