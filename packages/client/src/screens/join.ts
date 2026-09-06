import { escapeHtml, screen } from "../ui.js";

/**
 * Asking where the game is, and staying up until it is found.
 *
 * Its own screen rather than a field on the multiplayer menu, because it is the
 * one place a player has to type something a friend read out to them, and it is
 * where every "I cannot connect" conversation starts. It gets room for the
 * address, the example, and the error.
 *
 * The connection attempt happens *while this screen is still shown*, which is
 * the whole reason it takes a callback rather than resolving with an address. A
 * failed join is the common case -- a typo, a router that never forwarded the
 * port, a host who has not started yet -- and the player needs to be looking at
 * the field they typed it into, with the reason underneath it.
 */

export interface JoinOptions<T> {
  /**
   * Try the address. Resolve with the connection to finish, or throw with
   * something the player can act on. `say` reports progress meanwhile.
   */
  connect: (address: string, say: (message: string) => void) => Promise<T>;
  /**
   * Throw away a connection that arrived after the player had left.
   *
   * An attempt can take fifteen seconds to time out and Back stays live
   * throughout, so this is not an edge case -- it is what happens whenever
   * somebody mistypes an address and gives up. Without it the socket stays
   * open for a screen that no longer exists.
   */
  dispose: (value: T) => void;
}

/** The connection, or null if the player went back. */
export function showJoin<T>(options: JoinOptions<T>): Promise<T | null> {
  return new Promise((resolve) => {
    const { root, panel } = screen();

    // Deep link straight into a friend's game: ?join=host:port
    const preset = new URLSearchParams(location.search).get("join") ?? "";

    panel.innerHTML =
      `<h2>Join a game</h2>` +
      `<p class="sub">the address your friend's game is showing them</p>` +
      `<label class="rts-field"><span>address</span>` +
      `<input id="join-address" placeholder="e.g. 92.0.2.15:47654" autocomplete="off" ` +
      `spellcheck="false" value="${escapeHtml(preset)}" /></label>` +
      `<p class="rts-note" style="margin:-8px 0 20px">` +
      `A bare address works too — the port is filled in for you.</p>` +
      `<div id="join-status" class="rts-status"></div>` +
      `<hr />` +
      `<div class="rts-row" style="justify-content:flex-end">` +
      `<button class="quiet" id="join-back">Back</button>` +
      `<button class="primary" id="join-go">Join</button>` +
      `</div>`;

    const input = panel.querySelector<HTMLInputElement>("#join-address")!;
    const status = panel.querySelector<HTMLDivElement>("#join-status")!;

    const say = (message: string, tone: "info" | "error" = "info"): void => {
      status.textContent = message;
      status.className = tone === "error" ? "rts-status error" : "rts-status";
    };

    let done = false;
    const finish = (value: T | null): void => {
      if (done) return;
      done = true;
      root.remove();
      resolve(value);
    };

    const go = (): void => {
      const address = input.value.trim();
      if (address.length < 3) {
        say("enter the address your friend gave you", "error");
        input.focus();
        return;
      }

      panel.classList.add("busy");
      options
        .connect(address, say)
        .then((value) => {
          if (done) {
            options.dispose(value);
            return;
          }
          finish(value);
        })
        .catch((error: unknown) => {
          if (done) return;
          panel.classList.remove("busy");
          say(error instanceof Error ? error.message : String(error), "error");
          input.focus();
          input.select();
        });
    };

    panel.querySelector<HTMLButtonElement>("#join-go")!.onclick = go;
    panel.querySelector<HTMLButtonElement>("#join-back")!.onclick = () => finish(null);
    input.onkeydown = (event) => {
      if (event.key === "Enter") go();
    };
    input.focus();
    input.select();
  });
}
