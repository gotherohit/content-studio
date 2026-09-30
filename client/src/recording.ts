import type { Beat, NoiseReduction } from "./types";

/** The silent lead-in every recording starts with: the room, for the cleaning to learn. */
export const LEAD_SECONDS = 1;

/**
 * What the microphone is asked for. The browser's own echo cancelling, noise suppression and
 * automatic gain are all off: they are built for calls, pump the level and smear the voice,
 * and the cleaning afterwards does a better job with the room sample in hand.
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
export const recordingName = (kind: "voice" | "take", beatId: string, now = Date.now()) =>
  `${kind}-${beatId.replace(/[^\w-]/g, "")}-${now.toString(36)}.webm`;

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
