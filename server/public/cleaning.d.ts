export interface CleanTuning {
  /** Hz below which rumble is filtered out; 0 turns the filter off. */
  rumble: number;
  /** How far steady noise is turned down, by its spectrum, in dB; 0 is not at all. */
  staticDb: number;
  /** Share of the voice that may be the speech model's, 0–1. */
  speech: number;
  /** The same share between words. */
  pauseMix: number;
  /** How far pauses are turned down on top of that, in dB (0 to -60). */
  pauseDb: number;
  /** How firmly loud and quiet words are brought together: a ratio, 1 is not at all. */
  compress: number;
  /** The finished loudness, in LUFS. */
  loudness: number;
}
export type CleanLevel = "original" | "off" | "light" | "strong" | "custom";
export const LEVELS: CleanLevel[];
export const PRESETS: Record<"off" | "light" | "strong", CleanTuning>;
export const DEFAULT_TUNING: CleanTuning;
export const LIMITS: Record<keyof CleanTuning, [number, number]>;
export function cleanTuning(saved?: Partial<Record<keyof CleanTuning, unknown>> | null): CleanTuning;
export function tuningFor(level: string, custom?: Partial<CleanTuning> | null): CleanTuning;
export function sameTuning(a?: CleanTuning | null, b?: CleanTuning | null): boolean;
export function tuningText(t: CleanTuning): string;
export function parseTuning(text: unknown): CleanTuning | null;
