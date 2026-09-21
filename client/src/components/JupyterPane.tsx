import { useEffect, useRef, useState } from "react";
import { Folder } from "lucide-react";
import { api, type JupyterStatus } from "../api";
import { desktop } from "../desktop";
import { folderName, planFor, sameFolder } from "../jupyter";

interface Props {
  projectId: string;
  /** The folder this pane wants JupyterLab rooted at. */
  root: string;
  /** The creator chose another folder; it becomes this project's folder for notebooks. */
  onRoot: (dir: string) => void;
  /** Which folder is actually on screen, so a beat captures what was showing. */
  onShowing?: (dir: string) => void;
}

/** JupyterLab, managed by the app: detect → install → start → embed. */
export function JupyterPane({ projectId, root, onRoot, onShowing }: Props) {
  const [st, setSt] = useState<JupyterStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [kernels, setKernels] = useState(0);
  const logRef = useRef<HTMLPreElement>(null);
  const showing = useRef(onShowing);
  showing.current = onShowing;

  const refresh = () => api.jupyterStatus().then(setSt).catch((e) => setErr(e.message));

  /**
   * Settle the folder. A restart takes every kernel with it, so the pane only moves the
   * server by itself when nothing is running in it; otherwise it says where Jupyter is and
   * waits to be told, which is the difference between a beat changing the view and a beat
   * throwing away a morning's work mid-take.
   */
  useEffect(() => {
    let active = true;
    setErr(null);
    (async () => {
      const s = await api.jupyterStatus();
      if (!active) return;
      setSt(s);
      const count = s.running && !sameFolder(s.rootDir, root) ? (await api.jupyterKernels().catch(() => ({ count: 0 }))).count : 0;
      if (!active) return;
      setKernels(count);
      if (planFor(s, root, count) !== "switch") return;
      setBusy("Opening that folder in Jupyter…");
      const moved = await api.jupyterStart(projectId, root);
      if (active) { setSt(moved); setBusy(null); }
    })().catch((e) => { if (active) { setErr((e as Error).message); setBusy(null); } });
    return () => { active = false; };
  }, [projectId, root]);

  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [log]);
  // A beat records the folder that was on screen, not the one this pane asked for.
  useEffect(() => { showing.current?.(st?.running && st.rootDir ? st.rootDir : root); }, [st?.running, st?.rootDir, root]);

  async function install() {
    setBusy("Installing JupyterLab (this takes a few minutes)…"); setLog(""); setErr(null);
    try {
      const last = await api.jupyterInstall((t) => setLog((l) => l + t));
      if (last.code !== 0) setErr("pip exited with an error, see log");
    } catch (e) { setErr((e as Error).message); }
    setBusy(null); refresh();
  }
  async function start(dir = root) {
    setBusy("Starting Jupyter…"); setErr(null);
    try { setSt(await api.jupyterStart(projectId, dir)); setKernels(0); } catch (e) { setErr((e as Error).message); }
    setBusy(null);
  }
  async function stop() { try { setSt(await api.jupyterStop()); setKernels(0); } catch (e) { setErr((e as Error).message); } }

  /** Choosing a folder is explicit, so it moves the server even when kernels are running. */
  async function browse() {
    setErr(null);
    try {
      const label = "Folder for JupyterLab notebooks";
      const dir = desktop ? await desktop.pickFolder(label) : (await api.pickFolder(label, root)).dir;
      if (!dir || sameFolder(dir, root)) { if (dir) onRoot(dir); return; }
      onRoot(dir);
      if (st?.running) await start(dir);
    } catch (e) { setErr((e as Error).message); }
  }

  if (!st) return <div className="panel-empty">{err || "Checking Jupyter…"}</div>;

  const elsewhere = st.running && st.rootDir && !sameFolder(st.rootDir, root);

  if (st.running && st.url) {
    // Jupyter is already rooted at this project. Match the top-level site's host so
    // its authentication cookie also accompanies kernel WebSocket connections.
    const target = new URL(st.url);
    if (["127.0.0.1", "localhost"].includes(window.location.hostname)) target.hostname = window.location.hostname;
    const url = target.href;
    const where = st.rootDir || root;
    return (
      <div className="jupyter-pane">
        <div className="row term-bar">
          <button className="ghost small files-root" onClick={browse} title={`${where} — click to open another folder in Jupyter (this restarts it)`}>
            <Folder size={13} /> {folderName(where)}
          </button>
          <span className="muted small grow ellipsis" title={where}>JupyterLab on port {st.port} · notebooks saved in this folder</span>
          <a className="small" href={url} target="_blank" rel="noreferrer">open in tab</a>
          <button className="ghost small" onClick={stop}>Stop</button>
        </div>
        {elsewhere && (
          <div className="row term-bar">
            <span className="muted small grow ellipsis" title={`${st.rootDir} → ${root}`}>
              {kernels === 1 ? "A kernel is" : `${kernels} kernels are`} running in {folderName(st.rootDir!)}; moving to {folderName(root)} restarts Jupyter and loses them.
            </span>
            <button className="ghost small" onClick={() => start(root)} disabled={!!busy}>Open {folderName(root)}</button>
          </div>
        )}
        {busy && <div className="row term-bar"><span className="muted small">{busy}</span></div>}
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
      {st.installed && (
        <>
          <p className="muted small ellipsis" title={root}>Notebooks in <b>{folderName(root)}</b></p>
          <div className="row">
            <button onClick={() => start()} disabled={!!busy}>Start JupyterLab</button>
            <button className="ghost small" onClick={browse} disabled={!!busy}><Folder size={13} /> Another folder</button>
          </div>
        </>
      )}
      {busy && <p className="muted small">{busy}</p>}
      {err && <div className="error-bar">{err}</div>}
      {(log || st.log) && <pre ref={logRef} className="code-output" style={{ maxHeight: 260 }}>{log || st.log}</pre>}
    </div>
  );
}
