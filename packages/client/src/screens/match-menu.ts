import { desktop } from "../desktop.js";
import { anyModal } from "../modal.js";
import { chooseFrom } from "./shell.js";
import { showSettings } from "./settings.js";

/**
 * The menu inside a match: Escape, or F10.
 *
 * What used to be here was two buttons wedged into the top-right corner --
 * "save replay" and "leave match" -- because there was nowhere else to put
 * them. Both are here now, with the settings and the way out, which is where a
 * player goes looking for them.
 *
 * **It pauses the match when it can, and says so when it cannot.** A solo
 * skirmish or a replay stops dead while the menu is up. A match with somebody
 * else in it keeps running, because this client is one peer of a lockstep
 * match and stopping its clock would stall everyone else's game -- so the menu
 * says the match is still running rather than quietly letting the player lose
 * an army while reading the audio page.
 *
 * Escape is shared with the order the player might be in the middle of giving:
 * a pending build placement or attack-move is cancelled first, and only an
 * Escape with nothing to cancel opens the menu. That is the convention the
 * genre has, and it is why cancelling has to report whether it did anything.
 */

type Choice = "resume" | "settings" | "replay" | "leave" | "quit";

export interface MatchMenuOptions {
  /** True while nobody else is waiting on this client's clock. */
  canPause: () => boolean;
  setPaused: (paused: boolean) => void;
  /** Cancel whatever order is half-given. True if there was one. */
  cancelPending: () => boolean;
  /** Host only: a guest never sees the authoritative command log. */
  saveReplay?: (() => void) | undefined;
  /** Back to the main menu. The match screen is torn down by the caller. */
  onLeave: () => void;
}

export class MatchMenu {
  private readonly options: MatchMenuOptions;
  private readonly onKeyDown: (event: KeyboardEvent) => void;
  private open = false;
  private paused = false;
  private saved = false;

  constructor(options: MatchMenuOptions) {
    this.options = options;
    this.onKeyDown = (event) => {
      // A menu is already up: the modal stack owns Escape, and F10 in a menu
      // would open a second copy of the one being looked at.
      if (this.open || anyModal()) return;
      if (event.key === "Escape") {
        if (options.cancelPending()) return;
      } else if (event.key !== "F10") {
        return;
      }
      event.preventDefault();
      void this.show();
    };
    window.addEventListener("keydown", this.onKeyDown);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    this.resume();
  }

  // -------------------------------------------------------------------------

  private async show(): Promise<void> {
    this.open = true;
    if (this.options.canPause()) {
      this.paused = true;
      this.options.setPaused(true);
    }

    for (;;) {
      const choice = await chooseFrom<Choice>({
        title: this.paused ? "Paused" : "Match menu",
        sub: this.paused
          ? "the match is stopped until you go back"
          : "the match is still running — somebody else is in it",
        overlay: true,
        back: "resume",
        backButton: false,
        foot: "esc resumes",
        entries: [
          { value: "resume", label: "Resume", primary: true },
          {
            value: "settings",
            label: "Settings",
            note: "Sound, camera and display, without leaving the match.",
          },
          ...(this.options.saveReplay
            ? [
                {
                  value: "replay" as const,
                  label: this.saved ? "Save the replay again" : "Save the replay",
                  note: "The match so far, as a file you can watch back.",
                },
              ]
            : []),
          { value: "leave", label: "Leave match", note: "Back to the main menu." },
          ...(desktop ? [{ value: "quit" as const, label: "Quit the game" }] : []),
        ],
      });

      if (choice === "resume") break;
      if (choice === "settings") {
        await showSettings(true);
        continue;
      }
      if (choice === "replay") {
        this.options.saveReplay?.();
        this.saved = true;
        continue;
      }
      if (choice === "quit") {
        await desktop?.quit();
        continue;
      }
      if (await this.confirmLeave()) {
        // Left paused and open: the match screen is going away, and resuming a
        // simulation nobody is watching for the two frames before it does
        // would only risk the AI taking a turn on the way out.
        this.options.onLeave();
        return;
      }
    }

    this.open = false;
    this.resume();
  }

  /**
   * Leaving is one click away from Resume and cannot be undone, and in a
   * multiplayer match it ends the game for whoever was relying on this client.
   * It gets a question.
   */
  private async confirmLeave(): Promise<boolean> {
    return (
      (await chooseFrom<"leave" | "stay">({
        title: "Leave the match?",
        sub: this.options.saveReplay
          ? "save the replay first if you want to keep it"
          : "you will not be able to rejoin this one",
        overlay: true,
        back: "stay",
        backButton: false,
        foot: "esc stays",
        entries: [
          { value: "stay", label: "Stay", primary: true },
          { value: "leave", label: "Leave", note: "Back to the main menu." },
        ],
      })) === "leave"
    );
  }

  private resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.options.setPaused(false);
  }
}
