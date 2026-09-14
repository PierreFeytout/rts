import { Level, audioContext, ramp, whenFocusChanges } from "./context.js";
import { EMPTY_SFX, parseSfxConfig, resolveSound, spatial, type SfxConfig, type Sound } from "./sfx-config.js";

/**
 * The sound effects player.
 *
 * Plays the sounds in assets/sfx as sfx.json there assigns them -- see
 * assets/sfx/README.md and sfx-config.ts for how a sound is looked up. Unlike
 * music, effects are short and many, so they are decoded once at startup and
 * played from memory: starting a decoded buffer costs nothing, and four
 * hundred units in a fight start a lot of them.
 *
 * A sound with a position is heard from the camera: loud on screen, fading off
 * it, panned left to right. A sound without one -- an order acknowledged, a
 * button, "not enough alloy" -- is the interface's, and plays centred.
 *
 * Deciding *whether* something should be heard -- is it in the local player's
 * sight -- is the caller's; this only plays.
 */

const FILES = import.meta.glob<string>("../../assets/sfx/**/*.{ogg,wav,mp3,m4a,flac}", {
  eager: true,
  query: "?url",
  import: "default",
});
const CONFIG_FILES = import.meta.glob<unknown>("../../assets/sfx/sfx.json", { eager: true, import: "default" });

interface Voice {
  source: AudioBufferSourceNode;
  sound: Sound;
}

class SoundEffects {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private config: SfxConfig = EMPTY_SFX;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly voices = new Set<Voice>();
  private readonly lastStart = new Map<string, number>();
  private readonly level = new Level("rts.sfxVolume", 0.8);

  // The listener: where the camera looks, how much of the map it shows, and
  // which way is right on screen.
  private listenerX = 0;
  private listenerZ = 0;
  private radius = 20;
  private rightX = Math.SQRT1_2;
  private rightZ = -Math.SQRT1_2;

  /** Read the configuration and decode every sound it uses. Called once at startup. */
  async load(): Promise<void> {
    if (this.ctx) return;

    // Keyed by path relative to assets/sfx, so sounds can be kept in folders.
    const urls = new Map<string, string>();
    for (const [path, url] of Object.entries(FILES)) urls.set(path.slice(path.indexOf("assets/sfx/") + 11), url);

    const raw = Object.values(CONFIG_FILES)[0];
    if (raw !== undefined) {
      const { config, warnings } = parseSfxConfig(raw, new Set(urls.keys()));
      this.config = config;
      for (const warning of warnings) console.warn(`[rts] sfx.json: ${warning}`);
    }

    const ctx = audioContext();
    if (!ctx) return;
    const master = ctx.createGain();
    master.gain.value = this.level.effective * this.config.volume;
    master.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    whenFocusChanges(() => this.applyMaster(0.2));

    const used = new Set([...this.config.sounds.values()].flatMap((s) => s.files));
    await Promise.all(
      [...used].map(async (file) => {
        try {
          const bytes = await (await fetch(urls.get(file)!)).arrayBuffer();
          this.buffers.set(file, await ctx.decodeAudioData(bytes));
        } catch (error) {
          console.warn(`[rts] sfx: ${file} would not decode`, error);
        }
      }),
    );
    console.info(`[rts] sfx: ${this.config.sounds.size} sounds, ${this.buffers.size} files decoded`);
  }

  /** Where the camera is looking, on the ground, and roughly half its view. Call every frame. */
  listen(x: number, z: number, radius: number, rightX: number, rightZ: number): void {
    this.listenerX = x;
    this.listenerZ = z;
    this.radius = Math.max(1, radius);
    this.rightX = rightX;
    this.rightZ = rightZ;
  }

  /**
   * Play the first of `keys` the configuration has. With `at`, heard from the
   * camera at that ground position; without, centred, as the interface.
   */
  play(keys: readonly string[], at?: { x: number; z: number }): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== "running") return;
    const sound = resolveSound(this.config, keys);
    if (!sound) return;

    let gain = sound.volume;
    let pan = 0;
    if (at) {
      const heard = spatial(at.x - this.listenerX, at.z - this.listenerZ, this.radius, this.rightX, this.rightZ);
      if (heard.gain <= 0.01) return;
      gain *= heard.gain;
      pan = heard.pan;
    }

    // Too soon after the last one, or too many already: forty rivet drivers
    // firing on one tick are one volley, not forty stacked starts.
    const now = ctx.currentTime;
    if (now - (this.lastStart.get(sound.key) ?? -Infinity) < sound.gap) return;
    if (this.voices.size >= this.config.voices) return;
    let same = 0;
    for (const voice of this.voices) if (voice.sound === sound) same++;
    if (same >= sound.voices) return;

    const file = sound.files[Math.floor(Math.random() * sound.files.length)];
    const buffer = this.buffers.get(file);
    if (!buffer) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 1 + (Math.random() * 2 - 1) * sound.pitch;
    const volume = ctx.createGain();
    volume.gain.value = gain;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    source.connect(volume).connect(panner).connect(this.master);

    const voice: Voice = { source, sound };
    this.voices.add(voice);
    source.onended = () => {
      this.voices.delete(voice);
      source.disconnect();
      volume.disconnect();
      panner.disconnect();
    };
    source.start(now);
    this.lastStart.set(sound.key, now);
  }

  get volume(): number {
    return this.level.value;
  }

  setVolume(value: number): void {
    this.level.set(value);
    this.applyMaster(0.08);
  }

  get isMuted(): boolean {
    return this.level.muted;
  }

  toggleMute(): boolean {
    this.level.muted = !this.level.muted;
    this.applyMaster(0.08);
    return this.level.muted;
  }

  /** Sounds playing right now, for diagnostics. */
  get playing(): string[] {
    return [...this.voices].map((v) => v.sound.key);
  }

  private applyMaster(seconds: number): void {
    if (!this.ctx || !this.master) return;
    ramp(this.master.gain, this.level.effective * this.config.volume, seconds, this.ctx);
  }
}

/** The one player, for the life of the process. */
export const sfx = new SoundEffects();
