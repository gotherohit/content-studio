import { ClipboardCopy, Trash2 } from "lucide-react";
import type { Highlight, Source } from "../types";

interface Props {
  source: Source | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onUpdate: (h: Highlight) => void;
  onDelete: (id: string) => void;
  onCopyAll: () => void;
}

export function HighlightsPanel({ source, selectedId, onSelect, onUpdate, onDelete, onCopyAll }: Props) {
  if (!source) return <div className="panel-empty">Open a source to see its highlights.</div>;
  const list = source.highlights;
  return (
    <div className="panel-body">
      <div className="row between">
        <span className="muted small">{list.length} highlight{list.length === 1 ? "" : "s"} · click a card to jump to it</span>
        <button className="ghost small" onClick={onCopyAll} disabled={!list.length}><ClipboardCopy size={13} /> Copy as markdown</button>
      </div>
      {list.length === 0 && <div className="panel-empty">Select text in the article to add one.</div>}
      {list.map((h, i) => (
        <div
          key={h.id}
          id={`hlcard-${h.id}`}
          className={`hl-card hl-${h.color} ${selectedId === h.id ? "selected" : ""}`}
          onClick={() => onSelect(h.id)}
        >
          <div className="hl-card-head">
            <span className="hl-index">{i + 1}</span>
            <blockquote>{h.text}</blockquote>
          </div>
          <textarea
            placeholder="Your comment / analysis…"
            value={h.comment}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onUpdate({ ...h, comment: e.target.value })}
            rows={2}
          />
          <div className="row between" onClick={(e) => e.stopPropagation()}>
            <div className="hl-colors">
              {(["yellow", "green", "pink", "blue"] as const).map((c) => (
                <button key={c} className={`swatch hl-${c} ${h.color === c ? "active" : ""}`} onClick={() => onUpdate({ ...h, color: c })} />
              ))}
            </div>
            <button className="icon-btn danger" title="Delete highlight" onClick={() => onDelete(h.id)}><Trash2 size={14} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}
