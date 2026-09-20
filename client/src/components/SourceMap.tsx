import { useEffect, useMemo, useRef, useState } from "react";
import { Dot, Maximize2, Network } from "lucide-react";
import type { Source } from "../types";
import { buildGraph, layoutGraph, linkedPassages, passageEdges, relationOf, RELATIONS, type EdgeKind, type GraphEdge, type LinkEnd, type PassageEdge, type Point, type SourceLink } from "../links";

interface Props {
  sources: Source[];
  links: SourceLink[];
  activeSourceId: string | null;
  /** Clicking a source opens it. */
  onOpen: (sourceId: string) => void;
  /** Clicking a line opens the passage that made the link. */
  onGo: (end: LinkEnd) => void;
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
export function SourceMap({ sources, links, activeSourceId, onOpen, onGo }: Props) {
  const host = useRef<HTMLDivElement>(null);
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
  const lines = useMemo(() => passageEdges(sources, links), [sources, links]);
  const spots = useMemo(() => linkedPassages(sources, links), [sources, links]);
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
    for (const e of graph.edges) {
      if (e.source === hover) set.add(e.target);
      if (e.target === hover) set.add(e.source);
    }
    return set;
  }, [hover, graph.edges]);

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
    if (d?.id && !d.moved) onOpen(d.id);
  }
  function wheel(e: React.WheelEvent) {
    const box = host.current!.getBoundingClientRect();
    const cx = e.clientX - box.left, cy = e.clientY - box.top;
    const k = Math.min(4, Math.max(0.3, view.k * Math.exp(-e.deltaY * 0.0015)));
    setView({ k, x: cx - ((cx - view.x) * k) / view.k, y: cy - ((cy - view.y) * k) / view.k });
  }

  /** Two kinds of link between the same pair bow apart instead of drawing on top of each other. */
  const bend = (edge: GraphEdge) => {
    const siblings = graph.edges.filter((e) => (e.source === edge.source && e.target === edge.target) || (e.source === edge.target && e.target === edge.source));
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

  if (!sources.length) return <div className="panel-empty">Add sources to see how they connect.</div>;

  return (
    <div className="source-map" ref={host} onWheel={wheel} onPointerDown={(e) => down(e, null)} onPointerMove={move} onPointerUp={up}>
      <svg width={size.w} height={size.h}>
        <defs>
          {KINDS.map((k) => (
            <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className={`map-arrow edge-${k}`} />
            </marker>
          ))}
        </defs>
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {graph.edges.filter((edge) => !byPassage || edge.kind === "opened").map((edge) => {
            const faded = neighbours && !(neighbours.has(edge.source) && neighbours.has(edge.target));
            return (
              <g key={edge.key} className={`map-edge edge-${edge.kind} ${faded ? "faded" : ""}`}>
                <path d={path(edge)} className="map-edge-line" markerEnd={`url(#arrow-${edge.kind})`} />
                <path
                  d={path(edge)}
                  className="map-edge-hit"
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerEnter={(e) => setTip({ x: e.clientX, y: e.clientY, kind: "edge", edge })}
                  onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, kind: "edge", edge })}
                  onPointerLeave={() => setTip(null)}
                  onClick={() => onGo(edge.links[0]?.from ?? { sourceId: edge.source })}
                />
              </g>
            );
          })}
          {byPassage && lines.map((edge) => {
            const faded = neighbours && !(neighbours.has(edge.from.sourceId) && neighbours.has(edge.to.sourceId));
            const line = linkPath(edge);
            return (
              <g key={edge.id} className={`map-edge edge-${edge.kind} ${faded ? "faded" : ""}`}>
                <path d={line.d} className="map-edge-line" markerEnd={`url(#arrow-${edge.kind})`} />
                <path
                  d={line.d}
                  className="map-edge-hit"
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerEnter={(e) => setTip({ x: e.clientX, y: e.clientY, kind: "link", edge })}
                  onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, kind: "link", edge })}
                  onPointerLeave={() => setTip(null)}
                  // Clicking a line opens the end you were nearest, not always the same one.
                  onClick={(e) => {
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
            const faded = neighbours && !neighbours.has(sourceId);
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
          {graph.nodes.map((node) => {
            const p = at(node.id);
            const r = radius(node.weight);
            const faded = neighbours && !neighbours.has(node.id);
            return (
              <g
                key={node.id}
                className={`map-node ${node.file ? "file" : ""} ${node.id === activeSourceId ? "active" : ""} ${faded ? "faded" : ""} ${hover === node.id ? "hover" : ""}`}
                transform={`translate(${p.x},${p.y})`}
                onPointerDown={(e) => down(e, node.id)}
                onPointerEnter={() => setHover(node.id)}
                onPointerLeave={() => setHover(null)}
              >
                <title>{node.title}</title>
                <circle r={r} />
                <text y={r + 14} textAnchor="middle">{clip(node.title, hover === node.id ? 80 : 30)}</text>
              </g>
            );
          })}
        </g>
      </svg>

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
              <div className="muted small">Click the end you want to open</div>
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
          {tip.kind === "edge" && tip.edge.kind !== "opened" && <div className="muted small">Click to open the linked passage</div>}
        </div>
      )}

      <div className="map-legend" onPointerDown={(e) => e.stopPropagation()}>
        {RELATIONS.map((r) => <span key={r.id} className={`edge-${r.id}`}><i />{r.label}</span>)}
        <span className="edge-opened"><i />opened from</span>
        <button
          className={`ghost small ${byPassage ? "on" : ""}`}
          onClick={() => setByPassage((v) => !v)}
          title={byPassage ? "Draw one line per pair of sources instead" : "Draw each link where it really lands"}
        >
          <Dot size={13} /> passages
        </button>
        <button className="icon-btn" title="Fit the whole map" onClick={() => { setView({ x: 0, y: 0, k: 1 }); setMoved({}); }}><Maximize2 size={13} /></button>
      </div>
      {!graph.edges.length && !lines.length && (
        <div className="map-hint"><Network size={14} /> Link a highlighted passage to another source from the Highlights pane, and the sources connect here.</div>
      )}
    </div>
  );
}
