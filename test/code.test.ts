import assert from "node:assert/strict";
import { test } from "node:test";
import { codeHighlight, codeSourceFor, locateLines, renameCodeRefs, renamedPath, selectedLines } from "../client/src/code.ts";
import type { Beat, Source } from "../client/src/types.ts";

const file = ["import torch", "", "def train(model):", "    loss = step(model)", "    return loss", "", "def step(model):", "    return model()"].join("\n");

test("a selection's lines, not counting a line the selection only touches at its start", () => {
  const start = file.indexOf("def train");
  const end = file.indexOf("def step");
  assert.deepEqual(selectedLines(file, start, end), [3, 6]);
  assert.deepEqual(selectedLines(file, end, start), [3, 6]);
  assert.deepEqual(selectedLines(file, start, start + 3), [3, 3]);
});

test("a code highlight keeps its lines and the line either side", () => {
  const h = codeHighlight(file, [3, 5], "yellow", "h1");
  assert.equal(h.text, "def train(model):\n    loss = step(model)\n    return loss");
  assert.equal(h.prefix, "");
  assert.equal(h.suffix, "");
  assert.deepEqual(h.lines, [3, 5]);
});

test("a highlight moves with its code when lines are added above it", () => {
  const h = codeHighlight(file, [3, 5], "yellow", "h1");
  const edited = "# a new header\n# and another\n" + file;
  assert.deepEqual(locateLines(edited, h), { lines: [5, 7], found: true });
});

test("of several copies, the one nearest its old place and matching its neighbours wins", () => {
  const code = ["a", "x = 1", "b", "c", "x = 1", "d"].join("\n");
  const h = codeHighlight(code, [5, 5], "green", "h2");
  assert.deepEqual(locateLines(code, h), { lines: [5, 5], found: true });
  const shifted = "top\n" + code;
  assert.deepEqual(locateLines(shifted, h), { lines: [6, 6], found: true });
});

test("rewritten code falls back to the saved lines, flagged as not found, and never past the end", () => {
  const h = codeHighlight(file, [7, 8], "pink", "h3");
  assert.deepEqual(locateLines(file.replace("return model()", "return model(x)"), h), { lines: [7, 8], found: false });
  assert.deepEqual(locateLines("only\ntwo", h), { lines: [2, 2], found: false });
});

test("trailing spaces do not stop a highlight being found", () => {
  const h = codeHighlight(file, [4, 4], "blue", "h4");
  assert.deepEqual(locateLines(file.replace("step(model)", "step(model)   "), h)?.found, true);
});

test("a file's code source is found whatever the slashes or case", () => {
  const bs = String.fromCharCode(92);
  const s = { id: "c", kind: "code", code: { root: `D:${bs}Demo`, path: "src/train.py" } } as unknown as Source;
  assert.equal(codeSourceFor([s], "d:/demo", `SRC${bs}train.py`), s);
  assert.equal(codeSourceFor([s], `D:${bs}Demo`, "src/other.py"), undefined);
});

test("a renamed path: the file itself, something inside a renamed folder, or nothing", () => {
  assert.equal(renamedPath("src/train.py", "src/train.py", "src/fit.py"), "src/fit.py");
  assert.equal(renamedPath("src/models/train.py", "src", "lib"), "lib/models/train.py");
  assert.equal(renamedPath("SRC/train.py", "src", "lib"), "lib/train.py");
  assert.equal(renamedPath("src2/train.py", "src", "lib"), null);
  assert.equal(renamedPath("other.py", "src/train.py", "x.py"), null);
});

test("renaming a file takes its code source and every beat showing it along", () => {
  const code = (id: string, path: string, root = "D:/demo") => ({
    id, kind: "code", code: { root, path }, url: "", title: path, content: "", textContent: "", fetchedAt: "", highlights: [],
  } as unknown as Source);
  const web = { id: "w", url: "https://example.com", title: "web", content: "", textContent: "", fetchedAt: "", highlights: [] } as Source;
  const beat = (id: string, path: string) => ({
    id, point: id, createdAt: "", stage: { preset: "1", panes: [{ kind: "files" }], views: { 0: { code: { root: "D:/demo", path, line: 4, sel: [3, 5], focus: true } } }, split: 50, rowSplit: 50, activeSourceId: null, highlightId: null, viewMode: "original" },
  } as unknown as Beat);
  const project = {
    sources: [code("a", "src/train.py"), code("b", "src/util.py"), code("c", "src/train.py", "E:/other"), web],
    beats: [beat("one", "src/train.py"), beat("two", "notes.md")],
  };
  const next = renameCodeRefs(project, "d:/demo", "src", "lib");
  assert.deepEqual(next.sources.map((s) => s.code?.path ?? s.url), ["lib/train.py", "lib/util.py", "src/train.py", "https://example.com"]);
  assert.equal(next.sources[0].title, "lib/train.py");
  assert.equal(next.sources[3], web);
  assert.deepEqual(next.beats[0].stage.views[0].code, { root: "D:/demo", path: "lib/train.py", line: 4, sel: [3, 5], focus: true });
  assert.equal(next.beats[1], project.beats[1]);
});

test("a file renamed onto the name of an older code source merges into it, links and beats included", () => {
  const hl = (id: string) => ({ id, text: id, prefix: "", suffix: "", color: "yellow", comment: "", createdAt: "", lines: [1, 1] });
  const code = (id: string, path: string, highlights: string[]) => ({
    id, kind: "code", code: { root: "D:/demo", path }, url: "", title: path, content: "", textContent: "", fetchedAt: "", highlights: highlights.map(hl),
  } as unknown as Source);
  const stale = code("stale", "lib/fit.py", ["h1"]);
  const moving = code("moving", "src/train.py", ["h2"]);
  const beat = { id: "b", point: "", createdAt: "", stage: {
    preset: "2", panes: [{ kind: "source", sourceId: "moving" }, { kind: "files" }],
    views: { 0: { sourceId: "moving" }, 1: { code: { root: "D:/demo", path: "src/train.py", line: 1 } } },
    split: 50, rowSplit: 50, activeSourceId: "moving", highlightId: null, viewMode: "original",
  } } as unknown as Beat;
  const project = {
    sources: [stale, moving],
    beats: [beat],
    links: [{ id: "l", from: { sourceId: "moving", highlightId: "h2" }, to: { sourceId: "stale" }, relation: "related" as const, createdAt: "" }],
  };
  const next = renameCodeRefs(project, "D:/demo", "src/train.py", "lib/fit.py");
  assert.deepEqual(next.sources.map((s) => s.id), ["stale"]);
  assert.deepEqual(next.sources[0].highlights.map((h) => h.id), ["h1", "h2"]);
  assert.deepEqual(next.links[0].from, { sourceId: "stale", highlightId: "h2" });
  const stage = next.beats[0].stage;
  assert.equal(stage.activeSourceId, "stale");
  assert.equal(stage.panes[0].sourceId, "stale");
  assert.equal(stage.views[0].sourceId, "stale");
  assert.equal(stage.views[1].code?.path, "lib/fit.py");
  // The project the caller still holds is untouched.
  assert.deepEqual(stale.highlights.map((h) => h.id), ["h1"]);
  assert.equal(project.sources.length, 2);
});
