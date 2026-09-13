import assert from "node:assert/strict";
import { test } from "node:test";
import { duplicateBeat, insertBeatAfter, moveBeatInList } from "../client/src/beats.ts";
import type { Beat } from "../client/src/types.ts";

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
