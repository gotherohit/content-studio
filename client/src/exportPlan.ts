import type { Beat, ExportSettings, Source, Stage, TransitionKind, VerticalFrame } from "./types";
import { timeline } from "../../server/public/export-timing.js";

export const DEFAULT_EXPORT: ExportSettings = {
  format: "video", shape: "landscape", quality: 1080, fps: 30,
  seconds: 5, transition: "fade", transitionSeconds: 0.6, settle: 3,
  folder: "", name: "", takeFraming: "fit",
};

export const TRANSITIONS: { id: TransitionKind; label: string }[] = [
  { id: "cut", label: "Cut" },
  { id: "fade", label: "Cross-fade" },
  { id: "fadeblack", label: "Fade through black" },
  { id: "dissolve", label: "Dissolve" },
  { id: "slideleft", label: "Slide left" },
  { id: "slideup", label: "Slide up" },
  { id: "wipeleft", label: "Wipe" },
  { id: "smoothleft", label: "Smooth wipe" },
  { id: "circleopen", label: "Circle open" },
  { id: "zoomin", label: "Zoom in" },
  { id: "pixelize", label: "Pixelate" },
];

const QUALITIES = [1080, 1440, 2160] as const;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Saved choices, with anything missing or no longer valid put back to its default. */
export function exportSettings(saved?: Partial<ExportSettings>): ExportSettings {
  const s = { ...DEFAULT_EXPORT, ...(saved ?? {}) };
  return {
    ...s,
    format: s.format === "pdf" ? "pdf" : "video",
    shape: s.shape === "vertical" ? "vertical" : "landscape",
    quality: (QUALITIES as readonly number[]).includes(s.quality) ? s.quality : 1080,
    fps: s.fps === 60 ? 60 : 30,
    seconds: Number.isFinite(s.seconds) ? clamp(s.seconds, 0.5, 600) : DEFAULT_EXPORT.seconds,
    transition: TRANSITIONS.some((t) => t.id === s.transition) ? s.transition : DEFAULT_EXPORT.transition,
    transitionSeconds: Number.isFinite(s.transitionSeconds) ? clamp(s.transitionSeconds, 0.1, 3) : DEFAULT_EXPORT.transitionSeconds,
    settle: Number.isFinite(s.settle) ? clamp(s.settle, 1, 30) : DEFAULT_EXPORT.settle,
    takeFraming: s.takeFraming === "fill" ? "fill" : "fit",
  };
}

/** Output pixels: 1080 is 1920 × 1080 on its side, 1080 × 1920 upright. */
export function outputSize(shape: ExportSettings["shape"], quality: number) {
  const long = Math.round((quality * 16) / 9);
  return shape === "vertical" ? { width: quality, height: long } : { width: long, height: quality };
}

/**
 * The layout an export is rendered at: the largest 16:9 box that fits the window. Beats are
 * built on this screen, so a layout of the same size keeps every pane and paragraph where the
 * creator put it; only the resolution it is drawn at changes.
 */
export function exportViewport(width: number, height: number) {
  const byWidth = { width: Math.round(width), height: Math.round((width * 9) / 16) };
  return byWidth.height <= height ? byWidth : { width: Math.round((height * 16) / 9), height: Math.round(height) };
}

/** A vertical frame's width, as a fraction of the screen's, for a height given as a fraction of its height. */
export const frameWidth = (h: number, viewport: { width: number; height: number }) => (h * viewport.height * 9) / 16 / viewport.width;

export const MIN_FRAME = 0.3;

/** Kept 9:16, no smaller than a third of the screen's height, and wholly on the screen. */
export function clampFrame(frame: VerticalFrame, viewport: { width: number; height: number }): VerticalFrame {
  const h = clamp(Number.isFinite(frame.h) ? frame.h : 1, MIN_FRAME, 1);
  const w = frameWidth(h, viewport);
  return { x: clamp(frame.x, 0, Math.max(0, 1 - w)), y: clamp(frame.y, 0, 1 - h), h };
}

export const centredFrame = (viewport: { width: number; height: number }): VerticalFrame =>
  clampFrame({ x: (1 - frameWidth(1, viewport)) / 2, y: 0, h: 1 }, viewport);

export const MAX_ZOOM = 4;

/**
 * How far the window is zoomed while it is captured, so the part that is kept has at least
 * the output's pixels: the whole screen for a landscape export, the smallest frame for a
 * vertical one. More than four times over asks too much of the graphics card for too little.
 */
export function captureZoom(settings: Pick<ExportSettings, "shape" | "quality">, viewport: { width: number; height: number }, frames: VerticalFrame[]) {
  const out = outputSize(settings.shape, settings.quality);
  if (settings.shape === "landscape") return clamp(out.width / viewport.width, 1, MAX_ZOOM);
  const smallest = Math.min(1, ...frames.map((f) => f.h));
  return clamp(out.height / (smallest * viewport.height), 1, MAX_ZOOM);
}

/** The video sources a beat puts on screen, with the second each was paused at. */
/**
 * Where an area of the page is in a take's recorded picture, as fractions of it from the
 * top-left corner. A take records the whole window: `viewport` is the area wanted — the whole
 * `page` for a take — both in CSS pixels, against the top-left corner. The capture either scales the page
 * to fill its frame — the frame then has the page's shape — or copies it pixel for pixel into a
 * larger frame and fills the rest with black, which a 0.35.0 take on a 1913 × 1010 window did in
 * a 1920 × 1080 frame. Either way the page starts at the frame's corner.
 */
export function takeCrop(viewport: { width: number; height: number }, page: { width: number; height: number }, frame: { width: number; height: number }, pixelRatio: number) {
  const scaled = Math.abs(frame.width / frame.height - page.width / page.height) < 0.01;
  const w = scaled ? viewport.width / page.width : (viewport.width * pixelRatio) / frame.width;
  const h = scaled ? viewport.height / page.height : (viewport.height * pixelRatio) / frame.height;
  return { w: Math.min(1, w), h: Math.min(1, h) };
}

/**
 * The second a pane's video is at, for a beat being captured: what the pane last reported, if
 * it reported it for this source, otherwise what the beat already had. A pane with no source
 * and no report has neither — both are undefined, and must not count as a match.
 */
export function capturedVideoTime(live: { sourceId: string; time: number } | undefined, sourceId: string | undefined, saved?: number) {
  return live && sourceId && live.sourceId === sourceId ? live.time : saved;
}

export function beatVideos(stage: Stage, sources: Source[]): { pane: number; name: string; start: number }[] {
  return stage.panes.flatMap((pane, i) => {
    if (pane.kind !== "source") return [];
    const view = stage.views?.[i];
    const id = view?.sourceId ?? pane.sourceId ?? stage.activeSourceId;
    const source = sources.find((s) => s.id === id);
    if (source?.kind !== "file" || source.file?.viewer !== "video") return [];
    return [{ pane: i, name: source.file.name, start: Math.max(0, view?.videoTime ?? 0) }];
  });
}

/**
 * How long a beat is on screen and how it arrives. A beat that shows a video plays the rest of
 * it unless told otherwise — the point of putting a video in a beat is to play it.
 */
export function beatTiming(beat: Beat, settings: ExportSettings, sources: Source[], lengths: Record<string, number | null | undefined>) {
  const rest = beatVideos(beat.stage, sources)
    .map((v) => (lengths[v.name] ?? 0) - v.start)
    .filter((n) => n > 0.2);
  const own = beat.export?.seconds;
  const seconds = own && own > 0 ? own : rest.length ? Math.round(Math.max(...rest) * 10) / 10 : settings.seconds;
  return { seconds: clamp(seconds, 0.5, 3600), transition: beat.export?.transition ?? settings.transition, fromVideo: !own && rest.length > 0 };
}

/** A breath after the last word, so a beat does not cut away the moment the voice stops. */
export const VOICE_TAIL = 0.4;

export type TimedBy = "own" | "take" | "voice" | "video" | "hold";

/**
 * Every beat's length and how it arrives, with its recordings taken into account. A take is
 * the beat, so it lasts exactly as long. Narration decides a beat's length too, and it is
 * delayed by the transition coming in and given room for the one going out: both overlap the
 * beat, and a word said during a cross-fade is half-heard.
 */
export function beatTimings(beats: Beat[], settings: ExportSettings, sources: Source[], lengths: Record<string, number | null | undefined>) {
  const base = beats.map((b) => beatTiming(b, settings, sources, lengths));
  return base.map((t, i) => {
    const beat = beats[i];
    const into = i > 0 && t.transition !== "cut" ? settings.transitionSeconds : 0;
    const next = base[i + 1];
    const out = next && next.transition !== "cut" ? settings.transitionSeconds : 0;
    const voiceDelay = beat.voice && !(beat.take && !beat.take.muted) ? into : 0;
    if (beat.export?.seconds && beat.export.seconds > 0) return { ...t, voiceDelay, by: "own" as TimedBy };
    if (beat.take) return { ...t, seconds: beat.take.seconds, fromVideo: false, voiceDelay, by: "take" as TimedBy };
    if (beat.voice) {
      const seconds = Math.round((into + beat.voice.seconds + Math.max(VOICE_TAIL, out + 0.2)) * 10) / 10;
      return { ...t, seconds, fromVideo: false, voiceDelay, by: "voice" as TimedBy };
    }
    return { ...t, voiceDelay, by: (t.fromVideo ? "video" : "hold") as TimedBy };
  });
}

/** The finished video's length, transitions taken out. */
export const exportLength = (timings: { seconds: number; transition: TransitionKind }[], transitionSeconds: number) =>
  timeline(timings, transitionSeconds).total;

export const formatLength = (seconds: number) => {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Where a video's picture is inside its element: `object-fit: contain` letterboxes it, and
 * only the picture itself is replaced by the playing clip.
 */
export function containedBox(box: { x: number; y: number; w: number; h: number }, media: { width: number; height: number }) {
  if (!media.width || !media.height || !box.w || !box.h) return box;
  const scale = Math.min(box.w / media.width, box.h / media.height);
  const w = media.width * scale, h = media.height * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}
