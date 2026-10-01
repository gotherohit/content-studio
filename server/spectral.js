// Steady noise — a microphone's own hiss, a room's static — taken out by its spectrum.
//
// The speech model (rnnoise.js) is good at telling a voice from everything else, but it is
// held back while someone speaks, to keep the voice whole, and so the static stays under the
// words. Static is steady, though: it has the same spectrum in a pause as under a word. So it
// is measured where there is nothing else — the pauses, which RNNoise's voice detection finds
// — and subtracted, frequency by frequency, everywhere. A frequency where the voice is well
// above the static is left alone; one where there is only static is turned down. This is what
// an editor's "reduce noise" effect does.
//
// Everything is float mono PCM at 48 kHz, streamed, and comes out the same length and in time.
import fs from "node:fs";
import { Transform } from "node:stream";

/** Frame and hop of the transform: 43 ms frames, three-quarters overlapped. */
export const SIZE = 2048;
export const HOP = SIZE / 4;
const BINS = SIZE / 2 + 1;
/** How far the static is over-estimated before it is subtracted: what is merely near it goes too. */
const OVER = 2.5;

// Square-root Hann, used going in and coming out: overlapped by three-quarters the two multiply
// to a Hann and four of those add to exactly 2.
const WINDOW = Float32Array.from({ length: SIZE }, (_, i) => Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / SIZE)));
const REVERSED = (() => {
  const bits = Math.log2(SIZE);
  return Uint16Array.from({ length: SIZE }, (_, i) => { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); return r; });
})();
const COS = Float32Array.from({ length: SIZE / 2 }, (_, i) => Math.cos((2 * Math.PI * i) / SIZE));
const SIN = Float32Array.from({ length: SIZE / 2 }, (_, i) => Math.sin((2 * Math.PI * i) / SIZE));

/** In-place radix-2 FFT of `re`/`im` (length SIZE); `inverse` undoes it, scaling included. */
export function fft(re, im, inverse = false) {
  for (let i = 0; i < SIZE; i++) {
    const j = REVERSED[i];
    if (j > i) { const a = re[i]; re[i] = re[j]; re[j] = a; const b = im[i]; im[i] = im[j]; im[j] = b; }
  }
  for (let size = 2; size <= SIZE; size <<= 1) {
    const half = size >> 1, step = SIZE / size;
    for (let start = 0; start < SIZE; start += size) {
      for (let k = 0; k < half; k++) {
        const c = COS[k * step], s = inverse ? SIN[k * step] : -SIN[k * step];
        const a = start + k, b = a + half;
        const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
  if (inverse) for (let i = 0; i < SIZE; i++) { re[i] /= SIZE; im[i] /= SIZE; }
}

/** Float samples out of a stream of bytes that may split a sample between chunks. */
function sampleReader() {
  let spare = Buffer.alloc(0);
  return (chunk) => {
    const bytes = spare.length ? Buffer.concat([spare, chunk]) : chunk;
    const whole = bytes.length - (bytes.length % 4);
    spare = Buffer.from(bytes.subarray(whole));
    const out = new Float32Array(whole / 4);
    for (let i = 0; i < out.length; i++) out[i] = bytes.readFloatLE(i * 4);
    return out;
  };
}

/**
 * Cut a stream of samples into overlapped frames, as the remover will: `onFrame(index, frame)`
 * gets each SIZE-long frame, the first one starting SIZE − HOP before the first sample so that
 * every sample is covered by four. Returns `push(samples)` and `end()`.
 */
function framer(onFrame) {
  const pad = SIZE - HOP;
  let buffer = new Float32Array(pad);
  let index = 0;
  const drain = () => {
    let at = 0;
    for (; at + SIZE <= buffer.length; at += HOP) onFrame(index++, buffer.subarray(at, at + SIZE));
    buffer = buffer.slice(at);
  };
  return {
    push(samples) {
      const joined = new Float32Array(buffer.length + samples.length);
      joined.set(buffer);
      joined.set(samples, buffer.length);
      buffer = joined;
      drain();
    },
    end() {
      // Silence after the last sample, until it too has been covered four times.
      this.push(new Float32Array(SIZE));
    },
  };
}

/**
 * The static's power at each frequency, from a recording's pauses. `quiet(from, to)` says
 * whether the samples in that range are free of speech — the caller knows, from RNNoise.
 * When there is too little pause to learn from, the quietest each frequency ever gets (smoothed
 * over a few frames) stands in: static is what is left when nothing else is sounding.
 * Returns null for an empty recording.
 */
export async function noiseProfile(file, quiet) {
  const sum = new Float64Array(BINS), least = new Float64Array(BINS).fill(Infinity), recent = new Float64Array(BINS);
  const re = new Float32Array(SIZE), im = new Float32Array(SIZE);
  let learnt = 0, frames = 0;
  const cut = framer((index, frame) => {
    for (let i = 0; i < SIZE; i++) { re[i] = frame[i] * WINDOW[i]; im[i] = 0; }
    fft(re, im);
    const start = index * HOP - (SIZE - HOP);
    const pause = quiet(start, start + SIZE);
    for (let k = 0; k < BINS; k++) {
      const power = re[k] * re[k] + im[k] * im[k];
      if (pause) sum[k] += power;
      recent[k] = frames ? recent[k] * 0.8 + power * 0.2 : power;
      if (frames >= 8 && recent[k] < least[k]) least[k] = recent[k];
    }
    if (pause) learnt++;
    frames++;
  });
  const read = sampleReader();
  for await (const chunk of fs.createReadStream(file)) cut.push(read(chunk));
  cut.end();
  if (!frames) return null;
  const profile = new Float32Array(BINS);
  // A quarter of a second of pause is enough for a steady noise.
  if (learnt >= 24) for (let k = 0; k < BINS; k++) profile[k] = sum[k] / learnt;
  else for (let k = 0; k < BINS; k++) profile[k] = Number.isFinite(least[k]) ? least[k] * 1.5 : 0;
  return profile;
}

/**
 * Take the static out of a stream. `profile` is its power at each frequency; `amountDb` is how
 * far a frequency holding only static is turned down. A frequency's gain falls slowly and rises
 * at once, and is smoothed across its neighbours: without that, what is left of the static
 * flickers on and off as "musical" tones.
 */
export function spectralStream(profile, amountDb) {
  const floor = 10 ** (-Math.max(0, amountDb) / 20);
  const re = new Float32Array(SIZE), im = new Float32Array(SIZE);
  const gain = new Float32Array(BINS).fill(1), wanted = new Float32Array(BINS), power = new Float32Array(BINS), level = new Float32Array(BINS);
  let out = new Float32Array(SIZE);
  let received = 0, written = 0, skip = SIZE - HOP;
  let stream;
  const emit = (samples) => {
    const from = Math.min(skip, samples.length);
    skip -= from;
    const keep = samples.subarray(from, from + Math.max(0, Math.min(samples.length - from, received - written)));
    if (!keep.length) return;
    written += keep.length;
    stream.push(Buffer.from(Float32Array.from(keep).buffer));
  };
  const cut = framer((_index, frame) => {
    for (let i = 0; i < SIZE; i++) { re[i] = frame[i] * WINDOW[i]; im[i] = 0; }
    fft(re, im);
    // The level a frequency is judged by is smoothed over a few frames and its neighbours: one
    // frame of static swings far above and below its average, and judged raw, much of it would
    // pass as signal.
    for (let k = 0; k < BINS; k++) power[k] = re[k] * re[k] + im[k] * im[k];
    for (let k = 0; k < BINS; k++) {
      const across = 0.25 * power[Math.max(0, k - 1)] + 0.5 * power[k] + 0.25 * power[Math.min(BINS - 1, k + 1)];
      // An average, not a peak: following every upward swing over-reads static by several dB
      // and lets it through. Only a clear onset — four times the level so far, the start of a
      // word — is followed at once, so a word is never held back.
      level[k] = across > 4 * level[k] ? across : level[k] * 0.7 + across * 0.3;
      const kept = level[k] > 0 ? 1 - (OVER * profile[k]) / level[k] : 0;
      wanted[k] = Math.max(floor, kept > 0 ? Math.sqrt(kept) : 0);
    }
    for (let k = 0; k < BINS; k++) {
      const smooth = 0.25 * wanted[Math.max(0, k - 1)] + 0.5 * wanted[k] + 0.25 * wanted[Math.min(BINS - 1, k + 1)];
      gain[k] = Math.max(smooth, gain[k] * 0.8);
      re[k] *= gain[k]; im[k] *= gain[k];
      if (k > 0 && k < SIZE / 2) { re[SIZE - k] = re[k]; im[SIZE - k] = -im[k]; }
    }
    fft(re, im, true);
    for (let i = 0; i < SIZE; i++) out[i] += (re[i] * WINDOW[i]) / 2;
    // The first HOP samples have now had all four of their frames.
    emit(out.subarray(0, HOP));
    const next = new Float32Array(SIZE);
    next.set(out.subarray(HOP));
    out = next;
  });
  const read = sampleReader();
  stream = new Transform({
    transform(chunk, _enc, done) {
      try { const samples = read(chunk); received += samples.length; cut.push(samples); done(); } catch (e) { done(e); }
    },
    flush(done) {
      try { cut.end(); done(); } catch (e) { done(e); }
    },
  });
  return stream;
}
