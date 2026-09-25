import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGraph, graphNeighborhood, graphPathMarkdown, layoutGraph, linkedPassages, linksFor, linksOf, otherEnd, passageEdges, pruneLinks, shortestGraphPath, type SourceLink } from "../client/src/links.ts";
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

test("a link within one source is kept, but the map has no edge for it", () => {
  const sources = [
    { id: "a", title: "One", kind: "web", highlights: [{ id: "h1" }, { id: "h2" }] },
    { id: "b", title: "Two", kind: "web", highlights: [] },
  ] as unknown as Source[];
  const links = [
    { id: "l1", from: { sourceId: "a", highlightId: "h1" }, to: { sourceId: "a", highlightId: "h2" }, relation: "supports", createdAt: "" },
    { id: "l2", from: { sourceId: "a", highlightId: "h1" }, to: { sourceId: "b" }, relation: "cites", createdAt: "" },
  ] as unknown as SourceLink[];
  assert.equal(pruneLinks(links, sources).length, 2);
  const graph = buildGraph(sources, links);
  assert.deepEqual(graph.edges.map((e) => `${e.source}>${e.target}`), ["a>b"]);
});

test("the links touching one passage are found from either end", () => {
  const links = [
    { id: "l1", from: { sourceId: "a", highlightId: "h1" }, to: { sourceId: "a", highlightId: "h2" }, relation: "supports", createdAt: "" },
    { id: "l2", from: { sourceId: "b", highlightId: "h9" }, to: { sourceId: "a", highlightId: "h1" }, relation: "cites", createdAt: "" },
    { id: "l3", from: { sourceId: "a", highlightId: "h2" }, to: { sourceId: "b" }, relation: "related", createdAt: "" },
  ] as unknown as SourceLink[];
  assert.deepEqual(linksOf(links, "a", "h1").map((l) => l.id), ["l1", "l2"]);
  assert.equal(otherEnd(links[0], "a", "h1").outgoing, true);
  assert.deepEqual(otherEnd(links[0], "a", "h1").end, { sourceId: "a", highlightId: "h2" });
  // Seen from the other passage, the same link points the other way.
  assert.equal(otherEnd(links[0], "a", "h2").outgoing, false);
  assert.deepEqual(otherEnd(links[0], "a", "h2").end, { sourceId: "a", highlightId: "h1" });
});

test("the map can see links passage by passage", () => {
  const sources = [
    { id: "a", title: "One", kind: "web", highlights: [{ id: "h1" }, { id: "h2" }, { id: "h3" }] },
    { id: "b", title: "Two", kind: "web", highlights: [{ id: "k1" }] },
  ] as unknown as Source[];
  const links = [
    { id: "l1", from: { sourceId: "a", highlightId: "h2" }, to: { sourceId: "b", highlightId: "k1" }, relation: "supports", createdAt: "" },
    { id: "l2", from: { sourceId: "a", highlightId: "h1" }, to: { sourceId: "b" }, relation: "cites", createdAt: "" },
    { id: "l3", from: { sourceId: "gone", highlightId: "x" }, to: { sourceId: "b" }, relation: "cites", createdAt: "" },
  ] as unknown as SourceLink[];
  const edges = passageEdges(sources, links);
  // One line per link, not one per pair of sources, and nothing for a source that has gone.
  assert.deepEqual(edges.map((e) => e.id), ["l1", "l2"]);
  assert.deepEqual(edges[0].to, { sourceId: "b", highlightId: "k1" });
  // Only passages at one end of a link are drawn, in the order they were highlighted.
  assert.deepEqual(linkedPassages(sources, links), { a: ["h1", "h2"], b: ["k1"] });
});

test("map focus includes exactly the requested neighborhood and only its internal links", () => {
  const graph = buildGraph(["a", "b", "c", "d", "isolated"].map((id) => source(id)), [link("ab", "a", "b"), link("bc", "b", "c"), link("cd", "c", "d")]);
  const one = graphNeighborhood(graph, "a", 1);
  assert.deepEqual(one.nodes.map((node) => node.id), ["a", "b"]);
  assert.deepEqual(one.edges.map((edge) => edge.key), ["a>b:supports"]);
  assert.deepEqual(graphNeighborhood(graph, "a", 2).nodes.map((node) => node.id), ["a", "b", "c"]);
  assert.deepEqual(graphNeighborhood(graph, "missing", 2), { nodes: [], edges: [] });
  assert.deepEqual(graphNeighborhood(graph, "isolated", 1).nodes.map((node) => node.id), ["isolated"]);
});

test("a research trail finds the shortest visible route in either direction", () => {
  const graph = buildGraph(["a", "b", "c", "d", "alone"].map((id) => source(id)), [
    link("ab", "a", "b", "supports"), link("bc", "b", "c", "cites"),
    link("cd", "c", "d", "related"), link("ad", "a", "d", "contradicts"),
  ]);
  assert.deepEqual(shortestGraphPath(graph, "a", "d")?.ids, ["a", "d"]);
  assert.deepEqual(shortestGraphPath(graph, "d", "b")?.ids, ["d", "c", "b"]);
  const withoutContradiction = { ...graph, edges: graph.edges.filter((edge) => edge.kind !== "contradicts") };
  assert.deepEqual(shortestGraphPath(withoutContradiction, "a", "d")?.ids, ["a", "b", "c", "d"]);
  assert.equal(shortestGraphPath(withoutContradiction, "a", "alone"), null);
  assert.equal(shortestGraphPath(graph, "missing", "a"), null);
  assert.deepEqual(shortestGraphPath(graph, "a", "a"), { ids: ["a"], edges: [] });
});

test("a copied trail names the direction, source URLs, exact passages and notes", () => {
  const sources = [source("paper", ["finding"]), source("blog", ["claim"])];
  const evidence = { ...link("l1", "paper", "blog", "contradicts", "finding", "claim"), note: "Different sample size" };
  const graph = buildGraph(sources, [evidence]);
  const forward = graphPathMarkdown(shortestGraphPath(graph, "paper", "blog")!, sources);
  assert.match(forward, /paper\*\* contradicts \*\*blog/);
  assert.match(forward, /\[paper\]\(<https:\/\/example.com\/paper>\)/);
  assert.match(forward, /From “finding”/);
  assert.match(forward, /To “claim”/);
  assert.match(forward, /Different sample size/);
  const reverse = graphPathMarkdown(shortestGraphPath(graph, "blog", "paper")!, sources);
  assert.match(reverse, /blog\*\* contradicted by \*\*paper/);
  assert.match(reverse, /From “claim”/);
  assert.match(reverse, /To “finding”/);
});
