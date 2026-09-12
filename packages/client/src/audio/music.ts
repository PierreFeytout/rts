import { EV_DEATH, EV_SHOT, type World } from "@rts/sim";
import bedUrl from "../../assets/audio/bed.ogg";
import dreadUrl from "../../assets/audio/dread.ogg";
import leadUrl from "../../assets/audio/lead.ogg";
import menuUrl from "../../assets/audio/menu.ogg";
import pulseUrl from "../../assets/audio/pulse.ogg";

/**
 * The soundtrack.
 *
 * The music is rendered ahead of time as **stems** rather than as finished
 * tracks -- see scripts/generate-music.mjs -- and what plays is a live mix of
 * them. "The music gets tense" is therefore a gain envelope rather than a
 * second piece that would have to be beat-matched into the first.
 *
 * All four match stems are one render cut into layers, so they are the same
 * tempo and exactly the same number of samples long. They are started at one
 * scheduled time on the audio clock and loop natively, which keeps them
 * sample-locked for as long as the match lasts. Starting them with four
 * separate calls to `play()` on four `<audio>` elements would drift within a
 * minute and turn the percussion into a flam.
 *
 * WHY THE FILES ARE INLINED
 * -------------------------
 * The packaged app loads its renderer from `file://`, and Chromium refuses
 * `fetch` on a file URL -- so the ordinary "fetch the asset, decodeAudioData"
 * path works in the dev server and fails in the shipped game, which is the
 * worst shape a bug can have. Vite is configured to inline `.ogg` as data URLs
 * (see vite.config.ts), and `fetch` on a data URL is allowed everywhere.
 *
 * It costs about two megabytes in the bundle, which is nothing next to a 111 MB
 * installer. The better long-term fix is to serve the renderer over a custom
 * protocol from the Electron main process instead of `file://`; that is a
 * change to the boot path and does not belong in the same commit as the music.
 */

const STEMS = ["bed", "pulse", "lead", "dread"] as const;
type Stem = (typeof STEMS)[number];

const URLS: Record<Stem | "menu", string> = {
  bed: bedUrl,
  pulse: pulseUrl,
  lead: leadUrl,
  dread: dreadUrl,
  menu: menuUrl,
};

export type Scene = "menu" | "match" | "silent";

/** Seconds to cross from one scene to another. Slow: this is not a transition. */
const SCENE_FADE = 2.2;
/** Seconds for a stem to follow the mix. Fast enough to feel caused, slow enough not to pump. */
const MIX_FADE = 1.6;

const VOLUME_KEY = "rts.musicVolume";

class MusicPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly decoded = new Map<string, AudioBuffer>();

  /** Currently sounding sources, by stem name, with their own gain. */
  private voices = new Map<string, { source: AudioBufferSourceNode; gain: GainNode }>();
  private current: Scene = "silent";

  private level = 0.6;
  private muted = false;
  private ready = false;

  constructor() {
    try {
      const stored = localStorage.getItem(VOLUME_KEY);
      if (stored !== null) this.level = Math.max(0, Math.min(1, Number(stored)));
    } catch {
      // Blocked site data. A default volume is better than refusing to play.
    }
  }

  /**
   * Decode every stem.
   *
   * Called once at startup, alongside the terrain textures. Decoding five
   * minutes of audio takes long enough to be a visible hitch, and the moment it
   * would otherwise land is when the player has just pressed Start.
   */
  async load(): Promise<void> {
    if (this.ready) return;

    // Constructed here rather than lazily, because a context created inside an
    // event handler is the only kind some browsers will let you start -- and
    // this runs from the module's top level, before any gesture.
    const Ctor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : this.level;
    master.connect(ctx.destination);

    this.ctx = ctx;
    this.master = master;

    await Promise.all(
      Object.entries(URLS).map(async ([name, url]) => {
        const bytes = await (await fetch(url)).arrayBuffer();
        this.decoded.set(name, await ctx.decodeAudioData(bytes));
      }),
    );

    // Autoplay policy: a context created before any user gesture starts
    // suspended, and nothing will sound until it is resumed from one. The menu
    // is the first thing on screen, so the first click anywhere does it.
    const wake = (): void => {
      void ctx.resume();
    };
    window.addEventListener("pointerdown", wake, { once: true });
    window.addEventListener("keydown", wake, { once: true });

    // Quiet when the game is not the window in front. The simulation keeps
    // running -- the host is the arbiter and must not stall -- but there is no
    // reason for a background window to keep making noise.
    window.addEventListener("blur", () => this.applyMaster(0.4));
    window.addEventListener("focus", () => this.applyMaster(0.4));

    this.ready = true;
  }

  /** Switch between the menu piece, the match mix, and silence. */
  scene(next: Scene): void {
    if (!this.ctx || !this.master || this.current === next) return;
    this.current = next;

    const ctx = this.ctx;
    void ctx.resume();

    for (const [, voice] of this.voices) {
      ramp(voice.gain.gain, 0, SCENE_FADE, ctx);
      // Stopped rather than left running: an AudioBufferSourceNode at zero gain
      // still costs its decode and its loop bookkeeping for the life of the
      // process, and a player who bounces between menu and match a dozen times
      // would accumulate all of them.
      voice.source.stop(ctx.currentTime + SCENE_FADE + 0.1);
    }
    this.voices = new Map();

    if (next === "silent") return;

    const names: readonly string[] = next === "menu" ? ["menu"] : STEMS;
    // One start time for all of them. This is the whole reason the stems stay
    // in phase with each other.
    const at = ctx.currentTime + 0.06;

    for (const name of names) {
      const decoded = this.decoded.get(name);
      if (!decoded) continue;

      const source = ctx.createBufferSource();
      source.buffer = decoded;
      source.loop = true;

      const gain = ctx.createGain();
      // The bed and the menu come straight up; the reactive layers start silent
      // and are brought in by `intensity`.
      const target = name === "bed" || name === "menu" ? 1 : 0;
      gain.gain.value = 0;
      source.connect(gain).connect(this.master);
      source.start(at);
      ramp(gain.gain, target, SCENE_FADE, ctx);

      this.voices.set(name, { source, gain });
    }
  }

  /**
   * Where the mix sits, from what is happening in the match.
   *
   * `tension` brings in the machinery and then the guitar; `peril` brings in the
   * dissonant layer underneath everything. Both are 0..1 and are expected to
   * move slowly -- see `MusicDirector`, which is what smooths them.
   */
  intensity(tension: number, peril: number): void {
    if (!this.ctx || this.current !== "match") return;
    const ctx = this.ctx;

    // A floor under the pulse, so a quiet match still has a heartbeat. Without
    // it the opening minutes are a drone and nothing else.
    set(this.voices.get("pulse"), 0.25 + 0.75 * clamp01(tension), ctx);
    set(this.voices.get("lead"), clamp01(tension), ctx);
    set(this.voices.get("dread"), clamp01(peril), ctx);
  }

  get volume(): number {
    return this.level;
  }

  setVolume(value: number): void {
    this.level = Math.max(0, Math.min(1, value));
    try {
      localStorage.setItem(VOLUME_KEY, String(this.level));
    } catch {
      // See the constructor. It applies to this session either way.
    }
    this.applyMaster(0.12);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.applyMaster(0.12);
    return this.muted;
  }

  private applyMaster(seconds: number): void {
    if (!this.ctx || !this.master) return;
    const quiet = this.muted || !document.hasFocus();
    ramp(this.master.gain, quiet ? 0 : this.level, seconds, this.ctx);
  }
}

function set(
  voice: { gain: GainNode } | undefined,
  value: number,
  ctx: AudioContext,
): void {
  if (voice) ramp(voice.gain.gain, value, MIX_FADE, ctx);
}

/**
 * Move a parameter, cancelling whatever it was already doing.
 *
 * `cancelScheduledValues` alone leaves the parameter wherever the previous ramp
 * had reached but keeps its *old* target as the ramp's start point, which makes
 * a new ramp jump. Holding the current value first is what makes repeated calls
 * -- which `intensity` does constantly -- smooth rather than steppy.
 */
function ramp(param: AudioParam, to: number, seconds: number, ctx: AudioContext): void {
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(to, now + seconds);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Turns what happened in the simulation into two numbers for the mix.
 *
 * Both decay continuously and are pushed up by events, so the music leads
 * slightly and trails a long way -- a fight that ends does not take the drums
 * with it immediately, which is what makes the score feel like it is reacting
 * to a battle rather than to a frame.
 *
 * Reads events only; it never touches simulation state and is not part of any
 * hash. Two players can run entirely different music and still agree on the
 * match -- which is also why this can safely be skipped, muted or rewritten
 * without a thought for the netcode.
 */
export class MusicDirector {
  private tension = 0;
  private peril = 0;

  private readonly localPlayer: number;

  constructor(localPlayer: number) {
    this.localPlayer = localPlayer;
  }

  /** Call from the session's after-tick hook, while `world.events` is current. */
  ingest(world: World): void {
    const e = world.entities;
    const ownerOf = (id: number): number => {
      const i = e.indexOfLive(id);
      return i < 0 ? -1 : e.owner[i];
    };

    for (const event of world.events.all) {
      switch (event.kind) {
        // Anything involving this player's units, in either direction -- being
        // shot at and shooting are both reasons for the music to pick up.
        case EV_SHOT: {
          const shooter = ownerOf(event.shooter);
          const target = ownerOf(event.target);
          if (shooter !== this.localPlayer && target !== this.localPlayer) break;
          this.tension = Math.min(1, this.tension + 0.05);
          if (event.lethal && target === this.localPlayer) {
            this.peril = Math.min(1, this.peril + 0.05);
          }
          break;
        }

        // Losing things is what a losing match feels like.
        case EV_DEATH:
          if (event.owner === this.localPlayer) {
            this.peril = Math.min(1, this.peril + 0.12);
          }
          break;

        default:
          break;
      }
    }
  }

  /** Call once per tick with elapsed milliseconds. */
  update(deltaMs: number): void {
    const dt = Math.min(0.25, deltaMs / 1000);
    // Half-lives of roughly 6 and 25 seconds. Peril outlasts tension by a long
    // way on purpose: a lost expansion should colour the next minute.
    this.tension *= Math.pow(0.5, dt / 6);
    this.peril *= Math.pow(0.5, dt / 25);
    music.intensity(this.tension, this.peril);
  }
}

/** The one player, for the life of the process. */
export const music = new MusicPlayer();
