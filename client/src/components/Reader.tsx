import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import type { Highlight, HighlightColor, Shape, ShapeKind, Source } from "../types";
import { applyHighlights, captureSelection } from "../highlighter";
import { HighlightPopup } from "./HighlightPopup";
import { ShapeLayer, type LayerItem } from "./ShapeLayer";
import { fromDrag, shapeHighlights, textHighlights } from "../shapes";
import { anchorAt, boxWithin, hostFor } from "../../../server/public/shapes-dom.js";

interface Props {
  source: Source;
  scrollToId: string | null;
  scrollNonce: number;
  onAddHighlight: (h: Highlight) => void;
  onSelectHighlight: (id: string) => void;
  fontScale: number;
  tool?: ShapeKind | null;
  drawColor?: HighlightColor;
  showNotes?: boolean;
  onNote?: (id: string) => void;
}

/** Clean, text-only rendering of the article. */
export function Reader({ source, scrollToId, scrollNonce, onAddHighlight, onSelectHighlight, fontScale, tool, drawColor, showNotes, onNote }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // The layer covers the stage, so every box it is given is measured against the stage too.
  const stageRef = useRef<HTMLDivElement>(null);
  const [popup, setPopup] = useState<{
    x: number; y: number; flip: boolean;
    anchor: NonNullable<ReturnType<typeof captureSelection>>;
    shape?: Shape; onImage?: string;
  } | null>(null);
  const [items, setItems] = useState<LayerItem[]>([]);

  // Render sanitized HTML, then lay the highlights over it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = DOMPurify.sanitize(source.content, { ADD_ATTR: ["target"] });
    el.querySelectorAll("a").forEach((a) => { a.target = "_blank"; a.rel = "noreferrer"; });
    applyHighlights(el, textHighlights(source.highlights));
  }, [source.id, source.content]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (ref.current) applyHighlights(ref.current, textHighlights(source.highlights));
  }, [source.highlights]);

  /** Shapes follow the paragraph they were drawn over, so they are placed after every reflow. */
  const place = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const stage = stageRef.current;
    if (!stage) return;
    setItems(shapeHighlights(source.highlights).map((h) => {
      const host = hostFor(el, h);
      return host ? { id: h.id, shape: h.shape!, color: h.color, comment: h.comment, host: boxWithin(stage, host) } : null;
    }).filter(Boolean) as LayerItem[]);
  }, [source.highlights]);

  useEffect(() => {
    place();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(place);
    ro.observe(el);
    const images = Array.from(el.querySelectorAll("img"));
    images.forEach((img) => img.addEventListener("load", place));
    return () => { ro.disconnect(); images.forEach((img) => img.removeEventListener("load", place)); };
  }, [place, source.id, source.content]);

  useEffect(() => {
    if (!scrollToId) return;
    const el = ref.current;
    const mark = el?.querySelector<HTMLElement>(`mark.hl[data-hid="${scrollToId}"]`);
    if (mark) { mark.scrollIntoView({ behavior: "instant", block: "center" }); return; }
    const shape = source.highlights.find((h) => h.id === scrollToId && h.shape);
    const host = shape && el ? hostFor(el, shape) : null;
    host?.scrollIntoView({ behavior: "instant", block: "center" });
  }, [scrollToId, scrollNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  function onMouseUp(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest(".hl-popup") || tool) return;
    const el = ref.current;
    if (!el) return;
    const anchor = captureSelection(el);
    if (!anchor || !anchor.text.trim()) { setPopup(null); return; }
    const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
    setPopup(popupAt(rect.left + rect.width / 2, rect.top, rect.bottom, { anchor }));
  }

  /** Popup coordinates are relative to the scroller, which is what it is positioned inside. */
  function popupAt(clientX: number, top: number, bottom: number, rest: { anchor: NonNullable<ReturnType<typeof captureSelection>>; shape?: Shape; onImage?: string }) {
    const scroller = ref.current!.closest(".reader-scroll") as HTMLElement;
    const host = scroller.getBoundingClientRect();
    const above = top - host.top;
    const flip = above < 120;
    return {
      x: Math.min(Math.max(clientX - host.left, 170), host.width - 170),
      y: (flip ? bottom - host.top + 8 : above - 8) + scroller.scrollTop,
      flip,
      ...rest,
    };
  }

  function commit(color: HighlightColor, comment: string) {
    if (!popup) return;
    onAddHighlight({
      id: `h${Date.now().toString(36)}`, ...popup.anchor, shape: popup.shape, onImage: popup.onImage,
      color, comment, createdAt: new Date().toISOString(),
    });
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
      <div className="reader-stage" ref={stageRef}>
        <article ref={ref} className="reader-body" style={{ fontSize: `${fontScale}rem` }} />
        <ShapeLayer
          items={items}
          tool={tool ?? null}
          color={drawColor ?? "yellow"}
          selectedId={scrollToId}
          showNotes={showNotes}
          onSelect={onSelectHighlight}
          onNote={(id) => onNote?.(id)}
          onDraw={(drag) => {
            const el = ref.current, stage = stageRef.current;
            if (!el || !stage || !tool) return;
            const at = stage.getBoundingClientRect();
            const found = anchorAt(el.ownerDocument, el, at.left + drag.from.x, at.top + drag.from.y);
            if (!found) return;
            const box = boxWithin(stage, found.host);
            const shape = fromDrag(tool, { x: drag.from.x - box.left, y: drag.from.y - box.top }, { x: drag.to.x - box.left, y: drag.to.y - box.top }, box);
            if (!shape) return;
            const bottom = at.top + Math.max(drag.from.y, drag.to.y) + 6;
            setPopup(popupAt(at.left + (drag.from.x + drag.to.x) / 2, bottom, bottom, { anchor: found.anchor, shape, onImage: found.onImage }));
          }}
        />
      </div>
      {popup && <HighlightPopup x={popup.x} y={popup.y} flip={popup.flip} onCommit={commit} onCancel={() => setPopup(null)} />}
    </div>
  );
}
