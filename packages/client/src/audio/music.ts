import { defaultContent } from "@rts/content";
import { Level, audioContext, ramp, whenFocusChanges } from "./context.js";
import { EMPTY_CONFIG, parseMusicConfig, tracksFor, type MusicConfig, type Slot, type Track } from "./music-config.js";

/**
 * The music player.
 *
 * Plays the project's own recordings from assets/music, as music.json there
 * assigns them to slots -- see assets/music/README.md. The game only ever says
 * which slot it is in (`play`); which track that means, for which race, and
 * what to fall back to when a slot has nothing, is the configuration's.
 *
 * Tracks stream through `<audio>` elements rather than being decoded up front:
 * a four-minute song decoded is tens of megabytes, and a soundtrack is many of
 * them. Each element is routed through its own gain node into one master, and
 * there are two of them -- decks -- so one track fades out while the next
 * fades in.
 */

/** Every file in assets/music, by name, resolved to a URL at build time. */
const FILES = import.meta.glob<string>("../../assets/music/*.{mp3,ogg,wav,m4a,flac}", {
  eager: true,
  query: "?url",
  import: "default",
});

/** The configuration, if there is one. A missing file is silence, not an error. */
const CONFIG_FILES = import.meta.glob<unknown>("../../assets/music/music.json", { eager: true, import: "default" });

interface Deck {
  audio: HTMLAudioElement;
  gain: GainNode;
  track: Track | null;
}

class MusicPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private decks: Deck[] = [];
  /** Index into `decks` of the one playing, or fading in. */
  private active = 0;

  private config: MusicConfig = EMPTY_CONFIG;
  private urls = new Map<string, string>();
  private slot: Slot | null = null;
  private race: string | null = null;
  /** What the current slot may play, in the order to play it. */
  private playlist: Track[] = [];

  private readonly level = new Level("rts.musicVolume", 0.6);

  /** Read the configuration and open the audio context. Called once at startup. */
  async load(): Promise<void> {
    if (this.ctx) return;

    for (const [path, url] of Object.entries(FILES)) this.urls.set(path.slice(path.lastIndexOf("/") + 1), url);
    const raw = Object.values(CONFIG_FILES)[0];
    if (raw !== undefined) {
      const races = defaultContent.races.map((r) => r.id);
      const { config, warnings } = parseMusicConfig(raw, new Set(this.urls.keys()), races);
      this.config = config;
      for (const warning of warnings) console.warn(`[rts] music.json: ${warning}`);
    }
    console.info(`[rts] music: ${this.config.tracks.length} tracks configured, ${this.urls.size} files`);

    const ctx = audioContext();
    if (!ctx) return;
    const master = ctx.createGain();
    master.gain.value = this.level.effective;
    master.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;

    for (let k = 0; k < 2; k++) {
      const audio = new Audio();
      audio.preload = "auto";
      const gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaElementSource(audio).connect(gain).connect(master);
      const deck: Deck = { audio, gain, track: null };
      // One track after another within a slot. A slot with a single track
      // therefore plays it again, which is what a loop is.
      audio.addEventListener("ended", () => {
        if (this.decks[this.active] === deck) this.next();
      });
      this.decks.push(deck);
    }

    // Autoplay policy: nothing sounds before the player's first gesture. The
    // menu is the first thing on screen, so the first click anywhere starts
    // whatever should already be playing.
    const wake = (): void => {
      const deck = this.decks[this.active];
      if (deck.track && deck.audio.paused) void deck.audio.play().catch(() => {});
    };
    window.addEventListener("pointerdown", wake, { once: true });
    window.addEventListener("keydown", wake, { once: true });

    // Quiet when the game is not the window in front. The simulation keeps
    // running -- the host is the arbiter and must not stall -- but there is no
    // reason for a background window to keep making noise.
    whenFocusChanges(() => this.applyMaster(0.4));

    if (this.slot) this.play(this.slot, this.race);
  }

  /**
   * Play from a slot. `race` is the local player's race in a match, and null
   * elsewhere.
   *
   * Staying in a slot, or moving to one whose tracks include the one playing,
   * changes nothing audible: a lobby that falls back to the main menu's music
   * does not restart it, and neither does a battle that ends in a mood with the
   * same song.
   */
  play(slot: Slot, race: string | null = null): void {
    if (this.slot === slot && this.race === race) return;
    this.slot = slot;
    this.race = race;
    if (!this.ctx) return;

    const tracks = tracksFor(this.config, slot, race);
    this.playlist = this.config.shuffle ? shuffled(tracks) : tracks;
    const current = this.decks[this.active].track;
    if (current && tracks.includes(current)) return;
    this.start(this.playlist[0] ?? null);
  }

  /** When a match's mood moves, as configured. */
  get moods(): MusicConfig["moods"] {
    return this.config.moods;
  }

  /** The slot being played from, for diagnostics. */
  get currentSlot(): Slot | null {
    return this.slot;
  }

  /** The file playing, for diagnostics. */
  get currentFile(): string | null {
    return this.decks[this.active]?.track?.file ?? null;
  }

  get volume(): number {
    return this.level.value;
  }

  setVolume(value: number): void {
    this.level.set(value);
    this.applyMaster(0.12);
  }

  get isMuted(): boolean {
    return this.level.muted;
  }

  toggleMute(): boolean {
    this.level.muted = !this.level.muted;
    this.applyMaster(0.12);
    return this.level.muted;
  }

  /** The track after the one that just ended, from the same slot. */
  private next(): void {
    const current = this.decks[this.active].track;
    if (this.playlist.length === 0) return;
    const at = current ? this.playlist.indexOf(current) : -1;
    let following = this.playlist[(at + 1) % this.playlist.length];
    // A reshuffle at the end of the list, never repeating the song just heard
    // unless it is the only one.
    if (this.config.shuffle && at === this.playlist.length - 1 && this.playlist.length > 1) {
      this.playlist = shuffled(this.playlist);
      if (this.playlist[0] === current) this.playlist.push(this.playlist.shift()!);
      following = this.playlist[0];
    }
    this.start(following, following === current);
  }

  /** Fade the playing deck out and `track` in on the other one. */
  private start(track: Track | null, restart = false): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const fade = this.config.crossfade;
    const outgoing = this.decks[this.active];

    if (restart && track && outgoing.track === track) {
      outgoing.audio.currentTime = 0;
      void outgoing.audio.play().catch(() => {});
      return;
    }

    ramp(outgoing.gain.gain, 0, fade, ctx);
    const leaving = outgoing.audio;
    const left = outgoing.track;
    setTimeout(() => {
      // Only if nothing has been started on this deck since.
      if (outgoing.track === left && this.decks[this.active] !== outgoing) leaving.pause();
    }, fade * 1000 + 100);

    if (!track) {
      outgoing.track = null;
      return;
    }

    this.active = 1 - this.active;
    const incoming = this.decks[this.active];
    incoming.track = track;
    incoming.audio.src = this.urls.get(track.file)!;
    incoming.audio.currentTime = 0;
    incoming.gain.gain.cancelScheduledValues(ctx.currentTime);
    incoming.gain.gain.setValueAtTime(0, ctx.currentTime);
    ramp(incoming.gain.gain, track.volume, fade, ctx);
    // Rejected before the first gesture; `wake` starts it then.
    void incoming.audio.play().catch(() => {});
  }

  private applyMaster(seconds: number): void {
    if (!this.ctx || !this.master) return;
    ramp(this.master.gain, this.level.effective, seconds, this.ctx);
  }
}

function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The one player, for the life of the process. */
export const music = new MusicPlayer();
