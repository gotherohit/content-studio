import { useEffect, useLayoutEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import type { Highlight, HighlightColor, Source } from "../types";
import { applyHighlights, captureSelection } from "../highlighter";
import { HighlightPopup } from "./HighlightPopup";

interface Props {
  source: Source;
  scrollToId: string | null;
  scrollNonce: number;
  onAddHighlight: (h: Highlight) => void;
  onSelectHighlight: (id: string) => void;
  fontScale: number;
}

/** Clean, text-only rendering of the article. */
export function Reader({ source, scrollToId, scrollNonce, onAddHighlight, onSelectHighlight, fontScale }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [popup, setPopup] = useState<{ x: number; y: number; flip: boolean; anchor: NonNullable<ReturnType<typeof captureSelection>> } | null>(null);

  // Render sanitized HTML, then lay the highlights over it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = DOMPurify.sanitize(source.content, { ADD_ATTR: ["target"] });
    el.querySelectorAll("a").forEach((a) => { a.target = "_blank"; a.rel = "noreferrer"; });
    applyHighlights(el, source.highlights);
  }, [source.id, source.content]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (ref.current) applyHighlights(ref.current, source.highlights);
  }, [source.highlights]);

  useEffect(() => {
    if (!scrollToId) return;
    ref.current?.querySelector<HTMLElement>(`mark.hl[data-hid="${scrollToId}"]`)?.scrollIntoView({ behavior: "instant", block: "center" });
  }, [scrollToId, scrollNonce]);

  function onMouseUp(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest(".hl-popup")) return;
    const el = ref.current;
    if (!el) return;
    const anchor = captureSelection(el);
    if (!anchor || !anchor.text.trim()) { setPopup(null); return; }
    const scroller = el.closest(".reader-scroll") as HTMLElement;
    const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
    const host = scroller.getBoundingClientRect();
    const above = rect.top - host.top;
    const flip = above < 120;
    setPopup({
      x: Math.min(Math.max(rect.left - host.left + rect.width / 2, 170), host.width - 170),
      y: (flip ? rect.bottom - host.top + 8 : above - 8) + scroller.scrollTop,
      flip,
      anchor,
    });
  }

  function commit(color: HighlightColor, comment: string) {
    if (!popup) return;
    onAddHighlight({ id: `h${Date.now().toString(36)}`, ...popup.anchor, color, comment, createdAt: new Date().toISOString() });
    window.getSelection()?.removeAllRanges();
    setPopup(null);
  }

  function onClick(e: React.MouseEvent) {
    const mark = (e.target as HTMLElement).closest("mark.hl") as HTMLElement | null;
    if (mark?.dataset.hid) onSelectHighlight(mark.dataset.hid);
  }

  return (
    <div className="reader-scroll" onMouseUp={onMouseUp} onClick={onClick}>
      <div className="reader-meta">
        <h1>{source.title}</h1>
        <div className="muted small">
          {source.siteName && <span>{source.siteName} · </span>}
          {source.byline && <span>{source.byline} · </span>}
          <a href={source.url} target="_blank" rel="noreferrer">open original</a>
        </div>
      </div>
      <article ref={ref} className="reader-body" style={{ fontSize: `${fontScale}rem` }} />
      {popup && <HighlightPopup x={popup.x} y={popup.y} flip={popup.flip} onCommit={commit} onCancel={() => setPopup(null)} />}
    </div>
  );
}
