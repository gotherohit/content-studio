import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import {
  AUTO_PEAK_DB, CLIP_DB, GAIN_MAX, GAIN_MIN, LEAD_SECONDS, autoGain, clampGain, gainKey, isBluetoothMic, levelDb, micConstraints, peakDb,
  recordingInUse, recordingName, roomVerdict, takeVideoBitrate,
} from "../client/src/recording.ts";
import { beatTimings, exportSettings, VOICE_TAIL } from "../client/src/exportPlan.ts";
import {
  cleanFilter, compressFilter, DECODE, decodeFilter, derived, finishFilter, frameLevels, modelUse, NOISE, parseLoudness, parsePicture, pictureFilter, processRecording, quietSpan,
  roomLevel, TARGET_LUFS, trimFilter, voiceStart,
} from "../server/recordings.js";
import { cleanTuning, DEFAULT_TUNING, LIMITS, parseTuning, PRESETS, sameTuning, tuningFor, tuningText } from "../server/public/cleaning.js";
import { framingFilter, parseProbe, takeGraph, videoGraph } from "../electron/export-video.js";
import type { Beat, BeatTake, BeatVoice, Stage } from "../client/src/types.ts";

const stage: Stage = { preset: "1", panes: [{ kind: "notes" }], views: {}, split: 50, rowSplit: 50, activeSourceId: null, highlightId: null, viewMode: "original" };
const voice = (seconds: number, file = "voice-a.webm"): BeatVoice => ({ file, clean: "voice-a.clean.flac", seconds, noise: "light", lead: 1, recordedAt: "" });
const take = (seconds: number, file = "take-a.webm"): BeatTake => ({ file, video: "take-a.video.webm", seconds, noise: "light", lead: 1, width: 1920, height: 1080, muted: false, recordedAt: "" });
const beat = (extra: Partial<Beat> = {}): Beat => ({ id: Math.random().toString(36).slice(2), point: "", stage, createdAt: "", ...extra });

// The page's stream is the level meter's. Its noise suppression took 15 dB of a voice's upper
// frequencies with the hiss; the recording itself is made through Windows (microphone.js).
test("the page's microphone stream has none of the browser's call processing", () => {
  const c = micConstraints("usb-mic");
  assert.deepEqual(c.deviceId, { exact: "usb-mic" });
  assert.equal(c.noiseSuppression, false);
  assert.equal(c.echoCancellation, false);
  assert.equal(c.autoGainControl, false);
  assert.equal(c.sampleRate, 48000);
  assert.equal(micConstraints().deviceId, undefined);
  assert.equal(recordingName("voice", "b/1", 36 ** 3, "mka"), "voice-b1-1000.mka");
});

test("levels are measured in dB below full scale", () => {
  assert.equal(levelDb([0, 0, 0]), -100);
  assert.ok(Math.abs(levelDb([0.5, -0.5, 0.5, -0.5]) - 20 * Math.log10(0.5)) < 1e-9);
  assert.ok(Math.abs(peakDb([0.1, -1, 0.2])) < 1e-9);
  assert.ok(peakDb([0.99]) > CLIP_DB);
});

test("the room check says how noisy the room is and which noise reduction to use", () => {
  assert.equal(roomVerdict(-70).noise, "light");
  assert.equal(roomVerdict(-70).tone, "ok");
  assert.equal(roomVerdict(-58).tone, "ok");
  assert.equal(roomVerdict(-50).noise, "strong");
  assert.equal(roomVerdict(-50).tone, "warn");
  assert.equal(roomVerdict(-35).tone, "fail");
});

test("Bluetooth headset microphones are recognised, ordinary ones are not", () => {
  assert.ok(isBluetoothMic("Headset (WH-1000XM4 Hands-Free AG Audio)"));
  assert.ok(isBluetoothMic("Microphone (AirPods Pro)"));
  assert.ok(!isBluetoothMic("Microphone (Shure MV7)"));
  assert.ok(!isBluetoothMic("Microphone Array (Realtek(R) Audio)"));
});

test("recordings get names of their own, and a shared one is kept while another beat plays it", () => {
  assert.equal(recordingName("voice", "b/1", 36 ** 3), "voice-b1-1000.webm");
  const a = beat({ id: "a", voice: voice(3, "voice-x.webm") });
  const copy = beat({ id: "b", voice: voice(3, "voice-x.webm") });
  assert.equal(recordingInUse([a, copy], "voice-x.webm", "a"), true);
  assert.equal(recordingInUse([a], "voice-x.webm", "a"), false);
  assert.equal(recordingInUse([a, beat({ id: "c", take: take(2, "voice-x.webm") })], "voice-x.webm", "a"), true);
});

test("a take decides its beat's length; a voice does too, with room for the transitions around it", () => {
  const settings = exportSettings({ seconds: 5, transition: "fade", transitionSeconds: 0.6 });
  const t = beatTimings([beat({ take: take(8.2) }), beat({ voice: voice(3) }), beat(), beat({ voice: voice(2), export: { seconds: 9 } })], settings, [], {});
  assert.equal(t[0].seconds, 8.2);
  assert.equal(t[0].by, "take");
  // 0.6 s fading in, 3 s of voice, then the fade out plus a breath.
  assert.equal(t[1].seconds, Math.round((0.6 + 3 + Math.max(VOICE_TAIL, 0.6 + 0.2)) * 10) / 10);
  assert.equal(t[1].voiceDelay, 0.6);
  assert.equal(t[2].seconds, 5);
  // A length typed for the beat wins; its voice is still kept clear of the fade in.
  assert.equal(t[3].seconds, 9);
  assert.equal(t[3].voiceDelay, 0.6);
  // The first beat has no transition coming in.
  assert.equal(beatTimings([beat({ voice: voice(3) })], settings, [], {})[0].voiceDelay, 0);
  // Cuts leave only the breath.
  const cuts = beatTimings([beat(), beat({ voice: voice(3) })], exportSettings({ transition: "cut" }), [], {});
  assert.equal(cuts[1].seconds, 3 + VOICE_TAIL);
});

test("the room is read from the quietest stretch, not taken on trust from the lead-in", () => {
  const f = 0.1;
  // Quiet lead-in, speech, a pause, speech.
  const levels = [...Array(10).fill(-60), ...Array(20).fill(-20), ...Array(8).fill(-61), ...Array(10).fill(-22)];
  assert.deepEqual(quietSpan(levels, f, 1)?.map((n) => Math.round(n * 10) / 10), [0.1, 0.9]);
  assert.ok(Math.abs(roomLevel(levels, f, quietSpan(levels, f, 1)) + 60) < 0.01);
  // Talking straight away: the room is found in the pause instead.
  const early = [...Array(3).fill(-60), ...Array(25).fill(-20), ...Array(8).fill(-58), ...Array(10).fill(-21)];
  assert.deepEqual(quietSpan(early, f, 1)?.map((n) => Math.round(n * 10) / 10), [2.9, 3.5]);
  // No pause long enough to be the room.
  assert.equal(quietSpan([...Array(30).fill(-20), -60, -20], f, 1), null);
  assert.deepEqual(frameLevels("lavfi.astats.1.RMS_level=-38.5\nlavfi.astats.1.RMS_level=-inf\n"), [-38.5, -100]);
});

test("a voice's lead-in is cut only up to the first word said in it", () => {
  const f = 0.1;
  const quiet = [...Array(10).fill(-60), ...Array(20).fill(-20)];
  assert.equal(voiceStart(quiet, f, 1), 1);
  const early = [...Array(6).fill(-60), ...Array(24).fill(-20)];
  assert.equal(voiceStart(early, f, 1), 0.45);
  assert.equal(voiceStart(early, f, 0), 0);
});

test("cleaning favours the voice: Light never uses the speech model, and Strong caps it", () => {
  // At any strength, on real takes, the model took something from the voice: the default does
  // without it, and Strong gives it at most half — never more than 6 dB off a word.
  assert.equal(modelUse(PRESETS.light), null, "Light does not run the speech model");
  assert.ok(PRESETS.strong.speech <= 0.5, JSON.stringify(PRESETS));
  assert.ok(PRESETS.light.pauseDb === 0 && PRESETS.strong.pauseDb >= -15, "pauses are lowered, never silenced");
  assert.equal(TARGET_LUFS, -16);
  assert.deepEqual(NOISE, ["original", "off", "light", "strong", "custom"]);
  assert.equal(decodeFilter(PRESETS.light), DECODE);
  assert.match(DECODE, /channel_layouts=mono,highpass=f=85,highpass=f=85$/);
  assert.match(trimFilter(1), /atrim=start=1,asetpts=PTS-STARTPTS$/);
  assert.doesNotMatch(trimFilter(0), /atrim/);
  const whole = cleanFilter(PRESETS.strong, 1, 10, 3);
  assert.match(whole, /volume=10dB,acompressor=threshold=0\.1:ratio=2\.5[^,]*,volume=3dB,alimiter=limit=0\.84/);
  // Each of these dulled or clipped a real voice, or was not repeatable.
  assert.doesNotMatch(whole, /arnndn|afftdn|agate|loudnorm|dynaudnorm/);
  assert.match(finishFilter(2), /^volume=2dB,alimiter/);
  assert.doesNotMatch(cleanFilter(PRESETS.off, 1, 0, 0), /acompressor/);
  assert.equal(modelUse(PRESETS.off), null, "Off never runs the speech model");
  assert.deepEqual(modelUse(PRESETS.strong), { speech: 0.5, pauseMix: 1, pause: 10 ** (-12 / 20) });
  assert.equal(parseLoudness("Summary:\n  Integrated loudness:\n    I:         -23.4 LUFS\n"), -23.4);
});

test("every cleaning setting can be tuned, is kept in range, and falls back to the defaults", () => {
  assert.deepEqual(DEFAULT_TUNING, PRESETS.light);
  assert.deepEqual(tuningFor("light"), PRESETS.light);
  assert.deepEqual(tuningFor("nonsense"), PRESETS.light);
  // Custom with nothing saved is the default; a saved one is used, with anything missing filled in.
  assert.deepEqual(tuningFor("custom"), PRESETS.light);
  assert.deepEqual(tuningFor("custom", { speech: 0.3 } as never), { ...PRESETS.light, speech: 0.3 });
  // Out of range, wrong and empty values are put right, never passed to ffmpeg.
  assert.deepEqual(cleanTuning({ rumble: 9999, staticDb: 99, speech: -1, pauseMix: "abc", pauseDb: -500, compress: 0, loudness: "" }),
    { rumble: LIMITS.rumble[1], staticDb: LIMITS.staticDb[1], speech: 0, pauseMix: PRESETS.light.pauseMix, pauseDb: LIMITS.pauseDb[0], compress: 1, loudness: PRESETS.light.loudness });
  assert.equal(cleanTuning({ rumble: 10 }).rumble, 0, "a filter too low to matter is off");
  // An upload carries the tuning as text; it comes back the same, and junk comes back as nothing.
  const mine = { rumble: 100, staticDb: 15, speech: 0.35, pauseMix: 0.9, pauseDb: -14, compress: 3, loudness: -18 };
  assert.ok(PRESETS.off.staticDb === 0 && PRESETS.light.staticDb > 0 && PRESETS.strong.staticDb > PRESETS.light.staticDb);
  assert.deepEqual(parseTuning(tuningText(mine)), mine);
  assert.equal(parseTuning("1,2,3"), null);
  assert.equal(parseTuning(undefined), null);
  assert.ok(sameTuning(mine, { ...mine }) && !sameTuning(mine, { ...mine, pauseDb: -15 }) && !sameTuning(mine, undefined));
  // Each setting reaches the chain.
  assert.doesNotMatch(decodeFilter({ ...mine, rumble: 0 }), /highpass/);
  assert.match(decodeFilter(mine), /highpass=f=100,highpass=f=100$/);
  assert.match(compressFilter(mine, 0), /acompressor=threshold=0\.079:ratio=3:/);
  assert.doesNotMatch(compressFilter({ ...mine, compress: 1 }, 0), /acompressor/);
  assert.deepEqual(modelUse(mine), { speech: 0.35, pauseMix: 0.9, pause: 10 ** (-14 / 20) });
});

test("a take plays instead of the still, from after its lead-in, and narration sits under the beat", () => {
  const still = { still: "s.png", width: 1920, height: 1080, seconds: 3, transition: "cut", videos: [] };
  const { inputs, graph } = videoGraph([
    { ...still, take: { file: "take.video.webm", lead: 1.03, sound: "take.clean.flac" } },
    { ...still, voice: { file: "voice.clean.flac", delay: 0.6 }, videos: [{ file: "clip.mp4", start: 0, x: 0, y: 0, w: 100, h: 100, audio: true }] },
    { ...still, take: { file: "quiet.video.webm", lead: 1, sound: null } },
  ], { width: 1920, height: 1080, fps: 30 }, 0);
  assert.deepEqual(inputs.slice(0, 8), ["-ss", "1.03", "-t", "3", "-i", "take.video.webm", "-t", "3"]);
  assert.ok(!inputs.slice(0, 10).includes("s.png"), "a beat with a take reads no still");
  assert.match(graph, /tpad=stop_mode=clone:stop_duration=3,trim=duration=3/);
  assert.match(graph, /adelay=600:all=1/);
  // A video's own sound is turned down under the voice.
  assert.match(graph, /channel_layouts=stereo,volume=0\.3\[s1_0\]/);
  // A muted take is silent.
  assert.match(graph, /anullsrc=r=48000:cl=stereo,atrim=duration=3,aformat=sample_fmts=fltp:channel_layouts=stereo\[a2\]/);
});

// The real thing: a noisy recording with a silent second first, cleaned by ffmpeg. The "voice"
// is a pitch with harmonics that swells four times a second — a plain sine is not speech, and
// the speech model rightly removes it.
test("strong noise reduction takes the room out of the pauses and leaves the voice at -16 LUFS", { skip: !ffmpegPath || !fs.existsSync(ffmpegPath) }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-rec-"));
  try {
    const run = (args: string[]) => spawnSync(ffmpegPath as unknown as string, ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
    run(["-f", "lavfi", "-i", "sine=f=140:d=6,aeval='val(0)*(0.5+0.5*sin(2*PI*4*t))*(0.6*sin(2*PI*280*t)+0.4*sin(2*PI*420*t)+1)/2':c=same,volume='if(between(t,2,4),0.5,0)':eval=frame",
      "-f", "lavfi", "-i", "anoisesrc=d=6:c=pink:a=0.02:seed=7",
      "-filter_complex", "[0][1]amix=inputs=2:normalize=0", "-c:a", "libopus", "-b:a", "128k", path.join(dir, "voice-t.webm")]);
    const rms = (file: string, from: number, to: number) => Number(/RMS level dB: (-?[\d.]+|-inf)/.exec(spawnSync(ffmpegPath as unknown as string,
      ["-hide_banner", "-i", file, "-af", `atrim=${from}:${to},astats=metadata=0`, "-f", "null", "-"], { encoding: "utf8" }).stderr)?.[1].replace("-inf", "-200"));
    const made = await processRecording(dir, "voice-t.webm", "strong", 1);
    const clean = path.join(dir, made.clean!);
    // The lead-in is gone: what was 2–4 s is now 1–3 s.
    assert.ok(Math.abs(made.seconds - 5) < 0.1, `seconds ${made.seconds}`);
    const speech = rms(clean, 1.3, 2.7), pause = rms(clean, 3.6, 4.8);
    assert.ok(speech - pause > 45, `speech ${speech} dB, pause ${pause} dB`);
    assert.ok(Math.abs(made.room! + 48) < 4, `room ${made.room}`);
    const loud = parseLoudness(spawnSync(ffmpegPath as unknown as string, ["-hide_banner", "-i", clean, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" }).stderr);
    assert.ok(Math.abs((loud ?? 0) - TARGET_LUFS) < 1, `loudness ${loud}`);
    // The same recording cleaned again comes out the same, sample for sample.
    const first = fs.readFileSync(clean);
    await processRecording(dir, "voice-t.webm", "strong", 1);
    assert.ok(first.equals(fs.readFileSync(clean)), "cleaning is deterministic");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A recorder's own type, "video/webm;codecs=vp9,opus", made the server's raw parser skip the body.
test("recordings are uploaded as plain bytes", () => {
  const api = fs.readFileSync(new URL("../client/src/api.ts", import.meta.url), "utf8");
  const upload = api.slice(api.indexOf("uploadRecording:"), api.indexOf("recleanRecording:"));
  assert.match(upload, /"content-type": "application\/octet-stream"/);
  assert.doesNotMatch(upload, /blob\.type/);
});

test("the microphone boost is set from the voice: its loud moments land at -6 dB", () => {
  // Quiet speech peaking at -24 dB, with pauses the setting must ignore.
  const quiet = [...Array(40).fill(-24), ...Array(10).fill(-30), ...Array(30).fill(-70)];
  assert.equal(autoGain(quiet, 0), 18);
  assert.equal(autoGain(quiet, 0)! + -24, AUTO_PEAK_DB);
  // Too hot: turned down, and never past the ends of the range.
  assert.equal(autoGain(Array(50).fill(-1), 0), -5);
  assert.equal(autoGain(Array(50).fill(-50), 0), GAIN_MAX);
  assert.equal(autoGain(Array(50).fill(0), -10), GAIN_MIN);
  // Nothing said.
  assert.equal(autoGain(Array(80).fill(-70), 0), null);
  assert.equal(clampGain(99), GAIN_MAX);
  assert.equal(clampGain(Number.NaN), 0);
  assert.equal(gainKey(), "micGain:default");
});

// The picture a take keeps has no sound; played or downloaded on its own it was silent.
test("a take is previewed with its cleaned sound, and the silent picture is never offered for download", () => {
  const panel = fs.readFileSync(new URL("../client/src/components/BeatRecorder.tsx", import.meta.url), "utf8");
  assert.match(panel, /<TakePlayer[\s\S]*?sound=\{p\.beat\.take\.clean && !p\.beat\.take\.muted/);
  assert.match(panel, /controlsList="nodownload/);
  assert.doesNotMatch(panel, /<video controls muted=\{p\.beat\.take/);
});

test("a take saved as MP4 starts after its lead-in, is framed into 16:9, and always has a sound track", () => {
  const withSound = takeGraph({ video: "t.video.mp4", sound: "t.clean.flac", lead: 1.04, seconds: 6.5 });
  assert.deepEqual(withSound.inputs, ["-ss", "1.04", "-t", "6.5", "-i", "t.video.mp4", "-t", "6.5", "-i", "t.clean.flac"]);
  // Fit by default, into 1920 × 1080 unless told otherwise.
  assert.ok(withSound.graph.includes(framingFilter("fit", { width: 1920, height: 1080 })), withSound.graph);
  assert.match(withSound.graph, /channel_layouts=stereo,apad,atrim=duration=6\.5\[aout\]/);
  const filled = takeGraph({ video: "t.video.mp4", sound: null, lead: 0, seconds: 3, out: { width: 2560, height: 1440 }, framing: "fill" });
  assert.ok(filled.graph.includes(framingFilter("fill", { width: 2560, height: 1440 })), filled.graph);
  assert.deepEqual(filled.inputs.slice(0, 4), ["-t", "3", "-i", "t.video.mp4"]);
  assert.ok(filled.inputs.includes("anullsrc=r=48000:cl=stereo"));
});

test("a take really becomes an H.264 and AAC MP4 of the export's size and its own length", { skip: !ffmpegPath || !fs.existsSync(ffmpegPath) }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-take-"));
  try {
    const ff = (args: string[]) => spawnSync(ffmpegPath as unknown as string, ["-hide_banner", "-y", ...args], { encoding: "utf8" });
    ff(["-f", "lavfi", "-i", "testsrc2=s=322x200:r=25:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(dir, "t.video.mp4")]);
    ff(["-f", "lavfi", "-i", "sine=f=300:d=3", "-c:a", "flac", path.join(dir, "t.clean.flac")]);
    const { inputs, graph } = takeGraph({ video: path.join(dir, "t.video.mp4"), sound: path.join(dir, "t.clean.flac"), lead: 1, seconds: 3, out: { width: 320, height: 180 } });
    const out = path.join(dir, "t.mp4");
    const made = ff([...inputs, "-filter_complex", graph, "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", out]);
    assert.equal(made.status, 0, made.stderr.slice(-800));
    const info = ff(["-i", out]).stderr;
    assert.match(info, /Video: h264[^\n]*320x180/);
    assert.match(info, /Audio: aac/);
    assert.ok(Math.abs((parseProbe(info).duration ?? 0) - 3) < 0.1, info);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("RNNoise keeps the sound in time and the same length, and gives the same result every run", async () => {
  const { loadRnnoise, rnnoiseStream } = await import("../server/rnnoise.js");
  const rn = await loadRnnoise();
  const len = 48000 + 123;
  const input = new Float32Array(len);
  for (let i = 0; i < len; i++) input[i] = 0.3 * Math.sin(i / 7) * Math.sin(i / 900) + 0.01 * Math.sin(i * 1.7);
  const run = async (options: { speech?: number; pause?: number; pauseMix?: number }, chunk: number) => {
    const stream = rnnoiseStream(rn, options);
    const out: Buffer[] = [];
    stream.on("data", (b: Buffer) => out.push(b));
    const bytes = Buffer.from(input.buffer);
    // Odd chunk sizes: samples split across chunks must survive.
    for (let at = 0; at < bytes.length; at += chunk) stream.write(bytes.subarray(at, at + chunk));
    await new Promise((resolve) => stream.end(resolve));
    const all = Buffer.concat(out);
    return new Float32Array(all.buffer.slice(all.byteOffset, all.byteOffset + all.length));
  };
  // With none of the model mixed in, what comes out is exactly what went in: the delay is undone.
  const dry = await run({ speech: 0, pause: 1, pauseMix: 0 }, 4001);
  assert.equal(dry.length, len);
  assert.deepEqual(Array.from(dry.subarray(0, 2000)), Array.from(input.subarray(0, 2000)));
  assert.deepEqual(Array.from(dry.subarray(len - 2000)), Array.from(input.subarray(len - 2000)));
  const a = await run({ speech: 0.7, pause: 0.03 }, 777), b = await run({ speech: 0.7, pause: 0.03 }, 65536);
  assert.equal(a.length, len);
  assert.deepEqual(Buffer.from(a.buffer), Buffer.from(b.buffer));
});

// Nothing about a take may assume one screen: every size is measured when it is recorded.
test("the window is found in a take's picture on any screen, however the capture sized it", async () => {
  const { takeCrop } = await import("../client/src/exportPlan.ts");
  const whole = (page: { width: number; height: number }, frame: { width: number; height: number }, ratio: number) => takeCrop(page, page, frame, ratio);
  // Copied pixel for pixel into a padded 1920 × 1080 frame — a 1913 × 1010 window did this.
  const padded = whole({ width: 1913, height: 1010 }, { width: 1920, height: 1080 }, 1);
  assert.ok(Math.abs(padded.w * 1920 - 1913) < 0.01 && Math.abs(padded.h * 1080 - 1010) < 0.01, JSON.stringify(padded));
  // A display at 150 %: 1275 × 673 CSS pixels are 1913 × 1010 on screen.
  const at150 = whole({ width: 1275, height: 673 }, { width: 1920, height: 1080 }, 1.5);
  assert.ok(Math.abs(at150.w * 1920 - 1912.5) < 0.01, JSON.stringify(at150));
  // Recorded at the window's own size, or scaled evenly: all of the frame is the window — a
  // 16:10 laptop at 125 %, a 21:9 ultrawide, a portrait screen and a 4K screen at 200 % alike.
  for (const [page, frame, ratio] of [
    [{ width: 1536, height: 960 }, { width: 1920, height: 1200 }, 1.25],
    [{ width: 3440, height: 1392 }, { width: 3440, height: 1392 }, 1],
    [{ width: 1080, height: 1850 }, { width: 1080, height: 1850 }, 1],
    [{ width: 1920, height: 1040 }, { width: 3840, height: 2080 }, 2],
  ] as const) assert.deepEqual(whole(page, frame, ratio), { w: 1, h: 1 }, JSON.stringify(page));
});

test("a take's picture instructions are checked, and the window is kept at its own size", () => {
  assert.deepEqual(parsePicture("0.996354,0.935185"), { w: 0.996354, h: 0.935185 });
  // 0.36.0 and 0.37.0 also sent a size; it is ignored.
  assert.deepEqual(parsePicture("0.996354,0.935185,1920,1080"), { w: 0.996354, h: 0.935185 });
  assert.equal(parsePicture("1.2,1"), null);
  assert.equal(parsePicture(undefined), null);
  // Only the padding is cut — the window's area rounded to the nearest pixel — and an odd size
  // is made even by stretching a pixel, not cutting one.
  assert.equal(pictureFilter({ w: 0.996354, h: 0.935185 }),
    String.raw`crop=min(iw\,round(iw*0.996354)):min(ih\,round(ih*0.935185)):0:0,` +
    "scale=trunc((iw+1)/2)*2:trunc((ih+1)/2)*2:flags=lanczos,setsar=1,format=yuv420p");
  assert.deepEqual(derived("take-a.webm"), { clean: "take-a.clean.flac", video: "take-a.video.mp4", legacyVideo: "take-a.video.webm", sound: "take-a.mic.mka" });
});

test("fit keeps all of a take with bars, fill has no bars; neither stretches", () => {
  const out = { width: 1920, height: 1080 };
  assert.match(framingFilter("fit", out), /^scale=1920:1080:force_original_aspect_ratio=decrease:.*pad=1920:1080:\(ow-iw\)\/2:\(oh-ih\)\/2:black/);
  assert.match(framingFilter("fill", out), /^scale=1920:1080:force_original_aspect_ratio=increase:.*crop=1920:1080,format=yuv420p$/);
  assert.equal(framingFilter(undefined, out), framingFilter("fit", out), "fit unless fill is chosen");
  // An export fits or fills a take; a vertical export's crop is already 9:16 and is scaled.
  const still = { still: "s.png", width: 1920, height: 1080, seconds: 2, transition: "cut", videos: [] };
  const take = (framing?: string, crop?: object) => videoGraph([{ ...still, width: 1913, height: 1010, crop, take: { file: "t.mp4", lead: 0, sound: null, framing } }], { width: 1920, height: 1080, fps: 30 }, 0).graph;
  assert.ok(take("fit").includes(framingFilter("fit", { width: 1920, height: 1080 })));
  assert.ok(take("fill").includes(framingFilter("fill", { width: 1920, height: 1080 })));
  assert.doesNotMatch(take("fill", { x: 0, y: 0, w: 568, h: 1010 }), /force_original_aspect_ratio/);
});

test("a take keeps all of the window, edge to edge, at its own size", { skip: !ffmpegPath || !fs.existsSync(ffmpegPath) }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-crop-"));
  try {
    const ff = (args: string[]) => spawnSync(ffmpegPath as unknown as string, ["-hide_banner", "-y", ...args], { encoding: "utf8" });
    // A 320 × 200 window in a 400 × 240 frame padded with black, as the capture makes it: red,
    // with a yellow left edge, a blue right edge and a green bottom edge, two pixels each.
    ff(["-f", "lavfi", "-i", "color=c=black:s=400x240:r=30:d=2", "-vf",
      "drawbox=x=0:y=0:w=320:h=200:c=red:t=fill,drawbox=x=0:y=0:w=2:h=200:c=yellow:t=fill," +
      "drawbox=x=318:y=0:w=2:h=200:c=blue:t=fill,drawbox=x=0:y=198:w=320:h=2:c=green:t=fill",
      "-c:v", "libvpx-vp9", "-b:v", "2M", path.join(dir, "take-c.webm")]);
    const made = await processRecording(dir, "take-c.webm", "light", 0, parsePicture("0.8,0.833333"));
    assert.equal(made.video, "take-c.video.mp4");
    assert.deepEqual([made.width, made.height], [320, 200], "the window, not the padded frame");
    const pixel = (x: number, y: number) => [...spawnSync(ffmpegPath as unknown as string, ["-hide_banner", "-loglevel", "error", "-i", path.join(dir, made.video!), "-frames:v", "1",
      "-vf", `crop=2:2:${x}:${y},format=rgb24`, "-f", "rawvideo", "-"]).stdout.subarray(0, 3)];
    const [yr, yg, yb] = pixel(0, 100), [br, bg, bb] = pixel(318, 100), [gr, gg, gb] = pixel(160, 198);
    assert.ok(yr > 150 && yg > 150 && yb < 100, `left edge is yellow: ${yr},${yg},${yb}`);
    assert.ok(bb > 150 && br < 100 && bg < 100, `right edge is blue: ${br},${bg},${bb}`);
    assert.ok(gg > 90 && gr < 100 && gb < 100, `bottom edge is green: ${gr},${gg},${gb}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Real encodes of windows of every common shape into 16:9: fit keeps each edge and puts bars
// only where the shapes differ; fill leaves no bars at all.
test("fit and fill work for any window shape: laptop, ultrawide, portrait and 16:9", { skip: !ffmpegPath || !fs.existsSync(ffmpegPath) }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-frame-"));
  const out = { width: 640, height: 360 };
  try {
    const ff = (args: string[]) => spawnSync(ffmpegPath as unknown as string, ["-hide_banner", "-y", "-loglevel", "error", ...args], { encoding: "utf8" });
    for (const [name, w, h] of [["16x10", 320, 200], ["21x9", 420, 180], ["portrait", 180, 320], ["16x9", 320, 180]] as const) {
      const src = path.join(dir, `${name}.png`);
      // Red, with a 4-pixel yellow left, blue right, green bottom and magenta top edge.
      ff(["-f", "lavfi", "-i", `color=c=red:s=${w}x${h}:d=1`, "-frames:v", "1", "-vf",
        `drawbox=x=0:y=0:w=4:h=${h}:c=yellow:t=fill,drawbox=x=${w - 4}:y=0:w=4:h=${h}:c=blue:t=fill,` +
        `drawbox=x=0:y=${h - 4}:w=${w}:h=4:c=green:t=fill,drawbox=x=4:y=0:w=${w - 8}:h=4:c=magenta:t=fill`, src]);
      const pixel = (file: string, x: number, y: number) => [...spawnSync(ffmpegPath as unknown as string, ["-hide_banner", "-loglevel", "error", "-i", file,
        "-vf", `crop=2:2:${Math.max(0, Math.min(out.width - 2, Math.round(x)))}:${Math.max(0, Math.min(out.height - 2, Math.round(y)))},format=rgb24`, "-f", "rawvideo", "-"]).stdout.subarray(0, 3)];
      const dark = ([r, g, b]: number[]) => r < 40 && g < 40 && b < 40;
      for (const framing of ["fit", "fill"] as const) {
        const file = path.join(dir, `${name}-${framing}.png`);
        const made = ff(["-i", src, "-vf", framingFilter(framing, out), "-frames:v", "1", file]);
        assert.equal(made.status, 0, made.stderr);
        const size = /(\d+)x(\d+)/.exec(spawnSync(ffmpegPath as unknown as string, ["-hide_banner", "-i", file], { encoding: "utf8" }).stderr.split("Video:")[1])!;
        assert.deepEqual([Number(size[1]), Number(size[2])], [out.width, out.height], `${name} ${framing} size`);
        if (framing === "fill") {
          for (const [x, y] of [[1, 1], [637, 1], [1, 357], [637, 357]]) assert.ok(!dark(pixel(file, x, y)), `${name} fill has no bar at ${x},${y}: ${pixel(file, x, y)}`);
          continue;
        }
        const k = Math.min(out.width / w, out.height / h), bw = w * k, bh = h * k, x0 = (out.width - bw) / 2, y0 = (out.height - bh) / 2;
        const [lr, lg, lb] = pixel(file, x0 + 1, y0 + bh / 2), [rr, rg, rb] = pixel(file, x0 + bw - 3, y0 + bh / 2);
        const [br, bg, bb] = pixel(file, x0 + bw / 2, y0 + bh - 3), [tr, tg, tb] = pixel(file, x0 + bw / 2, y0 + 1);
        assert.ok(lr > 150 && lg > 150 && lb < 110, `${name} fit keeps the left edge: ${lr},${lg},${lb}`);
        assert.ok(rb > 150 && rr < 110 && rg < 110, `${name} fit keeps the right edge: ${rr},${rg},${rb}`);
        assert.ok(bg > 90 && br < 110 && bb < 110, `${name} fit keeps the bottom edge: ${br},${bg},${bb}`);
        assert.ok(tr > 150 && tb > 150 && tg < 110, `${name} fit keeps the top edge: ${tr},${tg},${tb}`);
        // Bars only where the shapes differ.
        if (x0 >= 4) assert.ok(dark(pixel(file, 1, out.height / 2)) && dark(pixel(file, out.width - 3, out.height / 2)), `${name} fit has side bars`);
        if (y0 >= 4) assert.ok(dark(pixel(file, out.width / 2, 1)) && dark(pixel(file, out.width / 2, out.height - 3)), `${name} fit has top and bottom bars`);
        if (x0 < 1 && y0 < 1) assert.ok(!dark(pixel(file, 1, 1)), `${name} fit of a 16:9 window has no bars`);
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// At full strength the model took bites out of a real voice: one speaking moment in five came
// out more than 6 dB down, and words went dull. The cap is what stops that. A stand-in for the
// model is used here — it says exactly when there is speech, and removes everything, the worst
// it could do — so the cap and the gate's timing are checked to the frame.
test("the voice is never pulled down by more than its cap, and the gate opens before a word and closes after it", async () => {
  const { rnnoiseStream, LOOKAHEAD, HANGOVER } = await import("../server/rnnoise.js");
  const n = 480, frames = 500, speechFrom = 100, speechTo = 300;
  const x = new Float32Array(frames * n).fill(0.25);
  const fake = (delay = 2) => ({
    frameSize: n,
    createDenoiseState() {
      let call = 0;
      return {
        // The real model's output is two frames late, so its verdict on a frame comes as that frame goes in.
        processFrame(frame: Float32Array) { const speaking = call >= speechFrom && call < speechTo; call++; void delay; frame.fill(0); return speaking ? 0.95 : 0.02; },
        destroy() {},
      };
    },
  });
  const run = async (options: { speech: number; pause: number; pauseMix?: number }) => {
    const stream = rnnoiseStream(fake() as never, options);
    const out: Buffer[] = [];
    stream.on("data", (b: Buffer) => out.push(b));
    stream.write(Buffer.from(x.buffer));
    await new Promise((resolve) => stream.end(resolve));
    const all = Buffer.concat(out);
    return new Float32Array(all.buffer.slice(all.byteOffset, all.byteOffset + all.length));
  };
  // Level of a frame against the input, in dB.
  const at = (y: Float32Array, frame: number) => 20 * Math.log10(Math.max(1e-9, Math.abs(y[frame * n + n - 1]) / 0.25));
  const light = await run({ speech: 0.5, pauseMix: 0.8, pause: 10 ** (-6 / 20) });
  assert.equal(light.length, x.length);
  // Half the output is the recording as it was: the model, removing everything, takes 6 dB and no more.
  for (const f of [speechFrom, 150, 299]) assert.ok(Math.abs(at(light, f) + 6.02) < 0.05, `light at frame ${f}: ${at(light, f).toFixed(2)} dB`);
  // In a pause: a fifth of the recording, 6 dB down — about -20 dB.
  assert.ok(Math.abs(at(light, 450) + 20) < 0.1, `light in a pause: ${at(light, 450).toFixed(2)} dB`);
  const strong = await run({ speech: 0.7, pause: 0.03 });
  assert.ok(Math.abs(at(strong, 200) + 10.46) < 0.05, `strong while speaking: ${at(strong, 200).toFixed(2)} dB`);
  assert.ok(at(strong, 450) < -100, `strong in a pause: ${at(strong, 450).toFixed(1)} dB`);
  // Fully open before the first word and still open after the last: soft edges are not clipped.
  assert.ok(Math.abs(at(strong, speechFrom - 3) + 10.46) < 0.05, `open before the word: ${at(strong, speechFrom - 3).toFixed(2)} dB`);
  assert.ok(at(strong, speechFrom - LOOKAHEAD - 2) < -100, "but not long before it");
  assert.ok(Math.abs(at(strong, speechTo + HANGOVER - 2) + 10.46) < 0.05, `still open after the word: ${at(strong, speechTo + HANGOVER - 2).toFixed(2)} dB`);
  assert.ok(at(strong, speechTo + HANGOVER + 30) < -25, `closed again after the hangover: ${at(strong, speechTo + HANGOVER + 30).toFixed(1)} dB`);
});

// A warning that came and went with every loud word moved everything under it, and the buttons
// slid out from under the pointer.
test("the recorder's level message keeps its place, and every cleaning setting has its explanation", () => {
  const panel = fs.readFileSync(new URL("../client/src/components/BeatRecorder.tsx", import.meta.url), "utf8");
  assert.match(panel, /<p className=\{`rec-status /);
  assert.doesNotMatch(panel, /\{clipping && <p/, "the clipping warning is not mounted and unmounted");
  const css = fs.readFileSync(new URL("../client/src/index.css", import.meta.url), "utf8");
  assert.match(css, /\.rec-status \{[^}]*min-height:/);
  for (const key of Object.keys(LIMITS)) assert.match(panel, new RegExp(`key: "${key}"[^\\n]*\\n\\s*info: "[^"]{40,}"`), `${key} has a slider and an explanation`);
  assert.match(panel, /Reset to defaults/);
});

// Static is steady: it sounds the same in a pause as under a word, so it is learnt in the
// pauses and subtracted everywhere.
test("steady static is learnt from the pauses and taken out, leaving a tone above it alone", async () => {
  const { fft, noiseProfile, spectralStream, SIZE } = await import("../server/spectral.js");
  // The transform undoes itself.
  const re = Float32Array.from({ length: SIZE }, (_, i) => Math.sin(i / 3) + 0.2 * Math.cos(i / 17)), im = new Float32Array(SIZE), was = Float32Array.from(re);
  fft(re, im); fft(re, im, true);
  assert.ok(re.every((v, i) => Math.abs(v - was[i]) < 1e-4), "forward then inverse gives the signal back");

  const rate = 48000, len = rate * 4;
  const noise = new Float32Array(len), tone = new Float32Array(len);
  let seed = 4321;
  for (let i = 0; i < len; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    noise[i] = (seed / 0x7fffffff - 0.5) * 0.06;
    // A steady 1 kHz tone from 2 s on: the "voice", far above the static at its frequency.
    if (i >= rate * 2) tone[i] = 0.2 * Math.sin((2 * Math.PI * 1000 * i) / rate);
  }
  const x = Float32Array.from(noise, (v, i) => v + tone[i]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-static-"));
  try {
    const file = path.join(dir, "x.raw");
    fs.writeFileSync(file, Buffer.from(x.buffer));
    // The first two seconds are the pause.
    const profile = await noiseProfile(file, (_from: number, to: number) => to <= rate * 2);
    assert.ok(profile && profile.length === SIZE / 2 + 1);
    const run = async (input: Float32Array, amount: number, chunk: number, using = profile) => {
      const stream = spectralStream(using, amount);
      const out: Buffer[] = [];
      stream.on("data", (b: Buffer) => out.push(b));
      const bytes = Buffer.from(input.buffer);
      for (let at = 0; at < bytes.length; at += chunk) stream.write(bytes.subarray(at, at + chunk));
      await new Promise((resolve) => stream.end(resolve));
      const all = Buffer.concat(out);
      return new Float32Array(all.buffer.slice(all.byteOffset, all.byteOffset + all.length));
    };
    const rms = (a: Float32Array, from: number, to: number) => { let e = 0; for (let i = from; i < to; i++) e += a[i] ** 2; return 10 * Math.log10(e / (to - from) + 1e-15); };
    // Nothing to remove: what comes out is what went in, sample for sample, the same length.
    const same = await run(x, 20, 4001, new Float32Array(SIZE / 2 + 1));
    assert.equal(same.length, len);
    assert.ok(same.every((v, i) => Math.abs(v - x[i]) < 1e-5), "transparent with an empty profile");
    const y = await run(x, 20, 7777);
    assert.equal(y.length, len);
    // The static in the pause comes down by most of what was asked for…
    const pause = rms(y, rate * 0.5, rate * 1.8) - rms(x, rate * 0.5, rate * 1.8);
    assert.ok(pause < -15, `static in the pause is down ${pause.toFixed(1)} dB`);
    // …and so does the static under the tone, while the tone itself is left where it was.
    const under = await run(noise, 20, 7777);
    assert.ok(rms(under, rate * 2.5, rate * 3.8) - rms(noise, rate * 2.5, rate * 3.8) < -15, "static alone is taken out throughout");
    const kept = rms(y, rate * 2.5, rate * 3.8) - rms(tone, rate * 2.5, rate * 3.8);
    assert.ok(Math.abs(kept) < 0.6, `the tone is kept: ${kept.toFixed(2)} dB`);
    // The same sound gives the same result, whatever sizes it arrives in.
    assert.ok(Buffer.from((await run(x, 20, 65536)).buffer).equals(Buffer.from(y.buffer)), "deterministic");
    // No confirmed pause: never substitute frequencies from the voice itself.
    assert.equal(await noiseProfile(file, () => false), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("noise learning excludes padded silence and needs a real quarter second of room sound", async () => {
  const { noiseProfile } = await import("../server/spectral.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-profile-"));
  try {
    const file = path.join(dir, "sound.raw");
    for (const seconds of [0, 0.01, 0.24]) {
      fs.writeFileSync(file, Buffer.from(new Float32Array(Math.round(48000 * seconds)).fill(0.1).buffer));
      assert.equal(await noiseProfile(file, () => true), null, `${seconds}s is not enough`);
    }
    fs.writeFileSync(file, Buffer.from(new Float32Array(48000).fill(0.1).buffer));
    const spans: number[][] = [];
    assert.ok(await noiseProfile(file, (from: number, to: number) => { spans.push([from, to]); return true; }));
    assert.ok(spans.every(([from, to]) => from >= 0 && to <= 48000), "synthetic padding is never learnt as room sound");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a continuous voice is not treated as room noise or gated away when the model misses it", async () => {
  const { pauseFloor, speechActivity } = await import("../server/rnnoise.js");
  const level = Float32Array.from({ length: 500 }, (_, i) => -25 + 2 * Math.sin(i / 11));
  const vad = new Float32Array(level.length).fill(0.1);
  assert.equal(pauseFloor(level), null);
  assert.equal(pauseFloor(new Float32Array(500).fill(-50)), null, "a room-only sample also has no known voice/noise separation");
  assert.ok(speechActivity({ level, vad }, null).every((v: number) => v === 1), "uncertain sound keeps the voice path open");
  assert.ok(speechActivity({ level, vad }).every((v: number) => v === 1), "the default also requires a trustworthy resting level");
  level.fill(-55, 0, 100);
  assert.equal(pauseFloor(level), -55);
  const noisy = Float32Array.from({ length: 500 }, (_, i) => i < 100 ? -40 : -32);
  assert.equal(pauseFloor(noisy), -40, "a voice 8 dB over the room still has usable pauses");
  assert.equal(speechActivity({ level: noisy, vad }, -40)[250], 1, "keep a low-contrast voice out of the pause gate");
});

test("cleaning a continuous sound without a noise sample preserves its spectrum end to end", { skip: !ffmpegPath || !fs.existsSync(ffmpegPath) }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-continuous-"));
  try {
    // Several voice-band harmonics, changing gently but never pausing. There is no room-only
    // sample to learn here; choosing per-bin minima would remove part of these harmonics.
    const pcm = Float32Array.from({ length: 48000 * 2 }, (_, i) => {
      const t = i / 48000;
      return (0.08 * Math.sin(2 * Math.PI * 180 * t) + 0.04 * Math.sin(2 * Math.PI * 540 * t)
        + 0.02 * Math.sin(2 * Math.PI * 3600 * t)) * (1 + 0.1 * Math.sin(2 * Math.PI * 3 * t));
    });
    const input = path.join(dir, "input.raw");
    fs.writeFileSync(input, Buffer.from(pcm.buffer));
    const encoded = spawnSync(ffmpegPath as unknown as string, ["-y", "-f", "f32le", "-ar", "48000", "-ac", "1", "-i", input, "-c:a", "pcm_f32le", path.join(dir, "voice.wav")], { encoding: "utf8", windowsHide: true });
    assert.equal(encoded.status, 0, encoded.stderr);
    const plain = await processRecording(dir, "voice.wav", "custom", 0, null, { ...PRESETS.off, rumble: 0 });
    const before = fs.readFileSync(path.join(dir, plain.clean!));
    const cleaned = await processRecording(dir, "voice.wav", "custom", 0, null, { ...PRESETS.off, rumble: 0, staticDb: 20 });
    assert.ok(before.equals(fs.readFileSync(path.join(dir, cleaned.clean!))), "without a trustworthy pause, static removal must leave every sample intact");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("room and gain checks use the capture path, return actual levels, and never write audio", async () => {
  const { captureArgs, measurementArgs, parseMeasurement, measureMicrophone } = await import("../server/microphone.js");
  const args = measurementArgs("Test microphone", 6, 999);
  assert.deepEqual(args.slice(1, args.indexOf("-t")), captureArgs("Test microphone", "unused", 6).slice(1, 9));
  assert.equal(args[args.indexOf("-t") + 1], "3", "untrusted duration is bounded");
  assert.equal(measurementArgs("mic", 0, 5)[args.indexOf("-t") + 1], "5");
  assert.deepEqual(args.slice(-3), ["-f", "null", "-"]);
  const filter = args[args.indexOf("-af") + 1];
  assert.ok(filter.startsWith("volume=6dB,aformat="), "boost is measured as it is recorded");
  assert.deepEqual(parseMeasurement("lavfi.astats.Overall.RMS_level=-inf\nlavfi.astats.Overall.Peak_level=-6.02"), { levels: [-120], peaks: [-6.02] });
  await assert.rejects(measureMicrophone("never open", 0, 3, AbortSignal.abort()), /cancelled/);
  if (ffmpegPath && fs.existsSync(ffmpegPath)) {
    const result = spawnSync(ffmpegPath, ["-hide_banner", "-f", "lavfi", "-i", "sine=frequency=1000:duration=1:sample_rate=48000", "-af", filter, "-f", "null", "-"], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const { levels, peaks } = parseMeasurement(result.stderr);
    assert.equal(levels.length, 20);
    assert.equal(peaks.length, 20);
    assert.ok(levels.every((v: number) => Math.abs(v - (-21.07 + 6)) < 0.1));
    assert.ok(peaks.every((v: number) => Math.abs(v - (-18.06 + 6)) < 0.1));
  }
  const panel = fs.readFileSync(new URL("../client/src/components/BeatRecorder.tsx", import.meta.url), "utf8");
  assert.match(panel, /api[.]measureMicrophone/);
  assert.match(panel, /calibration[.]current[?][.]abort[(][)]/);
  assert.match(panel, /reclean[(]p[.]noise, current, true[)]/, "existing recordings can use improved cleaning without changing preset");
  assert.match(panel, /p[.]onTake[(][{][^\n]+loudness: made[.]loudness/, "reprocessing a take into Original clears its old processed loudness");
  assert.match(panel, /phase !== "idle" \|\| auto \|\| room === "measuring"/, "recording and calibration cannot overlap");
});

test("Original audio keeps captured samples, level, bass and timing, with only the lead trimmed", { skip: !ffmpegPath || !fs.existsSync(ffmpegPath) }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-original-"));
  try {
    // Exact 16-bit samples represented as floats, including bass that the old Off mode removes.
    const pcm = Float32Array.from({ length: 48000 * 3 }, (_, i) => i < 48000 ? 0 : Math.round(32768 *
      (0.3 * Math.sin(2 * Math.PI * 50 * i / 48000) + 0.1 * Math.sin(2 * Math.PI * 4000 * i / 48000))) / 32768);
    const input = path.join(dir, "input.raw"), wav = path.join(dir, "voice.wav");
    fs.writeFileSync(input, Buffer.from(pcm.buffer));
    const enc = spawnSync(ffmpegPath as unknown as string, ["-y", "-f", "f32le", "-ar", "48000", "-ac", "1", "-i", input, "-c:a", "pcm_f32le", wav], { encoding: "utf8", windowsHide: true });
    assert.equal(enc.status, 0, enc.stderr);
    const before = fs.readFileSync(wav);
    const made = await processRecording(dir, "voice.wav", "original", 1);
    assert.equal(made.noise, "original");
    assert.ok(made.lead > 0 && made.lead <= 1, "the existing first-word protection still applies");
    assert.ok(Math.abs(made.seconds - (3 - made.lead)) < 0.01);
    const decoded = spawnSync(ffmpegPath as unknown as string, ["-v", "error", "-i", path.join(dir, made.clean!), "-f", "f32le", "-"], { windowsHide: true });
    assert.equal(decoded.status, 0, decoded.stderr.toString());
    const expected = pcm.subarray(Math.round(made.lead * 48000));
    assert.equal(decoded.stdout.length, expected.length * 4, "no samples added or lost");
    assert.ok(expected.every((v, i) => v === decoded.stdout.readFloatLE(i * 4)), "sample-identical, treating signed zeros alike, with no gain or limiter delay");
    assert.ok(fs.readFileSync(wav).equals(before), "original capture remains untouched");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("video recording budgets follow captured pixels rather than the later export resolution", () => {
  assert.equal(takeVideoBitrate({ width: 1920, height: 1080 }), 16e6);
  assert.equal(takeVideoBitrate({ width: 1080, height: 1920 }), 16e6);
  assert.equal(takeVideoBitrate({ width: 3840, height: 2160 }), 64e6);
  assert.ok(takeVideoBitrate({ width: 3440, height: 1440 }) > 32e6);
  assert.equal(takeVideoBitrate({ width: 7680, height: 4320 }), 80e6, "bounded for very large screens");
  assert.equal(takeVideoBitrate({ width: 320, height: 240 }), 16e6, "small captures keep the existing minimum");
  assert.equal(takeVideoBitrate(), 16e6);
  assert.equal(takeVideoBitrate({ width: Infinity, height: 2160 }), 16e6);
  const app = fs.readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /const rate = takeVideoBitrate[(]size[)]/);
});

// Sound with its static already taken out no longer looks like speech to the model, which then
// shut its gate on the voice.
test("the speech gate follows the recording as it was, not the cleaned sound it is given", async () => {
  const { rnnoiseStream, isPause, floorOf, speechActivity } = await import("../server/rnnoise.js");
  const n = 480, frames = 300;
  const x = new Float32Array(frames * n).fill(0.25);
  // A model that hears no voice at all in what it is given, and removes everything.
  const deaf = { frameSize: n, createDenoiseState: () => ({ processFrame(frame: Float32Array) { frame.fill(0); return 0; }, destroy() {} }) };
  const activity = Float32Array.from({ length: frames }, (_, i) => (i >= 100 && i < 200 ? 0.95 : 0.02));
  const run = async (given: Float32Array | null) => {
    const stream = rnnoiseStream(deaf as never, { speech: 0.5, pause: 0.03, activity: given });
    const out: Buffer[] = [];
    stream.on("data", (b: Buffer) => out.push(b));
    stream.write(Buffer.from(x.buffer));
    await new Promise((resolve) => stream.end(resolve));
    const all = Buffer.concat(out);
    return new Float32Array(all.buffer.slice(all.byteOffset, all.byteOffset + all.length));
  };
  const at = (y: Float32Array, frame: number) => 20 * Math.log10(Math.max(1e-9, Math.abs(y[frame * n + n - 1]) / 0.25));
  assert.ok(Math.abs(at(await run(activity), 150) + 6.02) < 0.05, "open where the recording had speech");
  assert.ok(at(await run(null), 150) < -100, "left to itself the deaf model shuts the gate");
  // The model read a voice recorded through a sound driver as 1 to 5 out of 10 through whole
  // sentences, and a gate driven by it alone shut on the words. Level counts as well.
  const level = Float32Array.from({ length: frames }, (_, i) => (i >= 100 && i < 200 ? -22 : -50));
  const unsure = Float32Array.from({ length: frames }, (_, i) => (i >= 100 && i < 200 ? 0.3 : 0.02));
  const floor = floorOf(level);
  assert.equal(floor, -50);
  const heard = speechActivity({ vad: unsure, level }, floor);
  assert.ok(heard[150] === 1 && heard[50] < 0.1, "what is well above the resting level is speech, whatever the model says");
  assert.ok(Math.abs(at(await run(heard), 150) + 6.02) < 0.05, "and the gate opens for it");
  // A pause is judged by level, and only well clear of anything louder: what is learnt there
  // is subtracted everywhere, and a voice the model missed must never be learnt as noise.
  assert.equal(isPause(level, floor, 10 * n, 60 * n), true);
  assert.equal(isPause(level, floor, 80 * n, 92 * n), false, "within a tenth of a second of a word");
  assert.equal(isPause(level, floor, 120 * n, 140 * n), false);
});

// Chromium opens a Windows microphone raw, past the sound driver's processing; recorded through
// DirectShow it is what OBS records.
test("the microphone is recorded through Windows: devices are matched, and the capture is stamped and lined up", async () => {
  const { alignCapture, captureArgs, matchMicrophone, parseDevices, parseStart, startCapture } = await import("../server/microphone.js");
  const listing = `[dshow @ 000001] "Integrated Webcam" (video)
[dshow @ 000001]   Alternative name "@device_pnp_x"
[dshow @ 000001] "Microphone (Razer BlackShark V2 X USB)" (audio)
[dshow @ 000001]   Alternative name "@device_cm_{33D9A762}\\wave_{B03B}"
[dshow @ 000001] "Microphone (Realtek(R) Audio)" (audio)`;
  const devices = parseDevices(listing);
  assert.deepEqual(devices, ["Microphone (Razer BlackShark V2 X USB)", "Microphone (Realtek(R) Audio)"]);
  // The page decorates Windows' names; a camera is never a microphone.
  assert.equal(matchMicrophone("Default - Microphone (Realtek(R) Audio)", devices), "Microphone (Realtek(R) Audio)");
  assert.equal(matchMicrophone("Communications - Microphone (Realtek(R) Audio)", devices), "Microphone (Realtek(R) Audio)");
  assert.equal(matchMicrophone("Microphone (Razer BlackShark V2 X USB) (1532:0526)", devices), "Microphone (Razer BlackShark V2 X USB)");
  assert.equal(matchMicrophone("Microphone (Some Other Device)", devices), null);
  assert.equal(matchMicrophone("", devices), null);
  assert.equal(matchMicrophone("Integrated Webcam", devices), null);
  // Float samples so a boost cannot clip, and the wall clock kept in the file.
  const args = captureArgs("Microphone (Realtek(R) Audio)", "out.mka", 6);
  assert.deepEqual(args.slice(0, 9), ["-y", "-f", "dshow", "-audio_buffer_size", "50", "-use_wallclock_as_timestamps", "1", "-i", "audio=Microphone (Realtek(R) Audio)"]);
  assert.ok(args.join(" ").includes("-af volume=6dB") && args.includes("pcm_f32le") && args.includes("-copyts"));
  assert.ok(!captureArgs("m", "o.mka", 0).includes("-af"));
  assert.equal(parseStart("  Duration: 497459:55:22.79, start: 1790855718.038000, bitrate: N/A"), 1790855718.038);
  assert.equal(parseStart("nothing"), null);
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-mic-"));
  try {
    // A capture stamped as a real one is: silence, then a tone from two seconds in.
    const stamp = 1790855718.038;
    const part = path.join(dir, "take-a.mic.mka.part"), final = path.join(dir, "take-a.mic.mka");
    const made = spawnSync(ffmpegPath as unknown as string, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
      `sine=f=440:d=5,volume='if(gte(t,2),1,0)':eval=frame,asetpts=PTS+${stamp}/TB`, "-ac", "1", "-ar", "48000", "-c:a", "pcm_f32le", "-copyts", "-f", "matroska", part], { encoding: "utf8" });
    assert.equal(made.status, 0, made.stderr);
    // The picture started 1.5 s after the capture: the tone must now begin half a second in.
    const cut = await alignCapture(part, final, (stamp + 1.5) * 1000);
    assert.ok(Math.abs(cut - 1.5) < 0.001, `cut ${cut}`);
    assert.ok(!fs.existsSync(part) && fs.existsSync(final));
    const heard = spawnSync(ffmpegPath as unknown as string, ["-hide_banner", "-i", final, "-af", "silencedetect=n=-50dB:d=0.1", "-f", "null", "-"], { encoding: "utf8" }).stderr;
    const begins = Number(/silence_end: ([\d.]+)/.exec(heard)?.[1]);
    assert.ok(Math.abs(begins - 0.5) < 0.03, `the tone begins at ${begins} s`);
    assert.ok(Math.abs((parseProbe(heard).duration ?? 0) - 3.5) < 0.05, "and the file has its own length, not the clock's");
    // A microphone that is not there is an error the recorder can act on, not a hang.
    if (process.platform === "win32") await assert.rejects(startCapture("No Such Microphone 12345", path.join(dir, "x.mka.part")), /could not be opened/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a take's voice recorded through Windows is what gets cleaned, beside its silent picture", { skip: !ffmpegPath || !fs.existsSync(ffmpegPath) }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-takemic-"));
  try {
    const ff = (args: string[]) => spawnSync(ffmpegPath as unknown as string, ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
    // The picture, with no sound of its own, and the microphone beside it.
    ff(["-f", "lavfi", "-i", "color=c=red:s=320x180:r=30:d=4", "-c:v", "libvpx-vp9", "-b:v", "500k", path.join(dir, "take-m.webm")]);
    ff(["-f", "lavfi", "-i", "sine=f=140:d=4,aeval='val(0)*(0.5+0.5*sin(2*PI*4*t))*(0.6*sin(2*PI*280*t)+0.4*sin(2*PI*420*t)+1)/2':c=same,volume='if(gte(t,1.5),0.5,0)':eval=frame",
      "-f", "lavfi", "-i", "anoisesrc=d=4:c=pink:a=0.005:seed=3", "-filter_complex", "[0][1]amix=inputs=2:normalize=0", "-ac", "1", "-c:a", "pcm_f32le", "-f", "matroska", path.join(dir, "take-m.mic.mka")]);
    const made = await processRecording(dir, "take-m.webm", "light", 1, parsePicture("1,1"));
    assert.equal(made.clean, "take-m.clean.flac", "the take has sound though its picture file has none");
    assert.equal(made.video, "take-m.video.mp4");
    assert.ok(Math.abs(made.seconds - 3) < 0.1, `seconds ${made.seconds}`);
    const loud = parseLoudness(spawnSync(ffmpegPath as unknown as string, ["-hide_banner", "-i", path.join(dir, made.clean!), "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" }).stderr);
    assert.ok(Math.abs((loud ?? 0) - TARGET_LUFS) < 1, `loudness ${loud}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
