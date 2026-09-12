import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  SAMPLE_RATE,
  applyGain,
  buffer,
  db,
  encodeWav,
  foldLoop,
  hit,
  kick,
  peak,
  pluck,
  reverb,
  rng,
  rumble,
  tone,
} from "./lib/audio.mjs";

/**
 * Generate the soundtrack.
 *
 * Original music, written for this world. The brief was "in the style of" a
 * well-known RTS theme, and style is where it stops: nothing here is taken from
 * any recording. What it borrows is a *genre* -- dirty modal blues over an
 * industrial bed, which nobody owns and which happens to suit a forge-world
 * that has been stripped and left running. See UNIVERSE.md.
 *
 * STEMS, NOT A TRACK
 * ------------------
 * The music has to answer to what is happening in the match, and the files are
 * rendered ahead of time, so it is rendered as *layers* rather than as a piece.
 * Every stem is the same tempo and the same length, and the game fades them in
 * and out against each other -- so "the music gets tense" is a gain envelope on
 * `pulse` and `lead` rather than a second track that has to be beat-matched into
 * the first. They only stay in sync because they are cut from one render.
 *
 *   node scripts/generate-music.mjs      (needs ffmpeg on PATH)
 *
 * ffmpeg is a build-time tool, not a dependency: it turns the uncompressed
 * render into the committed OGG. Nobody who merely builds the game needs it,
 * only somebody changing the music.
 */

const OUT = fileURLToPath(new URL("../packages/client/assets/audio/", import.meta.url));
const TEMP = fileURLToPath(new URL("../.audio-tmp/", import.meta.url));

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** Slow. This is music for a place where nothing is in a hurry any more. */
const BPM = 72;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
/** Sixteen bars. Long enough that the repeat is not the thing you notice. */
const BARS = 16;
const LOOP = BARS * BAR;
/** Room for the reverb tail of the second pass; discarded by the fold. */
const TAIL = 6;

const bar = (n) => n * BAR;
const beat = (n) => n * BEAT;

// ---------------------------------------------------------------------------
// Pitch
// ---------------------------------------------------------------------------

const D1 = 26;
const D2 = 38;
const A2 = 45;
const D3 = 50;
const F3 = 53;
const A3 = 57;
const Bb3 = 58;
const C4 = 60;
const D4 = 62;
const F4 = 65;
const G4 = 67;
const Ab4 = 68; // the blue note
const A4 = 69;
const C5 = 72;
const D5 = 74;

/**
 * Two bars per cell, eight cells.
 *
 * A D pedal under a modal drift up to the relative major and back. Deliberately
 * plain: the interest in this idiom is in the texture and the phrasing, and a
 * progression that keeps announcing itself would fight the fact that a player
 * is going to hear it for forty minutes.
 */
const CHORDS = [
  [D3, F3, A3], // Dm
  [D3, F3, A3], // Dm
  [F3, A3, C4], // F
  [D3, F3, A3], // Dm
  [Bb3, D4, F4], // Bb
  [C4, G4, C5], // C
  [D3, F3, A3], // Dm
  [D3, A3, D4], // Dm, open fifth to hand back to bar one
];

/**
 * Four answering phrases, in D minor pentatonic with the flat fifth.
 *
 * Sparse on purpose -- one phrase every four bars, each leaving most of its
 * space empty. A lead that plays continuously stops being a voice and becomes
 * part of the bed, and this one has to still be interesting on the fortieth
 * time round.
 */
const PHRASES = [
  { at: bar(3), notes: [[0, A3, 0.9], [beat(1.5), C4, 0.7], [beat(2.5), D4, 2.2]] },
  { at: bar(7), notes: [[0, D4, 0.8], [beat(1), C4, 0.6], [beat(2), A3, 0.8], [beat(3), G4, 1.6]] },
  // The blue-note walk-up, which is the one phrase that says what genre this is.
  {
    at: bar(11),
    notes: [[0, F4, 0.6], [beat(1), G4, 0.6], [beat(2), Ab4, 0.5], [beat(2.75), A4, 2.4]],
  },
  {
    at: bar(15),
    notes: [[0, A4, 0.7], [beat(1), G4, 0.6], [beat(2), F4, 0.7], [beat(3), D4, 2.6]],
  },
];

// ---------------------------------------------------------------------------
// Stems
// ---------------------------------------------------------------------------

/**
 * The bed: what is always playing.
 *
 * A sub that is felt rather than heard, a slow pad on the chords, and the
 * furnaces a few kilometres off. On its own this is the sound of an empty map.
 */
function bed(out, offset, random) {
  rumble(out, offset, LOOP, { gain: 0.16, cutoff: 74, swell: 0.031, random });

  // The pedal. Two octaves of sine, held the whole way, so the harmony above it
  // is always heard against a D.
  tone(out, offset, D1, LOOP, {
    gain: 0.5,
    shape: "sine",
    voices: 1,
    cutoff: 140,
    attack: 3,
    sustain: 1,
    release: 3,
    random,
  });
  tone(out, offset, D2, LOOP, {
    gain: 0.16,
    shape: "sine",
    voices: 2,
    detune: 4,
    cutoff: 200,
    attack: 4,
    sustain: 1,
    release: 3,
    random,
  });

  CHORDS.forEach((chord, cell) => {
    const at = offset + bar(cell * 2);
    chord.forEach((note, v) => {
      tone(out, at, note, BAR * 2 - 0.15, {
        gain: 0.052,
        voices: 3,
        detune: 9,
        cutoff: 420,
        resonance: 1.1,
        // A filter that opens across each chord, so the pad swells into the bar
        // rather than arriving fully formed.
        sweep: 1.15,
        attack: 1.4,
        decay: 1,
        sustain: 0.8,
        release: 2.2,
        pan: (v - 1) * 0.55,
        random,
      });
    });
  });
}

/**
 * The pulse: machinery keeping time.
 *
 * Struck metal rather than a drum kit. The bandpass banks are tuned to
 * frequencies that are not a harmonic series, which is what makes them read as
 * a hit sheet of steel instead of a tom.
 */
function pulse(out, offset, random) {
  for (let b = 0; b < BARS; b++) {
    const at = offset + bar(b);

    kick(out, at, { gain: 0.62, random });
    kick(out, at + beat(2), { gain: 0.44, from: 96, random });
    // A pickup into the next bar, every other bar. Without it the pattern is a
    // metronome; with it there is somewhere the loop is going.
    if (b % 2 === 1) kick(out, at + beat(3.5), { gain: 0.3, from: 88, random });

    // The backbeat, on a plate.
    hit(out, at + beat(1), 1.3, {
      gain: 0.3,
      partials: [287, 431, 719, 1103],
      q: 22,
      pan: -0.35,
      random,
    });
    hit(out, at + beat(3), 1.6, {
      gain: 0.33,
      partials: [211, 389, 617, 941],
      q: 20,
      pan: 0.4,
      random,
    });

    // Eighth-note ticks, quiet, panned apart. The thing that makes a slow tempo
    // feel like it is moving rather than merely slow.
    for (let e = 0; e < 8; e++) {
      if (e % 2 === 0) continue;
      hit(out, at + beat(e * 0.5), 0.12, {
        gain: 0.055,
        partials: [3100, 5300],
        q: 5,
        noiseCutoff: 12000,
        pan: e % 4 === 1 ? 0.6 : -0.6,
        random,
      });
    }
  }
}

/** The lead: a dirty plucked string, answering the pad. */
function lead(out, offset, random) {
  for (const phrase of PHRASES) {
    for (const [when, note, hold] of phrase.notes) {
      pluck(out, offset + phrase.at + when, note, hold, {
        gain: 0.3,
        damping: 0.9965,
        brightness: 0.62,
        drive: 0.45,
        pan: 0.22,
        random,
      });
      // An octave below at low level, which thickens the line without turning
      // it into a chord.
      pluck(out, offset + phrase.at + when, note - 12, hold * 0.7, {
        gain: 0.1,
        damping: 0.994,
        brightness: 0.35,
        drive: 0.2,
        pan: 0.1,
        random,
      });
    }
  }
}

/**
 * Dread: what plays while you are losing.
 *
 * A semitone cluster under the tonic. Two sines a semitone apart beat against
 * each other at their difference frequency, and at this pitch that is a slow
 * wobble you feel as unease rather than hear as two notes. Nothing else in the
 * score is dissonant, so this layer alone changes the mode of the whole piece.
 */
function dread(out, offset, random) {
  tone(out, offset, D2, LOOP, {
    gain: 0.2,
    shape: "sine",
    voices: 1,
    cutoff: 190,
    attack: 5,
    sustain: 1,
    release: 4,
    random,
  });
  tone(out, offset, D2 + 1, LOOP, {
    gain: 0.17,
    shape: "sine",
    voices: 1,
    cutoff: 190,
    attack: 7,
    sustain: 1,
    release: 4,
    random,
  });

  // A detuned low saw, filtered almost shut, that grinds under everything.
  tone(out, offset, A2, LOOP, {
    gain: 0.075,
    voices: 4,
    detune: 26,
    cutoff: 150,
    resonance: 1.6,
    sweep: 0.9,
    attack: 6,
    sustain: 0.9,
    release: 4,
    random,
  });

  // Four slow swells across the loop, each one a little alarm nobody answers.
  for (let s = 0; s < 4; s++) {
    hit(out, offset + bar(s * 4 + 2), 3.4, {
      gain: 0.1,
      partials: [149, 224, 373],
      q: 30,
      pan: s % 2 === 0 ? -0.5 : 0.5,
      random,
    });
  }
}

/**
 * The menu piece: the bed, alone, with the guitar much further away.
 *
 * Deliberately not a different composition. The menu should sound like the
 * place you are about to be dropped into, and the cheapest way to guarantee
 * that is for it to be the same music with almost everything taken out.
 */
function menu(out, offset, random) {
  bed(out, offset, random);
  for (const phrase of [PHRASES[0], PHRASES[3]]) {
    for (const [when, note, hold] of phrase.notes) {
      pluck(out, offset + phrase.at + when, note, hold * 1.4, {
        gain: 0.12,
        damping: 0.9975,
        brightness: 0.3,
        drive: 0.1,
        pan: 0.15,
        random,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * Render one stem to a seamless loop.
 *
 * The pattern is played twice and the second pass is what gets kept; see
 * `foldLoop`. Every stem gets its own seeded generator so that re-rendering one
 * of them does not change the others -- the noise in a pluck's excitation is
 * part of how it sounds, and a shared stream would make every file depend on
 * the order they happened to be generated in.
 */
function render(name, schedule, seed, reverbOptions) {
  const out = buffer(LOOP * 2 + TAIL);
  const random = rng(seed);
  schedule(out, 0, random);
  schedule(out, LOOP, random);

  // Before the fold, so the tail of pass one is inside the kept region.
  if (reverbOptions) reverb(out, reverbOptions);

  const loop = foldLoop(out, LOOP);
  console.log(
    `[rts] ${name}: ${LOOP.toFixed(1)}s, peak ${(20 * Math.log10(peak(loop) || 1e-9)).toFixed(1)} dBFS`,
  );
  return loop;
}

mkdirSync(OUT, { recursive: true });
mkdirSync(TEMP, { recursive: true });

const stems = {
  bed: render("bed", bed, 0x51e3d, { mix: 0.34, decay: 0.84, damping: 3200 }),
  pulse: render("pulse", pulse, 0x9a17c, { mix: 0.27, decay: 0.76, damping: 5200 }),
  lead: render("lead", lead, 0x2f40b, { mix: 0.36, decay: 0.82, damping: 4600 }),
  dread: render("dread", dread, 0x70cc1, { mix: 0.4, decay: 0.88, damping: 2600 }),
};
const menuLoop = render("menu", menu, 0x51e3d, { mix: 0.42, decay: 0.86, damping: 2900 });

/**
 * One gain for every stem, set by the loudest possible combination.
 *
 * Normalising each stem to its own peak would destroy the mix: `pulse` would
 * come back as loud as the whole bed, and the balance written above would mean
 * nothing. So the sum of everything is measured, and the single gain that keeps
 * *that* under full scale is applied to all four.
 */
const sum = buffer(LOOP);
for (const stem of Object.values(stems)) {
  for (let i = 0; i < sum.length; i++) {
    sum.L[i] += stem.L[i];
    sum.R[i] += stem.R[i];
  }
}
const headroom = db(-1.5) / (peak(sum) || 1);
console.log(`[rts] full mix peaked at ${(20 * Math.log10(peak(sum))).toFixed(1)} dBFS`);
for (const stem of Object.values(stems)) applyGain(stem, headroom);
applyGain(menuLoop, db(-1.5) / (peak(menuLoop) || 1));

/**
 * Encode.
 *
 * Vorbis at quality 4 -- around 128 kbps, which for a loop that is mostly low
 * frequency and noise is transparent enough, and keeps the whole soundtrack to
 * a few megabytes in the repository. The WAV is an intermediate and is deleted.
 */
function encode(name, loop) {
  const wav = `${TEMP}${name}.wav`;
  const ogg = `${OUT}${name}.ogg`;
  writeFileSync(wav, encodeWav(loop));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", wav, "-c:a", "libvorbis", "-q:a", "4", ogg]);
  return ogg;
}

const written = [];
for (const [name, loop] of Object.entries(stems)) written.push(encode(name, loop));
written.push(encode("menu", menuLoop));
rmSync(TEMP, { recursive: true, force: true });

console.log(`[rts] ${written.length} files written to packages/client/assets/audio/`);
console.log(`[rts] loop ${LOOP.toFixed(2)}s at ${BPM} BPM, ${SAMPLE_RATE} Hz`);
