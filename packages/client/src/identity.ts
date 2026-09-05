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
