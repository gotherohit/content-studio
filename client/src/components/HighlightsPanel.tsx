import { ArrowLeft, ArrowRight, ClipboardCopy, Link2, Trash2, X } from "lucide-react";
import { shapeLabel } from "../shapes";
import type { Highlight, Source } from "../types";
import { linksFor, relationOf, type LinkEnd, type SourceLink } from "../links";

interface Props {
  source: Source | null;
  sources: Source[];
  links: SourceLink[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onUpdate: (h: Highlight) => void;
  onDelete: (id: string) => void;
  onCopyAll: () => void;
  /** Start a link from a passage, or from the whole source when no highlight is given. */
  onLink: (from: LinkEnd) => void;
  onRemoveLink: (id: string) => void;
  /** Open the other end of a link: its source, and its passage when there is one. */
  onGo: (end: LinkEnd) => void;
}

const clip = (text: string, n = 70) => (text.length > n ? text.slice(0, n) + "…" : text);

export function HighlightsPanel({ source, sources, links, selectedId, onSelect, onUpdate, onDelete, onCopyAll, onLink, onRemoveLink, onGo }: Props) {
  if (!source) return <div className="panel-empty">Open a source to see its highlights.</div>;
  const list = source.highlights;
  const { outgoing, incoming } = linksFor(links, source.id);
  const titleOf = (id: string) => {
    if (id === source.id) return "this source";
    const s = sources.find((x) => x.id === id);
    return s ? (s.kind === "file" ? s.file?.name ?? s.title : s.title) : "a removed source";
  };
  /** A drawing has no quote, so it is named by what it is. */
  const passageOf = (end: LinkEnd) => {
    const h = sources.find((x) => x.id === end.sourceId)?.highlights.find((x) => x.id === end.highlightId);
    if (!h) return undefined;
    return h.shape ? `${shapeLabel(h.shape.kind)}${h.text.trim() ? ` — ${h.text}` : ""}` : h.text;
  };

  /** One link as seen from this source: which way it points decides the wording. */
  const chip = (l: SourceLink, out: boolean) => {
    const other = out ? l.to : l.from;
    const rel = relationOf(l.relation);
    const passage = passageOf(other);
    return (
      <div key={`${l.id}-${out}`} className={`link-chip rel-${l.relation}`} onClick={(e) => e.stopPropagation()}>
        <button className="link-go" onClick={() => onGo(other)} title={[passage ? `“${passage}”` : "", l.note ?? ""].filter(Boolean).join("\n") || "Open it"}>
          {out ? <ArrowRight size={11} /> : <ArrowLeft size={11} />}
          <span className="link-rel">{out ? rel.label : rel.backlink}</span>
          <span className="ellipsis">{titleOf(other.sourceId)}{passage ? ` — “${clip(passage, 40)}”` : ""}</span>
        </button>
        <button className="icon-btn link-remove" title="Remove this link" onClick={() => onRemoveLink(l.id)}><X size={11} /></button>
      </div>
    );
  };

  // Links made from the whole source, and backlinks that point at the whole source, sit above
  // the cards; those tied to a passage sit on its card.
  const sourceLinks = [...outgoing.filter((l) => !l.from.highlightId).map((l) => chip(l, true)), ...incoming.filter((l) => !l.to.highlightId).map((l) => chip(l, false))];

  return (
    <div className="panel-body">
      <div className="row between">
        <span className="muted small">{list.length} highlight{list.length === 1 ? "" : "s"} · {outgoing.length} link{outgoing.length === 1 ? "" : "s"} · {incoming.length} backlink{incoming.length === 1 ? "" : "s"}</span>
        <div className="row">
          <button className="ghost small" onClick={() => onLink({ sourceId: source.id })} title="Link this whole source to another"><Link2 size={13} /> Link source</button>
          <button className="ghost small" onClick={onCopyAll} disabled={!list.length}><ClipboardCopy size={13} /> Copy as markdown</button>
        </div>
      </div>
      {sourceLinks.length > 0 && <div className="link-list source-links">{sourceLinks}</div>}
      {list.length === 0 && <div className="panel-empty">Select text in the article to add one.</div>}
      {list.map((h, i) => {
        const chips = [
          ...outgoing.filter((l) => l.from.highlightId === h.id).map((l) => chip(l, true)),
          ...incoming.filter((l) => l.to.highlightId === h.id).map((l) => chip(l, false)),
        ];
        return (
          <div
            key={h.id}
            id={`hlcard-${h.id}`}
            className={`hl-card hl-${h.color} ${selectedId === h.id ? "selected" : ""}`}
            onClick={() => onSelect(h.id)}
          >
            <div className="hl-card-head">
              <span className="hl-index">{i + 1}</span>
              {h.shape ? (
                <div className="hl-code">
                  <span className="muted small">
                    {shapeLabel(h.shape.kind)}{h.page ? ` · page ${h.page}` : ""}
                  </span>
                  {h.text.trim() ? <blockquote>{h.text}</blockquote> : <span className="muted small">drawn on this source</span>}
                </div>
              ) : h.page ? (
                <div className="hl-code">
                  <span className="muted small">Page {h.page}</span>
                  <blockquote>{h.text}</blockquote>
                </div>
              ) : h.lines ? (
                <div className="hl-code">
                  <span className="muted small">{h.lines[0] === h.lines[1] ? `Line ${h.lines[0]}` : `Lines ${h.lines[0]}–${h.lines[1]}`}</span>
                  <pre>{h.text}</pre>
                </div>
              ) : <blockquote>{h.text}</blockquote>}
            </div>
            <textarea
              placeholder="Your comment / analysis…"
              value={h.comment}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onUpdate({ ...h, comment: e.target.value })}
              rows={2}
            />
            {chips.length > 0 && <div className="link-list">{chips}</div>}
            <div className="row between" onClick={(e) => e.stopPropagation()}>
              <div className="hl-colors">
                {(["yellow", "green", "pink", "blue"] as const).map((c) => (
                  <button key={c} className={`swatch hl-${c} ${h.color === c ? "active" : ""}`} onClick={() => onUpdate({ ...h, color: c })} />
                ))}
              </div>
              <div className="row">
                <button className="icon-btn" title="Link this passage to another source" onClick={() => onLink({ sourceId: source.id, highlightId: h.id })}><Link2 size={14} /></button>
                <button className="icon-btn danger" title="Delete highlight" onClick={() => onDelete(h.id)}><Trash2 size={14} /></button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
