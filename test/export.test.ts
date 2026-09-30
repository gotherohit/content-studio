import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_EXPORT, beatTiming, beatVideos, captureZoom, centredFrame, clampFrame, containedBox, exportLength,
  exportSettings, exportViewport, formatLength, frameWidth, MAX_ZOOM, MIN_FRAME, outputSize,
} from "../client/src/exportPlan.ts";
import { timeline, transitionLength } from "../server/public/export-timing.js";
import type { Beat, Source, Stage } from "../client/src/types.ts";

const screen = { width: 1584, height: 891 };

const video = (id: string, name: string): Source => ({
  id, kind: "file", file: { name, ext: ".mp4", size: 1, viewer: "video" }, url: `/x/${name}`, title: name,
  content: "", textContent: "", fetchedAt: "", highlights: [],
});
const article: Source = { id: "web", url: "https://example.com", title: "Article", content: "", textContent: "", fetchedAt: "", highlights: [] };
const stage = (panes: Stage["panes"], views: Stage["views"], activeSourceId: string | null = null): Stage => ({
  preset: "2", panes, views, split: 50, rowSplit: 50, activeSourceId, highlightId: null, viewMode: "original",
});
const beat = (s: Stage, exp?: Beat["export"]): Beat => ({ id: Math.random().toString(36), point: "", stage: s, createdAt: "", ...(exp ? { export: exp } : {}) });

test("saved export choices are kept, and anything unusable falls back to a default", () => {
  assert.deepEqual(exportSettings(undefined), DEFAULT_EXPORT);
  const s = exportSettings({ quality: 1440, shape: "vertical", fps: 60, transition: "zoomin", seconds: 8 });
  assert.equal(s.quality, 1440);
  assert.equal(s.shape, "vertical");
  assert.equal(s.fps, 60);
  assert.equal(s.transition, "zoomin");
  assert.equal(s.seconds, 8);
  const bad = exportSettings({ quality: 720 as never, fps: 24 as never, transition: "spin" as never, seconds: Number.NaN, transitionSeconds: 99, settle: 0 });
  assert.equal(bad.quality, 1080);
  assert.equal(bad.fps, 30);
  assert.equal(bad.transition, DEFAULT_EXPORT.transition);
  assert.equal(bad.seconds, DEFAULT_EXPORT.seconds);
  assert.equal(bad.transitionSeconds, 3);
  assert.equal(bad.settle, 1);
});

test("outputs are YouTube's standard sizes, on their side or upright", () => {
  assert.deepEqual(outputSize("landscape", 1080), { width: 1920, height: 1080 });
  assert.deepEqual(outputSize("landscape", 1440), { width: 2560, height: 1440 });
  assert.deepEqual(outputSize("landscape", 2160), { width: 3840, height: 2160 });
  assert.deepEqual(outputSize("vertical", 1080), { width: 1080, height: 1920 });
  assert.deepEqual(outputSize("vertical", 2160), { width: 2160, height: 3840 });
});

test("an export keeps the layout of the screen the beats were built on, cut to 16:9", () => {
  assert.deepEqual(exportViewport(1584, 961), { width: 1584, height: 891 });
  // A wide, short window is limited by its height instead.
  assert.deepEqual(exportViewport(2400, 900), { width: 1600, height: 900 });
});

test("the window is zoomed until the part that is kept has the output's pixels", () => {
  assert.equal(captureZoom({ shape: "landscape", quality: 1080 }, screen, []), 1920 / 1584);
  assert.equal(captureZoom({ shape: "landscape", quality: 2160 }, screen, []), 3840 / 1584);
  // Vertical: the smallest frame decides, so every beat is captured sharp enough.
  assert.equal(captureZoom({ shape: "vertical", quality: 1080 }, screen, [{ x: 0, y: 0, h: 1 }]), 1920 / 891);
  assert.equal(captureZoom({ shape: "vertical", quality: 1080 }, screen, [{ x: 0, y: 0, h: 1 }, { x: 0, y: 0, h: 0.6 }]), 1920 / (0.6 * 891));
  assert.equal(captureZoom({ shape: "vertical", quality: 2160 }, screen, [{ x: 0, y: 0, h: 0.3 }]), MAX_ZOOM);
  // Never below 1: a small window is not rendered smaller than it is.
  assert.equal(captureZoom({ shape: "landscape", quality: 1080 }, { width: 2560, height: 1440 }, []), 1);
});

test("a vertical frame is 9:16, stays on the screen, and cannot shrink to nothing", () => {
  const w = frameWidth(1, screen);
  assert.ok(Math.abs((w * screen.width) / screen.height - 9 / 16) < 1e-9);
  const centred = centredFrame(screen);
  assert.ok(Math.abs(centred.x + w / 2 - 0.5) < 1e-9);
  assert.equal(centred.y, 0);
  assert.equal(centred.h, 1);
  const off = clampFrame({ x: 0.95, y: 0.9, h: 0.5 }, screen);
  assert.ok(off.x + frameWidth(off.h, screen) <= 1 + 1e-9);
  assert.equal(off.y, 0.5);
  assert.equal(clampFrame({ x: 0, y: 0, h: 0.05 }, screen).h, MIN_FRAME);
  assert.equal(clampFrame({ x: -1, y: -1, h: 3 }, screen).h, 1);
  assert.equal(clampFrame({ x: -1, y: -1, h: 3 }, screen).x, 0);
});

test("a beat's videos are the video sources in its Source panes, from the second they were paused at", () => {
  const sources = [article, video("v1", "clip.mp4"), video("v2", "talk.mov")];
  const s = stage(
    [{ kind: "source" }, { kind: "source", sourceId: "v2" }, { kind: "notes" }],
    { 0: { sourceId: "v1", videoTime: 12.5 }, 1: { sourceId: "v2" } },
  );
  assert.deepEqual(beatVideos(s, sources), [{ pane: 0, name: "clip.mp4", start: 12.5 }, { pane: 1, name: "talk.mov", start: 0 }]);
  // An article, or a pane following the selection onto an article, plays nothing.
  assert.deepEqual(beatVideos(stage([{ kind: "source" }], {}, "web"), sources), []);
  // A pane that follows the selection uses the beat's selected source.
  assert.deepEqual(beatVideos(stage([{ kind: "source" }], {}, "v1"), sources), [{ pane: 0, name: "clip.mp4", start: 0 }]);
});

test("a beat with a video plays the rest of it; one without is held for the chosen time", () => {
  const sources = [article, video("v1", "clip.mp4")];
  const settings = exportSettings({ seconds: 4, transition: "fade" });
  const withClip = beat(stage([{ kind: "source" }], { 0: { sourceId: "v1", videoTime: 5 } }));
  assert.deepEqual(beatTiming(withClip, settings, sources, { "clip.mp4": 20 }), { seconds: 15, transition: "fade", fromVideo: true });
  // Its own length wins, and so does its own transition.
  assert.deepEqual(beatTiming(beat(withClip.stage, { seconds: 6, transition: "cut" }), settings, sources, { "clip.mp4": 20 }), { seconds: 6, transition: "cut", fromVideo: false });
  // Unknown length, or a clip paused at its end, falls back to the hold time.
  assert.equal(beatTiming(withClip, settings, sources, {}).seconds, 4);
  assert.equal(beatTiming(beat(stage([{ kind: "source" }], { 0: { sourceId: "v1", videoTime: 20 } })), settings, sources, { "clip.mp4": 20 }).seconds, 4);
  assert.equal(beatTiming(beat(stage([{ kind: "source" }], { 0: { sourceId: "web" } })), settings, sources, {}).seconds, 4);
});

test("a transition overlaps the beats it joins, and never takes more than half of either", () => {
  assert.equal(transitionLength("cut", 1, 5, 5), 0);
  assert.equal(transitionLength("fade", 0.6, 5, 5), 0.6);
  assert.equal(transitionLength("fade", 3, 2, 5), 1);
  const t = timeline([{ seconds: 5, transition: "fade" }, { seconds: 4, transition: "fade" }, { seconds: 3, transition: "cut" }], 1);
  assert.deepEqual(t.overlaps, [0, 1, 0]);
  assert.deepEqual(t.starts, [0, 4, 8]);
  assert.equal(t.total, 11);
  assert.equal(exportLength([{ seconds: 5, transition: "fade" }, { seconds: 4, transition: "fade" }], 1), 8);
  assert.equal(formatLength(83.4), "1:23");
});

test("only a video's picture is replaced by the clip, not the letterbox around it", () => {
  assert.deepEqual(containedBox({ x: 0, y: 0, w: 400, h: 400 }, { width: 1280, height: 720 }), { x: 0, y: 87.5, w: 400, h: 225 });
  assert.deepEqual(containedBox({ x: 10, y: 20, w: 160, h: 90 }, { width: 1920, height: 1080 }), { x: 10, y: 20, w: 160, h: 90 });
  // Before its metadata arrives, the element's box is all there is.
  assert.deepEqual(containedBox({ x: 1, y: 2, w: 3, h: 4 }, { width: 0, height: 0 }), { x: 1, y: 2, w: 3, h: 4 });
});

// A pane with no source and no reported time made `undefined?.sourceId === undefined` a match,
// and saving a beat in a project without sources failed with "reading 'time'".
test("a beat's video time comes only from a report for its own source", async () => {
  const { capturedVideoTime } = await import("../client/src/exportPlan.ts");
  assert.equal(capturedVideoTime(undefined, undefined, undefined), undefined);
  assert.equal(capturedVideoTime(undefined, "s1", 4), 4);
  assert.equal(capturedVideoTime({ sourceId: "s1", time: 9 }, "s1", 4), 9);
  assert.equal(capturedVideoTime({ sourceId: "s2", time: 9 }, "s1", 4), 4);
});
