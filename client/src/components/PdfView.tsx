import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { GlobalWorkerOptions, TextLayer, getDocument, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { Minus, Plus } from "lucide-react";
import type { Highlight, HighlightColor, Shape, ShapeKind } from "../types";
import { applyHighlights, captureSelection } from "../highlighter";
import { HighlightPopup } from "./HighlightPopup";
import { ShapeLayer, type LayerItem } from "./ShapeLayer";
import { fromDrag, shapeHighlights, textHighlights } from "../shapes";
import { boxWithin } from "../../../server/public/shapes-dom.js";
import { PAGE_GAP, clampPage, fitScale, highlightsOnPage, layoutPages, offsetOf, pageAt, pageOf, stepZoom, visiblePages, type PageSize } from "../pdf";

GlobalWorkerOptions.workerSrc = workerUrl;

/** Everything pdf.js fetches at runtime, copied into public/pdfjs before dev and builds. */
const ASSETS = {
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
  iccUrl: "/pdfjs/iccs/",
  enableHWA: true,
};

interface Props {
  url: string;
  name: string;
  slideshow: boolean;
  /** The page being shown, zero-based. Held by the pane, so a beat can capture it. */
  page: number;
  onPage: (i: number) => void;
  onCount: (n: number) => void;
  presenting: boolean;
  /** A deck rendered to PDF has no highlights of its own, so these are optional. */
  highlights?: Highlight[];
  onAddHighlight?: (h: Highlight) => void;
  onUpdateHighlight?: (h: Highlight) => void;
  onSelectHighlight?: (id: string) => void;
  scrollToId?: string | null;
  scrollNonce?: number;
  /** The drawing tool in the toolbar, and the colour it draws in. */
  tool?: ShapeKind | null;
  drawColor?: HighlightColor;
  showNotes?: boolean;
  linkedIds?: string[];
  onNote?: (id: string, at: { x: number; y: number }) => void;
}

/**
 * A PDF drawn by pdf.js, one canvas per page and only near the viewport. Chromium's own
 * viewer is a plugin in an iframe: it scrolls badly inside a pane, reports nothing about
 * which page is showing, and swallows the keys.
 */
export function PdfView(p: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageEls = useRef(new Map<number, HTMLDivElement>());
  const textEls = useRef(new Map<number, HTMLDivElement>());
  const tasks = useRef(new Map<number, RenderTask>());
  const painted = useRef(new Map<number, number>());
  const generation = useRef(0);
  const docRef = useRef<PDFDocumentProxy | null>(null);

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  // Markers for quotes: their marks only exist once a page has been drawn, so they are
  // measured after painting rather than worked out from the highlight list.
  const [quoteMarks, setQuoteMarks] = useState<Record<number, LayerItem[]>>({});
  const [popup, setPopup] = useState<{
    x: number; y: number; flip: boolean; page: number;
    anchor?: NonNullable<ReturnType<typeof captureSelection>>;
    shape?: Shape;
  } | null>(null);

  const highlights = p.highlights ?? [];
  // paint() is memoised on the scale, but must always draw the highlights as they are now.
  const marks = useRef(highlights);
  marks.current = highlights;

  const count = sizes.length;
  const page = clampPage(p.page, count);
  const onPage = useRef(p.onPage);
  onPage.current = p.onPage;
  const onCount = useRef(p.onCount);
  onCount.current = p.onCount;
  // What we last told the pane, so its echo back does not scroll the page out from under a read.
  const reported = useRef(page);

  useEffect(() => {
    let cancelled = false;
    setDoc(null); setSizes([]); setErr(null); setZoom(1);
    const task = getDocument({ url: p.url, ...ASSETS });
    task.promise.then(async (pdf) => {
      const measured = await Promise.all(
        Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1).then((pg) => {
          const v = pg.getViewport({ scale: 1 });
          return { width: v.width, height: v.height };
        })),
      );
      if (cancelled) return;
      docRef.current = pdf;
      setDoc(pdf); setSizes(measured);
      onCount.current(pdf.numPages);
    }).catch((e) => { if (!cancelled) setErr(e?.message ?? String(e)); });
    return () => {
      cancelled = true;
      void task.destroy().catch(() => {});
      docRef.current = null;
    };
  }, [p.url]);

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Slides show one whole page; the document view fills the pane and scrolls.
  const widest = useMemo(() => sizes.reduce((a, s) => (s.width > a.width ? s : a), sizes[0] ?? { width: 1, height: 1 }), [sizes]);
  const scale = useMemo(() => {
    if (!count || !box.width) return 0;
    return p.slideshow
      ? fitScale(sizes[page] ?? widest, box, "page")
      : fitScale(widest, box, "width") * zoom;
  }, [count, box, p.slideshow, page, sizes, widest, zoom]);
  const layout = useMemo(() => layoutPages(sizes, scale), [sizes, scale]);

  // paint() is memoised on the scale; the marks it lays must still be measured afterwards.
  const placeMarks = useRef(() => {});
  const paint = useCallback(async (i: number) => {
    const pdf = docRef.current, host = pageEls.current.get(i);
    if (!pdf || !host || !scale) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const want = Math.round(scale * dpr * 1000) / 1000;
    if (painted.current.get(i) === want) return;
    const mine = generation.current;
    painted.current.set(i, want);
    try {
      const pdfPage = await pdf.getPage(i + 1);
      if (mine !== generation.current) return;
      const viewport = pdfPage.getViewport({ scale: want });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const task = pdfPage.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport });
      tasks.current.get(i)?.cancel();
      tasks.current.set(i, task);
      await task.promise;
      tasks.current.delete(i);
      const el = pageEls.current.get(i);
      if (mine !== generation.current || !el) return;
      el.replaceChildren(canvas);
      // An invisible layer of the real text, so a quote can still be selected and copied.
      const text = document.createElement("div");
      text.className = "textLayer";
      const css = pdfPage.getViewport({ scale });
      el.style.setProperty("--scale-factor", String(scale));
      el.style.setProperty("--total-scale-factor", String(scale));
      await new TextLayer({ textContentSource: pdfPage.streamTextContent(), container: text, viewport: css }).render();
      if (mine !== generation.current || pageEls.current.get(i) !== el) return;
      el.append(text);
      textEls.current.set(i, text);
      applyHighlights(text, textHighlights(highlightsOnPage(marks.current, i)));
      placeMarks.current();
    } catch {
      // A cancelled render is the normal way a scroll interrupts one.
      painted.current.delete(i);
    }
  }, [scale]);

  const settle = useRef(0);
  /**
   * Draw what is on screen and drop the canvases that are not: a long PDF is mostly off it.
   * Rasterising a page is main-thread work, so while the scroll is still moving it waits for
   * it to settle — a page drawn for a position already scrolled past only costs smoothness.
   */
  const draw = useCallback((defer = false) => {
    const scroller = scrollRef.current;
    if (!scroller || !count || !scale) return;
    const { start, end } = p.slideshow
      ? { start: page, end: page }
      : visiblePages(layout, scroller.scrollTop, scroller.clientHeight);
    for (const [i, el] of pageEls.current) {
      if (i >= start && i <= end) continue;
      tasks.current.get(i)?.cancel();
      tasks.current.delete(i);
      painted.current.delete(i);
      textEls.current.delete(i);
      el.replaceChildren();
    }
    clearTimeout(settle.current);
    const run = () => { for (let i = start; i <= end; i++) void paint(i); };
    if (defer) settle.current = window.setTimeout(run, 90); else run();
  }, [count, scale, layout, p.slideshow, page, paint]);

  // Any change of scale invalidates every canvas, so start a new generation and repaint.
  useLayoutEffect(() => {
    generation.current++;
    for (const task of tasks.current.values()) task.cancel();
    tasks.current.clear();
    painted.current.clear();
    for (const el of pageEls.current.values()) el.replaceChildren();
    textEls.current.clear();
    draw();
  }, [scale, doc, p.slideshow]); // eslint-disable-line react-hooks/exhaustive-deps

  // The pane asked for a page: from the toolbar, or restoring a beat.
  useEffect(() => {
    if (p.slideshow || !count || page === reported.current) return;
    reported.current = page;
    scrollRef.current?.scrollTo({ top: offsetOf(layout, page), behavior: "instant" });
    draw();
  }, [page, count, layout, p.slideshow]); // eslint-disable-line react-hooks/exhaustive-deps

  // A highlight added, recoloured or deleted must show on the pages already drawn.
  useEffect(() => {
    for (const [i, text] of textEls.current) applyHighlights(text, textHighlights(highlightsOnPage(highlights, i)));
    placeQuoteMarks();
  }, [highlights]);

  const placeQuoteMarks = useCallback(() => {
    const next: Record<number, LayerItem[]> = {};
    for (const [i, text] of textEls.current) {
      const host = pageEls.current.get(i);
      if (!host) continue;
      const items: LayerItem[] = [];
      for (const h of highlightsOnPage(highlights, i)) {
        const linked = p.linkedIds?.includes(h.id);
        if (h.shape || (!h.comment?.trim() && !linked)) continue;
        const marks = text.querySelectorAll<HTMLElement>(`mark.hl[data-hid="${h.id}"]`);
        const last = marks[marks.length - 1];
        if (last) items.push({ id: h.id, color: h.color, comment: h.comment, linked, host: boxWithin(host, last) });
      }
      if (items.length) next[i] = items;
    }
    setQuoteMarks(next);
  }, [highlights, p.linkedIds]);

  placeMarks.current = placeQuoteMarks;
  useEffect(() => { placeQuoteMarks(); }, [placeQuoteMarks, scale, page, doc]);

  const frame = useRef(0);
  const onScroll = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      draw(true);
      const at = pageAt(layout, scroller.scrollTop, scroller.clientHeight);
      if (at !== reported.current) { reported.current = at; onPage.current(at); }
    });
  };
  useEffect(() => () => { cancelAnimationFrame(frame.current); clearTimeout(settle.current); }, []);

  const goTo = useCallback((i: number) => {
    const next = clampPage(i, count);
    if (next === reported.current) return;
    reported.current = next;
    onPage.current(next);
    if (!p.slideshow) scrollRef.current?.scrollTo({ top: offsetOf(layout, next), behavior: "instant" });
  }, [count, layout, p.slideshow]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !count) return;
    const onKey = (e: KeyboardEvent) => {
      // In Present mode the arrows belong to the beats, as they do for a Markdown deck.
      if (p.presenting) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      // With a second PDF open only the pane holding focus pages; with one, the keys are its own.
      if (document.querySelectorAll(".pdf-view").length > 1 && !host.contains(document.activeElement)) return;
      const on = ["ArrowRight", "PageDown"].includes(e.key) || (p.slideshow && e.key === " ");
      const back = ["ArrowLeft", "PageUp"].includes(e.key);
      if (on || back) { goTo(reported.current + (on ? 1 : -1)); e.preventDefault(); return; }
      if (e.key === "Home" || e.key === "End") { goTo(e.key === "Home" ? 0 : count - 1); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, goTo, p.slideshow, p.presenting]);

  /** Choosing a highlight card: turn to its page, then put the passage on screen. */
  useEffect(() => {
    const h = p.scrollToId ? highlights.find((x) => x.id === p.scrollToId) : null;
    if (!h || !count) return;
    goTo(pageOf(h));
    if (h.shape) return;
    let tries = 0;
    const timer = setInterval(() => {
      const mark = scrollRef.current?.querySelector<HTMLElement>(`mark.hl[data-hid="${h.id}"]`);
      // "nearest", not "center": centring a passage pushes its page off the top of the pane,
      // and the counter would then name the page before it.
      if (mark) mark.scrollIntoView({ behavior: "instant", block: "nearest" });
      if (mark || ++tries > 20) clearInterval(timer);
    }, 100);
    return () => clearInterval(timer);
  }, [p.scrollToId, p.scrollNonce, count]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A selection inside one page's text layer becomes a highlight on that page. */
  const onMouseUp = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".hl-popup")) return;
    const scroller = scrollRef.current;
    const layer = (e.target as HTMLElement).closest(".textLayer") as HTMLElement | null;
    if (!scroller || !layer || !p.onAddHighlight) { setPopup(null); return; }
    const anchor = captureSelection(layer);
    // Null for a selection running across two pages: each page has its own text.
    if (!anchor || !anchor.text.trim()) { setPopup(null); return; }
    const i = [...textEls.current].find(([, el]) => el === layer)?.[0] ?? 0;
    const rect = scroller.ownerDocument.defaultView!.getSelection()!.getRangeAt(0).getBoundingClientRect();
    const host = scroller.getBoundingClientRect();
    const above = rect.top - host.top;
    const flip = above < 120;
    setPopup({
      x: Math.min(Math.max(rect.left - host.left + rect.width / 2, 170), host.width - 170),
      y: (flip ? rect.bottom - host.top + 8 : above - 8) + scroller.scrollTop,
      flip, page: i, anchor,
    });
  };

  const commit = (color: HighlightColor, comment: string) => {
    if (!popup || !p.onAddHighlight) return;
    const anchor = popup.anchor ?? { text: "", prefix: "", suffix: "" };
    p.onAddHighlight({ id: `h${Date.now().toString(36)}`, ...anchor, shape: popup.shape, page: popup.page + 1, color, comment, createdAt: new Date().toISOString() });
    scrollRef.current?.ownerDocument.defaultView?.getSelection()?.removeAllRanges();
    setPopup(null);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey || p.slideshow) return;
    e.preventDefault();
    setZoom((z) => stepZoom(z, e.deltaY < 0 ? 1 : -1));
  };

  const setEl = (i: number) => (el: HTMLDivElement | null) => {
    if (el) pageEls.current.set(i, el); else pageEls.current.delete(i);
  };

  // The host is always rendered, or it would not be measured until the document arrived and
  // the pages would be laid out against a width of zero.
  return (
    <div className="pdf-view" ref={hostRef}>
      {err && <div className="panel-empty">Could not open {p.name}: {err}</div>}
      {!err && !count && <div className="panel-empty">Opening {p.name}…</div>}
      <div
        className={`pdf-scroll ${p.slideshow ? "as-slide" : ""}`}
        ref={scrollRef}
        tabIndex={0}
        onScroll={p.slideshow ? undefined : onScroll}
        onWheel={onWheel}
        onMouseUp={onMouseUp}
        onClick={(e) => {
          const mark = (e.target as HTMLElement).closest("mark.hl") as HTMLElement | null;
          if (mark?.dataset.hid) p.onSelectHighlight?.(mark.dataset.hid);
        }}
      >
        {(p.slideshow ? [page] : sizes.map((_, i) => i)).map((i) => (
          // The canvas and text layer are put into .pdf-page by hand, which replaces whatever is
          // inside it, so the shapes live beside it rather than in it.
          <div
            key={i}
            className="pdf-page-wrap"
            style={{ width: layout.widths[i], height: layout.heights[i], marginBottom: p.slideshow ? 0 : PAGE_GAP }}
          >
            <div className="pdf-page" ref={setEl(i)} />
            <ShapeLayer
              items={[
                ...shapeHighlights(highlightsOnPage(highlights, i)).map((h) => ({ id: h.id, shape: h.shape!, color: h.color, comment: h.comment, linked: p.linkedIds?.includes(h.id) })),
                ...(quoteMarks[i] ?? []),
              ]}
              tool={p.onAddHighlight ? p.tool ?? null : null}
              color={p.drawColor ?? "yellow"}
              selectedId={p.scrollToId}
              showNotes={p.showNotes !== false && !p.presenting}
              onSelect={(id) => p.onSelectHighlight?.(id)}
              onNote={p.onNote}
              onEdit={(id, drag) => {
                const was = highlights.find((h) => h.id === id);
                const shape = was?.shape && fromDrag(was.shape.kind, drag.from, drag.to, { width: layout.widths[i], height: layout.heights[i] });
                if (was && shape) p.onUpdateHighlight?.({ ...was, shape });
              }}
              onDraw={(drag) => {
                const shape = fromDrag(p.tool!, drag.from, drag.to, { width: layout.widths[i], height: layout.heights[i] });
                if (!shape) return;
                const scroller = scrollRef.current;
                const host = scroller!.getBoundingClientRect();
                const pageBox = pageEls.current.get(i)!.getBoundingClientRect();
                const y = pageBox.top - host.top + Math.max(drag.from.y, drag.to.y) + scroller!.scrollTop;
                setPopup({
                  x: Math.min(Math.max(pageBox.left - host.left + (drag.from.x + drag.to.x) / 2, 170), host.width - 170),
                  y: y + 10, flip: true, page: i, shape,
                });
              }}
            />
          </div>
        ))}
{popup && <HighlightPopup selectionText={popup.shape ? undefined : popup.anchor?.text} x={popup.x} y={popup.y} flip={popup.flip} onCommit={commit} onCancel={() => setPopup(null)} />}
      </div>
      {!p.presenting && !p.slideshow && count > 0 && (
        <div className="pdf-zoom">
          <button className="icon-btn" onClick={() => setZoom((z) => stepZoom(z, -1))} title="Zoom out"><Minus size={13} /></button>
          <button className="ghost small" onClick={() => setZoom(1)} title="Fit the page width">{Math.round(zoom * 100)}%</button>
          <button className="icon-btn" onClick={() => setZoom((z) => stepZoom(z, 1))} title="Zoom in"><Plus size={13} /></button>
        </div>
      )}
    </div>
  );
}
