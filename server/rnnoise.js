// RNNoise — Xiph's speech denoiser, a small recurrent network — run as WebAssembly.
//
// ffmpeg has it as `arnndn`, but up to its July 2026 fix that filter read past the end of a
// buffer and gave one of two different results for the same recording, 5 dB apart on a real
// voice. The WebAssembly build is Xiph's own code and gives the same output every time.
//
// It works on 48 kHz mono in frames of 480 samples, at 16-bit scale, and its output is two
// frames late; the stream here takes float PCM in and gives float PCM out, the same length and
// back in time with the input.
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

/**
 * Denoise a stream of 32-bit float mono PCM. `mix` is how much of the denoised sound is used:
 * 1 is RNNoise alone, 0.9 keeps a tenth of the original — lined up with the output, so the
 * two add rather than comb.
 */
export function rnnoiseStream(rn, mix = 1) {
  const n = rn.frameSize;
  const state = rn.createDenoiseState();
  const frame = new Float32Array(n);
  const wet = Math.max(0, Math.min(1, mix));
  // The input, delayed to meet the output, for the dry part of the mix.
  const dry = new Float32Array(n + DELAY);
  let held = new Float32Array(0);
  let spare = Buffer.alloc(0);
  let written = 0;
  let received = 0;
  let skip = DELAY;

  const process = (input) => {
    frame.set(input);
    for (let i = 0; i < n; i++) frame[i] *= 32768;
    state.processFrame(frame);
    dry.copyWithin(0, n);
    dry.set(input, DELAY);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = (frame[i] / 32768) * wet + dry[i] * (1 - wet);
    // The first frame's worth of output is the delay; after that the output is in time.
    const from = Math.min(skip, n);
    skip -= from;
    return out.subarray(from);
  };

  const emit = (stream, samples) => {
    const keep = samples.subarray(0, Math.max(0, Math.min(samples.length, received - written)));
    if (!keep.length) return;
    written += keep.length;
    stream.push(Buffer.from(keep.buffer, keep.byteOffset, keep.byteLength));
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
        for (; at + n <= all.length; at += n) emit(this, process(all.subarray(at, at + n)));
        held = all.slice(at);
        done();
      } catch (e) {
        done(e);
      }
    },
    flush(done) {
      try {
        // Push the last partial frame and the delayed tail out with silence.
        const tail = new Float32Array(Math.ceil((held.length + DELAY) / n) * n);
        tail.set(held);
        for (let at = 0; at < tail.length; at += n) emit(this, process(tail.subarray(at, at + n)));
        done();
      } catch (e) {
        done(e);
      } finally {
        state.destroy();
      }
    },
  });
}
