import { useEffect, useRef, useState } from "react";
import { ExternalLink, Globe, RefreshCw, TriangleAlert } from "lucide-react";
import { api, type SiteProbe } from "../api";

interface Props {
  url: string;
  onChange: (url: string) => void;
}

const PRESETS = ["http://localhost:3000", "http://127.0.0.1:3080", "http://localhost:7860", "http://localhost:8501", "http://localhost:11434"];

/** Turn an upstream refusal into something actionable. */
function explain(probe: SiteProbe): { title: string; detail: string } | null {
  if (probe.status === 0) {
    return { title: "Nothing is answering at that address", detail: `${probe.statusText}. Check the app is running and that the port is right.` };
  }
  if (probe.status === 401 || probe.status === 403) {
    return {
      title: "That app wants authentication",
      detail:
        "Many local harnesses print a URL containing a one-time token and only accept that exact link. " +
        "Copy the full URL the tool printed, including everything after the “?”, and paste it here.",
    };
  }
  if (probe.status === 404) return { title: "The app answered, but that path does not exist", detail: "Try the address without a path, or the one the tool printed." };
  if (probe.status >= 500) return { title: `The app returned ${probe.status}`, detail: "It is running but failing on its own; check its logs." };
  return null;
}

/**
 * Frames any local or remote web app. Most apps send headers that forbid framing and
 * talk over a websocket, so the URL is routed through the app's own proxy, which strips
 * those headers, forwards cookies so a login can stick, and pipes the socket through.
 */
export function EmbedPane({ url, onChange }: Props) {
  const [draft, setDraft] = useState(url);
  const [framed, setFramed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [probe, setProbe] = useState<SiteProbe | null>(null);
  const [gen, setGen] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);

  const load = async (raw: string) => {
    const target = raw.trim();
    if (!target) return;
    const withScheme = /^https?:\/\//i.test(target) ? target : `http://${target}`;
    setBusy(true); setErr(null); setProbe(null);
    try {
      // Ask the target first: framing a 401 just shows a wall of plain text.
      // The probe also completes any token handshake, so the session is ready.
      const p = await api.probeSite(withScheme);
      setProbe(p);
      if (!explain(p)) {
        // The handshake already spent a one-time token; frame the plain address so it
        // is not offered a second time.
        const clean = new URL(withScheme);
        clean.searchParams.delete("token");
        clean.searchParams.delete("key");
        const { url: local } = await api.registerSite(clean.href, "app");
        setFramed(local);
      } else {
        setFramed(null);
      }
      onChange(withScheme);
      setDraft(withScheme);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { if (url && !framed) load(url); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const problem = probe ? explain(probe) : null;

  return (
    <div className="jupyter-pane">
      <form className="row term-bar" onSubmit={(e) => { e.preventDefault(); load(draft); }}>
        <Globe size={14} className="muted" />
        <input className="grow" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="http://127.0.0.1:3080 — paste the full URL your tool printed" spellCheck={false} />
        <button className="primary small" type="submit" disabled={busy || !draft.trim()}>{busy ? "Loading…" : "Load"}</button>
        {framed && <button type="button" className="icon-btn" title="Reload" onClick={() => setGen((g) => g + 1)}><RefreshCw size={14} /></button>}
        <a className="icon-btn" href={draft} target="_blank" rel="noreferrer" title="Open in a browser tab"><ExternalLink size={14} /></a>
      </form>
      {err && <div className="error-bar" onClick={() => setErr(null)}>{err}</div>}

      {problem ? (
        <div className="empty-state">
          <h2><TriangleAlert size={18} /> {problem.title}</h2>
          <p>{problem.detail}</p>
          {probe?.body && <pre className="code-output err">{probe.body.trim().slice(0, 300)}</pre>}
          <p className="muted small">
            {probe?.status ? `${probe.status} ${probe.statusText} from ${draft}` : draft}
          </p>
        </div>
      ) : framed ? (
        <iframe
          key={`${framed}-${gen}`}
          ref={frame}
          className="embed"
          src={framed}
          title="Embedded app"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
          allow="clipboard-read; clipboard-write; microphone; camera"
        />
      ) : (
        <div className="empty-state">
          <h2>Embed a running app</h2>
          <p>Paste the address of anything serving over HTTP — a model harness, Streamlit, Gradio, Ollama, a dev server, or a public site.</p>
          <p className="muted small">
            It is routed through Content Studio's proxy, so apps that normally refuse to be framed still load, their
            websockets keep working, and login cookies stick. If a tool prints a URL with a token in it, paste that whole URL.
          </p>
          <div className="row wrap quick">
            {PRESETS.map((u) => <button key={u} className="chip" onClick={() => { setDraft(u); load(u); }}>{u.replace(/^https?:\/\//, "")}</button>)}
          </div>
        </div>
      )}
    </div>
  );
}
