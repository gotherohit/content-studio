import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Highlight, HighlightColor, ReadingPosition, Source } from "../types";
import { HighlightPopup } from "./HighlightPopup";
import { samePage } from "../../../server/public/pages.js";

type Anchor = { text: string; prefix: string; suffix: string };

interface Props {
  source: Source;
  apiPort: number;
  scripts: boolean;
  onAddHighlight: (h: Highlight) => void;
  onSelectHighlight: (id: string) => void;
  onOpenLink: (url: string, newTab: boolean) => void;
  /** Another page of the source's site to show instead of the source's own page. */
  page?: string;
  /** The frame is now on this page, whether by a link here or by the site's own routing. */
  onPage: (url: string) => void;
  scrollToId: string | null;
  scrollNonce: number;
  position?: ReadingPosition;
  restoreNonce: number;
  presenting: boolean;
  onPresentationKey: (key: string) => void;
  onPosition: (position: ReadingPosition, url: string) => void;
}

/** "https://www.example.com/a/b#c" -> "http://www--example--com.localhost:4700/a/b#c" (the app's reverse proxy). */
export function proxiedUrl(url: string, apiPort: number, scripts: boolean): string {
  const u = new URL(url);
  const sub = u.hostname.toLowerCase().replace(/\./g, "--");
  const q = scripts ? u.search : u.search ? `${u.search}&__rs_scripts=0` : "?__rs_scripts=0";
  return `http://${sub}.localhost:${apiPort}${u.pathname}${q}${u.hash}`;
}

/** The page exactly as the site serves it, running its own scripts, with highlights layered on top. */
export function OriginalView({ source, apiPort, scripts, onAddHighlight, onSelectHighlight, onOpenLink, page, onPage, scrollToId, scrollNonce, position, restoreNonce, onPosition, presenting, onPresentationKey }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [restoredNonce, setRestoredNonce] = useState<number | null>(null);
  const [positionError, setPositionError] = useState(false);
  const target = page ?? source.url;
  // The frame navigates by itself, so its src is only set when the app asks for a different
  // page. Deriving it from `target` would reload a page the frame has just arrived at.
  const [frameUrl, setFrameUrl] = useState(target);
  const shown = useRef(target);
  const latest = useRef({ position, restoreNonce, onPosition, presenting, onPresentationKey, target, onPage });
  latest.current = { position, restoreNonce, onPosition, presenting, onPresentationKey, target, onPage };
  const [popup, setPopup] = useState<{ x: number; y: number; flip: boolean; anchor: Anchor } | null>(null);
  const src = proxiedUrl(frameUrl, apiPort, scripts);

  const post = (msg: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ src: "rs-app", ...msg }, "*");

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data || {};
      if (m.src !== "rs-frame" || e.source !== frame.current?.contentWindow) return;
      if (m.type === "ready") {
        setReady(true);
        if (m.url) arrived(m.url);
        post({ type: "home", url: source.url });
        post({ type: "highlights", list: source.highlights });
        post({ type: "restorePosition", position: latest.current.position, nonce: latest.current.restoreNonce, page: latest.current.target });
        post({ type: "presentation", enabled: latest.current.presenting });
      }
      if (m.type === "navigated" && m.url) arrived(m.url);
      if (m.type === "position" && m.nonce === latest.current.restoreNonce && m.position && Number.isFinite(m.position.y) && Number.isFinite(m.position.x)) latest.current.onPosition(m.position, m.url ?? shown.current);
      // A page that is being replaced can still answer; only the page asked for counts.
      if (m.type === "positionRestored" && m.nonce === latest.current.restoreNonce && (!m.url || samePage(m.url, latest.current.target))) { setRestoredNonce(m.nonce); setPositionError(false); }
      if (m.type === "presentationKey" && latest.current.presenting && ["ArrowRight", "ArrowLeft", "PageDown", "PageUp", " ", "Home", "End", "Escape", "h"].includes(m.key)) latest.current.onPresentationKey(m.key);
      if (m.type === "selection") {
        if (!m.anchor) { setPopup(null); return; }
        const host = frame.current!.getBoundingClientRect();
        const r = m.rect;
        const flip = r.top < 120;
        setPopup({ x: Math.min(Math.max(r.left + r.width / 2, 170), host.width - 170), y: flip ? r.bottom + 8 : r.top - 8, flip, anchor: m.anchor });
      }
      if (m.type === "scroll") setPopup(null);
      if (m.type === "hlclick") onSelectHighlight(m.id);
      if (m.type === "link") {
        if (m.sameSite && !m.modifier) latest.current.onPage(m.url);
        else onOpenLink(m.url, Boolean(m.modifier));
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [source.highlights, onSelectHighlight, onOpenLink]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (ready) post({ type: "highlights", list: source.highlights }); }, [source.highlights, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready && scrollToId) post({ type: "scrollTo", id: scrollToId }); }, [scrollToId, scrollNonce, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Where the frame really is; a redirect or the site's own routing can differ from what was asked. */
  function arrived(url: string) {
    shown.current = url;
    if (!samePage(url, latest.current.target)) latest.current.onPage(url);
  }
  useLayoutEffect(() => {
    if (samePage(target, shown.current)) return;
    shown.current = target;
    // After in-page routing the frame's src still names the page it started on; setting the
    // attribute again is what makes it load that page.
    if (frameUrl === target && frame.current) frame.current.src = proxiedUrl(target, apiPort, scripts);
    else setFrameUrl(target);
    setReady(false);
    setPopup(null);
  }, [target]);
  useLayoutEffect(() => { if (ready && samePage(shown.current, target)) post({ type: "restorePosition", position, nonce: restoreNonce, page: target }); }, [restoreNonce, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready) post({ type: "presentation", enabled: presenting }); }, [presenting, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setReady(false); setPopup(null); }, [source.id, scripts]);
  useEffect(() => {
    if (!position || restoredNonce === restoreNonce) return;
    setPositionError(false);
    const timer = window.setTimeout(() => {
      setPositionError(true);
      setRestoredNonce(restoreNonce);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [position, restoreNonce, restoredNonce]);

  function commit(color: HighlightColor, comment: string) {
    if (!popup) return;
    onAddHighlight({ id: `h${Date.now().toString(36)}`, ...popup.anchor, color, comment, createdAt: new Date().toISOString() });
    post({ type: "clearSelection" });
    setPopup(null);
  }

  return (
    <div className="original-host">
      {positionError && <div className="error-bar">This page did not confirm its saved reading position. Try Reader view or capture this beat again.</div>}
      <iframe
        ref={frame}
        key={`${source.id}-${scripts}`}
        className="original-frame"
        style={{ visibility: position && restoredNonce !== restoreNonce ? "hidden" : "visible" }}
        src={src}
        title={source.title}
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
      />
      {popup && <HighlightPopup x={popup.x} y={popup.y} flip={popup.flip} onCommit={commit} onCancel={() => setPopup(null)} />}
    </div>
  );
}
