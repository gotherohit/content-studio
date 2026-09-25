import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Dot, Maximize2, Network, Search, X, Plus, Minus, Route, Focus, RotateCcw, ExternalLink, Link2, Copy } from "lucide-react";
import type { Source } from "../types";
import { buildGraph, graphNeighborhood, graphPathMarkdown, layoutGraph, linkedPassages, passageEdges, relationOf, RELATIONS, shortestGraphPath, type EdgeKind, type GraphEdge, type LinkEnd, type PassageEdge, type Point, type SourceLink } from "../links";

interface Props {
  sources: Source[];
  links: SourceLink[];
  activeSourceId: string | null;
  /** Clicking a source opens it. */
  onOpen: (sourceId: string) => void;
  /** Clicking a line opens the passage that made the link. */
  onGo: (end: LinkEnd) => void;
  onCreateLink?: (from: LinkEnd) => void;
  presenting?: boolean;
}

const KINDS: EdgeKind[] = ["supports", "contradicts", "cites", "same", "related", "opened"];
// Labels hang either side of a node, so the sides need more room than the top and bottom.
const PAD_X = 120, PAD_Y = 80;
const radius = (weight: number) => 8 + Math.min(12, Math.sqrt(weight) * 3);
const clip = (text: string, n: number) => (text.length > n ? text.slice(0, n - 1) + "…" : text);

/**
 * Every source in the project and how they connect, as a graph you can click through.
 *
 * The layout is computed, not saved, and is the same for the same sources and links, so a
 * beat showing the map looks the same every take. Dragging a source moves it for now only.
 */
export function SourceMap({ sources, links, activeSourceId, onOpen, onGo, onCreateLink, presenting = false }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const mapId = useId().replace(/:/g, "");
  const [size, setSize] = useState({ w: 600, h: 400 });
  const graph = useMemo(() => buildGraph(sources, links), [sources, links]);
  const signature = graph.nodes.map((n) => n.id).join(",") + "|" + graph.edges.map((e) => e.key).join(",");
  const base = useMemo(() => layoutGraph(graph.nodes, graph.edges), [signature]); // eslint-disable-line react-hooks/exhaustive-deps
  const [moved, setMoved] = useState<Record<string, Point>>({});
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);
  type Tip = { x: number; y: number } & ({ kind: "edge"; edge: GraphEdge } | { kind: "link"; edge: PassageEdge } | { kind: "dot"; end: LinkEnd });
  const [tip, setTip] = useState<Tip | null>(null);
  // Links drawn where they really land. A map that joins two whole documents when the link is
  // between two sentences is telling a smaller truth than it knows.
  const [byPassage, setByPassage] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | PassageEdge | null>(null);
  const [enabled, setEnabled] = useState<Set<EdgeKind>>(() => new Set(KINDS));
  const [focusHops, setFocusHops] = useState<0 | 1 | 2>(0);
  const [tracing, setTracing] = useState(false);
  const [traceCollapsed, setTraceCollapsed] = useState(false);
  const [pathFrom, setPathFrom] = useState("");
  const [pathTo, setPathTo] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const lines = useMemo(() => passageEdges(sources, links), [sources, links]);
  const filtered = useMemo(() => ({ nodes: graph.nodes, edges: graph.edges.filter((edge) => enabled.has(edge.kind)) }), [graph, enabled]);
  const visible = useMemo(() => selectedId && focusHops ? graphNeighborhood(filtered, selectedId, focusHops) : filtered, [filtered, selectedId, focusHops]);
  const visibleIds = useMemo(() => new Set(visible.nodes.map((node) => node.id)), [visible.nodes]);
  const visibleLines = useMemo(() => lines.filter((edge) => enabled.has(edge.kind) && edge.from.sourceId !== edge.to.sourceId && visibleIds.has(edge.from.sourceId) && visibleIds.has(edge.to.sourceId)), [lines, enabled, visibleIds]);
  const spots = useMemo(() => linkedPassages(sources, visibleLines.map((edge) => edge.link)), [sources, visibleLines]);
  const searchResults = useMemo(() => query.trim() ? graph.nodes.filter((node) => node.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : [], [graph.nodes, query]);
  const trace = useMemo(() => pathFrom && pathTo ? shortestGraphPath(filtered, pathFrom, pathTo) : null, [filtered, pathFrom, pathTo]);
  const traceIds = useMemo(() => new Set(trace?.ids ?? []), [trace]);
  const traceEdges = useMemo(() => new Set(trace?.edges.map((edge) => edge.key) ?? []), [trace]);
  const drag = useRef<{ id: string | null; startX: number; startY: number; origin: Point; view: typeof view; moved: boolean } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  // A handful of sources spread edge to edge look lost; keep small maps near the middle.
  const spread = Math.min(1, 0.3 + 0.12 * graph.nodes.length);
  const span = { x: Math.max(1, size.w - 2 * PAD_X) * spread, y: Math.max(1, size.h - 2 * PAD_Y) * spread };
  const at = (id: string): Point => {
    const p = moved[id] ?? base[id] ?? { x: 0.5, y: 0.5 };
    return { x: size.w / 2 + (p.x - 0.5) * span.x, y: size.h / 2 + (p.y - 0.5) * span.y };
  };
  const neighbours = useMemo(() => {
    if (!hover) return null;
    const set = new Set([hover]);
    for (const e of visible.edges) {
      if (e.source === hover) set.add(e.target);
      if (e.target === hover) set.add(e.source);
    }
    return set;
  }, [hover, visible.edges]);

  const centerOn = (id: string) => {
    const p = at(id);
    setView((v) => ({ ...v, x: size.w / 2 - p.x * v.k, y: size.h / 2 - p.y * v.k }));
    setSelectedId(id);
    setSelectedEdge(null);
    setFocusHops(0);
  };
  const zoom = (factor: number) => setView((v) => {
    const k = Math.min(4, Math.max(0.15, v.k * factor));
    return { k, x: size.w / 2 - (size.w / 2 - v.x) * k / v.k, y: size.h / 2 - (size.h / 2 - v.y) * k / v.k };
  });
  const fitIds = (ids: string[]) => {
    if (!ids.length) return;
    const points = ids.map(at);
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
    // Reserve room for the search bar and legend; otherwise the end of a narrow route lands
    // underneath those controls even though its node centre is technically inside the SVG.
    const padX = size.w < 520 ? 55 : 80, padY = size.w < 520 ? 130 : 95;
    const k = ids.length === 1 ? 1.5 : Math.min(3, Math.max(0.15, Math.min(Math.max(80, size.w - 2 * padX) / Math.max(1, right - left), Math.max(80, size.h - 2 * padY) / Math.max(1, bottom - top))));
    setView({ k, x: size.w / 2 - (left + right) * k / 2, y: size.h / 2 - (top + bottom) * k / 2 });
  };

  useEffect(() => {
    if (tracing && trace) fitIds(trace.ids);
    if (tracing && trace && size.w < 520) setTraceCollapsed(true);
  }, [size.w, size.h, tracing, trace]); // eslint-disable-line react-hooks/exhaustive-deps

  function down(e: React.PointerEvent, id: string | null) {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { id, startX: e.clientX, startY: e.clientY, origin: id ? (moved[id] ?? base[id]) : { x: 0, y: 0 }, view, moved: false };
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    if (Math.hypot(dx, dy) > 4) d.moved = true;
    if (!d.moved) return;
    if (d.id) {
      const id = d.id;
      const sx = span.x * view.k, sy = span.y * view.k;
      setMoved((m) => ({ ...m, [id]: { x: d.origin.x + dx / sx, y: d.origin.y + dy / sy } }));
    } else {
      setView({ ...d.view, x: d.view.x + dx, y: d.view.y + dy });
    }
  }
  function up() {
    const d = drag.current;
    drag.current = null;
    if (d?.id && !d.moved) { setSelectedId(d.id); setSelectedEdge(null); }
    else if (d && !d.moved) { setSelectedId(null); setSelectedEdge(null); }
  }
  function wheel(e: React.WheelEvent) {
    if ((e.target as Element).closest(".map-chrome")) return;
    const box = host.current!.getBoundingClientRect();
    const cx = e.clientX - box.left, cy = e.clientY - box.top;
    const k = Math.min(4, Math.max(0.15, view.k * Math.exp(-e.deltaY * 0.0015)));
    setView({ k, x: cx - ((cx - view.x) * k) / view.k, y: cy - ((cy - view.y) * k) / view.k });
  }

  /** Two kinds of link between the same pair bow apart instead of drawing on top of each other. */
  const bend = (edge: GraphEdge) => {
    const siblings = visible.edges.filter((e) => (e.source === edge.source && e.target === edge.target) || (e.source === edge.target && e.target === edge.source));
    if (siblings.length < 2) return 0;
    const i = siblings.indexOf(edge);
    const sign = edge.source < edge.target ? 1 : -1;
    return sign * (i - (siblings.length - 1) / 2) * 28;
  };
  const path = (edge: GraphEdge) => {
    const a = at(edge.source), b = at(edge.target);
    const ra = radius(graph.nodes.find((n) => n.id === edge.source)?.weight ?? 0);
    const rb = radius(graph.nodes.find((n) => n.id === edge.target)?.weight ?? 0) + 5;
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.max(Math.hypot(dx, dy), 1);
    const nx = -dy / d, ny = dx / d, off = bend(edge);
    const mx = (a.x + b.x) / 2 + nx * off, my = (a.y + b.y) / 2 + ny * off;
    const start = { x: a.x + ((mx - a.x) / Math.max(Math.hypot(mx - a.x, my - a.y), 1)) * ra, y: a.y + ((my - a.y) / Math.max(Math.hypot(mx - a.x, my - a.y), 1)) * ra };
    const end = { x: b.x - ((b.x - mx) / Math.max(Math.hypot(b.x - mx, b.y - my), 1)) * rb, y: b.y - ((b.y - my) / Math.max(Math.hypot(b.x - mx, b.y - my), 1)) * rb };
    return `M${start.x},${start.y} Q${mx},${my} ${end.x},${end.y}`;
  };
  const passage = (end: LinkEnd) => {
    const h = sources.find((s) => s.id === end.sourceId)?.highlights.find((x) => x.id === end.highlightId);
    if (!h) return undefined;
    return h.shape ? `${h.shape.kind === "rect" ? "Rectangle" : h.shape.kind === "oval" ? "Oval" : "Arrow"}${h.page ? ` · page ${h.page}` : ""}${h.text.trim() ? ` — ${h.text}` : ""}` : h.text;
  };
  const colourOf = (end: LinkEnd) =>
    sources.find((s) => s.id === end.sourceId)?.highlights.find((x) => x.id === end.highlightId)?.color ?? "yellow";

  /** Where a passage sits: around its source, in the order it was highlighted, so it never moves. */
  const dotAt = (end: LinkEnd): Point | null => {
    if (!end.highlightId) return null;
    const ids = spots[end.sourceId];
    const i = ids?.indexOf(end.highlightId) ?? -1;
    if (i < 0) return null;
    const node = graph.nodes.find((n) => n.id === end.sourceId);
    const centre = at(end.sourceId);
    const ring = radius(node?.weight ?? 0) + 15;
    // Spread over the top three quarters: the bottom of a node is where its name sits.
    const angle = -1.25 * Math.PI + (i + 0.5) * ((1.5 * Math.PI) / ids.length);
    return { x: centre.x + Math.cos(angle) * ring, y: centre.y + Math.sin(angle) * ring };
  };

  /** One link, from exactly where it starts to exactly where it lands. */
  const linkPath = (edge: PassageEdge) => {
    const from = dotAt(edge.from), to = dotAt(edge.to);
    const a = from ?? at(edge.from.sourceId), b = to ?? at(edge.to.sourceId);
    const ra = from ? 4 : radius(graph.nodes.find((n) => n.id === edge.from.sourceId)?.weight ?? 0);
    const rb = (to ? 4 : radius(graph.nodes.find((n) => n.id === edge.to.sourceId)?.weight ?? 0)) + 5;
    const siblings = lines.filter((e) =>
      (e.from.sourceId === edge.from.sourceId && e.to.sourceId === edge.to.sourceId) ||
      (e.from.sourceId === edge.to.sourceId && e.to.sourceId === edge.from.sourceId));
    const i = siblings.indexOf(edge);
    const off = siblings.length < 2 ? 0 : (edge.from.sourceId < edge.to.sourceId ? 1 : -1) * (i - (siblings.length - 1) / 2) * 22;
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.max(Math.hypot(dx, dy), 1);
    const mx = (a.x + b.x) / 2 - (dy / d) * off, my = (a.y + b.y) / 2 + (dx / d) * off;
    const da = Math.max(Math.hypot(mx - a.x, my - a.y), 1), db = Math.max(Math.hypot(b.x - mx, b.y - my), 1);
    const start = { x: a.x + ((mx - a.x) / da) * ra, y: a.y + ((my - a.y) / da) * ra };
    const end = { x: b.x - ((b.x - mx) / db) * rb, y: b.y - ((b.y - my) / db) * rb };
    return { d: `M${start.x},${start.y} Q${mx},${my} ${end.x},${end.y}`, a, b };
  };
  const titleOf = (id: string) => graph.nodes.find((n) => n.id === id)?.title ?? "";
  const selectedSource = graph.nodes.find((node) => node.id === selectedId);
  const selectedLinks = selectedId ? links.filter((link) => link.from.sourceId === selectedId || link.to.sourceId === selectedId) : [];
  const edgeLinks = selectedEdge ? "link" in selectedEdge ? [selectedEdge.link] : selectedEdge.links : [];

  useEffect(() => setCopyState("idle"), [pathFrom, pathTo, enabled]);

  useEffect(() => {
    if (selectedId && !graph.nodes.some((node) => node.id === selectedId)) setSelectedId(null);
    if (selectedEdge) {
      const current = "key" in selectedEdge ? graph.edges.find((edge) => edge.key === selectedEdge.key) : lines.find((edge) => edge.id === selectedEdge.id);
      if (!current) setSelectedEdge(null);
      else if (current !== selectedEdge) setSelectedEdge(current);
    }
  }, [graph, lines, selectedId, selectedEdge]);

  if (!sources.length) return <div className="panel-empty">Add sources to see how they connect.</div>;

  return (
    <div className="source-map" ref={host} onWheel={wheel} onPointerDown={(e) => down(e, null)} onPointerMove={move} onPointerUp={up}
      tabIndex={0} aria-label="Source map" onKeyDown={(e) => {
        if ((e.target as Element).closest("input, select, button, textarea")) return;
        if (e.key === "Escape") { setSelectedId(null); setSelectedEdge(null); setFocusHops(0); }
        if (e.key === "+" || e.key === "=") zoom(1.25);
        if (e.key === "-") zoom(0.8);
        if (e.key === "0") fitIds(visible.nodes.map((node) => node.id));
      }}>
      <svg width={size.w} height={size.h} role="img" aria-label={`${visible.nodes.length} sources and ${visible.edges.length} connections`}>
        <defs>
          {KINDS.map((k) => (
            <marker key={k} id={`${mapId}-arrow-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className={`map-arrow edge-${k}`} />
            </marker>
          ))}
        </defs>
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {visible.edges.filter((edge) => !byPassage || edge.kind === "opened").map((edge) => {
            const faded = (neighbours && !(neighbours.has(edge.source) && neighbours.has(edge.target))) || (tracing && trace && !traceEdges.has(edge.key));
            return (
              <g key={edge.key} className={`map-edge edge-${edge.kind} ${faded ? "faded" : ""} ${selectedEdge && "key" in selectedEdge && selectedEdge.key === edge.key ? "selected" : ""} ${traceEdges.has(edge.key) && tracing ? "traced" : ""}`}>
                <path d={path(edge)} className="map-edge-line" markerEnd={`url(#${mapId}-arrow-${edge.kind})`} />
                <path
                  d={path(edge)}
                  className="map-edge-hit"
                  onPointerDown={(e) => e.stopPropagation()}
                  tabIndex={0} role="button" aria-label={`Inspect ${titleOf(edge.source)} ${edge.kind} ${titleOf(edge.target)}`}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedEdge(edge); setSelectedId(null); } }}
                  onPointerEnter={(e) => setTip({ x: e.clientX, y: e.clientY, kind: "edge", edge })}
                  onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, kind: "edge", edge })}
                  onPointerLeave={() => setTip(null)}
                  onClick={() => { setSelectedEdge(edge); setSelectedId(null); }}
                  onDoubleClick={() => onGo(edge.links[0]?.from ?? { sourceId: edge.source })}
                />
              </g>
            );
          })}
          {byPassage && visibleLines.map((edge) => {
            const faded = (neighbours && !(neighbours.has(edge.from.sourceId) && neighbours.has(edge.to.sourceId))) || (tracing && trace && !traceEdges.has(`${edge.from.sourceId}>${edge.to.sourceId}:${edge.kind}`));
            const line = linkPath(edge);
            return (
              <g key={edge.id} className={`map-edge edge-${edge.kind} ${faded ? "faded" : ""} ${selectedEdge && "id" in selectedEdge && selectedEdge.id === edge.id ? "selected" : ""} ${tracing && traceEdges.has(`${edge.from.sourceId}>${edge.to.sourceId}:${edge.kind}`) ? "traced" : ""}`}>
                <path d={line.d} className="map-edge-line" markerEnd={`url(#${mapId}-arrow-${edge.kind})`} />
                <path
                  d={line.d}
                  className="map-edge-hit"
                  onPointerDown={(e) => e.stopPropagation()}
                  tabIndex={0} role="button" aria-label={`Inspect ${titleOf(edge.from.sourceId)} ${edge.kind} ${titleOf(edge.to.sourceId)}`}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedEdge(edge); setSelectedId(null); } }}
                  onPointerEnter={(e) => setTip({ x: e.clientX, y: e.clientY, kind: "link", edge })}
                  onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, kind: "link", edge })}
                  onPointerLeave={() => setTip(null)}
                  onClick={() => {
                    setSelectedEdge(edge); setSelectedId(null);
                  }}
                  onDoubleClick={(e) => {
                    const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                    const px = (e.clientX - box.left - view.x) / view.k, py = (e.clientY - box.top - view.y) / view.k;
                    const near = Math.hypot(px - line.a.x, py - line.a.y) <= Math.hypot(px - line.b.x, py - line.b.y);
                    onGo(near ? edge.from : edge.to);
                  }}
                />
              </g>
            );
          })}
          {byPassage && Object.entries(spots).flatMap(([sourceId, ids]) => ids.map((hid) => {
            const end = { sourceId, highlightId: hid };
            const spot = dotAt(end);
            if (!spot) return null;
            const faded = (neighbours && !neighbours.has(sourceId)) || (tracing && trace && !traceIds.has(sourceId));
            return (
              <circle
                key={`${sourceId}:${hid}`}
                className={`map-dot hl-${colourOf(end)} ${faded ? "faded" : ""}`}
                cx={spot.x}
                cy={spot.y}
                r={4.5}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerEnter={(e) => { setHover(sourceId); setTip({ x: e.clientX, y: e.clientY, kind: "dot", end }); }}
                onPointerLeave={() => { setHover(null); setTip(null); }}
                onClick={() => onGo(end)}
              />
            );
          }))}
          {visible.nodes.map((node) => {
            const p = at(node.id);
            const r = radius(node.weight);
            const faded = (neighbours && !neighbours.has(node.id)) || (tracing && trace && !traceIds.has(node.id));
            return (
              <g
                key={node.id}
                className={`map-node ${node.file ? "file" : ""} ${node.id === activeSourceId ? "active" : ""} ${node.id === selectedId ? "selected" : ""} ${tracing && traceIds.has(node.id) ? "traced" : ""} ${faded ? "faded" : ""} ${hover === node.id ? "hover" : ""}`}
                transform={`translate(${p.x},${p.y})`}
                tabIndex={0} role="button" aria-label={`Inspect source ${node.title}`}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(node.id); setSelectedEdge(null); } }}
                onPointerDown={(e) => down(e, node.id)}
                onPointerEnter={() => setHover(node.id)}
                onPointerLeave={() => setHover(null)}
                onDoubleClick={() => onOpen(node.id)}
              >
                <title>{node.title}</title>
                <circle r={r} />
                <text y={r + 14} textAnchor="middle">{clip(node.title, hover === node.id ? 80 : 30)}</text>
              </g>
            );
          })}
        </g>
      </svg>

      {!presenting && <div className="map-toolbar map-chrome" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        <div className="map-search">
          <Search size={15} />
          <input aria-label="Find source in map" placeholder="Find a source…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && <button className="icon-btn" aria-label="Clear search" onClick={() => setQuery("")}><X size={13} /></button>}
          {query && <div className="map-search-results">
            {searchResults.length ? searchResults.slice(0, 20).map((node) => <button key={node.id} onClick={() => { centerOn(node.id); setQuery(""); }} title={node.title}>{node.title}</button>) : <div className="muted small">No matching source</div>}
            {searchResults.length > 20 && <div className="muted small">Showing first 20 of {searchResults.length}</div>}
          </div>}
        </div>
        <span className="map-count">{visible.nodes.length} {visible.nodes.length === 1 ? "source" : "sources"} · {visible.edges.length} {visible.edges.length === 1 ? "connection" : "connections"}</span>
        <div className="map-toolbar-actions">
          <button className="icon-btn" aria-label="Zoom out" title="Zoom out (−)" onClick={() => zoom(0.8)}><Minus size={14} /></button>
          <button className="icon-btn" aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoom(1.25)}><Plus size={14} /></button>
          <button className="icon-btn" aria-label="Fit map" title="Fit map (0)" onClick={() => fitIds(visible.nodes.map((node) => node.id))}><Maximize2 size={14} /></button>
          <button className={`icon-btn ${tracing ? "on" : ""}`} aria-label={tracing ? traceCollapsed ? "Show trail" : "Hide trail" : "Trace a connection"} title={tracing ? traceCollapsed ? "Show trail" : "Hide trail" : "Trace a connection"} onClick={() => { if (tracing) setTraceCollapsed((v) => !v); else { setTracing(true); setTraceCollapsed(false); setPathFrom(selectedId ?? activeSourceId ?? ""); setPathTo(""); setSelectedId(null); setSelectedEdge(null); } }}><Route size={15} /></button>
        </div>
      </div>}

      {!presenting && tracing && traceCollapsed && !selectedSource && !selectedEdge && <div className="map-trace-compact map-chrome" onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={() => setTraceCollapsed(false)}><Route size={13} /> {pathFrom && pathTo ? `${clip(titleOf(pathFrom), 18)} → ${clip(titleOf(pathTo), 18)}` : "Trace a connection"} · Show trail</button>
        <button className="icon-btn" aria-label="End trace" title="End trace" onClick={() => { setTracing(false); setTraceCollapsed(false); }}><X size={13} /></button>
      </div>}
      {!presenting && tracing && !traceCollapsed && !selectedSource && !selectedEdge && <div className="map-trace map-chrome" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        <div className="map-trace-head"><strong>Trace a connection</strong><span className="grow" />{trace && <button className="icon-btn" aria-label="Copy trail as Markdown" title="Copy trail as Markdown" onClick={async () => { try { await navigator.clipboard.writeText(graphPathMarkdown(trace, sources)); setCopyState("copied"); } catch { setCopyState("error"); } }}><Copy size={14} /></button>}{trace && <button className="icon-btn" aria-label="Fit route" title="Fit route" onClick={() => fitIds(trace.ids)}><Maximize2 size={14} /></button>}<button className="icon-btn" aria-label="Close trace" onClick={() => { setTracing(false); setTraceCollapsed(false); }}><X size={14} /></button></div>
        <div className="map-trace-pickers">
          <select aria-label="Trace from source" value={pathFrom} onChange={(e) => { setPathFrom(e.target.value); const route = shortestGraphPath(filtered, e.target.value, pathTo); if (route) fitIds(route.ids); }}><option value="">From source…</option>{graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select>
          <select aria-label="Trace to source" value={pathTo} onChange={(e) => { setPathTo(e.target.value); const route = shortestGraphPath(filtered, pathFrom, e.target.value); if (route) { fitIds(route.ids); if (size.w < 520) setTraceCollapsed(true); } }}><option value="">To source…</option>{graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select>
        </div>
        {pathFrom && pathTo && (trace ? <div className="map-trace-results">
          <div className="muted small">{trace.edges.length} {trace.edges.length === 1 ? "step" : "steps"} through visible connections</div>
          {trace.edges.map((edge, i) => <button key={`${edge.key}-${i}`} className={`map-trace-step edge-${edge.kind}`} onClick={() => { setSelectedEdge(edge); setSelectedId(null); }}>
            <span>{i + 1}</span><b>{clip(titleOf(trace.ids[i]), 28)}</b><em>{edge.source === trace.ids[i] ? edge.kind === "opened" ? "opened from" : relationOf(edge.kind).label : edge.kind === "opened" ? "opened" : relationOf(edge.kind).backlink}</em><b>{clip(titleOf(trace.ids[i + 1]), 28)}</b>
          </button>)}
        </div> : <div className="muted small">No route with the selected relationship filters.</div>)}
        {copyState !== "idle" && <div className="muted small" role="status">{copyState === "copied" ? "Evidence trail copied as Markdown." : "Could not copy the trail. Check clipboard access."}</div>}
      </div>}

      {tip && (
        <div className="map-tip" style={{ left: tip.x - (host.current?.getBoundingClientRect().left ?? 0) + 12, top: tip.y - (host.current?.getBoundingClientRect().top ?? 0) + 12 }}>
          {tip.kind === "dot" ? (
            <div>
              <div><b>{clip(titleOf(tip.end.sourceId), 50)}</b></div>
              <div className="muted">“{clip(passage(tip.end) ?? "", 160)}”</div>
              <div className="muted small">Click to open it</div>
            </div>
          ) : tip.kind === "link" ? (
            <div className="map-tip-link">
              <div>
                <b>{clip(titleOf(tip.edge.from.sourceId), 40)}</b> {relationOf(tip.edge.kind).label} <b>{clip(titleOf(tip.edge.to.sourceId), 40)}</b>
              </div>
              {passage(tip.edge.from) && <div className="muted">“{clip(passage(tip.edge.from)!, 120)}”</div>}
              {passage(tip.edge.to) && <div className="muted">→ “{clip(passage(tip.edge.to)!, 120)}”</div>}
              {!tip.edge.to.highlightId && <div className="muted">→ the whole source</div>}
              {tip.edge.link.note && <div>{tip.edge.link.note}</div>}
              <div className="muted small">Click to inspect · double-click to open</div>
            </div>
          ) : tip.edge.kind === "opened" ? (
            <div><b>{clip(titleOf(tip.edge.source), 50)}</b> was opened from <b>{clip(titleOf(tip.edge.target), 50)}</b></div>
          ) : tip.edge.links.map((l) => (
            <div key={l.id} className="map-tip-link">
              <div><b>{clip(titleOf(l.from.sourceId), 40)}</b> {relationOf(l.relation).label} <b>{clip(titleOf(l.to.sourceId), 40)}</b></div>
              {passage(l.from) && <div className="muted">“{clip(passage(l.from)!, 120)}”</div>}
              {passage(l.to) && <div className="muted">→ “{clip(passage(l.to)!, 120)}”</div>}
              {l.note && <div>{l.note}</div>}
            </div>
          ))}
          {tip.kind === "edge" && tip.edge.kind !== "opened" && <div className="muted small">Click to inspect · double-click to open</div>}
        </div>
      )}

      {!presenting && <div className="map-legend map-chrome" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        {RELATIONS.map((r) => <button key={r.id} className={`map-filter edge-${r.id} ${enabled.has(r.id) ? "on" : ""}`} aria-pressed={enabled.has(r.id)} onClick={() => { setSelectedEdge(null); setEnabled((old) => { const next = new Set(old); if (next.has(r.id)) next.delete(r.id); else next.add(r.id); return next; }); }}><i />{r.label}<small>{graph.edges.filter((edge) => edge.kind === r.id).length}</small></button>)}
        <button className={`map-filter edge-opened ${enabled.has("opened") ? "on" : ""}`} aria-pressed={enabled.has("opened")} onClick={() => { setSelectedEdge(null); setEnabled((old) => { const next = new Set(old); if (next.has("opened")) next.delete("opened"); else next.add("opened"); return next; }); }}><i />opened from<small>{graph.edges.filter((edge) => edge.kind === "opened").length}</small></button>
        <button
          className={`ghost small ${byPassage ? "on" : ""}`}
          onClick={() => setByPassage((v) => !v)}
          title={byPassage ? "Group links by source pair" : "Show individual passage links"}
        >
          <Dot size={13} /> {byPassage ? "Passages" : "Sources"}
        </button>
        {Object.keys(moved).length > 0 && <button className="icon-btn" title="Restore automatic node layout" aria-label="Restore automatic node layout" onClick={() => setMoved({})}><RotateCcw size={13} /></button>}
      </div>}
      {!presenting && (selectedSource || selectedEdge) && <aside className="map-inspector map-chrome" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        <div className="map-inspector-head">
          <strong>{selectedSource ? "Source" : "Connection"}</strong>
          <button className="icon-btn" aria-label="Close map details" onClick={() => { setSelectedId(null); setSelectedEdge(null); setFocusHops(0); }}><X size={15} /></button>
        </div>
        {selectedSource ? <>
          <h3 title={selectedSource.title}>{selectedSource.title}</h3>
          <div className="muted small">{selectedSource.file ? "File" : "Source"} · {selectedLinks.length} {selectedLinks.length === 1 ? "link" : "links"}</div>
          <div className="map-inspector-actions">
            <button className="ghost small" onClick={() => onOpen(selectedSource.id)}><ExternalLink size={13} /> Open source</button>
            {onCreateLink && <button className="ghost small" onClick={() => onCreateLink({ sourceId: selectedSource.id })}><Link2 size={13} /> Link source</button>}
            <button className={`ghost small ${focusHops ? "on" : ""}`} onClick={() => { const next = focusHops === 0 ? 1 : focusHops === 1 ? 2 : 0; setFocusHops(next); fitIds((next ? graphNeighborhood(filtered, selectedSource.id, next) : filtered).nodes.map((node) => node.id)); }} title="Show this source and its one-hop or two-hop neighborhood"><Focus size={13} /> {focusHops ? `${focusHops} hop${focusHops > 1 ? "s" : ""}` : "Focus"}</button>
            <button className="ghost small" onClick={() => { setTracing(true); setPathFrom(selectedSource.id); setPathTo(""); setSelectedId(null); }}><Route size={13} /> Trace from here</button>
          </div>
          <div className="map-inspector-list">
            {selectedLinks.length ? selectedLinks.map((link) => {
              const outgoing = link.from.sourceId === selectedSource.id;
              const other = outgoing ? link.to : link.from;
              const own = outgoing ? link.from : link.to;
              return <div key={link.id} className={`map-inspector-link edge-${link.relation}`}>
                <div className="small"><span className="map-rel-dot" />{outgoing ? relationOf(link.relation).label : relationOf(link.relation).backlink}</div>
                <button onClick={() => onGo(other)} title="Open linked passage">{titleOf(other.sourceId)} <ExternalLink size={12} /></button>
                {passage(own) && <p>“{clip(passage(own)!, 150)}”</p>}
                {link.note && <p>{link.note}</p>}
              </div>;
            }) : <p className="muted small">No saved links yet. Create a link from a highlighted passage to connect this source.</p>}
          </div>
        </> : selectedEdge && <>
          <h3>{titleOf("from" in selectedEdge ? selectedEdge.from.sourceId : selectedEdge.source)} → {titleOf("to" in selectedEdge ? selectedEdge.to.sourceId : selectedEdge.target)}</h3>
          <div className="muted small">{selectedEdge.kind === "opened" ? "Opened from" : relationOf(selectedEdge.kind).label} · {edgeLinks.length || 1} {edgeLinks.length === 1 ? "link" : "links"}</div>
          <div className="map-inspector-list">
            {edgeLinks.length ? edgeLinks.map((link) => <div key={link.id} className={`map-inspector-link edge-${link.relation}`}>
              <div className="small"><span className="map-rel-dot" />{relationOf(link.relation).label}</div>
              <button onClick={() => onGo(link.from)} title="Open starting passage">{titleOf(link.from.sourceId)}{passage(link.from) ? `: “${clip(passage(link.from)!, 90)}”` : ""} <ExternalLink size={12} /></button>
              <button onClick={() => onGo(link.to)} title="Open target passage">→ {titleOf(link.to.sourceId)}{passage(link.to) ? `: “${clip(passage(link.to)!, 90)}”` : ""} <ExternalLink size={12} /></button>
              {link.note && <p>{link.note}</p>}
            </div>) : "source" in selectedEdge && <div className="map-inspector-link"><button onClick={() => onGo({ sourceId: selectedEdge.source })}>Open {titleOf(selectedEdge.source)} <ExternalLink size={12} /></button><p>This source was opened from {titleOf(selectedEdge.target)}.</p></div>}
          </div>
        </>}
      </aside>}
      {!graph.edges.length && !lines.length && (
        <div className="map-hint"><Network size={14} /> Link a highlighted passage to another source from the Highlights pane, and the sources connect here.</div>
      )}
    </div>
  );
}
