import { useEffect, useRef, useState } from "react";
import { api, type JupyterStatus } from "../api";

/** JupyterLab, managed by the app: detect → install → start → embed. */
export function JupyterPane({ projectId }: { projectId: string }) {
  const [st, setSt] = useState<JupyterStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  const refresh = () => api.jupyterStatus().then(setSt).catch((e) => setErr(e.message));
  // "start" is idempotent and also creates this project's notebook folder
  useEffect(() => {
    let active = true; setSt(null); setErr(null);
    api.jupyterStatus().then((s) => (s.running ? api.jupyterStart(projectId) : s))
      .then((s) => { if (active) setSt(s); }).catch((e) => { if (active) setErr(e.message); });
    return () => { active = false; };
  }, [projectId]);
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [log]);

  async function install() {
    setBusy("Installing JupyterLab (this takes a few minutes)…"); setLog(""); setErr(null);
    try {
      const last = await api.jupyterInstall((t) => setLog((l) => l + t));
      if (last.code !== 0) setErr("pip exited with an error, see log");
    } catch (e) { setErr((e as Error).message); }
    setBusy(null); refresh();
  }
  async function start() {
    setBusy("Starting Jupyter…"); setErr(null);
    try { setSt(await api.jupyterStart(projectId)); } catch (e) { setErr((e as Error).message); }
    setBusy(null);
  }
  async function stop() { try { setSt(await api.jupyterStop()); } catch (e) { setErr((e as Error).message); } }

  if (!st) return <div className="panel-empty">{err || "Checking Jupyter…"}</div>;

  if (st.running && st.url) {
    // Jupyter is already rooted at this project. Match the top-level site's host so
    // its authentication cookie also accompanies kernel WebSocket connections.
    const target = new URL(st.url);
    if (["127.0.0.1", "localhost"].includes(window.location.hostname)) target.hostname = window.location.hostname;
    const url = target.href;
    return (
      <div className="jupyter-pane">
        <div className="row term-bar">
          <span className="muted small grow" title={st.rootDir || undefined}>JupyterLab on port {st.port} · notebooks saved in this project folder</span>
          <a className="small" href={url} target="_blank" rel="noreferrer">open in tab</a>
          <button className="ghost small" onClick={stop}>Stop</button>
        </div>
        {err && <div className="error-bar">{err}</div>}
        <iframe className="embed" src={url} title="JupyterLab" />
      </div>
    );
  }

  return (
    <div className="panel-body">
      <h3 style={{ margin: 0 }}>Jupyter notebook</h3>
      {st.installed === false && (
        <>
          <p className="muted">JupyterLab is not installed for the Python on this machine.</p>
          <button onClick={install} disabled={!!busy}>Install JupyterLab (pip)</button>
        </>
      )}
      {st.installed && <button onClick={start} disabled={!!busy}>Start JupyterLab</button>}
      {busy && <p className="muted small">{busy}</p>}
      {err && <div className="error-bar">{err}</div>}
      {(log || st.log) && <pre ref={logRef} className="code-output" style={{ maxHeight: 260 }}>{log || st.log}</pre>}
    </div>
  );
}
