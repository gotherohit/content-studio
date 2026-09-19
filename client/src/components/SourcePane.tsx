import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookmarkPlus, ChevronLeft, ChevronRight, CornerUpLeft, ExternalLink, Maximize, Play, RefreshCw, Zap, ZapOff } from "lucide-react";
import type { Highlight, PaneView, ReadingPosition, Source } from "../types";
import { trackReadingPosition } from "../../../server/public/reading-position.js";
import type { AppConfig } from "../api";
import { Reader } from "./Reader";
import { OriginalView } from "./OriginalView";
import { FileView } from "./FileView";
import { SourceSummary } from "./SourceSummary";
import { samePage, stepPage, visitPage } from "../../../server/public/pages.js";

interface Props {
  source: Source | null;
  sources: Source[];
  pinnedId: string | null;
  onPin: (sourceId: string | null) => void;
  projectId: string;
  apiPort: number;
  mode: "original" | "reader";
  onMode: (m: "original" | "reader") => void;
  onToggleScripts: () => void;
  onAddHighlight: (h: Highlight) => void;
  onSelectHighlight: (id: string) => void;
  onOpenLink: (url: string, newTab: boolean) => void;
  onRefresh: () => void;
  scrollToId: string | null;
  scrollNonce: number;
  restoreNonce: number;
  presenting: boolean;
  onPresentationKey: (key: string) => void;
  /** `page` is undefined on the source's own page. */
  onPosition: (position: ReadingPosition, mode: string, page: string | undefined) => void;
  /** Turn a browsed page into a source of its own. */
  onSaveAsSource: (url: string) => void;
  /** The source this one was opened from, when it still exists. */
  fromSource: Source | null;
  onShowSource: (id: string) => void;
  summaryOpen: boolean;
  onSummaryOpen: (open: boolean) => void;
  onSummary: (summary: string) => void;
  /** Paging state, held by the app so a stage can capture and restore it. */
  view: PaneView;
  onView: (v: PaneView) => void;
  fontScale: number;
  busy: boolean;
  config: AppConfig | null;
}

/** Which file kinds can be paged through as slides. */
const SLIDEABLE = new Set(["markdown", "pdf", "deck"]);

export function SourcePane(p: Props) {
  const view = !p.view.sourceId || p.view.sourceId === p.source?.id ? p.view : {};
  const page = view.page && p.source && !samePage(view.page, p.source.url) ? view.page : undefined;
  // Reader shows the saved article, which is only ever the source's own page.
  const mode = page ? "original" : view.mode ?? p.mode;
  const setMode = (mode: "original" | "reader") => {
    p.onView({ ...view, sourceId: p.source?.id, mode, position: undefined });
    p.onMode(mode);
  };
  const slideshow = Boolean(view.slideshow);
  const slideIndex = view.slideIndex ?? 0;
  const setSlideshow = (v: boolean) => p.onView({ ...view, sourceId: p.source?.id, slideshow: v });
  const setSlideIndex = (v: number | ((i: number) => number)) =>
    p.onView({ ...view, sourceId: p.source?.id, slideIndex: typeof v === "function" ? v(slideIndex) : v });
  const [slideCount, setSlideCount] = useState(1);
  const stageRef = useRef<HTMLDivElement>(null);

  const source = p.source;
  const isFile = source?.kind === "file" && !!source.file;
  const viewer = isFile ? source!.file!.viewer : null;
  const canSlide = !!viewer && SLIDEABLE.has(viewer);

  const report = useRef(p.onPosition);
  report.current = p.onPosition;

  // The pane's own Back and Forward. The frame's history is shared with the studio window,
  // so going back there could leave the app itself.
  const home = p.source?.url ?? "";
  const [trail, setTrail] = useState(() => visitPage({ list: [home], at: 0 }, page ?? home));
  useEffect(() => { setTrail((t) => visitPage(t, page ?? home)); }, [page, home]);
  const showPage = (url: string) => {
    if (!p.source) return;
    p.onView({ ...view, sourceId: p.source.id, mode: "original", page: samePage(url, p.source.url) ? undefined : url, position: undefined });
  };
  // Choosing a highlight card while browsing elsewhere goes back to the page it is on.
  const mountedNonce = useRef(p.scrollNonce);
  useEffect(() => {
    if (p.scrollNonce !== mountedNonce.current && page && p.scrollToId) showPage(home);
  }, [p.scrollNonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const step = (by: number) => {
    const next = stepPage(trail, by);
    if (next === trail) return;
    setTrail(next);
    showPage(next.list[next.at]);
  };
  useLayoutEffect(() => {
    const host = stageRef.current;
    if (!host || (!isFile && mode === "original")) return;
    let cleanup: (() => void) | undefined;
    let current: Element | null = null;
    const attach = () => {
      const scroller = host.querySelector(".reader-scroll, .file-scroll, .deck-grid");
      if (!scroller || scroller === current) return;
      cleanup?.();
      current = scroller;
      cleanup = trackReadingPosition(scroller, scroller, view.position, (position) => report.current(position, mode, undefined));
    };
    attach();
    const observer = new MutationObserver(attach);
    observer.observe(host, { childList: true, subtree: true });
    return () => { observer.disconnect(); cleanup?.(); };
  }, [source?.id, mode, p.restoreNonce, slideshow]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!slideshow || viewer !== "markdown") return; // deck and pdf handle their own keys
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector(".app.present")) return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (["ArrowRight", "PageDown", " "].includes(e.key)) { setSlideIndex((i) => Math.min(slideCount - 1, i + 1)); e.preventDefault(); }
      if (["ArrowLeft", "PageUp"].includes(e.key)) { setSlideIndex((i) => Math.max(0, i - 1)); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slideshow, slideCount, viewer]);

  /** Lets each Source pane show a different source: a deck here, the article there. */
  const picker = (
    <select
      className="source-picker"
      value={p.pinnedId ?? ""}
      onChange={(e) => p.onPin(e.target.value || null)}
      title="Which source this pane shows"
    >
      <option value="">Follows selection</option>
      {p.sources.map((s) => (
        <option key={s.id} value={s.id}>{s.kind === "file" ? s.file?.name ?? s.title : s.title}</option>
      ))}
    </select>
  );

  if (!source) {
    return (
      <div className="source-pane">
        <div className="pane-toolbar">{picker}<span className="grow" /></div>
        <div className="empty-state">
          <h2>No source open</h2>
          <p>Paste a URL in the bar above, or drop a file anywhere in the window.</p>
          <p className="muted small">
            Sources can be web pages, slide decks (PDF or markdown), Jupyter notebooks, documents, images, CSV or plain text.
            Select text in any of them to highlight it and attach a comment.
          </p>
        </div>
      </div>
    );
  }

  const scripts = source.scripts !== false;

  return (
    <div className="source-pane">
      <div className="pane-toolbar">
        {picker}
        {isFile ? (
          <>
            <span className="file-chip">{source.file!.ext.replace(".", "") || "file"}</span>
            <span className="muted small grow ellipsis" title={source.file!.name}>{source.file!.name}</span>
            {canSlide && (
              <>
                {slideshow && viewer === "markdown" && (
                  <>
                    <button className="icon-btn" onClick={() => setSlideIndex((i) => Math.max(0, i - 1))} disabled={slideIndex === 0} title="Previous slide"><ChevronLeft size={15} /></button>
                    <span className="muted small">{slideIndex + 1}/{slideCount}</span>
                    <button className="icon-btn" onClick={() => setSlideIndex((i) => Math.min(slideCount - 1, i + 1))} disabled={slideIndex >= slideCount - 1} title="Next slide"><ChevronRight size={15} /></button>
                  </>
                )}
                <div className="seg">
                  <button className={!slideshow ? "active" : ""} onClick={() => setSlideshow(false)}>Document</button>
                  <button className={slideshow ? "active" : ""} onClick={() => setSlideshow(true)}><Play size={12} /> Slides</button>
                </div>
                <button className="icon-btn" title="Fullscreen" onClick={() => stageRef.current?.requestFullscreen?.()}><Maximize size={14} /></button>
              </>
            )}
            <a className="icon-btn" href={`/api/projects/${p.projectId}/sources/${encodeURIComponent(source.file!.name)}`} download={source.file!.name} title="Download"><ExternalLink size={14} /></a>
          </>
        ) : (
          <>
            <button className="icon-btn" onClick={() => step(-1)} disabled={trail.at === 0} title="Back to the previous page in this pane"><ArrowLeft size={14} /></button>
            <button className="icon-btn" onClick={() => step(1)} disabled={trail.at >= trail.list.length - 1} title="Forward"><ArrowRight size={14} /></button>
            <div className="seg">
              <button className={mode === "original" ? "active" : ""} onClick={() => setMode("original")}>Original</button>
              <button
                className={mode === "reader" ? "active" : ""}
                onClick={() => setMode("reader")}
                disabled={Boolean(page)}
                title={page ? "Reader shows a saved source. Save this page as a source to read it here." : undefined}
              >Reader</button>
            </div>
            {p.fromSource && !page && (
              <button className="from-chip" onClick={() => p.onShowSource(p.fromSource!.id)} title={`Opened from ${p.fromSource.url}`}>
                <CornerUpLeft size={12} /> <span className="ellipsis">{p.fromSource.title}</span>
              </button>
            )}
            <span className="muted small grow ellipsis" title={page ?? source.url}>{page ?? source.url}</span>
            {page && (
              <button className="ghost small save-page" onClick={() => p.onSaveAsSource(page)} title="Keep this page as a source, so it can have highlights and a summary">
                <BookmarkPlus size={13} /> Save as source
              </button>
            )}
            {mode === "original" && (
              <button
                className={`icon-btn ${scripts ? "on" : ""}`}
                onClick={p.onToggleScripts}
                title={scripts ? "Page scripts are running — click to disable" : "Page scripts are off — click to enable"}
              >{scripts ? <Zap size={14} /> : <ZapOff size={14} />}</button>
            )}
            <button className="icon-btn" onClick={p.onRefresh} title="Re-download this page" disabled={p.busy}>
              <RefreshCw size={14} className={p.busy ? "spin" : ""} />
            </button>
            <a className="icon-btn" href={source.url} target="_blank" rel="noreferrer" title="Open the real site in a new tab"><ExternalLink size={14} /></a>
          </>
        )}
      </div>

      {!p.presenting && !page && (
        <SourceSummary value={source.summary ?? ""} open={p.summaryOpen} onOpen={p.onSummaryOpen} onChange={p.onSummary} />
      )}

      <div ref={stageRef} className="source-stage">
        {isFile ? (
          <FileView
            source={source}
            projectId={p.projectId}
            fontScale={p.fontScale}
            slideshow={slideshow}
            slideIndex={slideIndex}
            onSlideCount={setSlideCount}
            onSlideIndex={setSlideIndex}
            config={p.config}
            scrollToId={p.scrollToId}
            scrollNonce={p.scrollNonce}
            onAddHighlight={p.onAddHighlight}
            onSelectHighlight={p.onSelectHighlight}
          />
        ) : mode === "original" ? (
          <OriginalView
            key={`${source.id}:${scripts}`}
            source={source}
            apiPort={p.apiPort}
            scripts={scripts}
            onAddHighlight={p.onAddHighlight}
            onSelectHighlight={p.onSelectHighlight}
            onOpenLink={p.onOpenLink}
            page={page}
            onPage={showPage}
            scrollToId={p.scrollToId}
            scrollNonce={p.scrollNonce}
            position={view.position}
            restoreNonce={p.restoreNonce}
            presenting={p.presenting}
            onPresentationKey={p.onPresentationKey}
            onPosition={(position, url) => report.current(position, mode, samePage(url, source.url) ? undefined : url)}
          />
        ) : (
          <Reader
            source={source}
            scrollToId={p.scrollToId}
            scrollNonce={p.scrollNonce}
            onAddHighlight={p.onAddHighlight}
            onSelectHighlight={p.onSelectHighlight}
            fontScale={p.fontScale}
          />
        )}
      </div>
    </div>
  );
}
