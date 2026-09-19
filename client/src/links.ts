import type { Source } from "./types";

/** How one passage bears on another. Read from the linking side: "this supports that". */
export type Relation = "supports" | "contradicts" | "cites" | "same" | "related";

export const RELATIONS: { id: Relation; label: string; backlink: string }[] = [
  { id: "supports", label: "supports", backlink: "supported by" },
  { id: "contradicts", label: "contradicts", backlink: "contradicted by" },
  { id: "cites", label: "cites", backlink: "cited by" },
  { id: "same", label: "same claim as", backlink: "same claim as" },
  { id: "related", label: "related to", backlink: "related to" },
];
export const relationOf = (id: Relation) => RELATIONS.find((r) => r.id === id) ?? RELATIONS[4];

/** One end of a link: a source, or one highlighted passage in it. */
export interface LinkEnd {
  sourceId: string;
  highlightId?: string;
}

/**
 * A link between two sources, usually from a highlighted passage. It stores references only,
 * like a beat, so a link follows its highlight wherever that highlight is edited.
 */
export interface SourceLink {
  id: string;
  from: LinkEnd;
  to: LinkEnd;
  relation: Relation;
  note?: string;
  createdAt: string;
}

export function linksFor(links: SourceLink[], sourceId: string) {
  return {
    outgoing: links.filter((l) => l.from.sourceId === sourceId),
    incoming: links.filter((l) => l.to.sourceId === sourceId),
  };
}

/**
 * Keep links honest after a source or highlight goes. A link to a deleted source is removed;
 * a link to a deleted highlight falls back to the whole source, since the sources are still
 * related even if the passage was taken out.
 */
export function pruneLinks(links: SourceLink[], sources: Source[]): SourceLink[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const end = (e: LinkEnd): LinkEnd | null => {
    const s = byId.get(e.sourceId);
    if (!s) return null;
    return e.highlightId && !s.highlights.some((h) => h.id === e.highlightId) ? { sourceId: e.sourceId } : e;
  };
  const next: SourceLink[] = [];
  let changed = false;
  for (const l of links) {
    const from = end(l.from), to = end(l.to);
    if (!from || !to) { changed = true; continue; }
    if (from !== l.from || to !== l.to) { changed = true; next.push({ ...l, from, to }); } else next.push(l);
  }
  return changed ? next : links;
}

export type EdgeKind = Relation | "opened";

export interface GraphNode { id: string; title: string; file: boolean; weight: number }
export interface GraphEdge { key: string; source: string; target: string; kind: EdgeKind; links: SourceLink[] }

/**
 * Sources as nodes; links, and the "opened from" trail of 0.12.0, as edges. Several links of
 * the same kind between the same two sources draw as one edge carrying all of them.
 */
export function buildGraph(sources: Source[], links: SourceLink[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const ids = new Set(sources.map((s) => s.id));
  const edges = new Map<string, GraphEdge>();
  const add = (source: string, target: string, kind: EdgeKind, link?: SourceLink) => {
    if (source === target || !ids.has(source) || !ids.has(target)) return;
    const key = `${source}>${target}:${kind}`;
    const edge = edges.get(key) ?? { key, source, target, kind, links: [] };
    if (link) edge.links.push(link);
    edges.set(key, edge);
  };
  for (const l of links) add(l.from.sourceId, l.to.sourceId, l.relation, l);
  for (const s of sources) if (s.from) add(s.id, s.from, "opened");
  const degree = new Map<string, number>();
  for (const e of edges.values()) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const nodes = sources.map((s) => ({
    id: s.id,
    title: s.kind === "file" ? s.file?.name ?? s.title : s.title,
    file: s.kind === "file",
    weight: s.highlights.length + (degree.get(s.id) ?? 0),
  }));
  return { nodes, edges: [...edges.values()] };
}

export type Point = { x: number; y: number };

/**
 * A force layout: nodes repel, edges pull their ends together, a weak pull keeps loose
 * sources near the middle. Deterministic — the same sources and links always give the same
 * picture, so a map shown in a beat looks the same every take. Returns positions in 0..1.
 */
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[], iterations = 300): Record<string, Point> {
  const n = nodes.length;
  if (!n) return {};
  if (n === 1) return { [nodes[0].id]: { x: 0.5, y: 0.5 } };
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  // Start on a circle in source order, so the picture does not depend on anything random.
  const pos = nodes.map((_, i) => ({ x: Math.cos((2 * Math.PI * i) / n), y: Math.sin((2 * Math.PI * i) / n) }));
  const k = Math.sqrt(4 / n);
  const pairs = edges.map((e) => [index.get(e.source)!, index.get(e.target)!] as const);
  // A source with no links has nothing holding it, and repulsion alone flings it to the edge,
  // squeezing everything connected into a corner once the picture is fitted to the frame.
  const degree = nodes.map(() => 0);
  for (const [a, b] of pairs) { degree[a]++; degree[b]++; }
  let temperature = 0.2;
  for (let step = 0; step < iterations; step++) {
    const force = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
        let d = Math.hypot(dx, dy);
        if (d < 1e-6) { dx = 1e-3 * (i - j); dy = 1e-3; d = Math.hypot(dx, dy); }
        const f = (k * k) / d;
        force[i].x += (dx / d) * f; force[i].y += (dy / d) * f;
        force[j].x -= (dx / d) * f; force[j].y -= (dy / d) * f;
      }
    }
    for (const [a, b] of pairs) {
      const dx = pos[a].x - pos[b].x, dy = pos[a].y - pos[b].y;
      const d = Math.max(Math.hypot(dx, dy), 1e-6);
      const f = (d * d) / k;
      force[a].x -= (dx / d) * f; force[a].y -= (dy / d) * f;
      force[b].x += (dx / d) * f; force[b].y += (dy / d) * f;
    }
    for (let i = 0; i < n; i++) {
      const pull = (degree[i] ? 0.6 : 2.4) * k;
      force[i].x -= pos[i].x * pull; force[i].y -= pos[i].y * pull;
      const d = Math.max(Math.hypot(force[i].x, force[i].y), 1e-9);
      const move = Math.min(d, temperature);
      pos[i].x += (force[i].x / d) * move;
      pos[i].y += (force[i].y / d) * move;
    }
    temperature = Math.max(0.002, temperature * 0.985);
  }
  const xs = pos.map((p) => p.x), ys = pos.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY, 1e-6);
  const offX = (1 - (Math.max(...xs) - minX) / span) / 2, offY = (1 - (Math.max(...ys) - minY) / span) / 2;
  return Object.fromEntries(nodes.map((node, i) => [node.id, { x: offX + (pos[i].x - minX) / span, y: offY + (pos[i].y - minY) / span }]));
}
