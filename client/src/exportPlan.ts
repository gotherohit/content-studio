import type { Beat, ExportSettings, Source, Stage, TransitionKind, VerticalFrame } from "./types";
import { timeline } from "../../server/public/export-timing.js";

export const DEFAULT_EXPORT: ExportSettings = {
  format: "video", shape: "landscape", quality: 1080, fps: 30,
  seconds: 5, transition: "fade", transitionSeconds: 0.6, settle: 3,
  folder: "", name: "",
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
