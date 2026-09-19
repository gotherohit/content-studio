import assert from "node:assert/strict";
import { test } from "node:test";
import { captureSummary, duplicateBeat, insertBeatAfter, moveBeatInList } from "../client/src/beats.ts";
import type { Beat, Source } from "../client/src/types.ts";

const makeBeat = (id: string): Beat => ({
  id, point: id, script: "Keep this script", createdAt: "2026-01-01",
  stage: { preset: "1", panes: [{ kind: "source" }], views: { 0: { sourceId: "article", position: { x: 0, y: 500 } } }, split: 58, rowSplit: 50, activeSourceId: "article", highlightId: null, viewMode: "reader" },
});

test("moving another beat preserves the identity of the current beat", () => {
  const beats = [makeBeat("hook"), makeBeat("evidence"), makeBeat("conclusion")];
  const active = "evidence";
  const next = moveBeatInList(beats, "hook", 2);
  assert.equal(next.findIndex((beat) => beat.id === active), 0);
  assert.equal(next[0], beats[1]);
  assert.deepEqual(beats.map((beat) => beat.id), ["hook", "evidence", "conclusion"]);
});

test("a new beat is inserted after the current beat, or appended without a selection", () => {
  const beats = [makeBeat("hook"), makeBeat("conclusion")];
  assert.deepEqual(insertBeatAfter(beats, "hook", makeBeat("evidence")).map((b) => b.id), ["hook", "evidence", "conclusion"]);
  assert.deepEqual(insertBeatAfter(beats, null, makeBeat("credits")).map((b) => b.id), ["hook", "conclusion", "credits"]);
});

test("duplicating preserves script and references but independently copies the arrangement", () => {
  const original = makeBeat("evidence");
  const copy = duplicateBeat(original, "copy");
  assert.equal(copy.script, original.script);
  assert.equal(copy.stage.activeSourceId, original.stage.activeSourceId);
  copy.stage.views[0].position!.y = 900;
  copy.stage.panes[0].kind = "canvas";
  assert.equal(original.stage.views[0].position!.y, 500);
  assert.equal(original.stage.panes[0].kind, "source");
  assert.equal(copy.id, "copy");
});

test("out-of-range and missing beat moves leave the sequence unchanged", () => {
  const beats = [makeBeat("hook")];
  assert.equal(moveBeatInList(beats, "hook", -1), beats);
  assert.equal(moveBeatInList(beats, "hook", 1), beats);
  assert.equal(moveBeatInList(beats, "missing", 0), beats);
});

const article = (id: string, kind?: "file"): Source => ({ id, kind, url: `https://example.com/${id}`, title: id, content: "", textContent: "", fetchedAt: "2026-01-01", highlights: [] });

test("a capture says where each article pane is, including a browsed page", () => {
  const stage = { ...makeBeat("a").stage, panes: [{ kind: "source" as const }, { kind: "source" as const, sourceId: "docs" }],
    views: { 0: { sourceId: "article", position: { x: 0, y: 900, text: "GTG-16008: Distillation campaign by a laboratory" } }, 1: { sourceId: "docs", page: "https://example.com/docs/quickstart", position: { x: 0, y: 0 } } } };
  const summary = captureSummary(stage, stage.panes, [article("article"), article("docs")]);
  assert.deepEqual(summary.unplaced, []);
  assert.equal(summary.where, "pane 1 at “GTG-16008: Distillation campaign by a la…”, pane 2 at the top of /docs/quickstart");
});

test("a capture names an article pane that had not reported its place, and ignores other panes", () => {
  const stage = { ...makeBeat("a").stage, panes: [{ kind: "source" as const }, { kind: "notes" as const }, { kind: "source" as const, sourceId: "deck" }],
    views: { 0: { sourceId: "article" }, 1: {}, 2: { sourceId: "deck" } } };
  const summary = captureSummary(stage, stage.panes, [article("article"), article("deck", "file")]);
  assert.deepEqual(summary.unplaced, [0]);
  assert.equal(summary.where, null);
});

test("a capture names the file and lines a Files pane shows", () => {
  const stage = { ...makeBeat("a").stage, panes: [{ kind: "files" as const }],
    views: { 0: { code: { root: "D:/demo", path: "src/train.py", line: 1, sel: [3, 5] as [number, number], focus: true } } } };
  assert.equal(captureSummary(stage, stage.panes, []).where, "train.py at lines 3–5, focused");
  const scrolled = { ...stage, views: { 0: { code: { root: "D:/demo", path: "utils.py", line: 56 } } } };
  assert.equal(captureSummary(scrolled, stage.panes, []).where, "utils.py at line 56");
  const windows = { ...stage, views: { 0: { code: { root: "D:/demo", path: ["src", "model.py"].join(String.fromCharCode(92)), line: 2 } } } };
  assert.equal(captureSummary(windows, stage.panes, []).where, "model.py at line 2");
});
