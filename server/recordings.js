// A beat's own recordings: narration over it, or a take of it on screen.
//
// They live in the project's recordings/ folder — never sources/, which the app adopts as
// sources. What the recorder hands over is kept as it came; ffmpeg then makes what is used:
// the sound cleaned of background noise and brought to a consistent loudness, and a take's
// picture remuxed so it has a length and can be seeked. The original stays, so a different
// amount of noise reduction can be tried without recording again.
//
// Every recording starts with a second of silence — the recorder asks for it — but people
// start talking early, so it is not taken on trust: the recording is measured first, the room's
// level is read from its quietest stretch, and a voice's lead-in is only cut up to the first word.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import ffmpegPath from "ffmpeg-static";
import { parseProbe } from "../electron/export-video.js";
import { loadRnnoise, rnnoiseStream } from "./rnnoise.js";

export const NOISE = ["off", "light", "strong"];
/** Integrated loudness a finished voice is brought to: what YouTube and most players expect. */
export const TARGET_LUFS = -16;
/** How much of RNNoise's output is used: Strong is the model alone, Light keeps a tenth of the original. */
export const RNN_MIX = { off: 0, light: 0.9, strong: 1 };
/**
 * Before anything else: mono at 48 kHz, which RNNoise needs, and a fourth-order high-pass —
 * rumble and desk thumps sit under the voice, and a gentle slope left them in.
 */
export const DECODE = "aformat=sample_fmts=flt:sample_rates=48000:channel_layouts=mono,highpass=f=85,highpass=f=85";
/** Length of one analysis frame, in seconds. */
export const FRAME = 0.03;

const n3 = (n) => String(Math.round(n * 1000) / 1000);
const safeLevel = (level) => (NOISE.includes(level) ? level : "light");

/** Per-frame RMS levels (dB) from ffmpeg's `astats` + `ametadata=print`. Silence is -100. */
export function frameLevels(text) {
  return [...String(text).matchAll(/RMS_level=(-?[\d.]+|-inf|inf|nan)/g)].map((m) => {
    const v = Number(m[1]);
    return Number.isFinite(v) ? Math.max(-100, v) : -100;
  });
}

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : -100;
};

/**
 * Where the room can be heard on its own: the longest run of frames near the quietest level
 * in the recording, clear of speech, preferring the silent lead-in when it really was silent.
 * Returns `[start, end]` in seconds, or null when there is no quiet stretch worth learning from.
 */
export function quietSpan(levels, frame = FRAME, lead = 0) {
  if (levels.length < 10) return null;
  const floor = percentile(levels, 0.1);
  const speech = percentile(levels, 0.9);
  // Near the floor, and well under the voice: a breath or a word's tail is not the room.
  const limit = Math.min(floor + 6, speech - 12);
  const runs = [];
  let from = -1;
  for (let i = 0; i <= levels.length; i++) {
    const quiet = i < levels.length && levels[i] <= limit;
    if (quiet && from < 0) from = i;
    if (!quiet && from >= 0) { runs.push([from, i]); from = -1; }
  }
  // A frame either side of a run is where a word starts or stops.
  const usable = runs.map(([a, b]) => [a + 1, b - 1]).filter(([a, b]) => (b - a) * frame >= 0.25);
  if (!usable.length) return null;
  const inLead = usable.find(([a, b]) => a * frame < lead && (Math.min(b * frame, lead) - a * frame) >= 0.5);
  const [a, b] = inLead ?? usable.reduce((best, r) => (r[1] - r[0] > best[1] - best[0] ? r : best));
  return [a * frame, Math.min(b * frame, a * frame + 2)];
}

/**
 * How much of a voice's lead-in to cut: all of it, unless the person started talking during
 * it — then up to just before the first word, so nothing said is lost.
 */
export function voiceStart(levels, frame = FRAME, lead = 0) {
  if (!(lead > 0) || !levels.length) return Math.max(0, lead);
  const floor = percentile(levels, 0.1);
  const speech = percentile(levels, 0.9);
  const loud = Math.max(floor + 15, speech - 15);
  const first = levels.findIndex((l, i) => i * frame < lead && l >= loud);
  if (first < 0) return lead;
  return Math.max(0, Math.round((first * frame - 0.15) * 1000) / 1000);
}

/** The room's level: the median of the quiet stretch, or the quietest tenth when there is none. */
export function roomLevel(levels, frame = FRAME, span = null) {
  const inSpan = span ? levels.slice(Math.round(span[0] / frame), Math.round(span[1] / frame)) : [];
  return inSpan.length ? percentile(inSpan, 0.5) : percentile(levels, 0.1);
}

/**
 * The spectral part of the noise removal, on what RNNoise has already cleaned (`rnnoise.js`).
 * RNNoise is a speech model: it takes out what is not a voice — fans, hum, keyboards, traffic,
 * a room's hiss — steady or not. `afftdn` then takes steady noise down further, told the room's
 * measured level: without it, it assumes a floor of -50 dB and leaves a louder room almost
 * alone (it took 0.6 dB off a creator's -35 dB room, where RNNoise took 23).
 */
export function denoiseFilter(level, start, roomDb = null) {
  const safe = safeLevel(level);
  const parts = ["aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=mono"];
  if (safe !== "off") {
    const floor = Number.isFinite(roomDb) ? Math.max(-70, Math.min(-25, roomDb - (safe === "strong" ? 20 : 10))) : -50;
    parts.push(`afftdn=nr=${safe === "strong" ? 18 : 10}:nf=${Math.round(floor)}`);
  }
  if (start > 0) parts.push(`atrim=start=${n3(start)}`, "asetpts=PTS-STARTPTS");
  return parts.join(",");
}

/**
 * What follows the denoiser. One fixed gain brings the voice to the target — never a dynamic
 * normaliser, which lifts the pauses. With the voice at a known level, a downward expander can
 * quieten what is left between words; it comes before the compressor, which evens the voice out
 * and would otherwise lift the pauses back over the expander's threshold. The compressor's
 * effect on loudness is measured and put back with a second fixed gain (`correctDb`), and a
 * limiter keeps peaks below -1.5 dB.
 */
export function compressFilter(level, gainDb) {
  const safe = safeLevel(level);
  const parts = [`volume=${n3(Math.max(-20, Math.min(36, gainDb)))}dB`];
  // About 20 dB under normal speech, where only the pauses and the room are.
  if (safe === "light") parts.push("agate=threshold=0.025:range=0.25:ratio=3:attack=10:release=300");
  if (safe === "strong") parts.push("agate=threshold=0.03:range=0.06:ratio=4:attack=8:release=250");
  // With the voice near -16 LUFS its loud syllables reach about -10 dBFS: compress above -20.
  if (safe !== "off") parts.push("acompressor=threshold=0.1:ratio=2.5:attack=8:release=160:knee=4");
  return parts.join(",");
}

export function finishFilter(correctDb) {
  return [`volume=${n3(Math.max(-12, Math.min(18, correctDb)))}dB`, "alimiter=limit=0.84:level=false", "aresample=48000"].join(",");
}

/** The ffmpeg part of the chain, after RNNoise, once the two gains are known — as the three passes run it. */
export const cleanFilter = (level, start, roomDb, gainDb, correctDb) =>
  [denoiseFilter(level, start, roomDb), compressFilter(level, gainDb), finishFilter(correctDb)].join(",");

/** Names for what is made from an original: `take-x.webm` → `take-x.clean.flac`, `take-x.video.webm`. */
export function derived(name) {
  const stem = name.replace(/\.[^.]+$/, "");
  // Takes recorded before 0.36.0 kept their picture as a WebM copy.
  return { clean: `${stem}.clean.flac`, video: `${stem}.video.mp4`, legacyVideo: `${stem}.video.webm` };
}

/**
 * Where the window is in a take, from the upload's `picture=w,h`: its area as fractions of the
 * recorded frame, from the top-left corner. (0.36.0 and 0.37.0 also sent an output size; it is
 * ignored.) Null when missing or out of range, and the picture is then kept as it was recorded.
 */
export function parsePicture(text) {
  const [w, h] = String(text ?? "").split(",").map(Number);
  const fraction = (n) => n > 0.2 && n <= 1;
  return fraction(w) && fraction(h) ? { w, h } : null;
}

/**
 * A take records the whole window, as a screen recorder records a screen. The capture copies it
 * into a larger frame padded with black; the padding is cut away — the window's own area rounded
 * to the nearest pixel, never inwards, so nothing of it is lost — and the window is kept at its
 * own size and shape. Fitting it into 16:9, with bars or filled, happens when a video is made
 * (`framingFilter`), so the choice can change without recording again.
 */
export function pictureFilter({ w, h }) {
  // Six places: at three, a fraction of a 1913-pixel window could be two pixels out.
  const f = (n) => String(Math.round(n * 1e6) / 1e6);
  // H.264 needs even sizes: an odd edge is stretched by a pixel rather than cut.
  return `crop=min(iw\\,round(iw*${f(w)})):min(ih\\,round(ih*${f(h)})):0:0,` +
    "scale=trunc((iw+1)/2)*2:trunc((ih+1)/2)*2:flags=lanczos,setsar=1,format=yuv420p";
}

/** Integrated loudness from ffmpeg's `ebur128` summary. */
export function parseLoudness(text) {
  const all = [...String(text).matchAll(/I:\s+(-?[\d.]+) LUFS/g)];
  return all.length ? Number(all[all.length - 1][1]) : null;
}

const ffmpeg = (args) => new Promise((resolve, reject) => {
  const child = spawn(ffmpegPath, ["-hide_banner", "-nostats", ...args], { windowsHide: true });
  let log = "";
  child.stderr.on("data", (b) => { log = (log + b).slice(-400000); });
  child.on("error", reject);
  child.on("close", (code) => resolve({ code, log }));
});
const run = async (args) => {
  const { code, log } = await ffmpeg(["-y", ...args]);
  if (code !== 0) throw new Error(log.trim().split("\n").slice(-3).join(" ") || `ffmpeg stopped (${code})`);
  return log;
};

/** `ffmpeg -i` with no output always "fails"; what it prints about the file is the answer. */
export async function probe(file) {
  return parseProbe((await ffmpeg(["-i", file])).log);
}

/** Frame levels of a recording's sound, after the rumble filter, for finding the room and the first word. */
async function analyse(file) {
  const samples = Math.round(48000 * FRAME);
  const { log } = await ffmpeg(["-i", file, "-map", "0:a:0", "-af",
    `aformat=channel_layouts=mono,aresample=48000,highpass=f=85,highpass=f=85,asetnsamples=n=${samples}:p=0,` +
    "astats=metadata=1:reset=1:measure_overall=none:measure_perchannel=RMS_level,ametadata=print:key=lavfi.astats.1.RMS_level",
    "-f", "null", "-"]);
  return frameLevels(log);
}

/**
 * The recording's sound, decoded and high-passed, through RNNoise (unless noise reduction is
 * off), into a float WAV that every later pass reads. RNNoise runs once, streamed, so a long
 * take is never held in memory.
 */
async function denoiseToFile(file, dest, level) {
  const decode = spawn(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-i", file, "-map", "0:a:0", "-af", DECODE, "-f", "f32le", "-"], { windowsHide: true });
  const encode = spawn(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-f", "f32le", "-ar", "48000", "-ac", "1", "-i", "-", "-c:a", "pcm_f32le", dest], { windowsHide: true });
  let log = "";
  for (const child of [decode, encode]) child.stderr.on("data", (b) => { log = (log + b).slice(-4000); });
  const exited = (child) => new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  const done = Promise.all([exited(decode), exited(encode)]);
  const mix = RNN_MIX[safeLevel(level)];
  const stages = mix > 0 ? [decode.stdout, rnnoiseStream(await loadRnnoise(), mix), encode.stdin] : [decode.stdout, encode.stdin];
  try {
    await pipeline(...stages);
  } catch (e) {
    decode.kill();
    encode.kill();
    await done.catch(() => {});
    throw new Error(`The noise could not be removed: ${log.trim() || e.message}`);
  }
  const [a, b] = await done;
  if (a !== 0 || b !== 0) throw new Error(`The sound could not be decoded: ${log.trim() || `ffmpeg stopped (${a}, ${b})`}`);
}

/**
 * Make the usable files from an original recording: its cleaned sound and, for a take, its
 * picture with a proper length. `lead` is the silent second the recorder asked for. Returns
 * what the beat stores; its `lead` is what was actually cut from the sound.
 */
export async function processRecording(dir, name, level, lead = 0, picture = null) {
  const file = path.join(dir, name);
  const out = derived(name);
  const original = await probe(file);
  const asked = Math.max(0, Math.min(5, Number(lead) || 0));
  const safe = safeLevel(level);
  const result = { file: name, noise: safe, lead: asked };
  if (original.width) {
    // The lead-in stays in the picture and the export starts that far in, so a picture made
    // before is still right when only the sound is cleaned again — it is kept, not remade.
    const made = [out.video, out.legacyVideo].find((v) => existsSync(path.join(dir, v)));
    if (made && !picture) {
      const size = await probe(path.join(dir, made));
      Object.assign(result, { video: made, width: size.width ?? original.width, height: size.height ?? original.height });
    } else if (picture) {
      await run(["-i", file, "-map", "0:v:0", "-vf", pictureFilter(picture), "-fps_mode", "cfr", "-r", "30",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-profile:v", "high", "-pix_fmt", "yuv420p",
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-an", "-movflags", "+faststart", path.join(dir, out.video)]);
      const size = await probe(path.join(dir, out.video));
      Object.assign(result, { video: out.video, width: size.width ?? original.width, height: size.height ?? original.height });
    } else {
      // Where the beat sits is not known: the picture is kept as recorded, copied so it gains a
      // length and an index.
      await run(["-i", file, "-map", "0:v:0", "-c", "copy", path.join(dir, out.legacyVideo)]);
      Object.assign(result, { video: out.legacyVideo, width: original.width, height: original.height });
    }
  }
  if (original.audio) {
    const levels = await analyse(file);
    const span = quietSpan(levels, FRAME, asked);
    const room = levels.length ? roomLevel(levels, FRAME, span) : null;
    // A take's picture is cut by the same amount, and shows the "stay quiet" card until then.
    const start = original.width ? asked : voiceStart(levels, FRAME, asked);
    const loudness = async (input, filter) => parseLoudness((await ffmpeg(["-i", input, "-map", "0:a:0", "-af", `${filter},ebur128`, "-f", "null", "-"])).log);
    // Measure the denoised voice and bring it to the target. The expander and compressor then
    // move the loudness, and not always identically from run to run — an expander on a voice
    // hovering at its threshold can go either way — so what they make is written once and
    // measured, and the correction is applied to that file rather than to a fresh run.
    const denoised = path.join(dir, `${out.clean}.rnn.wav`);
    const shaped = path.join(dir, `${out.clean}.part.wav`);
    let measured = null;
    try {
      await denoiseToFile(file, denoised, safe);
      measured = await loudness(denoised, denoiseFilter(safe, start, room));
      const gain = Number.isFinite(measured) ? TARGET_LUFS - measured : 0;
      await run(["-i", denoised, "-af", `${denoiseFilter(safe, start, room)},${compressFilter(safe, gain)}`, "-c:a", "pcm_f32le", shaped]);
      const compressed = await loudness(shaped, "anull");
      const correct = Number.isFinite(compressed) ? TARGET_LUFS - compressed : 0;
      await run(["-i", shaped, "-af", finishFilter(correct), "-ac", "1", "-c:a", "flac", path.join(dir, out.clean)]);
    } finally {
      await fs.rm(denoised, { force: true });
      await fs.rm(shaped, { force: true });
    }
    Object.assign(result, { clean: out.clean, lead: start });
    if (Number.isFinite(measured)) result.loudness = measured;
    if (Number.isFinite(room)) result.room = Math.round(room * 10) / 10;
  }
  const whole = await probe(path.join(dir, result.video ?? result.clean ?? name));
  const seconds = (whole.duration ?? original.duration ?? 0) - (result.video ? asked : 0);
  result.seconds = Math.round(seconds * 100) / 100;
  if (!(result.seconds > 0)) throw new Error("The recording is empty.");
  return result;
}
