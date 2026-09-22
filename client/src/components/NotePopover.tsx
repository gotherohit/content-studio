import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, GripVertical, X } from "lucide-react";
import type { Highlight, Source } from "../types";
import { otherEnd, relationOf, type LinkEnd, type SourceLink } from "../links";
import { shapeLabel } from "../shapes";
import { noteCardLayout } from "../note-popover";

interface Props {
  highlight: Highlight;
  source: Source;
  sources: Source[];
  links: SourceLink[];
  x: number;
  y: number;
  flip: boolean;
  onWidth: (width: number) => void;
  onGo: (end: LinkEnd) => void;
  onClose: () => void;
}

const clip = (text: string, n = 60) => (text.trim().length > n ? `${text.trim().slice(0, n)}…` : text.trim());

/**
 * What a marker on a source is hiding: the note, and where this passage is linked. Opened on
 * the source itself so the answer arrives where the eye already is, rather than only in the
 * Highlights panel.
 */
export function NotePopover(p: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(p.highlight.noteWidth ?? 300);
  const [anchorX, setAnchorX] = useState(p.x);
  const [size, setSize] = useState({ width: 300, height: 300, cardHeight: 0 });
  const drag = useRef<{ x: number; width: number; left: number; current: number; side: "left" | "right" } | null>(null);
  useLayoutEffect(() => { setWidth(p.highlight.noteWidth ?? 300); setAnchorX(p.x); }, [p.highlight.id, p.x, p.y]);
  useEffect(() => { setWidth(p.highlight.noteWidth ?? 300); }, [p.highlight.noteWidth]);
  useLayoutEffect(() => {
    const card = ref.current, parent = card?.parentElement;
    if (!card || !parent) return;
    const measure = () => {
      const next = { width: parent.clientWidth, height: parent.clientHeight, cardHeight: card.offsetHeight };
      setSize((old) => old.width === next.width && old.height === next.height && old.cardHeight === next.cardHeight ? old : next);
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(parent); observer.observe(card);
    return () => observer.disconnect();
  }, []);
  const layout = noteCardLayout(width, anchorX, p.y, p.flip, size, size.cardHeight);

  useEffect(() => {
    const outside = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) p.onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") p.onClose(); };
    // A click inside an article frame never reaches this document; the window losing focus does.
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", key);
    window.addEventListener("blur", p.onClose);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", key);
      window.removeEventListener("blur", p.onClose);
    };
  }, [p.onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  const titleOf = (id: string) => {
    if (id === p.source.id) return "this source";
    const s = p.sources.find((x) => x.id === id);
    return s ? (s.kind === "file" ? s.file?.name ?? s.title : s.title) : "a source that has gone";
  };
  const passageOf = (end: LinkEnd) => {
    const s = p.sources.find((x) => x.id === end.sourceId);
    const h = end.highlightId ? s?.highlights.find((x) => x.id === end.highlightId) : undefined;
    if (!h) return "";
    return h.shape ? `${shapeLabel(h.shape.kind)}${h.text.trim() ? ` — ${clip(h.text, 40)}` : ""}` : clip(h.text, 40);
  };

  const what = p.highlight.shape
    ? `${shapeLabel(p.highlight.shape.kind)}${p.highlight.page ? ` · page ${p.highlight.page}` : ""}`
    : clip(p.highlight.text, 90);

  return (
    <div ref={ref} className={`note-pop hl-${p.highlight.color}`} style={layout} onMouseDown={(e) => e.stopPropagation()}>
      <div className="note-pop-head">
        <span className="muted small ellipsis">{what}</span>
        <button className="icon-btn" onClick={p.onClose} title="Close"><X size={13} /></button>
      </div>
      {p.highlight.comment?.trim() && <p className="note-pop-comment">{p.highlight.comment}</p>}
      {p.links.map((l) => {
        const { end, outgoing } = otherEnd(l, p.source.id, p.highlight.id);
        const rel = relationOf(l.relation);
        const passage = passageOf(end);
        return (
          <button key={l.id} className={`note-pop-link rel-${l.relation}`} onClick={() => p.onGo(end)} title={l.note || "Open it"}>
            {outgoing ? <ArrowRight size={11} /> : <ArrowLeft size={11} />}
            <span className="link-rel">{outgoing ? rel.label : rel.backlink}</span>
            <span className="ellipsis">{titleOf(end.sourceId)}{passage ? ` — “${passage}”` : ""}</span>
          </button>
        );
      })}
      {p.links.some((l) => l.note) && (
        <p className="muted small">{p.links.filter((l) => l.note).map((l) => l.note).join(" · ")}</p>
      )}
      {(["left", "right"] as const).map((side) => <button key={side} className={`note-pop-resize ${side}`} aria-label={`Resize comment width from ${side}`} title="Drag to change width. Arrow keys resize; double-click resets."
        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, width: layout.width, left: layout.left, current: layout.width, side }; }}
        onPointerMove={(e) => { const start = drag.current; if (!start) return; const next = noteCardLayout(start.width + (start.side === "right" ? 1 : -1) * (e.clientX - start.x), anchorX, p.y, p.flip, size, size.cardHeight).width; start.current = next; setWidth(next); setAnchorX(start.side === "right" ? start.left + next / 2 : start.left + start.width - next / 2); }}
        onPointerUp={(e) => { const start = drag.current; if (!start) return; drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); p.onWidth(Math.round(start.current)); }}
        onPointerCancel={() => { drag.current = null; setWidth(p.highlight.noteWidth ?? 300); setAnchorX(p.x); }}
        onDoubleClick={() => { setWidth(300); setAnchorX(p.x); p.onWidth(300); }}
        onKeyDown={(e) => { if (!["ArrowLeft", "ArrowRight", "Home"].includes(e.key)) return; e.preventDefault(); e.stopPropagation(); const next = noteCardLayout(e.key === "Home" ? 300 : layout.width + (e.key === "ArrowRight" ? 32 : -32), anchorX, p.y, p.flip, size, size.cardHeight).width; setWidth(next); p.onWidth(Math.round(next)); }}
      ><GripVertical size={14} /></button>)}
    </div>
  );
}
