// RNNoise — Xiph's speech denoiser, a small recurrent network — run as WebAssembly.
//
// ffmpeg has it as `arnndn`, but up to its July 2026 fix that filter read past the end of a
// buffer and gave one of two different results for the same recording, 5 dB apart on a real
// voice. The WebAssembly build is Xiph's own code and gives the same output every time.
//
// It works on 48 kHz mono in frames of 480 samples, at 16-bit scale, and its output is two
// frames late; the stream here takes float PCM in and gives float PCM out, the same length and
// back in time with the input. It also reports how likely each frame is to hold a voice, which
// is what lets the voice be left alone and only the pauses be scrubbed.
import fs from "node:fs";
import { Transform } from "node:stream";

/** Samples RNNoise's output lags its input by: two frames, 20 ms, measured against a real voice. */
export const DELAY = 960;

let loading = null;

/**
 * The module is built for browsers and refuses to start unless it finds a browser or a web
 * worker. Everything it needs is inside the script — the WebAssembly is embedded, nothing is
 * fetched — so it is let through by being told it is in a worker for as long as it loads.
 */
export function loadRnnoise() {
  loading ??= (async () => {
    const shim = typeof globalThis.WorkerGlobalScope === "undefined";
    if (shim) globalThis.WorkerGlobalScope = function WorkerGlobalScope() {};
    try {
      const { Rnnoise } = await import("@shiguredo/rnnoise-wasm");
      return await Rnnoise.load();
    } finally {
      if (shim) delete globalThis.WorkerGlobalScope;
    }
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

/** How sure RNNoise must be that a frame holds a voice for it to count as speech. */
export const SPEECH = 0.5;
/** The voice is let through from this long before a word (frames of 10 ms)… */
export const LOOKAHEAD = 12;
/** …until this long after the last one, so soft word endings and short gaps are never clipped. */
export const HANGOVER = 30;

/**
 * Denoise a stream of 32-bit float mono PCM, treating the voice and the pauses differently.
 *
 * RNNoise alone, at full strength, takes bites out of the voice: on real takes it pulled one
 * speaking moment in five down by more than 6 dB, which is heard as words going dull. But it
 * also says, frame by frame, how likely a voice is, and that is reliable. So:
 *
 * - while someone is speaking, only `speech` of the output is RNNoise's and the rest is the
 *   recording as it was (lined up, so the two add rather than comb) — the model can take at
 *   most `1 - speech` of the level away, and the voice keeps its own sound;
 * - in a pause, the output is RNNoise's alone (`pauseMix`), turned down to `pause`.
 *
 * "Speaking" starts LOOKAHEAD before the first frame RNNoise is sure of and lasts HANGOVER
 * after the last, and the change between the two is a ramp, never a step. `activity` is
 * `voiceActivity` of the untouched recording, for when what is streamed in has been cleaned
 * already.
 */
export function rnnoiseStream(rn, { speech = 1, pause = 1, pauseMix = 1, activity = null } = {}) {
  const n = rn.frameSize;
  const lag = DELAY / n;
  const state = rn.createDenoiseState();
  const frame = new Float32Array(n);
  const unit = (v) => Math.max(0, Math.min(1, v));
  const speechMix = unit(speech), quietMix = unit(pauseMix), quietGain = unit(pause);
  // Opening takes 60 ms, well inside the look-ahead; closing takes 200 ms.
  const rise = 1 / (0.06 * 48000), fall = 1 / (0.2 * 48000);
  const inputs = [];   // dry frames not yet matched with their output
  const waiting = [];  // frames in time with the input, waiting for the look-ahead
  let calls = 0;       // frames given to RNNoise so far
  let first = 0;       // index of waiting[0]
  let lastSpeech = -Infinity;
  let open = 0;
  let held = new Float32Array(0);
  let spare = Buffer.alloc(0);
  let written = 0;
  let received = 0;

  const emit = (stream, samples) => {
    const keep = samples.subarray(0, Math.max(0, Math.min(samples.length, received - written)));
    if (!keep.length) return;
    written += keep.length;
    stream.push(Buffer.from(keep.buffer, keep.byteOffset, keep.byteLength));
  };

  /** Give RNNoise one frame, then send out every frame whose look-ahead is now known. */
  const process = (stream, input) => {
    frame.set(input);
    for (let i = 0; i < n; i++) frame[i] *= 32768;
    // Where the words are is judged on the recording as it was (`activity`, when given): sound
    // that has already had its static taken out no longer looks like speech to the model, and
    // it would shut the gate on the voice.
    const heard = state.processFrame(frame);
    if ((activity ? activity[calls] ?? 0 : heard) >= SPEECH) lastSpeech = calls;
    inputs.push(Float32Array.from(input));
    // RNNoise's output is `lag` frames late: this is the sound of the frame given `lag` calls ago.
    if (calls >= lag) {
      const wet = new Float32Array(n);
      for (let i = 0; i < n; i++) wet[i] = frame[i] / 32768;
      waiting.push({ wet, dry: inputs.shift() });
    }
    calls++;
    while (waiting.length && first + LOOKAHEAD < calls) {
      const { wet, dry } = waiting.shift();
      const target = lastSpeech >= first - HANGOVER ? 1 : 0;
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        open += Math.max(-fall, Math.min(rise, target - open));
        const mix = quietMix + open * (speechMix - quietMix);
        // The gain moves evenly in dB, so a pause fades rather than drops.
        const gain = quietGain > 0 ? quietGain ** (1 - open) : open;
        out[i] = (wet[i] * mix + dry[i] * (1 - mix)) * gain;
      }
      first++;
      emit(stream, out);
    }
  };

  return new Transform({
    transform(chunk, _enc, done) {
      try {
        const bytes = spare.length ? Buffer.concat([spare, chunk]) : chunk;
        const whole = bytes.length - (bytes.length % 4);
        spare = Buffer.from(bytes.subarray(whole));
        const copy = new Float32Array(whole / 4);
        for (let i = 0; i < copy.length; i++) copy[i] = bytes.readFloatLE(i * 4);
        received += copy.length;
        const all = new Float32Array(held.length + copy.length);
        all.set(held);
        all.set(copy, held.length);
        let at = 0;
        for (; at + n <= all.length; at += n) process(this, all.subarray(at, at + n));
        held = all.slice(at);
        done();
      } catch (e) {
        done(e);
      }
    },
    flush(done) {
      try {
        // The last partial frame, then silence until the delay and the look-ahead have run out.
        const tail = new Float32Array((Math.ceil(held.length / n) + lag + LOOKAHEAD + 1) * n);
        tail.set(held);
        for (let at = 0; at < tail.length; at += n) process(this, tail.subarray(at, at + n));
        done();
      } catch (e) {
        done(e);
      } finally {
        state.destroy();
      }
    },
  });
}

/**
 * A recording heard 10 ms at a time: each frame's level in dB, and how likely RNNoise thinks it
 * is to hold a voice (zero throughout when no model is given). For a file of 32-bit float mono PCM.
 */
export async function listen(rn, file, frameSize = 480) {
  const state = rn ? rn.createDenoiseState() : null;
  const frame = new Float32Array(frameSize);
  const vad = [], level = [];
  let filled = 0, energy = 0;
  let spare = Buffer.alloc(0);
  try {
    for await (const chunk of fs.createReadStream(file)) {
      const bytes = spare.length ? Buffer.concat([spare, chunk]) : chunk;
      const whole = bytes.length - (bytes.length % 4);
      spare = Buffer.from(bytes.subarray(whole));
      for (let at = 0; at < whole; at += 4) {
        const v = bytes.readFloatLE(at);
        energy += v * v;
        frame[filled++] = v * 32768;
        if (filled === frameSize) {
          vad.push(state ? state.processFrame(frame) : 0);
          level.push(10 * Math.log10(energy / frameSize + 1e-12));
          filled = 0; energy = 0;
        }
      }
    }
  } finally {
    state?.destroy();
  }
  return { vad: Float32Array.from(vad), level: Float32Array.from(level) };
}

/** The level a recording rests at: the quietest tenth of its frames. */
export function floorOf(level) {
  if (!level.length) return -100;
  const sorted = Float32Array.from(level).sort();
  return sorted[Math.floor(sorted.length * 0.1)];
}

/** A resting level is usable only when there is a clearly louder part to distinguish it from. */
export function pauseFloor(level) {
  if (!level.length) return null;
  const sorted = Float32Array.from(level).sort();
  const floor = sorted[Math.floor(sorted.length * 0.1)];
  return sorted[Math.floor(sorted.length * 0.9)] - floor >= 6 ? floor : null;
}

/**
 * Where the words are, frame by frame, as a number the gate reads like RNNoise's own. The model
 * is not trusted alone: it reads a voice recorded through a sound driver's processing as
 * barely speech at all — 1 to 5 out of 10 through whole sentences — and a gate driven by it
 * shut on the words. So anything well above the level the recording rests at counts too.
 * Letting a loud noise through is a small fault; cutting a word is not.
 */
export function speechActivity({ vad, level }, floor = pauseFloor(level)) {
  // A steady or very short voice can be the quietest part of its own recording. With no
  // trustworthy resting level, favour speech rather than closing the gate on uncertain words.
  if (floor == null) return new Float32Array(level.length).fill(1);
  return Float32Array.from(level, (l, i) => (l > floor + 6 ? 1 : vad[i] ?? 0));
}

/**
 * Whether the samples from `from` to `to` are a pause: every frame in them, and for a tenth of
 * a second either side, within 3 dB of the level the recording rests at. Judged by level, not
 * by the model — what is learnt here is subtracted from the whole recording, and a voice the
 * model failed to recognise must never be learnt as noise.
 */
export function isPause(level, floor, from, to, frameSize = 480) {
  if (floor == null) return false;
  const first = Math.max(0, Math.floor(from / frameSize) - 10), last = Math.min(level.length - 1, Math.ceil(to / frameSize) + 10);
  if (last < first) return false;
  for (let i = first; i <= last; i++) if (level[i] > floor + 3) return false;
  return true;
}
