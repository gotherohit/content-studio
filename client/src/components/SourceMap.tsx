import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Network } from "lucide-react";
import type { Source } from "../types";
import { buildGraph, layoutGraph, relationOf, RELATIONS, type EdgeKind, type GraphEdge, type LinkEnd, type Point, type SourceLink } from "../links";

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
  const [tip, setTip] = useState<{ x: number; y: number; edge: GraphEdge } | null>(null);
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
  const passage = (end: LinkEnd) => sources.find((s) => s.id === end.sourceId)?.highlights.find((h) => h.id === end.highlightId)?.text;
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
          {graph.edges.map((edge) => {
            const faded = neighbours && !(neighbours.has(edge.source) && neighbours.has(edge.target));
            return (
              <g key={edge.key} className={`map-edge edge-${edge.kind} ${faded ? "faded" : ""}`}>
                <path d={path(edge)} className="map-edge-line" markerEnd={`url(#arrow-${edge.kind})`} />
                <path
                  d={path(edge)}
                  className="map-edge-hit"
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerEnter={(e) => setTip({ x: e.clientX, y: e.clientY, edge })}
                  onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, edge })}
                  onPointerLeave={() => setTip(null)}
                  onClick={() => onGo(edge.links[0]?.from ?? { sourceId: edge.source })}
                />
              </g>
            );
          })}
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
          {tip.edge.kind === "opened" ? (
            <div><b>{clip(titleOf(tip.edge.source), 50)}</b> was opened from <b>{clip(titleOf(tip.edge.target), 50)}</b></div>
          ) : tip.edge.links.map((l) => (
            <div key={l.id} className="map-tip-link">
              <div><b>{clip(titleOf(l.from.sourceId), 40)}</b> {relationOf(l.relation).label} <b>{clip(titleOf(l.to.sourceId), 40)}</b></div>
              {passage(l.from) && <div className="muted">“{clip(passage(l.from)!, 120)}”</div>}
              {passage(l.to) && <div className="muted">→ “{clip(passage(l.to)!, 120)}”</div>}
              {l.note && <div>{l.note}</div>}
            </div>
          ))}
          {tip.edge.kind !== "opened" && <div className="muted small">Click to open the linked passage</div>}
        </div>
      )}

      <div className="map-legend" onPointerDown={(e) => e.stopPropagation()}>
        {RELATIONS.map((r) => <span key={r.id} className={`edge-${r.id}`}><i />{r.label}</span>)}
        <span className="edge-opened"><i />opened from</span>
        <button className="icon-btn" title="Fit the whole map" onClick={() => { setView({ x: 0, y: 0, k: 1 }); setMoved({}); }}><Maximize2 size={13} /></button>
      </div>
      {!graph.edges.length && (
        <div className="map-hint"><Network size={14} /> Link a highlighted passage to another source from the Highlights pane, and the sources connect here.</div>
      )}
    </div>
  );
}
