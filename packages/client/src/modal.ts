/**
 * Which screens are open on top of everything else, and what Escape means.
 *
 * A match keeps listening while a menu is over it: the camera still reads WASD,
 * the selection still reads S and H, and the control groups still read the
 * digits. Without somewhere to ask "is a menu open?", opening the in-game menu
 * and pressing S to reach Settings would also order the selected squad to stop.
 *
 * Escape belongs here for the same reason. Several screens can be open at once
 * -- the in-game menu, then Settings, then Audio -- and the one that should
 * close is the innermost. A listener per screen cannot arrange that between
 * them; a stack can, and it is the whole of this file.
 */

/** Innermost last. Each entry closes its own screen. */
const stack: Array<() => void> = [];
let listening = false;

/**
 * Register an open screen. Returns its own remover, which every screen must
 * call when it closes -- including when it closes for a reason other than
 * Escape.
 */
export function pushModal(onEscape: () => void): () => void {
  stack.push(onEscape);
  if (!listening) {
    // Capture, so this runs before the match's own key handlers whatever order
    // they were added in.
    window.addEventListener("keydown", onKeyDown, true);
    listening = true;
  }
  return () => {
    const at = stack.lastIndexOf(onEscape);
    if (at >= 0) stack.splice(at, 1);
  };
}

/** Is anything open over the match? */
export function anyModal(): boolean {
  return stack.length > 0;
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || stack.length === 0) return;
  event.preventDefault();
  event.stopPropagation();
  stack[stack.length - 1]();
}
