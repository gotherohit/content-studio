import { useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { ChevronDown, ChevronRight, Eye, NotebookText, Pencil } from "lucide-react";

interface Props {
  value: string;
  /** Held by the app and remembered: once collapsed it stays collapsed until opened again. */
  open: boolean;
  onOpen: (open: boolean) => void;
  onChange: (summary: string) => void;
}

/**
 * The creator's own summary of a source, above it in the pane.
 *
 * It sits inside the studio window, so the pane leaves it out entirely in Present mode
 * rather than letting a recording pick it up.
 */
export function SourceSummary({ value, open, onOpen, onChange }: Props) {
  const [tab, setTab] = useState<"write" | "read">(value.trim() ? "read" : "write");
  const first = value.trim().split("\n").find((line) => line.trim())?.replace(/^[#>*\-\s]+/, "") ?? "";

  return (
    <div className={`source-summary ${open ? "open" : ""}`}>
      <div className="source-summary-head">
        <button className="source-summary-toggle" onClick={() => onOpen(!open)} title={open ? "Collapse the summary" : "Show the summary"} aria-expanded={open}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <NotebookText size={13} />
          <span>Summary</span>
          {!open && <span className="muted ellipsis">{first || "Add what this source says, in your words"}</span>}
        </button>
        {open && (
          <div className="seg">
            <button className={tab === "write" ? "active" : ""} onClick={() => setTab("write")}><Pencil size={11} /> Write</button>
            <button className={tab === "read" ? "active" : ""} onClick={() => setTab("read")}><Eye size={11} /> Preview</button>
          </div>
        )}
      </div>
      {open && (tab === "write" ? (
        <textarea
          className="source-summary-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="What this source says, in your words — the main claim, the number worth quoting, what it contradicts. Markdown works; the first line shows in the sources list. Hidden in Present mode."
          spellCheck
        />
      ) : (
        <div
          className="source-summary-preview md-preview"
          onDoubleClick={() => setTab("write")}
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(value.trim() || "*No summary yet — switch to Write.*") as string) }}
        />
      ))}
    </div>
  );
}
