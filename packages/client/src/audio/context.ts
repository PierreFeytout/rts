/**
 * The one audio context the game plays everything through.
 *
 * Music and sound effects share it: one clock, one output, and one unlock --
 * browsers start a context created before any user gesture suspended, and
 * resume it only from inside one, so the first click or key anywhere wakes it
 * for everything.
 *
 * Also where "the game is not the window in front" is decided, for every
 * channel that wants to go quiet when it is not.
 */

let shared: AudioContext | null = null;
const onFocusChange: Array<() => void> = [];

/** The context, created on first use. Null where the platform has no Web Audio. */
export function audioContext(): AudioContext | null {
  if (shared) return shared;
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  const ctx = new Ctor();
  shared = ctx;
  const wake = (): void => {
    void ctx.resume();
  };
  window.addEventListener("pointerdown", wake);
  window.addEventListener("keydown", wake);
  window.addEventListener("blur", () => onFocusChange.forEach((f) => f()));
  window.addEventListener("focus", () => onFocusChange.forEach((f) => f()));
  return ctx;
}

/** Call `listener` whenever the window gains or loses focus. */
export function whenFocusChanges(listener: () => void): void {
  onFocusChange.push(listener);
}

/**
 * Move a parameter, cancelling whatever it was already doing.
 *
 * `cancelScheduledValues` alone leaves the parameter wherever the previous ramp
 * had reached but keeps its *old* target as the ramp's start point, which makes
 * a new ramp jump. Holding the current value first is what makes repeated calls
 * smooth rather than steppy.
 */
export function ramp(param: AudioParam, to: number, seconds: number, ctx: AudioContext): void {
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(to, now + Math.max(0.01, seconds));
}

/** A volume and mute, kept between sessions under `key`. */
export class Level {
  value: number;
  muted = false;
  private readonly key: string;

  constructor(key: string, fallback: number) {
    this.key = key;
    this.value = fallback;
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) this.value = Math.max(0, Math.min(1, Number(stored)));
    } catch {
      // Blocked site data. A default is better than refusing to play.
    }
  }

  set(value: number): void {
    this.value = Math.max(0, Math.min(1, value));
    try {
      localStorage.setItem(this.key, String(this.value));
    } catch {
      // Applies to this session either way.
    }
  }

  /** What the output gain should be: silent when muted or in the background. */
  get effective(): number {
    return this.muted || !document.hasFocus() ? 0 : this.value;
  }
}
