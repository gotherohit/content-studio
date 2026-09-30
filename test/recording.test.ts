import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import {
  AUTO_PEAK_DB, CLIP_DB, GAIN_MAX, GAIN_MIN, LEAD_SECONDS, autoGain, clampGain, gainKey, isBluetoothMic, levelDb, micConstraints, peakDb,
  recordingInUse, recordingName, roomVerdict,
} from "../client/src/recording.ts";
import { beatTimings, exportSettings, VOICE_TAIL } from "../client/src/exportPlan.ts";
import {
  cleanFilter, DECODE, denoiseFilter, derived, finishFilter, frameLevels, parseLoudness, parsePicture, pictureFilter, RNN_MIX, processRecording, quietSpan, roomLevel, TARGET_LUFS, voiceStart,
} from "../server/recordings.js";
import { parseProbe, takeGraph, videoGraph } from "../electron/export-video.js";
import type { Beat, BeatTake, BeatVoice, Stage } from "../client/src/types.ts";

const stage: Stage = { preset: "1", panes: [{ kind: "notes" }], views: {}, split: 50, rowSplit: 50, activeSourceId: null, highlightId: null, viewMode: "original" };
const voice = (seconds: number, file = "voice-a.webm"): BeatVoice => ({ file, clean: "voice-a.clean.flac", seconds, noise: "light", lead: 1, recordedAt: "" });
const take = (seconds: number, file = "take-a.webm"): BeatTake => ({ file, video: "take-a.video.webm", seconds, noise: "light", lead: 1, width: 1920, height: 1080, muted: false, recordedAt: "" });
const beat = (extra: Partial<Beat> = {}): Beat => ({ id: Math.random().toString(36).slice(2), point: "", stage, createdAt: "", ...extra });

test("the microphone is recorded as it is: the browser's call processing is all off", () => {
  const c = micConstraints("usb-mic");
  assert.deepEqual(c.deviceId, { exact: "usb-mic" });
  assert.equal(c.echoCancellation, false);
  assert.equal(c.noiseSuppression, false);
  assert.equal(c.autoGainControl, false);
  assert.equal(c.sampleRate, 48000);
  assert.equal(micConstraints().deviceId, undefined);
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

test("cleaning tells the spectral pass the room's level, and never normalises dynamically", () => {
  assert.match(DECODE, /channel_layouts=mono,highpass=f=85,highpass=f=85$/);
  assert.deepEqual(RNN_MIX, { off: 0, light: 0.9, strong: 1 });
  const strong = denoiseFilter("strong", 1, -35);
  // A -35 dB room: afftdn told a floor of -55 instead of assuming -50.
  assert.match(strong, /afftdn=nr=18:nf=-55/);
  assert.match(strong, /atrim=start=1,asetpts=PTS-STARTPTS$/);
  assert.doesNotMatch(strong, /arnndn/, "ffmpeg's RNNoise gives a different result on every other run");
  assert.match(denoiseFilter("light", 0, -35), /afftdn=nr=10:nf=-45$/);
  assert.doesNotMatch(denoiseFilter("off", 1, -35), /afftdn/);
  const whole = cleanFilter("light", 1, -40, 10, 3);
  // The expander works at the known level, before the compressor can lift the pauses.
  assert.match(whole, /volume=10dB,agate=threshold=0\.025:range=0\.25[^,]*,acompressor=[^,]*,volume=3dB,alimiter/);
  assert.doesNotMatch(whole, /loudnorm|dynaudnorm/);
  assert.match(whole, /alimiter=limit=0\.84/);
  assert.match(cleanFilter("strong", 1, -40, 0, 0), /agate=threshold=0\.03:range=0\.06/);
  assert.match(finishFilter(2), /^volume=2dB,alimiter/);
  assert.doesNotMatch(cleanFilter("off", 1, -40, 0, 0), /agate|acompressor/);
  assert.equal(parseLoudness("Summary:\n  Integrated loudness:\n    I:         -23.4 LUFS\n"), -23.4);
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

test("a take saved as MP4 starts after its lead-in and always has a sound track", () => {
  const withSound = takeGraph({ video: "t.video.webm", sound: "t.clean.flac", lead: 1.04, seconds: 6.5 });
  assert.deepEqual(withSound.inputs, ["-ss", "1.04", "-t", "6.5", "-i", "t.video.webm", "-t", "6.5", "-i", "t.clean.flac"]);
  assert.match(withSound.graph, /scale=trunc\(iw\/2\)\*2:trunc\(ih\/2\)\*2/);
  assert.match(withSound.graph, /channel_layouts=stereo,apad,atrim=duration=6\.5\[aout\]/);
  const silent = takeGraph({ video: "t.video.webm", sound: null, lead: 0, seconds: 3 });
  assert.deepEqual(silent.inputs.slice(0, 4), ["-t", "3", "-i", "t.video.webm"]);
  assert.ok(silent.inputs.includes("anullsrc=r=48000:cl=stereo"));
});

test("a take really becomes an H.264 and AAC MP4 of its own length", { skip: !ffmpegPath || !fs.existsSync(ffmpegPath) }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-take-"));
  try {
    const ff = (args: string[]) => spawnSync(ffmpegPath as unknown as string, ["-hide_banner", "-y", ...args], { encoding: "utf8" });
    ff(["-f", "lavfi", "-i", "testsrc2=s=321x181:r=25:d=4", "-c:v", "libvpx-vp9", "-b:v", "300k", path.join(dir, "t.video.webm")]);
    ff(["-f", "lavfi", "-i", "sine=f=300:d=3", "-c:a", "flac", path.join(dir, "t.clean.flac")]);
    const { inputs, graph } = takeGraph({ video: path.join(dir, "t.video.webm"), sound: path.join(dir, "t.clean.flac"), lead: 1, seconds: 3 });
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
  const run = async (mix: number, chunk: number) => {
    const stream = rnnoiseStream(rn, mix);
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
  const dry = await run(0, 4001);
  assert.equal(dry.length, len);
  assert.deepEqual(Array.from(dry.subarray(0, 2000)), Array.from(input.subarray(0, 2000)));
  assert.deepEqual(Array.from(dry.subarray(len - 2000)), Array.from(input.subarray(len - 2000)));
  const a = await run(1, 777), b = await run(1, 65536);
  assert.equal(a.length, len);
  assert.deepEqual(Buffer.from(a.buffer), Buffer.from(b.buffer));
});

// A 0.35.0 take on a 1913 × 1010 window came out as the window pixel for pixel in a 1920 × 1080
// frame: the beat's 16:9 box, a dark strip beside it and black below.
test("the beat's box is found in a take's picture, however the capture sized it", async () => {
  const { takeCrop } = await import("../client/src/exportPlan.ts");
  const { exportViewport } = await import("../client/src/exportPlan.ts");
  const page = { width: 1913, height: 1010 };
  const box = exportViewport(page.width, page.height);
  assert.deepEqual(box, { width: 1796, height: 1010 });
  // Copied pixel for pixel into a padded frame.
  const padded = takeCrop(box, page, { width: 1920, height: 1080 }, 1);
  assert.ok(Math.abs(padded.w * 1920 - 1796) < 0.01 && Math.abs(padded.h * 1080 - 1010) < 0.01, JSON.stringify(padded));
  // Recorded at the window's own size, or scaled to fit: the same fraction of the page.
  for (const frame of [{ width: 1913, height: 1010 }, { width: 3826, height: 2020 }]) {
    const c = takeCrop(box, page, frame, 1);
    assert.ok(Math.abs(c.w - 1796 / 1913) < 1e-9 && c.h === 1, JSON.stringify(c));
  }
  // A 16:9 window has nothing to cut.
  assert.deepEqual(takeCrop({ width: 1600, height: 900 }, { width: 1600, height: 900 }, { width: 3200, height: 1800 }, 2), { w: 1, h: 1 });
});

test("a take's picture instructions are checked, and the crop never goes inwards", () => {
  assert.deepEqual(parsePicture("0.935417,0.935185,1920,1080"), { w: 0.935417, h: 0.935185, width: 1920, height: 1080 });
  assert.equal(parsePicture("1.2,1,1920,1080"), null);
  assert.equal(parsePicture("0.9,0.9,1921,1080"), null);
  assert.equal(parsePicture(undefined), null);
  // Rounded to the nearest pixel and capped at the frame; the comma inside min() is escaped for the filter.
  assert.equal(pictureFilter({ w: 0.935417, h: 0.935185, width: 1920, height: 1080 }),
    String.raw`crop=min(iw\,round(iw*0.935417)):min(ih\,round(ih*0.935185)):0:0,scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p`);
  assert.deepEqual(derived("take-a.webm"), { clean: "take-a.clean.flac", video: "take-a.video.mp4", legacyVideo: "take-a.video.webm" });
});

test("a take loses the strip beside the beat and keeps every pixel of the beat", { skip: !ffmpegPath || !fs.existsSync(ffmpegPath) }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-crop-"));
  try {
    const ff = (args: string[]) => spawnSync(ffmpegPath as unknown as string, ["-hide_banner", "-y", ...args], { encoding: "utf8" });
    // A 400 × 240 window: the beat is the red 320 × 180 box, its last two columns blue; grey beside and below.
    ff(["-f", "lavfi", "-i", "color=c=0x505050:s=400x240:r=30:d=2", "-vf",
      "drawbox=x=0:y=0:w=320:h=180:c=red:t=fill,drawbox=x=318:y=0:w=2:h=180:c=blue:t=fill",
      "-c:v", "libvpx-vp9", "-b:v", "2M", path.join(dir, "take-c.webm")]);
    const made = await processRecording(dir, "take-c.webm", "light", 0, parsePicture("0.8,0.75,640,360"));
    assert.equal(made.video, "take-c.video.mp4");
    assert.deepEqual([made.width, made.height], [640, 360]);
    const pixel = (x: number, y: number) => {
      const raw = spawnSync(ffmpegPath as unknown as string, ["-hide_banner", "-loglevel", "error", "-i", path.join(dir, made.video!), "-frames:v", "1",
        "-vf", `crop=2:2:${x}:${y},format=rgb24`, "-f", "rawvideo", "-"]).stdout;
      return [...raw.subarray(0, 3)];
    };
    const [r1, , b1] = pixel(10, 10), [r2, g2, b2] = pixel(638, 180), [r3, , b3] = pixel(320, 358);
    assert.ok(r1 > 180 && b1 < 80, `top-left is the beat: ${r1},${b1}`);
    // The beat's own right edge is still there — nothing cut — and no grey strip came with it.
    assert.ok(b2 > 150 && r2 < 100 && g2 < 100, `right edge is the blue line: ${r2},${g2},${b2}`);
    assert.ok(r3 > 180 && b3 < 80, `bottom is the beat, not the grey below it: ${r3},${b3}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
