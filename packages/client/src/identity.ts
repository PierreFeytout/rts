/**
 * A stable identity for this player, for as long as the tab lives.
 *
 * Held in `sessionStorage` rather than `localStorage` on purpose: two tabs of
 * the same browser must be two different players -- which is exactly how this
 * game gets tested -- and `localStorage` is shared between them, so both would
 * claim the same slot and the second would evict the first. `sessionStorage` is
 * per tab, and survives a reload, which is the case that matters for reconnect.
 *
 * This is not a credential. See HelloMessage.token.
 */

const KEY = "rts.playerToken";

export function playerToken(): string {
  try {
    const existing = sessionStorage.getItem(KEY);
    if (existing) return existing;
    const fresh = mint();
    sessionStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // Storage can be unavailable outright (private mode, blocked site data).
    // A per-load token still works for everything except reconnecting after a
    // page refresh, which is far better than refusing to start.
    return mint();
  }
}

function mint(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Display name
// ---------------------------------------------------------------------------

const NAME_KEY = "rts.playerName";

/**
 * What other players see in the lobby and on the scoreboard.
 *
 * `localStorage`, unlike the token: a name is meant to be the same every time
 * this person plays, and two tabs of the same browser sharing one is correct
 * -- they are the same person testing. The token is what must differ, and does.
 */
export function playerName(): string {
  try {
    const stored = localStorage.getItem(NAME_KEY);
    if (stored && stored.trim().length > 0) return stored;
  } catch {
    // Blocked site data. A default name is better than refusing to play.
  }
  return `Player ${playerToken().slice(0, 4)}`;
}

export function setPlayerName(name: string): void {
  const trimmed = name.trim().slice(0, MAX_NAME);
  if (trimmed.length === 0) return;
  try {
    localStorage.setItem(NAME_KEY, trimmed);
  } catch {
    // See above. The name still applies to this session; it just will not
    // be remembered next time.
  }
}

/**
 * Longest name accepted.
 *
 * Names are rendered into fixed-width lobby rows and a scoreboard, and are
 * chosen by other people. Truncating at the door is simpler than every place
 * that displays one having to cope.
 */
export const MAX_NAME = 20;
