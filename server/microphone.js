// Recording the microphone through Windows, the way a native recorder does.
//
// Chromium opens a Windows microphone in raw mode: it bypasses the sound driver's processing —
// the microphone-array clean-up and equalising a laptop's maker tuned for that microphone —
// and what it records is hissy and dull beside the same microphone in OBS. Its own noise
// suppression takes the hiss out, and 15 dB of the voice's upper frequencies with it. So the
// sound is not recorded by the page at all: ffmpeg opens the microphone through DirectShow,
// which gets the driver's sound, and writes it to a file. The page keeps its own stream only
// for the level meter.
//
// A take's picture is still recorded by the page, so the two start at different moments. The
// capture stamps its samples with the wall clock, the page says when its recorder started, and
// the sound is cut to begin at that moment.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

const ffmpeg = (args) => new Promise((resolve, reject) => {
  const child = spawn(ffmpegPath, ["-hide_banner", ...args], { windowsHide: true });
  let log = "";
  child.stderr.on("data", (b) => { log = (log + b).slice(-100000); });
  child.on("error", reject);
  child.on("close", (code) => resolve({ code, log }));
});

/** The audio capture devices in what `ffmpeg -list_devices true -f dshow -i dummy` prints. */
export function parseDevices(text) {
  return [...String(text).matchAll(/"([^"\r\n]+)" \(audio\)/g)].map((m) => m[1]);
}

/** The microphones Windows offers, by the names DirectShow knows them by. Empty where there is no DirectShow. */
export async function listMicrophones() {
  if (process.platform !== "win32") return [];
  try {
    return parseDevices((await ffmpeg(["-list_devices", "true", "-f", "dshow", "-i", "dummy"])).log);
  } catch {
    return [];
  }
}

/**
 * The DirectShow device for a microphone as the page names it. The page's label is Windows'
 * name with decoration: "Default - " or "Communications - " in front of the default device,
 * and a USB id such as " (046d:0825)" after some. Null when nothing matches, and the page then
 * records it itself.
 */
export function matchMicrophone(label, devices) {
  const bare = String(label ?? "").replace(/^(Default|Communications)\s*-\s*/i, "").replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "").trim();
  if (!bare) return null;
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  return devices.find((d) => same(d, bare))
    // DirectShow cuts long names short; the page does not.
    ?? devices.find((d) => d.length >= 20 && bare.toLowerCase().startsWith(d.toLowerCase()))
    ?? devices.find((d) => bare.length >= 20 && d.toLowerCase().startsWith(bare.toLowerCase()))
    ?? null;
}

/**
 * ffmpeg's arguments to record a microphone to `file`. Float samples, so the boost can never
 * clip; a small device buffer, so the wall-clock stamp on each block is close to when it was
 * heard; and those stamps kept in the file (`-copyts`), which is how its start is known.
 */
export function captureArgs(device, file, gainDb = 0) {
  const gain = Math.max(-24, Math.min(36, Number(gainDb) || 0));
  return [
    "-y", "-f", "dshow", "-audio_buffer_size", "50", "-use_wallclock_as_timestamps", "1", "-i", `audio=${device}`,
    ...(gain ? ["-af", `volume=${Math.round(gain * 10) / 10}dB`] : []),
    "-ac", "1", "-ar", "48000", "-c:a", "pcm_f32le", "-copyts", "-f", "matroska", file,
  ];
}

/** The wall-clock second a capture's first sample was heard, from what `ffmpeg -i` prints about it. */
export function parseStart(text) {
  const m = /start:\s*(\d+(?:\.\d+)?)/.exec(String(text));
  return m ? Number(m[1]) : null;
}

/** Captures in progress, by the file they are writing. */
const running = new Map();

/**
 * Start recording `device` to `file`. Resolves once ffmpeg is actually writing — it takes a few
 * tenths of a second to open the device — so the recorder's "stay quiet" second is not spent
 * waiting for it. Rejects, with what ffmpeg said, if the device cannot be opened.
 */
export function startCapture(device, file, gainDb = 0) {
  if (running.has(file)) return Promise.reject(new Error("That recording is already running."));
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ["-hide_banner", ...captureArgs(device, file, gainDb)], { windowsHide: true });
    let log = "";
    let settled = false;
    const entry = { child, exited: new Promise((done) => child.on("close", done)) };
    running.set(file, entry);
    const fail = (message) => {
      running.delete(file);
      if (settled) return;
      settled = true;
      reject(new Error(message));
    };
    const timer = setTimeout(() => { child.kill(); fail("The microphone did not start in time."); }, 8000);
    child.stderr.on("data", (b) => {
      log = (log + b).slice(-8000);
      // The first progress line: samples are being written.
      if (!settled && /size=\s*\d+/.test(log)) { settled = true; clearTimeout(timer); resolve(); }
    });
    child.on("error", (e) => { clearTimeout(timer); fail(`The microphone could not be opened: ${e.message}`); });
    child.on("close", () => {
      clearTimeout(timer);
      const said = log.trim().split("\n").filter((l) => /error|could not|cannot|failed/i.test(l)).slice(-2).join(" ");
      fail(`The microphone could not be opened${said ? `: ${said}` : "."}`);
    });
  });
}

/** Stop a capture and wait for its file to be finished. False when there was none. */
export async function stopCapture(file) {
  const entry = running.get(file);
  if (!entry) return false;
  running.delete(file);
  // "q" lets ffmpeg close the file properly; killing it leaves one with no length.
  try { entry.child.stdin.write("q"); entry.child.stdin.end(); } catch { entry.child.kill(); }
  const timer = setTimeout(() => entry.child.kill(), 5000);
  await entry.exited;
  clearTimeout(timer);
  return true;
}

/** Stop everything still recording: the app is closing, or a project is being let go of. */
export async function stopAllCaptures(under = null) {
  const files = [...running.keys()].filter((f) => !under || f.toLowerCase().startsWith(path.resolve(under).toLowerCase() + path.sep));
  await Promise.all(files.map((f) => stopCapture(f)));
}

/**
 * Cut a finished capture so it begins at the wall-clock moment `atMs` — when the page started
 * recording the picture — and write it to `dest`. The capture is started first, so there is
 * always something to cut; if the clocks say otherwise it is kept whole. Returns the seconds
 * cut. The samples are copied, not encoded again.
 */
export async function alignCapture(file, dest, atMs) {
  const start = parseStart((await ffmpeg(["-i", file])).log);
  const offset = start != null && Number.isFinite(atMs) ? Math.max(0, Math.min(60, atMs / 1000 - start)) : 0;
  const { code, log } = await ffmpeg(["-y", "-i", file, "-ss", String(Math.round(offset * 1000) / 1000), "-c", "copy", dest]);
  if (code !== 0) throw new Error(`The recorded sound could not be lined up: ${log.trim().split("\n").slice(-2).join(" ")}`);
  await fs.rm(file, { force: true });
  return offset;
}
