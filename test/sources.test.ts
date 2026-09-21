import assert from "node:assert/strict";
import { test } from "node:test";
import { adoptFiles } from "../client/src/sources.ts";
import type { Source, SourceFile } from "../client/src/types.ts";

const file = (name: string): SourceFile => ({ name, ext: ".md", size: 10, viewer: "markdown" });
const fileSource = (id: string, name: string): Source => ({
  id, kind: "file", file: file(name), url: "", title: name,
  content: "", textContent: "", fetchedAt: "2026-01-01", highlights: [],
});
const webSource = (id: string): Source => ({
  id, url: `https://example.com/${id}`, title: id,
  content: "", textContent: "", fetchedAt: "2026-01-01", highlights: [],
});
const make = (f: SourceFile, i: number): Source => fileSource(`new${i}`, f.name);

test("a file already in the project is not adopted a second time", () => {
  const sources = [fileSource("f1", "note.md"), webSource("w1")];
  assert.equal(adoptFiles(sources, [file("note.md")], make), null, "nothing changed, so nothing is written");
});

test("a file dropped into the folder becomes a source", () => {
  const next = adoptFiles([webSource("w1")], [file("slides.md")], make);
  assert.deepEqual(next?.map((s) => s.title), ["w1", "slides.md"]);
});

test("a file that has gone takes its source with it, and nothing else", () => {
  const sources = [fileSource("f1", "note.md"), webSource("w1"), { ...webSource("c1"), kind: "code" as const, code: { root: "D:/repo", path: "train.py" } }];
  const next = adoptFiles(sources, [], make);
  assert.deepEqual(next?.map((s) => s.id), ["w1", "c1"], "a code source points outside the project and is never dropped");
});

test("a removed source does not come back while its file is gone too", () => {
  // What the bug was: the source was taken out of the project but its file stayed in the
  // folder, so opening the project adopted it again — with a new id, and its highlights lost.
  const after = adoptFiles([], [], make);
  assert.equal(after, null);
});
