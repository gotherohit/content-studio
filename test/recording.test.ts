import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import {
  CLIP_DB, LEAD_SECONDS, isBluetoothMic, levelDb, micConstraints, peakDb, recordingInUse, recordingName, roomVerdict,
} from "../client/src/recording.ts";
import { beatTimings, exportSettings, VOICE_TAIL } from "../client/src/exportPlan.ts";
import { cleanFilter, denoiseFilter, derived, parseLoudness, processRecording, TARGET_LUFS } from "../server/recordings.js";
import { videoGraph } from "../electron/export-video.js";
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

test("cleaning learns the room from the silent lead-in and cuts it off", () => {
  const f = denoiseFilter("strong", LEAD_SECONDS);
  assert.match(f, /asendcmd=c='0\.1 afftdn sn start; 0\.85 afftdn sn stop'/);
  assert.match(f, /afftdn=nr=24/);
  assert.match(f, /atrim=start=1,asetpts=PTS-STARTPTS/);
  assert.doesNotMatch(denoiseFilter("off", 1), /afftdn/);
  assert.doesNotMatch(denoiseFilter("light", 0), /asendcmd|atrim/);
  // One fixed gain to the target, never a dynamic normaliser that lifts the pauses.
  const whole = cleanFilter("light", 1, -26);
  assert.match(whole, /volume=10dB/);
  assert.doesNotMatch(whole, /loudnorm|dynaudnorm/);
  assert.match(whole, /alimiter=limit=0\.84/);
  assert.match(cleanFilter("strong", 1, -20), /agate=threshold=0\.03:range=0\.08/);
  assert.doesNotMatch(cleanFilter("off", 1, -20), /agate/);
  assert.equal(parseLoudness("Summary:\n  Integrated loudness:\n    I:         -23.4 LUFS\n"), -23.4);
  assert.deepEqual(derived("take-a.webm"), { clean: "take-a.clean.flac", video: "take-a.video.webm" });
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

// The real thing: a noisy recording with a silent second first, cleaned by ffmpeg.
test("strong noise reduction takes the room out of the pauses and leaves the voice at -16 LUFS", { skip: !ffmpegPath || !fs.existsSync(ffmpegPath) }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-rec-"));
  try {
    const run = (args: string[]) => spawnSync(ffmpegPath as unknown as string, ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
    run(["-f", "lavfi", "-i", "sine=f=220:d=6,volume='if(between(t,2,4),0.3,0)':eval=frame", "-f", "lavfi", "-i", "anoisesrc=d=6:c=pink:a=0.02:seed=7",
      "-filter_complex", "[0][1]amix=inputs=2:normalize=0", "-c:a", "libopus", "-b:a", "128k", path.join(dir, "voice-t.webm")]);
    const rms = (file: string, from: number, to: number) => Number(/RMS level dB: (-?[\d.]+|-inf)/.exec(spawnSync(ffmpegPath as unknown as string,
      ["-hide_banner", "-i", file, "-af", `atrim=${from}:${to},astats=metadata=0`, "-f", "null", "-"], { encoding: "utf8" }).stderr)?.[1].replace("-inf", "-200"));
    const made = await processRecording(dir, "voice-t.webm", "strong", 1);
    const clean = path.join(dir, made.clean!);
    // The lead-in is gone: what was 2–4 s is now 1–3 s.
    assert.ok(Math.abs(made.seconds - 5) < 0.1, `seconds ${made.seconds}`);
    const speech = rms(clean, 1.3, 2.7), pause = rms(clean, 3.6, 4.8);
    assert.ok(speech - pause > 35, `speech ${speech} dB, pause ${pause} dB`);
    const loud = parseLoudness(spawnSync(ffmpegPath as unknown as string, ["-hide_banner", "-i", clean, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" }).stderr);
    assert.ok(Math.abs((loud ?? 0) - TARGET_LUFS) < 1, `loudness ${loud}`);
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
