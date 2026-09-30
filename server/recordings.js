// A beat's own recordings: narration over it, or a take of it on screen.
//
// They live in the project's recordings/ folder — never sources/, which the app adopts as
// sources. What the recorder hands over is kept as it came; ffmpeg then makes what is used:
// the sound cleaned of steady background noise and brought to a consistent loudness, and a
// take's picture remuxed so it has a length and can be seeked. The original stays, so a
// different amount of noise reduction can be tried without recording again.
//
// Every recording starts with a second of silence — the recorder asks for it — and that is
// what makes the cleaning work: the denoiser learns the room from it rather than guessing,
// and it is trimmed off afterwards.
import { spawn } from "node:child_process";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { parseProbe } from "../electron/export-video.js";

export const NOISE = ["off", "light", "strong"];
/** Integrated loudness a finished voice is brought to: what YouTube and most players expect. */
export const TARGET_LUFS = -16;

const n3 = (n) => String(Math.round(n * 1000) / 1000);

/** The part before the loudness is known: rumble removed and, with a room sample, the noise learnt and taken out. */
export function denoiseFilter(level, lead) {
  const safe = NOISE.includes(level) ? level : "light";
  const parts = ["highpass=f=80"];
  if (safe !== "off") {
    const nr = safe === "strong" ? 24 : 12;
    // Learn the noise from the silent lead-in, when there is one; otherwise estimate it.
    if (lead >= 0.6) parts.push(`asendcmd=c='${n3(0.1)} afftdn sn start; ${n3(lead - 0.15)} afftdn sn stop'`);
    parts.push(`afftdn=nr=${nr}:nf=-50`);
  }
  if (lead > 0) parts.push(`atrim=start=${n3(lead)}`, "asetpts=PTS-STARTPTS");
  return parts.join(",");
}

/**
 * The whole chain, once the loudness of the denoised voice has been measured. A fixed gain
 * brings it to the target — one number for the whole take, so pauses are not pumped up the
 * way a dynamic normaliser does — then a downward expander quietens what is left in the
 * pauses, gently or firmly, and a limiter keeps peaks below -1.5 dB.
 */
export function cleanFilter(level, lead, measuredLufs) {
  const safe = NOISE.includes(level) ? level : "light";
  const gain = Number.isFinite(measuredLufs) ? Math.max(-12, Math.min(30, TARGET_LUFS - measuredLufs)) : 0;
  const parts = [denoiseFilter(safe, lead), `volume=${n3(gain)}dB`];
  // The voice is now at a known level, so the expander's threshold can be fixed below it:
  // about 20 dB under normal speech, where only the pauses and the room are.
  if (safe === "light") parts.push("agate=threshold=0.025:range=0.25:ratio=3:attack=10:release=300");
  if (safe === "strong") parts.push("agate=threshold=0.03:range=0.08:ratio=4:attack=8:release=250");
  parts.push("alimiter=limit=0.84:level=false", "aresample=48000");
  return parts.join(",");
}

/** Names for what is made from an original: `take-x.webm` → `take-x.clean.flac`, `take-x.video.webm`. */
export function derived(name) {
  const stem = name.replace(/\.[^.]+$/, "");
  return { clean: `${stem}.clean.flac`, video: `${stem}.video.webm` };
}

/** Integrated loudness from ffmpeg's `ebur128` summary. */
export function parseLoudness(text) {
  const all = [...String(text).matchAll(/I:\s+(-?[\d.]+) LUFS/g)];
  return all.length ? Number(all[all.length - 1][1]) : null;
}

const ffmpeg = (args) => new Promise((resolve, reject) => {
  const child = spawn(ffmpegPath, ["-hide_banner", "-nostats", ...args], { windowsHide: true });
  let log = "";
  child.stderr.on("data", (b) => { log = (log + b).slice(-20000); });
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

/**
 * Make the usable files from an original recording: its cleaned sound and, for a take, its
 * picture with a proper length. `lead` is the silent second the recorder asked for. Returns
 * what the beat stores.
 */
export async function processRecording(dir, name, level, lead = 0) {
  const file = path.join(dir, name);
  const out = derived(name);
  const original = await probe(file);
  const safeLead = Math.max(0, Math.min(5, Number(lead) || 0));
  const result = { file: name, noise: NOISE.includes(level) ? level : "light", lead: safeLead };
  if (original.width) {
    // Copying the picture is quick and loses nothing; it only gains a length and an index. The
    // lead-in stays in the file — cutting without re-encoding lands on a keyframe — and the
    // export starts the picture that far in.
    await run(["-i", file, "-map", "0:v:0", "-c", "copy", path.join(dir, out.video)]);
    Object.assign(result, { video: out.video, width: original.width, height: original.height });
  }
  if (original.audio) {
    const measured = parseLoudness((await ffmpeg(["-i", file, "-map", "0:a:0", "-af", `${denoiseFilter(level, safeLead)},ebur128`, "-f", "null", "-"])).log);
    await run(["-i", file, "-map", "0:a:0", "-af", cleanFilter(level, safeLead, measured), "-ac", "1", "-c:a", "flac", path.join(dir, out.clean)]);
    result.clean = out.clean;
    if (Number.isFinite(measured)) result.loudness = measured;
  }
  const whole = await probe(path.join(dir, result.video ?? result.clean ?? name));
  const seconds = (whole.duration ?? original.duration ?? 0) - (result.video ? safeLead : 0);
  result.seconds = Math.round(seconds * 100) / 100;
  if (!(result.seconds > 0)) throw new Error("The recording is empty.");
  return result;
}
