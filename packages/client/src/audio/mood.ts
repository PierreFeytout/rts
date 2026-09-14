import { EV_DEATH, EV_SHOT, type World } from "@rts/sim";
import type { MoodThresholds, Slot } from "./music-config.js";

/**
 * How a match feels, from what is happening to the local player.
 *
 * Two numbers, both decaying continuously and pushed up by events: **tension**
 * rises with every shot fired by or at the player's units, **peril** with every
 * one of them lost. They become one of four moods by the thresholds in the
 * music configuration, and the mood picks the slot the music plays from.
 *
 * A mood moves **up** the moment its threshold is crossed, and **down** only
 * once the higher mood has been left behind for `calmAfter` seconds. Music that
 * dropped back to calm between two volleys of the same fight, and came back up
 * for the next, would be worse than none.
 *
 * Reads events only; never touches simulation state and is in no hash. Two
 * players can hear entirely different music and agree on every tick.
 */

export type Mood = "calm" | "tension" | "combat" | "peril";

const RANK: Record<Mood, number> = { calm: 0, tension: 1, combat: 2, peril: 3 };

/** Seconds for tension and for peril to halve. Peril outlasts tension on purpose. */
const TENSION_HALF_LIFE = 6;
const PERIL_HALF_LIFE = 25;

export class MoodTracker {
  tension = 0;
  peril = 0;
  private mood: Mood = "calm";
  /** Seconds since the tension and peril last justified the current mood. */
  private below = 0;

  private readonly localPlayer: number;
  private readonly thresholds: MoodThresholds;

  constructor(localPlayer: number, thresholds: MoodThresholds) {
    this.localPlayer = localPlayer;
    this.thresholds = thresholds;
  }

  /** Call from the session's after-tick hook, while `world.events` is current. */
  ingest(world: World): void {
    const e = world.entities;
    const ownerOf = (id: number): number => {
      const i = e.indexOfLive(id);
      return i < 0 ? -1 : e.owner[i];
    };
    for (const event of world.events.all) {
      if (event.kind === EV_SHOT) {
        const shooter = ownerOf(event.shooter);
        const target = ownerOf(event.target);
        if (shooter !== this.localPlayer && target !== this.localPlayer) continue;
        this.tension = Math.min(1, this.tension + 0.05);
        if (event.lethal && target === this.localPlayer) this.peril = Math.min(1, this.peril + 0.05);
      } else if (event.kind === EV_DEATH && event.owner === this.localPlayer) {
        this.peril = Math.min(1, this.peril + 0.12);
      }
    }
  }

  /** Decay by `seconds` and settle the mood. */
  update(seconds: number): Mood {
    const dt = Math.min(0.25, Math.max(0, seconds));
    this.tension *= Math.pow(0.5, dt / TENSION_HALF_LIFE);
    this.peril *= Math.pow(0.5, dt / PERIL_HALF_LIFE);

    const t = this.thresholds;
    const now: Mood =
      this.peril >= t.peril ? "peril"
      : this.tension >= t.combat ? "combat"
      : this.tension >= t.tension ? "tension"
      : "calm";

    if (RANK[now] >= RANK[this.mood]) {
      this.mood = now;
      this.below = 0;
    } else {
      this.below += dt;
      if (this.below >= t.calmAfter) {
        this.mood = now;
        this.below = 0;
      }
    }
    return this.mood;
  }

  get current(): Mood {
    return this.mood;
  }
}

/** The slot a mood plays from. */
export function moodSlot(mood: Mood): Slot {
  return `match.${mood}`;
}
