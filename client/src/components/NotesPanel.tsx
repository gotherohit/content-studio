import { useState } from "react";
import { Eye, Pencil } from "lucide-react";
import { marked } from "marked";
import DOMPurify from "dompurify";

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export function NotesPanel({ value, onChange }: Props) {
  const [preview, setPreview] = useState(false);
  return (
    <div className="panel-body">
      <div className="row between">
        <span className="muted small">Markdown · script, talking points, links</span>
        <button className="ghost small" onClick={() => setPreview((p) => !p)}>
          {preview ? <><Pencil size={13} /> Edit</> : <><Eye size={13} /> Preview</>}
        </button>
      </div>
      {preview ? (
        <div className="md-preview" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(value) as string) }} />
      ) : (
        <textarea className="notes-editor" value={value} onChange={(e) => onChange(e.target.value)} spellCheck />
      )}
    </div>
  );
}
