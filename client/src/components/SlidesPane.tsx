import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Play, Sparkles, SquarePen } from "lucide-react";
import { marked } from "marked";
import DOMPurify from "dompurify";

interface Props {
  value: string;
  onChange: (v: string) => void;
}

const SAMPLE = `# My video title
A one-line hook for the intro

---

## The claim
- What the article says
- Why it matters

---

## My take
> Quote the key highlight here

\`\`\`python
print("show a demo")
\`\`\`

---

## Takeaways
1. First
2. Second
`;

/** Markdown slides separated by "---". Slideshow mode goes fullscreen with arrow-key navigation. */
export function SlidesPane({ value, onChange }: Props) {
  const [idx, setIdx] = useState(0);
  const [editing, setEditing] = useState(true);
  const stage = useRef<HTMLDivElement>(null);
  const slides = useMemo(() => (value.trim() ? value : SAMPLE).split(/\n\s*---\s*\n/), [value]);
  const cur = Math.min(idx, slides.length - 1);
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(slides[cur] || "") as string), [slides, cur]);

  const go = useCallback((d: number) => setIdx((i) => Math.max(0, Math.min(slides.length - 1, i + d))), [slides.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.fullscreenElement !== stage.current) return;
      if (["ArrowRight", "PageDown", " "].includes(e.key)) { go(1); e.preventDefault(); }
      if (["ArrowLeft", "PageUp"].includes(e.key)) { go(-1); e.preventDefault(); }
      if (e.key === "Home") setIdx(0);
      if (e.key === "End") setIdx(slides.length - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, slides.length]);

  const present = () => { stage.current?.requestFullscreen?.(); stage.current?.focus(); };

  return (
    <div className="slides-pane">
      <div className="row term-bar wrap">
        <button className="icon-btn" onClick={() => go(-1)} disabled={cur === 0} title="Previous slide"><ChevronLeft size={15} /></button>
        <span className="muted small">{cur + 1} / {slides.length}</span>
        <button className="icon-btn" onClick={() => go(1)} disabled={cur >= slides.length - 1} title="Next slide"><ChevronRight size={15} /></button>
        <span className="grow" />
        {!value.trim() && <button className="ghost small" onClick={() => onChange(SAMPLE)}><Sparkles size={13} /> Use sample</button>}
        <button className="ghost small" onClick={() => setEditing((e) => !e)}><SquarePen size={13} /> {editing ? "Hide editor" : "Edit"}</button>
        <button className="primary small" onClick={present} title="Fullscreen slideshow — arrows to navigate, Esc to exit"><Play size={13} /> Slideshow</button>
      </div>
      <div className="slides-body">
        {editing && (
          <textarea
            className="slides-editor"
            value={value}
            placeholder={"Markdown. Separate slides with a line containing only ---\n\n" + SAMPLE}
            onChange={(e) => onChange(e.target.value)}
            spellCheck
          />
        )}
        <div ref={stage} className="slide-stage" tabIndex={0} onClick={(e) => { if (document.fullscreenElement) go(e.shiftKey ? -1 : 1); }}>
          <div className="slide md-preview" dangerouslySetInnerHTML={{ __html: html }} />
          <div className="slide-counter">{cur + 1} / {slides.length}</div>
        </div>
      </div>
    </div>
  );
}
