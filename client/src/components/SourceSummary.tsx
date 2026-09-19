import { useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { ChevronUp, Eye, NotebookText, Pencil } from "lucide-react";

interface Props {
  value: string;
  onClose: () => void;
  onChange: (summary: string) => void;
}

/**
 * The creator's own summary of a source, opened from the pane's toolbar.
 *
 * Whether it is open is held by the app and remembered: once closed it stays closed until
 * opened again. It sits inside the studio window, so the pane leaves it out entirely in
 * Present mode rather than letting a recording pick it up.
 */
export function SourceSummary({ value, onClose, onChange }: Props) {
  const [tab, setTab] = useState<"write" | "read">(value.trim() ? "read" : "write");

  return (
    <div className="source-summary">
      <div className="source-summary-head">
        <NotebookText size={13} />
        <span className="source-summary-title">Summary</span>
        <span className="muted small grow">First line shows in the sources list · hidden in Present mode</span>
        <div className="seg">
          <button className={tab === "write" ? "active" : ""} onClick={() => setTab("write")}><Pencil size={11} /> Write</button>
          <button className={tab === "read" ? "active" : ""} onClick={() => setTab("read")}><Eye size={11} /> Preview</button>
        </div>
        <button className="icon-btn" onClick={onClose} title="Hide the summary — it stays hidden until you open it again"><ChevronUp size={14} /></button>
      </div>
      {tab === "write" ? (
        <textarea
          className="source-summary-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="What this source says, in your words — the main claim, the number worth quoting, what it contradicts. Markdown works."
          spellCheck
        />
      ) : (
        <div
          className="source-summary-preview md-preview"
          onDoubleClick={() => setTab("write")}
          title="Double-click to edit"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(value.trim() || "*No summary yet — switch to Write.*") as string) }}
        />
      )}
    </div>
  );
}
