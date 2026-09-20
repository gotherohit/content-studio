import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { Highlight, HighlightColor, Shape, ShapeKind, Source } from "../types";
import { applyHighlights, captureSelection } from "../highlighter";
import { HighlightPopup } from "./HighlightPopup";
import { NotebookView } from "./NotebookView";
import { DeckView } from "./DeckView";
import { PdfView } from "./PdfView";
import { ShapeLayer } from "./ShapeLayer";
import { fromDrag, shapeHighlights, textHighlights } from "../shapes";
import type { AppConfig } from "../api";

interface Props {
  source: Source;
  projectId: string;
  fontScale: number;
  slideshow: boolean;
  slideIndex: number;
  onSlideCount: (n: number) => void;
  onSlideIndex: (i: number) => void;
  config: AppConfig | null;
  scrollToId: string | null;
  scrollNonce: number;
  onAddHighlight: (h: Highlight) => void;
  onSelectHighlight: (id: string) => void;
  presenting: boolean;
  tool?: ShapeKind | null;
  drawColor?: HighlightColor;
  showNotes?: boolean;
  linkedIds?: string[];
  onNote?: (id: string, at: { x: number; y: number }) => void;
}

function parseDelimited(text: string, sep: string) {
  return text.trim().split(/\r?\n/).slice(0, 2000).map((line) => {
    // minimal quoted-field handling
    const out: string[] = []; let cur = ""; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === sep && !q) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  });
}

/** Shows a file source: markdown (with slideshow), notebook, PDF, image, table, text. */
export function FileView(p: Props) {
  const { source, projectId, fontScale } = p;
  const file = source.file!;
  const url = `/api/projects/${projectId}/sources/${encodeURIComponent(file.name)}`;
  const viewer = file.viewer;

  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const imageFrame = useRef<HTMLDivElement>(null);
  const [popup, setPopup] = useState<{
    x: number; y: number; flip: boolean;
    anchor: NonNullable<ReturnType<typeof captureSelection>>;
    shape?: Shape;
  } | null>(null);

  const needsText = ["markdown", "text", "table"].includes(viewer);
  useEffect(() => {
    if (!needsText) return;
    let cancelled = false;
    setText(null); setErr(null);
    fetch(url).then((r) => r.text()).then((t) => { if (!cancelled) setText(t); }).catch((e) => { if (!cancelled) setErr(e.message); });
    return () => { cancelled = true; };
  }, [url, needsText]);

  // Markdown splits into slides on a line containing only ---
  const slides = useMemo(() => (viewer === "markdown" && text ? text.split(/\n\s*---\s*\n/) : []), [viewer, text]);
  useEffect(() => { if (viewer === "markdown") p.onSlideCount(slides.length); }, [slides.length, viewer]); // eslint-disable-line react-hooks/exhaustive-deps

  const markdownHtml = useMemo(() => {
    if (viewer !== "markdown" || text === null) return "";
    const src = p.slideshow ? (slides[Math.min(p.slideIndex, slides.length - 1)] ?? "") : text;
    return DOMPurify.sanitize(marked.parse(src) as string);
  }, [viewer, text, p.slideshow, p.slideIndex, slides]);

  // Highlighting works on the rendered markdown/text, same machinery as the Reader.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !["markdown", "text"].includes(viewer)) return;
    applyHighlights(el, textHighlights(source.highlights));
  }, [markdownHtml, text, source.highlights, viewer]);

  useEffect(() => {
    if (!p.scrollToId) return;
    bodyRef.current?.querySelector<HTMLElement>(`mark.hl[data-hid="${p.scrollToId}"]`)?.scrollIntoView({ behavior: "instant", block: "center" });
  }, [p.scrollToId, p.scrollNonce, text]);

  function onMouseUp(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest(".hl-popup")) return;
    const el = bodyRef.current;
    if (!el) return;
    const anchor = captureSelection(el);
    if (!anchor || !anchor.text.trim()) { setPopup(null); return; }
    const scroller = el.closest(".file-scroll") as HTMLElement;
    const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
    const host = scroller.getBoundingClientRect();
    const above = rect.top - host.top;
    const flip = above < 120;
    setPopup({
      x: Math.min(Math.max(rect.left - host.left + rect.width / 2, 170), host.width - 170),
      y: (flip ? rect.bottom - host.top + 8 : above - 8) + scroller.scrollTop,
      flip, anchor,
    });
  }

  function commit(color: HighlightColor, comment: string) {
    if (!popup) return;
    p.onAddHighlight({ id: `h${Date.now().toString(36)}`, ...popup.anchor, shape: popup.shape, color, comment, createdAt: new Date().toISOString() });
    window.getSelection()?.removeAllRanges();
    setPopup(null);
  }

  if (err) return <div className="panel-empty">Could not open {file.name}: {err}</div>;

  if (viewer === "pdf") {
    return (
      <PdfView
        url={url}
        name={file.name}
        slideshow={p.slideshow}
        page={p.slideIndex}
        onPage={p.onSlideIndex}
        onCount={p.onSlideCount}
        presenting={p.presenting}
        highlights={source.highlights}
        onAddHighlight={p.onAddHighlight}
        onSelectHighlight={p.onSelectHighlight}
        scrollToId={p.scrollToId}
        scrollNonce={p.scrollNonce}
        tool={p.tool}
        drawColor={p.drawColor}
        showNotes={p.showNotes}
        linkedIds={p.linkedIds}
        onNote={p.onNote}
      />
    );
  }
  if (viewer === "html") return <iframe className="file-frame" src={url} title={file.name} sandbox="allow-scripts allow-same-origin allow-forms" />;
  if (viewer === "image") {
    return (
      <div className="file-media">
        <div className="media-frame" ref={imageFrame}>
          <img src={url} alt={file.name} />
          <ShapeLayer
            items={shapeHighlights(source.highlights).map((h) => ({ id: h.id, shape: h.shape!, color: h.color, comment: h.comment, linked: p.linkedIds?.includes(h.id) }))}
            tool={p.tool ?? null}
            color={p.drawColor ?? "yellow"}
            selectedId={p.scrollToId}
            showNotes={p.showNotes !== false && !p.presenting}
            onSelect={p.onSelectHighlight}
            onNote={p.onNote}
            onDraw={(drag) => {
              const frame = imageFrame.current;
              if (!frame || !p.tool) return;
              const box = frame.getBoundingClientRect();
              const shape = fromDrag(p.tool, drag.from, drag.to, box);
              if (!shape) return;
              setPopup({
                x: Math.min(Math.max((drag.from.x + drag.to.x) / 2, 170), Math.max(171, box.width - 170)),
                y: Math.max(drag.from.y, drag.to.y) + 10,
                flip: true,
                anchor: { text: "", prefix: "", suffix: "" },
                shape,
              });
            }}
          />
          {popup && <HighlightPopup x={popup.x} y={popup.y} flip={popup.flip} onCommit={commit} onCancel={() => setPopup(null)} />}
        </div>
      </div>
    );
  }
  if (viewer === "video") return <div className="file-media"><video src={url} controls /></div>;
  if (viewer === "audio") return <div className="file-media"><audio src={url} controls /></div>;
  if (viewer === "notebook") return <div className="file-scroll"><NotebookView url={url} /></div>;
  if (viewer === "deck") {
    return (
      <DeckView
        projectId={projectId}
        name={file.name}
        slideshow={p.slideshow}
        slideIndex={p.slideIndex}
        onSlideIndex={p.onSlideIndex}
        onSlideCount={p.onSlideCount}
        config={p.config}
        presenting={p.presenting}
      />
    );
  }

  if (viewer === "office") {
    return (
      <div className="empty-state">
        <h2>{file.name}</h2>
        <p>Word and Excel files cannot be rendered by a browser. Export to PDF and add that instead, or open the file from the project folder.</p>
        <p><a href={url} download={file.name}>Download {file.name}</a></p>
      </div>
    );
  }

  if (viewer === "table") {
    const rows = text ? parseDelimited(text, file.ext === ".tsv" ? "\t" : ",") : [];
    return (
      <div className="file-scroll">
        <table className="data-table">
          <thead><tr>{(rows[0] || []).map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
          <tbody>{rows.slice(1).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }

  // markdown / plain text
  return (
    <div className={`file-scroll ${p.slideshow ? "as-slide" : ""}`} onMouseUp={onMouseUp} onClick={(e) => {
      const mark = (e.target as HTMLElement).closest("mark.hl") as HTMLElement | null;
      if (mark?.dataset.hid) p.onSelectHighlight(mark.dataset.hid);
    }}>
      {viewer === "markdown" ? (
        <div ref={bodyRef} className={`md-preview file-body ${p.slideshow ? "slide" : ""}`} style={{ fontSize: `${fontScale}rem` }} dangerouslySetInnerHTML={{ __html: markdownHtml }} />
      ) : (
        <div ref={bodyRef} className="file-body"><pre className="file-text" style={{ fontSize: `${fontScale * 0.85}rem` }}>{text ?? "Loading…"}</pre></div>
      )}
      {popup && <HighlightPopup x={popup.x} y={popup.y} flip={popup.flip} onCommit={commit} onCancel={() => setPopup(null)} />}
    </div>
  );
}
