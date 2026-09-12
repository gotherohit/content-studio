import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, MonitorPlay, RefreshCw } from "lucide-react";
import { api, type AppConfig } from "../api";
import type { DeckRender } from "../types";

interface Props {
  projectId: string;
  name: string;
  slideshow: boolean;
  slideIndex: number;
  onSlideIndex: (i: number) => void;
  onSlideCount: (n: number) => void;
  config: AppConfig | null;
}

/**
 * A PowerPoint deck. PowerPoint itself renders each slide to an image, so fonts,
 * charts and layout are exactly as designed. Build animations cannot survive a
 * still image, so "Play in PowerPoint" starts the real slideshow, which the Window
 * pane can mirror and drive.
 */
export function DeckView({ projectId, name, slideshow, slideIndex, onSlideIndex, onSlideCount, config }: Props) {
  const [render, setRender] = useState<DeckRender | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.renderDeck(projectId, name);
      setRender(r);
      onSlideCount(r.slides.length || 1);
      if (r.error) setErr(r.error);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [projectId, name]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const slides = render?.slides ?? [];
  const idx = Math.min(slideIndex, Math.max(0, slides.length - 1));

  useEffect(() => {
    if (!slideshow || !slides.length) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (["ArrowRight", "PageDown", " "].includes(e.key)) { onSlideIndex(Math.min(slides.length - 1, idx + 1)); e.preventDefault(); }
      if (["ArrowLeft", "PageUp"].includes(e.key)) { onSlideIndex(Math.max(0, idx - 1)); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slideshow, slides.length, idx, onSlideIndex]);

  async function present() {
    setErr(null);
    try { await api.presentDeck(projectId, name); }
    catch (e) { setErr((e as Error).message); }
  }

  if (busy) return <div className="panel-empty">Rendering slides with PowerPoint…</div>;

  // LibreOffice route: we got a PDF instead of images.
  if (render?.pdf) {
    return <iframe className="file-frame" src={api.deckSlideUrl(projectId, name, render.pdf)} title={name} />;
  }

  if (!slides.length) {
    return (
      <div className="empty-state">
        <h2>Cannot render {name}</h2>
        {render?.renderer === "none" ? (
          <p>Rendering a PowerPoint deck needs PowerPoint or <a href="https://www.libreoffice.org/download/" target="_blank" rel="noreferrer">LibreOffice</a> installed. Exporting the deck to PDF also works, and PDFs get the same slideshow.</p>
        ) : (
          <p>The renderer did not produce any slides.</p>
        )}
        {err && <pre className="code-output err">{err}</pre>}
        <div className="row">
          <button onClick={load}><RefreshCw size={13} /> Try again</button>
          {config?.powerPoint && <button className="ghost" onClick={present}><MonitorPlay size={13} /> Open in PowerPoint</button>}
        </div>
      </div>
    );
  }

  if (slideshow) {
    return (
      <div className="deck-stage" onClick={(e) => onSlideIndex(e.shiftKey ? Math.max(0, idx - 1) : Math.min(slides.length - 1, idx + 1))}>
        <img className="deck-slide" src={api.deckSlideUrl(projectId, name, slides[idx])} alt={`Slide ${idx + 1}`} />
        <div className="deck-controls" onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn" onClick={() => onSlideIndex(Math.max(0, idx - 1))} disabled={idx === 0}><ChevronLeft size={16} /></button>
          <span className="muted small">{idx + 1} / {slides.length}</span>
          <button className="icon-btn" onClick={() => onSlideIndex(Math.min(slides.length - 1, idx + 1))} disabled={idx >= slides.length - 1}><ChevronRight size={16} /></button>
          {config?.powerPoint && (
            <button className="ghost small" onClick={present} title="Run the real slideshow so transitions and build animations play; mirror it with a Window pane">
              <MonitorPlay size={13} /> Play in PowerPoint
            </button>
          )}
        </div>
        {err && <div className="error-bar" onClick={() => setErr(null)}>{err}</div>}
      </div>
    );
  }

  // Filmstrip: every slide, click one to jump to it.
  return (
    <div className="deck-grid">
      {err && <div className="error-bar" onClick={() => setErr(null)}>{err}</div>}
      {slides.map((s, i) => (
        <button key={s} className={`deck-thumb ${i === idx ? "active" : ""}`} onClick={() => onSlideIndex(i)}>
          <img src={api.deckSlideUrl(projectId, name, s)} alt={`Slide ${i + 1}`} loading="lazy" />
          <span className="deck-num">{i + 1}</span>
        </button>
      ))}
    </div>
  );
}
