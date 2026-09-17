/**
 * What the player has chosen, and where it is kept.
 *
 * Everything the settings menu writes lands here, and everything that obeys a
 * setting reads it from here -- the camera, the renderer, the two overlays.
 * One store rather than a flag threaded through four constructors, because a
 * setting changed in the middle of a match has to reach whatever is already
 * running, and a subscription is the only thing that does that without the
 * match screen knowing the settings menu exists.
 *
 * Volumes are the exception: music and effects each own their own level and
 * persist it themselves (see audio/context.ts), and duplicating them here
 * would give the same number two homes.
 *
 * `parseSettings` is pure, so what is read back out of storage is checked the
 * same way under the test suite as it is at startup. A stored file that has
 * been hand-edited, or written by an older build, costs the settings it got
 * wrong and nothing else.
 */

export interface Settings {
  /** Pan when the pointer rests against the edge of the screen. */
  edgeScroll: boolean;
  /** Multiplier on keyboard and edge panning. */
  panSpeed: number;
  /** Multiplier on how far one wheel notch zooms. */
  zoomSpeed: number;
  /** Wheel up zooms out, for the people who expect a map to work that way. */
  invertZoom: boolean;
  /**
   * Cap on the device pixel ratio the match renders at.
   *
   * The one setting that trades looks for frames: at 0.5 a 4K screen renders a
   * quarter of the pixels, which on a laptop is the difference between 30 and
   * 60.
   */
  renderScale: number;
  /** The performance readout. Also toggled in a match with the key above Tab. */
  showStats: boolean;
  /** The line of control reminders under the console. */
  showHints: boolean;
}

export const DEFAULTS: Settings = {
  edgeScroll: false,
  panSpeed: 1,
  zoomSpeed: 1,
  invertZoom: false,
  renderScale: 1,
  showStats: false,
  showHints: true,
};

/**
 * What each number may be, in one place.
 *
 * The sliders in the settings menu are built from this, so a range cannot be
 * widened in the menu and left narrow in the parser -- which is how a setting
 * ends up silently clamped back every time the game starts.
 */
export const RANGES: Readonly<Record<"panSpeed" | "zoomSpeed" | "renderScale", readonly [number, number]>> = {
  panSpeed: [0.4, 2.5],
  zoomSpeed: [0.5, 2],
  renderScale: [0.5, 2],
};

/** Read stored settings, keeping whatever is usable. Never throws. */
export function parseSettings(raw: unknown): Settings {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ...DEFAULTS };
  const input = raw as Record<string, unknown>;
  return {
    edgeScroll: flag(input.edgeScroll, DEFAULTS.edgeScroll),
    panSpeed: number(input.panSpeed, DEFAULTS.panSpeed, RANGES.panSpeed),
    zoomSpeed: number(input.zoomSpeed, DEFAULTS.zoomSpeed, RANGES.zoomSpeed),
    invertZoom: flag(input.invertZoom, DEFAULTS.invertZoom),
    renderScale: number(input.renderScale, DEFAULTS.renderScale, RANGES.renderScale),
    showStats: flag(input.showStats, DEFAULTS.showStats),
    showHints: flag(input.showHints, DEFAULTS.showHints),
  };
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function number(value: unknown, fallback: number, [min, max]: readonly [number, number]): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

const KEY = "rts.settings";

/**
 * The live settings, and everyone watching them.
 *
 * A change is applied to the object, written to storage and announced in that
 * order, so a listener that reads `current` always sees the value it is being
 * told about.
 */
class SettingsStore {
  private value: Settings;
  private readonly listeners = new Set<(settings: Settings) => void>();

  constructor() {
    this.value = parseSettings(read());
  }

  get current(): Settings {
    return this.value;
  }

  /** Change some settings, leaving the rest. */
  set(patch: Partial<Settings>): void {
    this.value = parseSettings({ ...this.value, ...patch });
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {
      // Blocked site data. The choice still applies to this session; it just
      // will not be remembered next time.
    }
    for (const listener of this.listeners) listener(this.value);
  }

  /** Watch for changes. Returns its own remover. */
  onChange(listener: (settings: Settings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function read(): unknown {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === null ? null : JSON.parse(stored);
  } catch {
    // Unavailable storage, or something that is not JSON. Defaults, quietly:
    // this runs before anything is on screen to complain to.
    return null;
  }
}

export const settings = new SettingsStore();
