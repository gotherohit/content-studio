// How a recorded voice is cleaned: the presets, and the settings behind them.
//
// Shared by the server, which does the cleaning, and the recorder panel, which shows the
// settings — one definition, so a preset's sliders always show what the preset does.
//
// A tuning is every choice in the chain:
//   rumble    Hz below which rumble is filtered out (0 turns the filter off)
//   speech    share of the voice that may be the speech model's, 0–1: the model can take at
//             most that share of the level off a word, the rest is the recording as it was
//   pauseMix  the same share between words
//   pauseDb   how far pauses are turned down on top of that, in dB (0 to -60)
//   compress  how firmly loud and quiet words are brought together: a ratio, 1 is not at all
//   loudness  the finished loudness, in LUFS

export const LEVELS = ["off", "light", "strong", "custom"];

/**
 * These favour the voice on purpose. At full strength, on real takes in a noisy room, the
 * speech model pulled the voice's 3–8 kHz down by more than 6 dB in half of all speaking
 * moments — heard as words going dull. Light caps it at half (never more than 6 dB off a
 * word) and keeps a little of the room in the pauses, so the noise does not switch on and off
 * with the words; Strong gives the model 70 % and makes the pauses silent.
 */
export const PRESETS = {
  off: { rumble: 85, speech: 0, pauseMix: 0, pauseDb: 0, compress: 1, loudness: -16 },
  light: { rumble: 85, speech: 0.5, pauseMix: 0.8, pauseDb: -6, compress: 2.5, loudness: -16 },
  strong: { rumble: 85, speech: 0.7, pauseMix: 1, pauseDb: -30, compress: 2.5, loudness: -16 },
};

/** What a new custom tuning starts from, and what anything missing falls back to. */
export const DEFAULT_TUNING = PRESETS.light;

export const LIMITS = {
  rumble: [0, 200], speech: [0, 1], pauseMix: [0, 1], pauseDb: [-60, 0], compress: [1, 6], loudness: [-24, -12],
};

/** A saved tuning with anything missing, wrong or out of range put right. */
export function cleanTuning(saved) {
  const out = {};
  for (const key of Object.keys(LIMITS)) {
    const [lo, hi] = LIMITS[key];
    const value = Number(saved?.[key]);
    out[key] = saved?.[key] != null && saved[key] !== "" && Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : DEFAULT_TUNING[key];
  }
  // A filter this low does nothing a microphone can record; treat it as off.
  if (out.rumble < 20) out.rumble = 0;
  return out;
}

/** The tuning a level stands for; `custom` is the saved one. An unknown level is Light. */
export function tuningFor(level, custom) {
  if (level === "custom") return cleanTuning(custom);
  return PRESETS[level] ?? PRESETS.light;
}

export const sameTuning = (a, b) => Boolean(a && b) && Object.keys(LIMITS).every((key) => Math.abs(Number(a[key]) - Number(b[key])) < 1e-6);

/** A tuning as the short text an upload carries, and back. */
export const tuningText = (t) => Object.keys(LIMITS).map((key) => t[key]).join(",");
export function parseTuning(text) {
  const parts = String(text ?? "").split(",");
  const keys = Object.keys(LIMITS);
  if (parts.length !== keys.length) return null;
  return cleanTuning(Object.fromEntries(keys.map((key, i) => [key, parts[i]])));
}
