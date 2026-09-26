import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Highlight, HighlightColor, ReadingPosition, Shape, ShapeKind, Source, ShapeStyle } from "../types";
import { HighlightPopup } from "./HighlightPopup";
import { PALETTE } from "../shapes";
import { samePage } from "../../../server/public/pages.js";

type Anchor = { text: string; prefix: string; suffix: string };

interface Props {
  source: Source;
  apiPort: number;
  scripts: boolean;
  onAddHighlight: (h: Highlight) => void;
  onUpdateHighlight?: (h: Highlight) => void;
  onDeleteHighlight?: (id: string) => void;
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
  /** The drawing tool in the toolbar; while one is out the page itself cannot be clicked. */
  tool?: ShapeKind | null;
  drawColor?: HighlightColor;
  drawStyle?: ShapeStyle;
  showNotes?: boolean;
  /** Passages that are one end of a link, which earn a marker even without a note. */
  linkedIds?: string[];
  onNote?: (id: string, at: { x: number; y: number }) => void;
}

/** "https://www.example.com/a/b#c" -> "http://www--example--com.localhost:4700/a/b#c" (the app's reverse proxy). */
export function proxiedUrl(url: string, apiPort: number, scripts: boolean): string {
  const u = new URL(url);
  const sub = u.hostname.toLowerCase().replace(/\./g, "--");
  const q = scripts ? u.search : u.search ? `${u.search}&__rs_scripts=0` : "?__rs_scripts=0";
  return `http://${sub}.localhost:${apiPort}${u.pathname}${q}${u.hash}`;
}

/** The page exactly as the site serves it, running its own scripts, with highlights layered on top. */
export function OriginalView({ source, apiPort, scripts, onAddHighlight, onUpdateHighlight, onDeleteHighlight, onSelectHighlight, onOpenLink, page, onPage, scrollToId, scrollNonce, position, restoreNonce, onPosition, presenting, onPresentationKey, tool, drawColor, drawStyle, showNotes, linkedIds, onNote }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [restoredNonce, setRestoredNonce] = useState<number | null>(null);
  const [positionError, setPositionError] = useState(false);
  const target = page ?? source.url;
  // The frame navigates by itself, so its src is only set when the app asks for a different
  // page. Deriving it from `target` would reload a page the frame has just arrived at.
  const [frameUrl, setFrameUrl] = useState(target);
  const shown = useRef(target);
  const latest = useRef({ position, restoreNonce, onPosition, presenting, onPresentationKey, target, onPage, tool, drawColor, drawStyle, showNotes, onNote, scrollToId, onDeleteHighlight });
  latest.current = { position, restoreNonce, onPosition, presenting, onPresentationKey, target, onPage, tool, drawColor, drawStyle, showNotes, onNote, scrollToId, onDeleteHighlight };
  const [popup, setPopup] = useState<{ x: number; y: number; flip: boolean; anchor: Anchor; shape?: Shape; onImage?: string } | null>(null);
  // Once something has been typed into the note, only the person may close the card: the page
  // carries on scrolling, loading and firing events underneath, and a comment thrown away
  // mid-sentence is indistinguishable from the feature not working.
  const noteTyped = useRef(false);
  const show = (p: typeof popup) => { noteTyped.current = false; setPopup(p); };
  const dismiss = () => { if (!noteTyped.current) show(null); };
  const src = proxiedUrl(frameUrl, apiPort, scripts);

  const post = (msg: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ src: "rs-app", ...msg }, "*");
  const forFrame = () => source.highlights.map((h) => (linkedIds?.includes(h.id) ? { ...h, linked: true } : h));

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data || {};
      if (m.src !== "rs-frame" || e.source !== frame.current?.contentWindow) return;
      if (m.type === "ready") {
        setReady(true);
        if (m.url) arrived(m.url);
        post({ type: "home", url: source.url });
        post({ type: "highlights", list: forFrame() });
        post({ type: "restorePosition", position: latest.current.position, nonce: latest.current.restoreNonce, page: latest.current.target });
        post({ type: "presentation", enabled: latest.current.presenting });
        post({ type: "notes", show: latest.current.showNotes !== false && !latest.current.presenting });
        post({ type: "draw", tool: latest.current.tool ?? null, color: latest.current.drawColor, style: latest.current.drawStyle });
        post({ type: "selected", id: latest.current.scrollToId });
      }
      if (m.type === "navigated" && m.url) arrived(m.url);
      if (m.type === "position" && m.nonce === latest.current.restoreNonce && m.position && Number.isFinite(m.position.y) && Number.isFinite(m.position.x)) latest.current.onPosition(m.position, m.url ?? shown.current);
      // A page that is being replaced can still answer; only the page asked for counts.
      if (m.type === "positionRestored" && m.nonce === latest.current.restoreNonce && (!m.url || samePage(m.url, latest.current.target))) { setRestoredNonce(m.nonce); setPositionError(false); }
      if (m.type === "presentationKey" && latest.current.presenting && ["ArrowRight", "ArrowLeft", "PageDown", "PageUp", " ", "Home", "End", "Escape", "h"].includes(m.key)) latest.current.onPresentationKey(m.key);
      if (m.type === "selection") {
        if (!m.anchor) { dismiss(); return; }
        const host = frame.current!.getBoundingClientRect();
        const r = m.rect;
        const flip = r.top < 120;
        show({ x: Math.min(Math.max(r.left + r.width / 2, 170), host.width - 170), y: flip ? r.bottom + 8 : r.top - 8, flip, anchor: m.anchor });
      }
      if (m.type === "shapeDrawn" && m.shape) {
        const host = frame.current!.getBoundingClientRect();
        const r = m.rect;
        show({
          x: Math.min(Math.max(r.left + r.width / 2, 170), host.width - 170),
          y: r.bottom + 10, flip: true, anchor: m.anchor ?? { text: "", prefix: "", suffix: "" },
          shape: m.shape, onImage: m.onImage,
        });
      }
      if (m.type === "scroll") dismiss();
      if (m.type === "hlclick") onSelectHighlight(m.id);
      if (m.type === "shapeDelete" && m.id && source.highlights.some((h) => h.id === m.id && h.shape)) latest.current.onDeleteHighlight?.(m.id);
      if (m.type === "shapeEdited" && m.shape) {
        const was = source.highlights.find((h) => h.id === m.id);
        // Moved onto other text, it belongs to that text now.
        if (was) onUpdateHighlight?.({ ...was, ...(m.anchor ?? { text: "", prefix: "", suffix: "" }), shape: { ...was.shape, ...m.shape }, onImage: m.onImage });
      }
      if (m.type === "noteClick") {
        const host = frame.current!.getBoundingClientRect();
        latest.current.onNote?.(m.id, { x: host.left + m.at.x, y: host.top + m.at.y });
      }
      if (m.type === "link") {
        if (m.sameSite && !m.modifier) latest.current.onPage(m.url);
        else onOpenLink(m.url, Boolean(m.modifier));
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [source.highlights, onSelectHighlight, onOpenLink]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (ready) post({ type: "highlights", list: forFrame() }); }, [source.highlights, linkedIds, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready && scrollToId) post({ type: "scrollTo", id: scrollToId }); }, [scrollToId, scrollNonce, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  // The frame puts the grips on whichever drawing the app says is chosen.
  useEffect(() => { if (ready) post({ type: "selected", id: scrollToId }); }, [scrollToId, ready]); // eslint-disable-line react-hooks/exhaustive-deps
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
    show(null);
  }, [target]);
  useLayoutEffect(() => { if (ready && samePage(shown.current, target)) post({ type: "restorePosition", position, nonce: restoreNonce, page: target }); }, [restoreNonce, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready) post({ type: "presentation", enabled: presenting }); }, [presenting, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready) post({ type: "draw", tool: tool ?? null, color: drawColor, style: drawStyle }); }, [tool, drawColor, drawStyle, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready) post({ type: "notes", show: showNotes !== false && !presenting }); }, [showNotes, presenting, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setReady(false); show(null); }, [source.id, scripts]); // eslint-disable-line react-hooks/exhaustive-deps
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
    onAddHighlight({
      id: `h${Date.now().toString(36)}`, ...popup.anchor, shape: popup.shape, onImage: popup.onImage,
      color, comment, createdAt: new Date().toISOString(),
    });
    post({ type: "clearSelection" });
    show(null);
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
{popup && <HighlightPopup selectionText={popup.shape ? undefined : popup.anchor?.text} drawing={popup.shape ? drawColor ?? "yellow" : undefined} palette={PALETTE} x={popup.x} y={popup.y} flip={popup.flip} onCommit={commit} onCancel={() => show(null)} onType={() => (noteTyped.current = true)} />}
    </div>
  );
}
