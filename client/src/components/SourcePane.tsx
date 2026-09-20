import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookmarkPlus, Check, ChevronLeft, ChevronRight, CornerUpLeft, ExternalLink, Maximize, MoreHorizontal, NotebookText, Play, RefreshCw, ZapOff } from "lucide-react";
import type { CodeView, Highlight, PaneView, ReadingPosition, Source } from "../types";
import { trackReadingPosition } from "../../../server/public/reading-position.js";
import type { AppConfig } from "../api";
import { Reader } from "./Reader";
import { OriginalView } from "./OriginalView";
import { FileView } from "./FileView";
import { SourceSummary } from "./SourceSummary";
import { CodeSourceView } from "./FilesPane";
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
  /** A code source reports where it is scrolled, for a beat to capture. */
  onCodePlace: (code: CodeView) => void;
  dark: boolean;
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
  // The key handler below outlives renders; through this it always pages from the slide on
  // screen, not the one showing when it was attached — which stopped the arrows at slide two.
  const pageSlides = useRef(setSlideIndex);
  pageSlides.current = setSlideIndex;
  const [slideCount, setSlideCount] = useState(1);
  const stageRef = useRef<HTMLDivElement>(null);

  const source = p.source;
  const isFile = source?.kind === "file" && !!source.file;
  const isCode = source?.kind === "code" && !!source.code;
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
    if (!host || isCode || (!isFile && mode === "original")) return;
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
    if (!slideshow || viewer !== "markdown") return; // deck and PDF handle their own keys
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector(".app.present")) return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (["ArrowRight", "PageDown", " "].includes(e.key)) { pageSlides.current((i) => Math.min(slideCount - 1, i + 1)); e.preventDefault(); }
      if (["ArrowLeft", "PageUp"].includes(e.key)) { pageSlides.current((i) => Math.max(0, i - 1)); e.preventDefault(); }
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
  const hasSummary = Boolean(source.summary?.trim());
  // Hidden in Present mode with the panel itself, so neither reaches a recording.
  const summaryButton = !p.presenting && !page && (
    <button
      className={`icon-btn summary-btn ${p.summaryOpen ? "on" : ""}`}
      onClick={() => p.onSummaryOpen(!p.summaryOpen)}
      title={p.summaryOpen ? "Hide the summary" : hasSummary ? "Show your summary of this source" : "Write a summary of this source"}
      aria-pressed={p.summaryOpen}
    >
      <NotebookText size={14} />
      {hasSummary && <span className="summary-dot" />}
    </button>
  );

  return (
    <div className="source-pane">
      <div className="pane-toolbar">
        {picker}
        {isCode ? (
          <>
            <span className="file-chip">code</span>
            <span className="muted small grow ellipsis" title={source.url}>{source.url}</span>
            {summaryButton}
          </>
        ) : isFile ? (
          <>
            <span className="file-chip">{source.file!.ext.replace(".", "") || "file"}</span>
            <span className="muted small grow ellipsis" title={source.file!.name}>{source.file!.name}</span>
            {canSlide && (
              <>
                {(viewer === "pdf" || (slideshow && viewer === "markdown")) && (
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
            {summaryButton}
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
            {!scripts && mode === "original" && (
              <button className="scripts-off" onClick={p.onToggleScripts} title="This page's own scripts are off, which can leave parts of it blank. Click to turn them back on.">
                <ZapOff size={12} /> scripts off
              </button>
            )}
            {summaryButton}
            <PageMenu
              scripts={scripts}
              canToggleScripts={mode === "original"}
              onToggleScripts={p.onToggleScripts}
              onRefresh={p.onRefresh}
              busy={p.busy}
              url={page ?? source.url}
            />
          </>
        )}
      </div>

      {!p.presenting && !page && p.summaryOpen && (
        <SourceSummary value={source.summary ?? ""} onClose={() => p.onSummaryOpen(false)} onChange={p.onSummary} />
      )}

      <div ref={stageRef} className="source-stage">
        {isCode ? (
          <CodeSourceView
            source={source}
            sources={p.sources}
            dark={p.dark}
            fontScale={p.fontScale}
            selectedHl={p.scrollToId}
            scrollNonce={p.scrollNonce}
            view={view}
            restoreNonce={p.restoreNonce}
            onPlace={p.onCodePlace}
            onMarkClick={p.onSelectHighlight}
          />
        ) : isFile ? (
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
            presenting={p.presenting}
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

/** Things done to a page now and then, kept off the toolbar that every recording shows. */
function PageMenu({ scripts, canToggleScripts, onToggleScripts, onRefresh, busy, url }: {
  scripts: boolean;
  canToggleScripts: boolean;
  onToggleScripts: () => void;
  onRefresh: () => void;
  busy: boolean;
  url: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    // A click inside the article frame never reaches this document; the window losing focus does.
    const blur = () => setOpen(false);
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", key);
    window.addEventListener("blur", blur);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", key); window.removeEventListener("blur", blur); };
  }, [open]);
  const run = (fn: () => void) => () => { setOpen(false); fn(); };

  return (
    <div className="page-menu" ref={ref}>
      <button className={`icon-btn ${open ? "on" : ""}`} onClick={() => setOpen((v) => !v)} title="More: page scripts, re-download, open in your browser" aria-expanded={open}>
        {busy ? <RefreshCw size={14} className="spin" /> : <MoreHorizontal size={15} />}
      </button>
      {open && (
        <div className="page-menu-list" role="menu">
          {canToggleScripts && (
            <button role="menuitemcheckbox" aria-checked={scripts} onClick={run(onToggleScripts)}>
              <span className="page-menu-check">{scripts && <Check size={13} />}</span> Run the page's own scripts
            </button>
          )}
          <button role="menuitem" onClick={run(onRefresh)} disabled={busy}>
            <RefreshCw size={13} /> Re-download this page
          </button>
          <a role="menuitem" href={url} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            <ExternalLink size={13} /> Open in your browser
          </a>
        </div>
      )}
    </div>
  );
}
