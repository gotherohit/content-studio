import assert from "node:assert/strict";
import { test } from "node:test";
import { codeHighlight, codeSourceFor, locateLines, selectedLines } from "../client/src/code.ts";
import type { Source } from "../client/src/types.ts";

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
