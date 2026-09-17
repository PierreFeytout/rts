import type { Replay } from "@rts/netcode";
import { encodeReplay } from "@rts/netcode";
import { defaultContent } from "@rts/content";
import { REPLAY_SPEEDS, type ReplaySession } from "./replay-session.js";
import { installStyles } from "./ui.js";

/**
 * Saving a match and watching one back.
 *
 * Both halves are small because lockstep did the work: the host's command log
 * *is* the replay, so recording costs nothing during play and a file is the
 * initial snapshot plus that log. Playback reuses the entire match screen --
 * see `MatchSession` in game.ts -- so this is only the transport controls.
 */

/** Offer the current match as a download. */
export function downloadReplay(replay: Replay): void {
  const bytes = encodeReplay(replay, defaultContent.hash, Date.now());
  const blob = new Blob([bytes as BlobPart], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const link = document.createElement("a");
  link.href = url;
  link.download = `rts-${stamp}.rtsreplay`;
  link.click();
  // Revoking immediately can race the download on some browsers; a tick is
  // enough and the object is a few hundred kilobytes at most.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Transport controls for a replay: play/pause, speed, scrub, and the position.
 *
 * Deliberately a strip along the bottom rather than an overlay. A replay is
 * watched, so the map should stay unobstructed; the one thing that must be
 * legible at a glance is where in the match you are.
 */
export class ReplayControls {
  private readonly root: HTMLDivElement;
  private readonly playButton: HTMLButtonElement;
  private readonly scrub: HTMLInputElement;
  private readonly label: HTMLSpanElement;
  private readonly session: ReplaySession;
  /** True while the player is dragging, so the slider is not fought for. */
  private scrubbing = false;

  constructor(session: ReplaySession) {
    this.session = session;

    // A console bay like the others, rather than the one blue panel in a game
    // that has no blue in it. See ui.ts.
    installStyles();
    this.root = document.createElement("div");
    this.root.className = "rts-bay rts-replay";
    document.body.appendChild(this.root);

    this.playButton = button("pause");
    this.playButton.onclick = () => {
      session.setPlaying(!session.isPlaying);
      this.sync();
    };
    this.root.appendChild(this.playButton);

    for (const speed of REPLAY_SPEEDS) {
      const b = button(`${speed}x`);
      b.dataset.speed = String(speed);
      b.onclick = () => {
        session.setSpeed(speed);
        this.sync();
      };
      this.root.appendChild(b);
    }

    this.scrub = document.createElement("input");
    this.scrub.type = "range";
    this.scrub.min = "0";
    this.scrub.max = String(Math.max(1, session.length));
    this.scrub.value = "0";
    // Seeking backwards replays from the start, which for a long match is a
    // visible pause. Doing it on release rather than on every input event
    // means one seek per drag instead of one per pixel.
    this.scrub.oninput = () => {
      this.scrubbing = true;
      this.label.textContent = position(Number(this.scrub.value), session.length);
    };
    this.scrub.onchange = () => {
      session.seek(Number(this.scrub.value));
      this.scrubbing = false;
      this.sync();
    };
    this.root.appendChild(this.scrub);

    this.label = document.createElement("span");
    this.label.className = "at";
    this.root.appendChild(this.label);

    this.sync();
  }

  /** Refresh from the session. Cheap enough to call every frame. */
  sync(): void {
    this.playButton.textContent = this.session.isPlaying ? "pause" : "play";
    if (!this.scrubbing) {
      this.scrub.value = String(this.session.position);
      this.label.textContent = position(this.session.position, this.session.length);
    }
    for (const child of this.root.children) {
      const speed = (child as HTMLElement).dataset?.speed;
      if (speed === undefined) continue;
      child.classList.toggle("on", Number(speed) === this.session.playbackSpeed);
    }
  }

  dispose(): void {
    this.root.remove();
  }
}

/** Ticks as minutes and seconds, which is what a viewer actually reads. */
function position(tick: number, total: number): string {
  return `${clock(tick)} / ${clock(total)}`;
}

function clock(ticks: number): string {
  const seconds = Math.floor(ticks / 20);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function button(label: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.textContent = label;
  return element;
}
