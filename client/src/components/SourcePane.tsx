import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Maximize, Play, RefreshCw, Zap, ZapOff } from "lucide-react";
import type { Highlight, PaneView, Source } from "../types";
import type { AppConfig } from "../api";
import { Reader } from "./Reader";
import { OriginalView } from "./OriginalView";
import { FileView } from "./FileView";

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
  const slideshow = Boolean(p.view.slideshow);
  const slideIndex = p.view.slideIndex ?? 0;
  const setSlideshow = (v: boolean) => p.onView({ ...p.view, slideshow: v });
  const setSlideIndex = (v: number | ((i: number) => number)) =>
    p.onView({ ...p.view, slideIndex: typeof v === "function" ? v(slideIndex) : v });
  const [slideCount, setSlideCount] = useState(1);
  const stageRef = useRef<HTMLDivElement>(null);

  const source = p.source;
  const isFile = source?.kind === "file" && !!source.file;
  const viewer = isFile ? source!.file!.viewer : null;
  const canSlide = !!viewer && SLIDEABLE.has(viewer);

  useEffect(() => { setSlideshow(false); setSlideIndex(0); }, [source?.id]);

  useEffect(() => {
    if (!slideshow || viewer !== "markdown") return; // deck and pdf handle their own keys
    const onKey = (e: KeyboardEvent) => {
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
            <div className="seg">
              <button className={p.mode === "original" ? "active" : ""} onClick={() => p.onMode("original")}>Original</button>
              <button className={p.mode === "reader" ? "active" : ""} onClick={() => p.onMode("reader")}>Reader</button>
            </div>
            <span className="muted small grow ellipsis" title={source.url}>{source.url}</span>
            {p.mode === "original" && (
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
        ) : p.mode === "original" ? (
          <OriginalView
            source={source}
            apiPort={p.apiPort}
            scripts={scripts}
            onAddHighlight={p.onAddHighlight}
            onSelectHighlight={p.onSelectHighlight}
            onOpenLink={p.onOpenLink}
            scrollToId={p.scrollToId}
            scrollNonce={p.scrollNonce}
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
