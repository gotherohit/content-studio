import { useEffect, useRef, useState } from "react";
import type { Highlight, HighlightColor, Source } from "../types";
import { HighlightPopup } from "./HighlightPopup";

type Anchor = { text: string; prefix: string; suffix: string };

interface Props {
  source: Source;
  apiPort: number;
  scripts: boolean;
  onAddHighlight: (h: Highlight) => void;
  onSelectHighlight: (id: string) => void;
  onOpenLink: (url: string, newTab: boolean) => void;
  scrollToId: string | null;
  scrollNonce: number;
}

/** "https://www.example.com/a/b#c" -> "http://www--example--com.localhost:4700/a/b#c" (the app's reverse proxy). */
export function proxiedUrl(url: string, apiPort: number, scripts: boolean): string {
  const u = new URL(url);
  const sub = u.hostname.toLowerCase().replace(/\./g, "--");
  const q = scripts ? u.search : u.search ? `${u.search}&__rs_scripts=0` : "?__rs_scripts=0";
  return `http://${sub}.localhost:${apiPort}${u.pathname}${q}${u.hash}`;
}

/** The page exactly as the site serves it, running its own scripts, with highlights layered on top. */
export function OriginalView({ source, apiPort, scripts, onAddHighlight, onSelectHighlight, onOpenLink, scrollToId, scrollNonce }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [popup, setPopup] = useState<{ x: number; y: number; flip: boolean; anchor: Anchor } | null>(null);
  const src = proxiedUrl(source.url, apiPort, scripts);

  const post = (msg: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ src: "rs-app", ...msg }, "*");

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data || {};
      if (m.src !== "rs-frame" || e.source !== frame.current?.contentWindow) return;
      if (m.type === "ready") { setReady(true); post({ type: "highlights", list: source.highlights }); }
      if (m.type === "selection") {
        if (!m.anchor) { setPopup(null); return; }
        const host = frame.current!.getBoundingClientRect();
        const r = m.rect;
        const flip = r.top < 120;
        setPopup({ x: Math.min(Math.max(r.left + r.width / 2, 170), host.width - 170), y: flip ? r.bottom + 8 : r.top - 8, flip, anchor: m.anchor });
      }
      if (m.type === "scroll") setPopup(null);
      if (m.type === "hlclick") onSelectHighlight(m.id);
      if (m.type === "link") onOpenLink(m.url, Boolean(m.modifier));
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [source.highlights, onSelectHighlight, onOpenLink]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (ready) post({ type: "highlights", list: source.highlights }); }, [source.highlights, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready && scrollToId) post({ type: "scrollTo", id: scrollToId }); }, [scrollToId, scrollNonce, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setReady(false); setPopup(null); }, [source.id, scripts]);

  function commit(color: HighlightColor, comment: string) {
    if (!popup) return;
    onAddHighlight({ id: `h${Date.now().toString(36)}`, ...popup.anchor, color, comment, createdAt: new Date().toISOString() });
    post({ type: "clearSelection" });
    setPopup(null);
  }

  return (
    <div className="original-host">
      <iframe
        ref={frame}
        key={`${source.id}-${scripts}`}
        className="original-frame"
        src={src}
        title={source.title}
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
      />
      {popup && <HighlightPopup x={popup.x} y={popup.y} flip={popup.flip} onCommit={commit} onCancel={() => setPopup(null)} />}
    </div>
  );
}
