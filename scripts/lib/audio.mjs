/**
 * Offline audio synthesis, for the music generator.
 *
 * The same bargain as the terrain textures: generated rather than authored, the
 * generator committed alongside its output, and the output an ordinary media
 * file that can be replaced by a real recording without touching a line of
 * code. See UNIVERSE.md.
 *
 * Everything here writes into a pair of `Float32Array` channels at full float
 * precision and worries about quantisation exactly once, on the way out. Nothing
 * is normalised as it goes -- a stem has to keep its natural level relative to
 * the others, because the game mixes them live.
 */

export const SAMPLE_RATE = 44100;

/** A stereo buffer of `seconds` duration. */
export function buffer(seconds) {
  const n = Math.ceil(seconds * SAMPLE_RATE);
  return { L: new Float32Array(n), R: new Float32Array(n), length: n };
}

/** MIDI note number to frequency. 69 is A4 = 440 Hz. */
export function hz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Decibels to a linear gain, because levels are easier to reason about in dB. */
export function db(decibels) {
  return Math.pow(10, decibels / 20);
}

/** xorshift32, so a render is reproducible to the sample. */
export function rng(seed) {
  let state = seed | 0;
  if (state === 0) state = 1;
  return () => {
    state ^= state << 13;
    state |= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state |= 0;
    return (state >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

/**
 * Attack/decay/sustain/release, evaluated at a point in time.
 *
 * Exponential rather than linear in the decay and release, because linear decay
 * sounds synthetic -- a struck or plucked thing loses energy proportionally to
 * how much it has left, which is an exponential curve.
 */
export function adsr(t, duration, a, d, s, r) {
  if (t < 0) return 0;
  if (t < a) return a === 0 ? 1 : t / a;
  if (t < a + d) {
    const k = (t - a) / d;
    return 1 + (s - 1) * (1 - Math.pow(1 - k, 2));
  }
  if (t < duration) return s;
  const k = (t - duration) / r;
  return k >= 1 ? 0 : s * Math.pow(1 - k, 2.2);
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/**
 * A biquad, from the RBJ cookbook coefficients.
 *
 * One instance is one filter with one memory, so a caller that wants to filter
 * two voices needs two of them -- sharing one smears the tail of each into the
 * other, which on percussive material sounds like a broken reverb.
 */
export class Biquad {
  constructor() {
    this.b0 = 1;
    this.b1 = 0;
    this.b2 = 0;
    this.a1 = 0;
    this.a2 = 0;
    this.x1 = 0;
    this.x2 = 0;
    this.y1 = 0;
    this.y2 = 0;
  }

  lowpass(freq, q) {
    const w = (2 * Math.PI * freq) / SAMPLE_RATE;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = ((1 - cos) / 2) / a0;
    this.b1 = (1 - cos) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
    return this;
  }

  highpass(freq, q) {
    const w = (2 * Math.PI * freq) / SAMPLE_RATE;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = ((1 + cos) / 2) / a0;
    this.b1 = -(1 + cos) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
    return this;
  }

  bandpass(freq, q) {
    const w = (2 * Math.PI * freq) / SAMPLE_RATE;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b1 = 0;
    this.b2 = -alpha / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
    return this;
  }

  run(x) {
    const y =
      this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

// ---------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------

/**
 * A plucked string, by Karplus-Strong.
 *
 * A burst of noise in a delay line as long as one period, fed back through a
 * one-pole lowpass. The noise is every frequency at once; the delay keeps only
 * the ones that fit a whole number of times, which is the harmonic series; and
 * the lowpass makes the high partials die first, which is what a real string
 * does. Forty lines of arithmetic that sound unmistakably like a plucked
 * string, and nothing else in this file comes close for the effort.
 *
 * `drive` runs the result into a soft clipper. A clean string is a folk
 * instrument; the same string through a bit of dirt is the one this world wants.
 */
export function pluck(out, startSeconds, midi, seconds, options = {}) {
  const { gain = 0.3, damping = 0.996, brightness = 0.5, drive = 0, pan = 0, random } = options;
  const frequency = hz(midi);
  const n = Math.max(2, Math.round(SAMPLE_RATE / frequency));
  const line = new Float32Array(n);

  // Excitation. Lowpassing it controls how bright the attack is -- a hard pick
  // near the bridge is full-spectrum, a thumb over the soundhole is not.
  const excite = new Biquad().lowpass(400 + brightness * 6000, 0.7);
  const rand = random ?? Math.random;
  for (let i = 0; i < n; i++) line[i] = excite.run(rand() * 2 - 1);

  const start = Math.round(startSeconds * SAMPLE_RATE);
  const total = Math.round(seconds * SAMPLE_RATE);
  const left = Math.cos(((pan + 1) * Math.PI) / 4);
  const right = Math.sin(((pan + 1) * Math.PI) / 4);

  let previous = 0;
  let p = 0;
  for (let i = 0; i < total; i++) {
    const index = start + i;
    if (index >= out.length) break;

    const current = line[p];
    // One-pole lowpass in the feedback path: the string's losses.
    const filtered = (current + previous) * 0.5 * damping;
    line[p] = filtered;
    previous = current;
    p = (p + 1) % n;

    let sample = current * gain;
    if (drive > 0) sample = Math.tanh(sample * (1 + drive * 8)) / (1 + drive * 2);
    // A gentle fade at the very end, so a note that is still ringing when its
    // slot runs out does not end on a click.
    const fade = i > total - 512 ? (total - i) / 512 : 1;

    out.L[index] += sample * left * fade;
    out.R[index] += sample * right * fade;
  }
}

/**
 * A sustained tone: one or more detuned saw or sine partials through a filter.
 *
 * The workhorse for pads and drones. `detune` is in cents and is what turns two
 * oscillators into something that moves -- perfectly tuned unison is dead, and
 * the slow beating between slightly-off copies is most of what makes a pad
 * sound like it is breathing.
 */
export function tone(out, startSeconds, midi, seconds, options = {}) {
  const {
    gain = 0.2,
    shape = "saw",
    voices = 3,
    detune = 7,
    cutoff = 1200,
    resonance = 0.9,
    attack = 0.8,
    decay = 0.3,
    sustain = 0.85,
    release = 1.5,
    sweep = 0,
    pan = 0,
    random,
  } = options;

  const start = Math.round(startSeconds * SAMPLE_RATE);
  const total = Math.round((seconds + release) * SAMPLE_RATE);
  const base = hz(midi);
  const rand = random ?? Math.random;

  const phases = [];
  const steps = [];
  for (let v = 0; v < voices; v++) {
    // Spread the detune symmetrically, and start each voice somewhere random so
    // the attack is not a single phase-aligned click.
    const offset = voices === 1 ? 0 : (v / (voices - 1) - 0.5) * 2 * detune;
    phases.push(rand());
    steps.push((base * Math.pow(2, offset / 1200)) / SAMPLE_RATE);
  }

  const filter = new Biquad();
  const left = Math.cos(((pan + 1) * Math.PI) / 4);
  const right = Math.sin(((pan + 1) * Math.PI) / 4);

  for (let i = 0; i < total; i++) {
    const index = start + i;
    if (index >= out.length) break;
    const t = i / SAMPLE_RATE;

    // Re-tuned per sample rather than once: a filter that opens over the life of
    // the note is the difference between a pad and an organ chord.
    const k = t / (seconds + release);
    filter.lowpass(Math.max(60, cutoff * Math.pow(2, sweep * k)), resonance);

    let sample = 0;
    for (let v = 0; v < voices; v++) {
      phases[v] = (phases[v] + steps[v]) % 1;
      const ph = phases[v];
      sample += shape === "sine" ? Math.sin(ph * 2 * Math.PI) : ph * 2 - 1;
    }
    sample /= voices;

    const envelope = adsr(t, seconds, attack, decay, sustain, release);
    const value = filter.run(sample) * envelope * gain;

    out.L[index] += value * left;
    out.R[index] += value * right;
  }
}

/**
 * A burst of filtered noise: the whole percussion section.
 *
 * A bandpass with a high Q rings when you hit it, and a bank of them tuned to
 * frequencies that are *not* a harmonic series rings the way struck metal does.
 * That inharmonicity is the entire difference between a drum and a sheet of
 * steel, and this world only has the one of those.
 */
export function hit(out, startSeconds, seconds, options = {}) {
  const {
    gain = 0.3,
    partials = [220],
    q = 18,
    attack = 0.001,
    pan = 0,
    noiseCutoff = 9000,
    random,
  } = options;

  const start = Math.round(startSeconds * SAMPLE_RATE);
  const total = Math.round(seconds * SAMPLE_RATE);
  const rand = random ?? Math.random;

  const shaper = new Biquad().lowpass(noiseCutoff, 0.7);
  const banks = partials.map((f) => new Biquad().bandpass(f, q));
  const left = Math.cos(((pan + 1) * Math.PI) / 4);
  const right = Math.sin(((pan + 1) * Math.PI) / 4);

  for (let i = 0; i < total; i++) {
    const index = start + i;
    if (index >= out.length) break;
    const t = i / SAMPLE_RATE;

    // The excitation is short; what rings afterwards is the filter bank.
    const strike = t < 0.006 ? rand() * 2 - 1 : 0;
    const source = shaper.run(strike);

    let sample = 0;
    for (const bank of banks) sample += bank.run(source);
    sample /= banks.length;

    const envelope = adsr(t, seconds * 0.1, attack, seconds * 0.3, 0.35, seconds * 0.7);
    const value = sample * envelope * gain;

    out.L[index] += value * left;
    out.R[index] += value * right;
  }
}

/** A kick: a sine whose pitch falls off a cliff. What a struck membrane does. */
export function kick(out, startSeconds, options = {}) {
  const { gain = 0.7, from = 110, to = 38, seconds = 0.5, click = 0.25, random } = options;
  const start = Math.round(startSeconds * SAMPLE_RATE);
  const total = Math.round(seconds * SAMPLE_RATE);
  const rand = random ?? Math.random;

  let phase = 0;
  for (let i = 0; i < total; i++) {
    const index = start + i;
    if (index >= out.length) break;
    const t = i / SAMPLE_RATE;

    const frequency = to + (from - to) * Math.exp(-t * 34);
    phase = (phase + frequency / SAMPLE_RATE) % 1;

    const body = Math.sin(phase * 2 * Math.PI) * Math.exp(-t * 5.5);
    const tick = t < 0.004 ? (rand() * 2 - 1) * click * (1 - t / 0.004) : 0;
    const value = (body + tick) * gain;

    out.L[index] += value;
    out.R[index] += value;
  }
}

/** Broadband rumble: the furnaces, several kilometres away. */
export function rumble(out, startSeconds, seconds, options = {}) {
  const { gain = 0.2, cutoff = 90, swell = 0.05, random } = options;
  const start = Math.round(startSeconds * SAMPLE_RATE);
  const total = Math.round(seconds * SAMPLE_RATE);
  const rand = random ?? Math.random;

  // Two poles of lowpass, because one leaves audible hiss on top of what should
  // be felt rather than heard.
  const a = new Biquad().lowpass(cutoff, 0.6);
  const b = new Biquad().lowpass(cutoff * 1.6, 0.6);

  for (let i = 0; i < total; i++) {
    const index = start + i;
    if (index >= out.length) break;
    const t = i / SAMPLE_RATE;

    const noise = rand() * 2 - 1;
    const value = b.run(a.run(noise)) * gain * (1 + Math.sin(t * swell * 2 * Math.PI) * 0.45);

    // Decorrelated a little between channels, which is what makes a low bed
    // feel like a space rather than a point.
    out.L[index] += value;
    out.R[index] += value * 0.82;
  }
}

// ---------------------------------------------------------------------------
// Space
// ---------------------------------------------------------------------------

/**
 * A plate-ish reverb: four combs into two allpasses, per channel.
 *
 * Schroeder's arrangement from 1962, and still the cheapest way to turn a dry
 * signal into one that is somewhere. The comb lengths are coprime so their
 * repeats do not line up into a flutter, and the two channels use different
 * lengths so the result is wide.
 */
export function reverb(out, options = {}) {
  const { mix = 0.3, decay = 0.8, damping = 4200 } = options;

  const combsL = [1557, 1617, 1491, 1422];
  const combsR = [1640, 1703, 1576, 1502];
  const allpass = [556, 441];

  for (const [channel, combs] of [
    [out.L, combsL],
    [out.R, combsR],
  ]) {
    const lines = combs.map((n) => ({ buf: new Float32Array(n), p: 0, lp: 0 }));
    const aps = allpass.map((n) => ({ buf: new Float32Array(n), p: 0 }));
    const damp = damping / (SAMPLE_RATE / 2);

    for (let i = 0; i < channel.length; i++) {
      const dry = channel[i];

      let wet = 0;
      for (const line of lines) {
        const v = line.buf[line.p];
        wet += v;
        // One-pole lowpass inside the feedback: high frequencies die first in
        // any real room, and without this the tail turns into a hiss.
        line.lp += damp * (v - line.lp);
        line.buf[line.p] = dry + line.lp * decay;
        line.p = (line.p + 1) % line.buf.length;
      }
      wet /= lines.length;

      for (const ap of aps) {
        const v = ap.buf[ap.p];
        const output = -wet + v;
        ap.buf[ap.p] = wet + v * 0.5;
        ap.p = (ap.p + 1) % ap.buf.length;
        wet = output;
      }

      channel[i] = dry * (1 - mix) + wet * mix;
    }
  }
}

/**
 * Fold a double-length render down to one seamless loop.
 *
 * Render the pattern twice and keep the second half. The reverb tail and the
 * ring of anything still sounding at the end of pass one is present at the
 * start of pass two, so the join is silent -- which a straight render can never
 * be, because at sample zero nothing has happened yet and at the last sample
 * everything is still decaying.
 */
export function foldLoop(rendered, loopSeconds) {
  const n = Math.round(loopSeconds * SAMPLE_RATE);
  return {
    L: rendered.L.slice(n, n * 2),
    R: rendered.R.slice(n, n * 2),
    length: n,
  };
}

/** Peak level of a buffer, in linear amplitude. */
export function peak(buf) {
  let max = 0;
  for (let i = 0; i < buf.length; i++) {
    max = Math.max(max, Math.abs(buf.L[i]), Math.abs(buf.R[i]));
  }
  return max;
}

export function applyGain(buf, gain) {
  for (let i = 0; i < buf.length; i++) {
    buf.L[i] *= gain;
    buf.R[i] *= gain;
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/**
 * Sixteen-bit stereo WAV.
 *
 * The uncompressed intermediate. ffmpeg turns it into the committed OGG -- see
 * the note in generate-music.mjs about why the compressed file is the artefact
 * and this one is not.
 */
export function encodeWav(buf) {
  const frames = buf.length;
  const data = Buffer.alloc(frames * 4);

  for (let i = 0; i < frames; i++) {
    // Clamp rather than wrap. A sample over full scale that wraps becomes loud
    // broadband noise, which is far worse than the flat top of clipping.
    const l = Math.max(-1, Math.min(1, buf.L[i]));
    const r = Math.max(-1, Math.min(1, buf.R[i]));
    data.writeInt16LE(Math.round(l * 32767), i * 4);
    data.writeInt16LE(Math.round(r * 32767), i * 4 + 2);
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format: PCM
  header.writeUInt16LE(2, 22); // channels
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 4, 28); // byte rate
  header.writeUInt16LE(4, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
}
