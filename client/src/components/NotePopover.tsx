import { useEffect, useRef } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import type { Highlight, Source } from "../types";
import { otherEnd, relationOf, type LinkEnd, type SourceLink } from "../links";
import { shapeLabel } from "../shapes";

interface Props {
  highlight: Highlight;
  source: Source;
  sources: Source[];
  links: SourceLink[];
  x: number;
  y: number;
  flip: boolean;
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
    <div ref={ref} className={`note-pop hl-${p.highlight.color} ${p.flip ? "below" : ""}`} style={{ left: p.x, top: p.y }} onMouseDown={(e) => e.stopPropagation()}>
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
    </div>
  );
}
