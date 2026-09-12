import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Globe, RefreshCw, TriangleAlert, X } from "lucide-react";
import { PANE_PARTITION, desktop } from "../desktop";

interface Props {
  url: string;
  onChange: (url: string) => void;
  placeholder?: string;
  presets?: [string, string][];
  /** Shown when no page is loaded yet. */
  empty?: React.ReactNode;
  scheme?: "http" | "https";
}

/** Electron's webview element, which has navigation methods React's types do not know. */
type Webview = HTMLElement & {
  src: string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  getURL(): string;
  loadURL(url: string): Promise<void>;
};

/**
 * A real browser in a pane.
 *
 * Not an iframe and not a proxy: `<webview>` is a separate Chromium process with its own
 * navigation, its own cookies, and the true origin. Colab, Drive, a Jupyter server or a
 * local harness with a token in its URL all behave exactly as they do in a browser, and a
 * password typed here goes straight to the site — Content Studio never sees it.
 */
export function WebviewFrame({ url, onChange, placeholder, presets = [], empty, scheme = "https" }: Props) {
  const ref = useRef<Webview | null>(null);
  const [draft, setDraft] = useState(url);
  const [current, setCurrent] = useState(url);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [nav, setNav] = useState({ back: false, forward: false });

  const normalise = (raw: string) => {
    const t = raw.trim();
    if (!t) return "";
    return /^[a-z]+:\/\//i.test(t) ? t : `${scheme}://${t}`;
  };

  const go = (raw: string) => {
    const target = normalise(raw);
    if (!target) return;
    setErr(null);
    setDraft(target);
    setCurrent(target);
    onChange(target);
    ref.current?.loadURL(target).catch((e: Error) => setErr(e.message));
  };

  useEffect(() => {
    const wv = ref.current;
    if (!wv || !current) return;

    const sync = () => setNav({ back: wv.canGoBack(), forward: wv.canGoForward() });
    const onNavigate = (e: Event & { url?: string }) => {
      if (e.url) { setCurrent(e.url); setDraft(e.url); onChange(e.url); }
      sync();
    };
    const onTitle = (e: Event & { title?: string }) => setTitle(e.title ?? "");
    const onStart = () => { setLoading(true); setErr(null); };
    const onStop = () => { setLoading(false); sync(); };
    // -3 is an aborted load, which happens on every ordinary redirect.
    const onFail = (e: Event & { errorCode?: number; errorDescription?: string; isMainFrame?: boolean }) => {
      if (e.isMainFrame && e.errorCode !== -3) setErr(e.errorDescription || `Load failed (${e.errorCode})`);
      setLoading(false);
    };

    wv.addEventListener("did-navigate", onNavigate as EventListener);
    wv.addEventListener("did-navigate-in-page", onNavigate as EventListener);
    wv.addEventListener("page-title-updated", onTitle as EventListener);
    wv.addEventListener("did-start-loading", onStart);
    wv.addEventListener("did-stop-loading", onStop);
    wv.addEventListener("did-fail-load", onFail as EventListener);
    return () => {
      wv.removeEventListener("did-navigate", onNavigate as EventListener);
      wv.removeEventListener("did-navigate-in-page", onNavigate as EventListener);
      wv.removeEventListener("page-title-updated", onTitle as EventListener);
      wv.removeEventListener("did-start-loading", onStart);
      wv.removeEventListener("did-stop-loading", onStop);
      wv.removeEventListener("did-fail-load", onFail as EventListener);
    };
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="webview-pane">
      <form className="row term-bar" onSubmit={(e) => { e.preventDefault(); go(draft); }}>
        <button type="button" className="icon-btn" title="Back" disabled={!nav.back} onClick={() => ref.current?.goBack()}><ArrowLeft size={14} /></button>
        <button type="button" className="icon-btn" title="Forward" disabled={!nav.forward} onClick={() => ref.current?.goForward()}><ArrowRight size={14} /></button>
        <button type="button" className="icon-btn" title={loading ? "Stop" : "Reload"} disabled={!current}
          onClick={() => (loading ? ref.current?.stop() : ref.current?.reload())}>
          {loading ? <X size={14} /> : <RefreshCw size={14} />}
        </button>
        <Globe size={14} className="muted" />
        <input className="grow" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} spellCheck={false} />
        <button className="primary small" type="submit">Go</button>
        <button type="button" className="icon-btn" title="Open in your own browser" disabled={!current}
          onClick={() => desktop?.openExternal(current)}><ExternalLink size={14} /></button>
      </form>

      {err && <div className="error-bar" onClick={() => setErr(null)}><TriangleAlert size={13} /> {err}</div>}

      {current ? (
        <webview
          ref={ref as unknown as React.Ref<HTMLElement>}
          className="webview"
          src={current}
          partition={PANE_PARTITION}
          allowpopups
        />
      ) : (
        <div className="empty-state">
          {empty}
          {presets.length > 0 && (
            <div className="row wrap quick">
              {presets.map(([label, u]) => <button key={u} className="chip" onClick={() => go(u)}>{label}</button>)}
            </div>
          )}
        </div>
      )}

      {current && (
        <div className="row browser-status">
          <span className="muted small ellipsis grow" title={current}>{title ? `${title} — ` : ""}{current}</span>
        </div>
      )}
    </div>
  );
}
