import type { Beat, NoiseReduction } from "./types";

/** The silent lead-in every recording starts with: the room, for the cleaning to learn. */
export const LEAD_SECONDS = 1;

/**
 * What the page asks the microphone for. This stream is the level meter's, and the recording
 * itself only where Windows cannot make it (see `server/microphone.js`): Chromium opens a
 * Windows microphone in raw mode, past the sound driver's processing, and it is hissy and dull
 * beside the same microphone recorded natively. Its own echo cancelling, noise suppression and
 * automatic gain are all off — the suppression takes the hiss out and 15 dB of the voice's
 * upper frequencies with it, and the others pump the level.
 */
export function micConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    channelCount: 1,
    sampleRate: 48000,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };
}

/** Level of a block of samples, in dB below full scale. Silence is -100, not -Infinity. */
export function levelDb(samples: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100;
}

export const peakDb = (samples: ArrayLike<number>) => {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  return peak > 0 ? Math.max(-100, 20 * Math.log10(peak)) : -100;
};

/**
 * What a few seconds of the room say about recording in it. The level is the quiet room as the
 * microphone hears it, before any cleaning: speech lands around -20 dB, so the distance between
 * the two is what a listener will notice.
 */
export function roomVerdict(noiseDb: number): { label: string; advice: string; noise: NoiseReduction; tone: "ok" | "warn" | "fail" } {
  if (noiseDb <= -65) return { label: "Very quiet room", advice: "Light noise reduction is plenty.", noise: "light", tone: "ok" };
  if (noiseDb <= -55) return { label: "Quiet room", advice: "Light noise reduction will take out what little there is.", noise: "light", tone: "ok" };
  if (noiseDb <= -45) return { label: "Some background noise", advice: "Use strong noise reduction, or turn off a fan or move closer to the microphone.", noise: "strong", tone: "warn" };
  return { label: "Noisy", advice: "Strong noise reduction will help, but the noise is close to your voice: find a quieter spot or move closer to the microphone.", noise: "strong", tone: "fail" };
}

/** Bluetooth headset microphones fall back to telephone quality while they are recording. */
export const isBluetoothMic = (label: string) => /hands-?free|headset|bluetooth|\bbt\b|airpods/i.test(label);

/** A peak this high is clipping, and clipping cannot be cleaned out afterwards. */
export const CLIP_DB = -1;
/** Speech peaking below this is too far from the microphone, and cleaning will lift the room with it. */
export const QUIET_DB = -30;

/** A name no other recording has: the kind, the beat and the moment. */
export const recordingName = (kind: "voice" | "take", beatId: string, now = Date.now(), ext = "webm") =>
  `${kind}-${beatId.replace(/[^\w-]/g, "")}-${now.toString(36)}.${ext}`;

/**
 * Whether another beat still plays a recording — a duplicated beat shares its files, so taking
 * the recording away from one must not throw the other's away.
 */
export function recordingInUse(beats: Beat[], file: string, except: string) {
  return beats.some((b) => b.id !== except && (b.voice?.file === file || b.take?.file === file));
}

export const formatSeconds = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** How far the microphone can be turned down or up before it is recorded, in dB. */
export const GAIN_MIN = -12;
export const GAIN_MAX = 24;
export const clampGain = (db: number) => Math.round(Math.max(GAIN_MIN, Math.min(GAIN_MAX, Number.isFinite(db) ? db : 0)));

/** Where Auto puts the loud moments of normal speech: clear of clipping, well above the room. */
export const AUTO_PEAK_DB = -6;

/**
 * The boost that puts speech where it should be, from the block peaks heard while the person
 * talked at the current boost. The loud moments decide — the 90th percentile of peaks, so one
 * shout or bump does not — and pauses are left out. Null when no voice was heard.
 */
export function autoGain(peaksDb: number[], currentDb: number): number | null {
  const voiced = peaksDb.filter((p) => p > -55).sort((a, b) => a - b);
  if (voiced.length < 10) return null;
  const loud = voiced[Math.floor(voiced.length * 0.9)];
  return clampGain(currentDb + AUTO_PEAK_DB - loud);
}

/**
 * The microphone turned up or down before anything hears it: the level meter, a voice and a
 * take all record `stream`, so what the meter shows is what is recorded. Web Audio passes
 * samples above full scale through, but the encoder clips them — the meter's clipping warning
 * is measured after the boost for that reason.
 */
export function boostedMic(mic: MediaStream, db: number) {
  const ctx = new AudioContext({ sampleRate: 48000 });
  const source = ctx.createMediaStreamSource(mic);
  const gain = ctx.createGain();
  gain.gain.value = 10 ** (clampGain(db) / 20);
  const out = ctx.createMediaStreamDestination();
  out.channelCount = 1;
  source.connect(gain).connect(out);
  return {
    ctx,
    node: gain,
    stream: out.stream,
    setGain: (next: number) => gain.gain.setTargetAtTime(10 ** (clampGain(next) / 20), ctx.currentTime, 0.02),
    close: () => { source.disconnect(); gain.disconnect(); void ctx.close(); },
  };
}

/** The boost remembered for a microphone. */
export const gainKey = (deviceId?: string) => `micGain:${deviceId || "default"}`;
