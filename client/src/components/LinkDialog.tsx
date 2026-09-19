import { useState } from "react";
import { Link2, X } from "lucide-react";
import type { Highlight, Source } from "../types";
import { RELATIONS, type LinkEnd, type Relation } from "../links";

interface Props {
  /** The linking side: a highlighted passage, or a whole source. */
  from: LinkEnd;
  sources: Source[];
  onSave: (to: LinkEnd, relation: Relation, note: string) => void;
  onClose: () => void;
}

const clip = (text: string, n = 90) => (text.length > n ? text.slice(0, n) + "…" : text);

/** Say how a passage bears on another source, or on one passage in it. */
export function LinkDialog({ from, sources, onSave, onClose }: Props) {
  const origin = sources.find((s) => s.id === from.sourceId);
  const passage: Highlight | undefined = origin?.highlights.find((h) => h.id === from.highlightId);
  const others = sources.filter((s) => s.id !== from.sourceId);
  const [target, setTarget] = useState(others[0]?.id ?? "");
  const [targetHl, setTargetHl] = useState("");
  const [relation, setRelation] = useState<Relation>("supports");
  const [note, setNote] = useState("");
  const targetSource = others.find((s) => s.id === target);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal link-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <Link2 size={18} />
          <h3>Link {passage ? "this passage" : "this source"}</h3>
          <span className="grow" />
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <blockquote className="link-from">{passage ? clip(passage.text, 220) : origin?.title}</blockquote>

        {others.length === 0 ? (
          <p className="muted small">Add another source to the project first — a link joins two sources.</p>
        ) : (
          <>
            <div className="field">
              <span>How it relates</span>
              <div className="seg wrap">
                {RELATIONS.map((r) => (
                  <button key={r.id} className={`rel-${r.id} ${relation === r.id ? "active" : ""}`} onClick={() => setRelation(r.id)}>{r.label}</button>
                ))}
              </div>
            </div>
            <label className="field">
              <span>Source</span>
              <select value={target} onChange={(e) => { setTarget(e.target.value); setTargetHl(""); }}>
                {others.map((s) => <option key={s.id} value={s.id}>{s.kind === "file" ? s.file?.name ?? s.title : s.title}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Passage in it <span className="muted">(optional)</span></span>
              <select value={targetHl} onChange={(e) => setTargetHl(e.target.value)} disabled={!targetSource?.highlights.length}>
                <option value="">The whole source</option>
                {targetSource?.highlights.map((h) => <option key={h.id} value={h.id}>{clip(h.text)}</option>)}
              </select>
              {targetSource && !targetSource.highlights.length && <span className="muted small">Highlight a passage in that source to link to it exactly.</span>}
            </label>
            <label className="field">
              <span>Note <span className="muted">(optional)</span></span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why — e.g. the paper measured 3×, not 10×" />
            </label>
          </>
        )}

        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={!targetSource}
            onClick={() => onSave({ sourceId: target, ...(targetHl ? { highlightId: targetHl } : {}) }, relation, note.trim())}
          >Add link</button>
        </div>
      </div>
    </div>
  );
}
