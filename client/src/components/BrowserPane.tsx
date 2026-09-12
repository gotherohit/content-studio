import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Globe, RefreshCw, TriangleAlert } from "lucide-react";
import { isDesktop } from "../desktop";
import { WebviewFrame } from "./WebviewFrame";

interface Props {
  url: string;
  onChange: (url: string) => void;
}

const PRESETS: [string, string][] = [
  ["Colab", "https://colab.research.google.com/"],
  ["Drive", "https://drive.google.com/"],
  ["OneDrive", "https://onedrive.live.com/"],
  ["Kaggle", "https://www.kaggle.com/code"],
];

/** Chrome's modifier bitmask: Alt, Ctrl, Meta, Shift. */
const mods = (e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) =>
  (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);

const BUTTON = ["left", "middle", "right"] as const;

/** Keys that must be sent as key events rather than inserted as text. */
const KEYCODES: Record<string, number> = {
  Enter: 13, Tab: 9, Backspace: 8, Delete: 46, Escape: 27,
  ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
  Home: 36, End: 35, PageUp: 33, PageDown: 34,
};

/**
 * A real browser in a pane.
 *
 * Colab, Drive and OneDrive all refuse to be framed, and their sign-in pages refuse
 * hardest of all, so this is not an iframe. The server runs Chrome on a profile of its
 * own and streams its frames here; clicks and keys go back the other way. The page is a
 * genuine Chrome tab, so sign-in works and the password never passes through this app.
 */
function StreamedBrowser({ url, onChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sizeRef = useRef({ width: 1440, height: 900 });

  const [draft, setDraft] = useState(url || "https://colab.research.google.com/");
  const [state, setState] = useState<"idle" | "starting" | "live" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [current, setCurrent] = useState(url);
  const [frame, setFrame] = useState<string | null>(null);
  const [gen, setGen] = useState(0);

  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const open = (raw: string) => {
    const target = raw.trim();
    if (!target) return;
    const withScheme = /^https?:\/\//i.test(target) ? target : `https://${target}`;
    setDraft(withScheme);
    onChange(withScheme);
    setCurrent(withScheme);
    setGen((g) => g + 1); // a new socket, a new tab
  };

  // One socket per opened page; closing it closes the tab on the server.
  useEffect(() => {
    if (!current) return;
    setState("starting"); setErr(null); setFrame(null);
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/browser?url=${encodeURIComponent(current)}`);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === "ready") {
        setState("live");
        const box = hostRef.current?.getBoundingClientRect();
        const width = Math.max(600, Math.round(box?.width ?? 1200));
        const height = Math.max(400, Math.round(box?.height ?? 800));
        sizeRef.current = { width, height };
        ws.send(JSON.stringify({ type: "resize", width, height }));
        ws.send(JSON.stringify({ type: "start", width, height, quality: 75 }));
      }
      if (m.type === "frame") setFrame(m.data);
      if (m.type === "url") setCurrent(m.url);
      if (m.type === "title") setTitle(m.title);
      if (m.type === "error") { setErr(m.message); setState("error"); }
      if (m.type === "closed") setState("idle");
    };
    ws.onerror = () => { setErr("Lost the connection to the browser"); setState("error"); };
    ws.onclose = () => setState((s) => (s === "live" ? "idle" : s));

    return () => ws.close();
  }, [current, gen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the page laid out for the pane, not for the off-screen window.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    let timer = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const box = el.getBoundingClientRect();
        const width = Math.max(600, Math.round(box.width));
        const height = Math.max(400, Math.round(box.height));
        sizeRef.current = { width, height };
        send({ type: "resize", width, height });
        send({ type: "start", width, height, quality: 75 });
      }, 250);
    });
    ro.observe(el);
    return () => { ro.disconnect(); window.clearTimeout(timer); };
  }, [send]);

  /** Pointer position in the pane translated to page coordinates. */
  const point = (e: React.MouseEvent | React.WheelEvent) => {
    const img = imgRef.current;
    const box = img?.getBoundingClientRect();
    if (!box || !box.width) return null;
    const { width, height } = sizeRef.current;
    return {
      x: Math.round(((e.clientX - box.left) / box.width) * width),
      y: Math.round(((e.clientY - box.top) / box.height) * height),
    };
  };

  function onMouse(action: "mousePressed" | "mouseReleased" | "mouseMoved", e: React.MouseEvent) {
    const p = point(e);
    if (!p) return;
    send({
      type: "mouse", action, ...p,
      button: action === "mouseMoved" ? "none" : BUTTON[e.button] ?? "left",
      clickCount: action === "mouseMoved" ? 0 : e.detail || 1,
      modifiers: mods(e),
    });
  }

  function onWheel(e: React.WheelEvent) {
    const p = point(e);
    if (!p) return;
    send({ type: "mouse", action: "mouseWheel", ...p, deltaX: -e.deltaX, deltaY: -e.deltaY, modifiers: mods(e) });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();
    const code = KEYCODES[e.key];
    if (code) {
      send({ type: "key", action: "rawKeyDown", key: e.key, code: e.code, keyCode: code, modifiers: mods(e) });
      send({ type: "key", action: "keyUp", key: e.key, code: e.code, keyCode: code, modifiers: mods(e) });
      return;
    }
    // Ctrl/Cmd shortcuts must stay shortcuts; plain characters are inserted as text.
    if (e.ctrlKey || e.metaKey) {
      const kc = e.key.length === 1 ? e.key.toUpperCase().charCodeAt(0) : 0;
      send({ type: "key", action: "rawKeyDown", key: e.key, code: e.code, keyCode: kc, modifiers: mods(e) });
      send({ type: "key", action: "keyUp", key: e.key, code: e.code, keyCode: kc, modifiers: mods(e) });
      return;
    }
    if (e.key.length === 1) send({ type: "text", text: e.key });
  }

  return (
    <div className="browser-pane">
      <form className="row term-bar" onSubmit={(e) => { e.preventDefault(); open(draft); }}>
        <button type="button" className="icon-btn" title="Back" onClick={() => send({ type: "back" })} disabled={state !== "live"}><ArrowLeft size={14} /></button>
        <button type="button" className="icon-btn" title="Forward" onClick={() => send({ type: "forward" })} disabled={state !== "live"}><ArrowRight size={14} /></button>
        <button type="button" className="icon-btn" title="Reload" onClick={() => send({ type: "reload" })} disabled={state !== "live"}><RefreshCw size={14} /></button>
        <Globe size={14} className="muted" />
        <input className="grow" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="colab.research.google.com" spellCheck={false} />
        <button className="primary small" type="submit">Go</button>
      </form>

      {err && <div className="error-bar" onClick={() => setErr(null)}><TriangleAlert size={13} /> {err}</div>}

      <div ref={hostRef} className="browser-stage">
        {frame ? (
          <img
            ref={imgRef}
            className="browser-frame"
            src={`data:image/jpeg;base64,${frame}`}
            alt={title || "page"}
            tabIndex={0}
            draggable={false}
            onMouseDown={(e) => { (e.currentTarget as HTMLElement).focus(); onMouse("mousePressed", e); }}
            onMouseUp={(e) => onMouse("mouseReleased", e)}
            onMouseMove={(e) => onMouse("mouseMoved", e)}
            onWheel={onWheel}
            onKeyDown={onKeyDown}
            onContextMenu={(e) => e.preventDefault()}
          />
        ) : (
          <div className="empty-state">
            <h2>{state === "starting" ? "Starting the browser…" : "A real browser, in a pane"}</h2>
            <p>
              Colab, Drive and OneDrive refuse to be framed, so this is not an iframe. It is a real Chrome tab,
              streamed here, with clicks and typing sent back.
            </p>
            <p className="muted small">
              Sign in once and it is remembered, because Chrome keeps its own profile for this pane. Your password
              goes straight to Google and never passes through Content Studio.
            </p>
            <div className="row wrap quick">
              {PRESETS.map(([label, u]) => <button key={u} className="chip" onClick={() => open(u)}>{label}</button>)}
            </div>
          </div>
        )}
      </div>

      {state === "live" && (
        <div className="row browser-status">
          <span className="muted small ellipsis grow" title={current}>{title ? `${title} — ` : ""}{current}</span>
        </div>
      )}
    </div>
  );
}

/**
 * On the desktop the pane is a real Chromium view, so Colab and Drive simply load. In a
 * plain browser they refuse to be framed, and the fallback streams a Chrome tab instead.
 */
export function BrowserPane(props: Props) {
  if (!isDesktop) return <StreamedBrowser {...props} />;
  return (
    <WebviewFrame
      url={props.url}
      onChange={props.onChange}
      placeholder="colab.research.google.com"
      presets={PRESETS}
      empty={
        <>
          <h2>A browser, in a pane</h2>
          <p>Open Colab for a free GPU, a notebook in Drive, a dataset on Kaggle, or anything else on the web — beside your source and your notes.</p>
          <p className="muted small">
            This is a real Chromium view with its own profile, so signing in works and is remembered. Your password goes
            straight to the site; Content Studio never sees it.
          </p>
        </>
      }
    />
  );
}
