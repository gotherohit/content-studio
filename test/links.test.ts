import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGraph, layoutGraph, linksFor, pruneLinks, type SourceLink } from "../client/src/links.ts";
import type { Source } from "../client/src/types.ts";

const source = (id: string, highlights: string[] = [], extra: Partial<Source> = {}): Source => ({
  id, url: `https://example.com/${id}`, title: id, content: "", textContent: "", fetchedAt: "2026-01-01",
  highlights: highlights.map((h) => ({ id: h, text: h, prefix: "", suffix: "", color: "yellow", comment: "", createdAt: "2026-01-01" })),
  ...extra,
});
const link = (id: string, from: string, to: string, relation: SourceLink["relation"] = "supports", fromHl?: string, toHl?: string): SourceLink => ({
  id, from: { sourceId: from, highlightId: fromHl }, to: { sourceId: to, highlightId: toHl }, relation, createdAt: "2026-01-01",
});

test("a source lists its own links and the backlinks pointing at it", () => {
  const links = [link("1", "report", "paper"), link("2", "blog", "report", "contradicts"), link("3", "blog", "paper")];
  const { outgoing, incoming } = linksFor(links, "report");
  assert.deepEqual(outgoing.map((l) => l.id), ["1"]);
  assert.deepEqual(incoming.map((l) => l.id), ["2"]);
});

test("deleting a source removes its links; deleting a highlight keeps the link to the whole source", () => {
  const sources = [source("report", ["claim"]), source("paper", [])];
  const links = [link("1", "report", "paper", "supports", "claim"), link("2", "report", "gone"), link("3", "report", "paper", "cites", "deleted-hl")];
  const pruned = pruneLinks(links, sources);
  assert.deepEqual(pruned.map((l) => l.id), ["1", "3"]);
  assert.equal(pruned[0], links[0]);
  assert.deepEqual(pruned[1].from, { sourceId: "report" });
  // Nothing to change returns the same list, so a save is not triggered for nothing.
  assert.equal(pruneLinks(pruned, sources), pruned);
});

test("the map has one node per source and merges links of one kind between the same pair", () => {
  const sources = [source("report", ["a", "b"]), source("paper"), source("docs", [], { from: "report" }), source("alone")];
  const links = [link("1", "report", "paper", "supports", "a"), link("2", "report", "paper", "supports", "b"), link("3", "report", "paper", "contradicts"), link("4", "report", "missing")];
  const { nodes, edges } = buildGraph(sources, links);
  assert.deepEqual(nodes.map((n) => n.id), ["report", "paper", "docs", "alone"]);
  assert.deepEqual(edges.map((e) => `${e.key}#${e.links.length}`).sort(), ["docs>report:opened#0", "report>paper:contradicts#1", "report>paper:supports#2"]);
  assert.equal(nodes.find((n) => n.id === "report")!.weight, 2 + 3);
});

test("the layout is deterministic, fits the frame and keeps linked sources closer than unlinked ones", () => {
  const sources = ["a", "b", "c", "d", "e", "f"].map((id) => source(id));
  const { nodes, edges } = buildGraph(sources, [link("1", "a", "b"), link("2", "b", "c"), link("3", "a", "c")]);
  const one = layoutGraph(nodes, edges);
  assert.deepEqual(layoutGraph(nodes, edges), one);
  for (const p of Object.values(one)) {
    assert.ok(p.x >= -1e-9 && p.x <= 1 + 1e-9 && p.y >= -1e-9 && p.y <= 1 + 1e-9);
  }
  const dist = (x: string, y: string) => Math.hypot(one[x].x - one[y].x, one[x].y - one[y].y);
  assert.ok(dist("a", "b") < dist("a", "f"));
  assert.ok(Object.values(one).every((p, i, all) => all.every((q, j) => i === j || Math.hypot(p.x - q.x, p.y - q.y) > 0.05)));
});

test("an empty or single-source project still lays out", () => {
  assert.deepEqual(layoutGraph([], []), {});
  assert.deepEqual(layoutGraph([{ id: "a", title: "a", file: false, weight: 0 }], []), { a: { x: 0.5, y: 0.5 } });
});

test("a source with no links does not squeeze the connected ones into a corner", () => {
  const ids = ["report", "paper", "blog", "news", "docs", "tweet", "deck"];
  const sources = ids.map((id) => source(id, [], id === "docs" ? { from: "news" } : {}));
  const links = [link("1", "blog", "report", "contradicts"), link("2", "tweet", "report"), link("3", "report", "paper", "cites"), link("4", "news", "report", "related"), link("5", "paper", "report", "same")];
  const { nodes, edges } = buildGraph(sources, links);
  const at = layoutGraph(nodes, edges);
  const linked = ids.filter((id) => id !== "deck").map((id) => at[id]);
  const width = Math.max(...linked.map((p) => p.x)) - Math.min(...linked.map((p) => p.x));
  const height = Math.max(...linked.map((p) => p.y)) - Math.min(...linked.map((p) => p.y));
  assert.ok(Math.max(width, height) > 0.8, `connected sources span ${width.toFixed(2)} × ${height.toFixed(2)}`);
});
