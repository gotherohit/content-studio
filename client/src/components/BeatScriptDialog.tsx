import { useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { Eye, Pencil, ScrollText, X } from "lucide-react";
import type { Beat } from "../types";

interface Props {
  beat: Beat;
  index: number;
  onChange: (script: string) => void;
  onClose: () => void;
}

/**
 * What to say on a beat.
 *
 * Markdown, because a script is bullets and emphasis rather than prose, and because it
 * has to be readable at a glance from arm's length while talking. It is written here and
 * read in the presenter window on the other monitor — never drawn inside the studio
 * window, so nothing capturing that window can record it.
 */
export function BeatScriptDialog({ beat, index, onChange, onClose }: Props) {
  const [tab, setTab] = useState<"write" | "read">("write");
  const html = DOMPurify.sanitize(marked.parse(beat.script || "*Nothing written for this beat yet.*") as string);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <ScrollText size={18} />
          <h3>Beat {index + 1}{beat.point ? ` — ${beat.point}` : ""}</h3>
          <span className="grow" />
          <div className="seg">
            <button className={tab === "write" ? "active" : ""} onClick={() => setTab("write")}><Pencil size={12} /> Write</button>
            <button className={tab === "read" ? "active" : ""} onClick={() => setTab("read")}><Eye size={12} /> Preview</button>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        {tab === "write" ? (
          <textarea
            className="beat-script-input"
            autoFocus
            value={beat.script ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={"What to say here.\n\n- the point that must land\n- the phrase to use: **illicit distillation**\n- the thing not to forget\n\nMarkdown works. This shows on your presenter window, never on the recording."}
            spellCheck
          />
        ) : (
          <div className="beat-script-preview md-preview" dangerouslySetInnerHTML={{ __html: html }} />
        )}

        <div className="row">
          <span className="muted small grow">
            Saved as you type. Shown on the presenter window when this beat comes up.
          </span>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
