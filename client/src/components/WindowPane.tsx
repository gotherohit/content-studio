import { useCallback, useEffect, useRef, useState } from "react";
import { MonitorPlay, MousePointerClick, Square } from "lucide-react";
import { api, type InputTarget } from "../api";
import { desktop } from "../desktop";

/** Live desktop preview with an explicit handoff to the actual application. */
export function WindowPane() {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(false);
  const [targets, setTargets] = useState<InputTarget[]>([]);
  const [targetId, setTargetId] = useState("");
  const [available, setAvailable] = useState(false);
  const [choices, setChoices] = useState<{ id: string; name: string; thumbnail: string }[] | null>(null);
  const mounted = useRef(true);
  const target = targets.find((t) => String(t.id) === targetId);

  const loadTargets = useCallback(async () => {
    try {
      const r = await api.inputTargets();
      setAvailable(r.available); setTargets(r.windows);
      if (r.error) setErr(r.error);
    } catch (e) { setAvailable(false); setErr((e as Error).message); }
  }, []);
  useEffect(() => {
    mounted.current = true; loadTargets();
    return () => { mounted.current = false; };
  }, [loadTargets]);
  useEffect(() => {
    if (!desktop) return;
    const off = desktop.onHandoffState((s) => setActive(s.active));
    desktop.handoffState().then((s) => setActive(s.active)).catch((e) => setErr(e.message));
    return off;
  }, []);
  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
    return () => { stream?.getTracks().forEach((t) => t.stop()); };
  }, [stream]);

  async function pick() {
    if (!desktop) return capture();
    setBusy(true); setErr(null);
    try { setChoices(await desktop.captureSources()); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  async function capture(id?: string) {
    setBusy(true); setErr(null);
    try {
      if (desktop && id) await desktop.chooseCapture(id);
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      if (!mounted.current) { s.getTracks().forEach((t) => t.stop()); return; }
      s.getVideoTracks()[0].addEventListener("ended", () => setStream((current) => current === s ? null : current));
      setTargetId(id?.startsWith("window:") ? id.split(":")[1] : "");
      setChoices(null); setStream(s); loadTargets();
    } catch (e) {
      if (desktop || (e as Error).name !== "NotAllowedError") setErr(`Could not start capture: ${(e as Error).message}. Choose the window again if it has closed.`);
    } finally { setBusy(false); }
  }
  async function interact() {
    if (!desktop || !target) return;
    setBusy(true); setErr(null);
    try { await desktop.startHandoff(Number(target.id)); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="window-pane">
      <div className="row term-bar wrap">
        <button className="primary small" onClick={pick} disabled={busy || active}><MonitorPlay size={13} /> {stream ? "Change capture" : "Pick a window"}</button>
        {stream && <>
          <select value={targetId} onChange={(e) => setTargetId(e.target.value)} disabled={busy || active} title="Choose the application to bring forward">
            <option value="">Choose app to interact with…</option>
            {targets.map((w) => <option key={String(w.id)} value={String(w.id)}>{w.title.slice(0, 80)}</option>)}
          </select>
          <button className="small primary" onClick={interact} disabled={!desktop || !available || !target || busy || active} title="Use the actual app, then return with the floating toolbar or Ctrl+Shift+F12">
            <MousePointerClick size={13} /> {busy ? "Switching…" : "Interact with app"}
          </button>
          {active && <button className="small" onClick={() => desktop?.returnToStudio().catch((e) => setErr(e.message))}>Back to Studio</button>}
          <button className="ghost small" disabled={busy || active} onClick={() => setStream(null)}><Square size={12} /> Stop</button>
        </>}
        <span className="grow" />
        <button className="ghost small" onClick={loadTargets} title="Refresh the window list">Rescan</button>
      </div>
      <p className="muted small" style={{ margin: "6px 12px" }}>Window is a live desktop preview. For an interactive website or localhost tool inside the pane, choose <b>Embed</b>.</p>
      {err && <div className="error-bar" role="alert" onClick={() => setErr(null)}>{err}</div>}
      {choices && <div className="capture-picker" role="region" aria-label="Choose a desktop capture">
        <div className="row"><b>Choose a window or screen</b><span className="grow" /><button className="small" disabled={busy} onClick={() => setChoices(null)}>Cancel</button></div>
        <div className="capture-grid">{choices.map((choice) => <button key={choice.id} disabled={busy} onClick={() => capture(choice.id)} title={choice.name}>
          <img src={choice.thumbnail} alt="" /><span>{choice.name}</span>
        </button>)}</div>
        {!choices.length && <p>No windows found. Open the app you want to show, then try again.</p>}
      </div>}
      {stream ? <video ref={video} autoPlay muted playsInline className="window-video" /> : (
        <div className="empty-state">
          <h2>Mirror a desktop app</h2>
          <p>Click <b>Pick a window</b> and choose the app you want beside the article — an IDE, PowerPoint, or another desktop tool.</p>
          <p className="muted small">Choose the app in the dropdown, then click <b>Interact with app</b> to use its own window. Return using the floating <b>Back to Studio</b> button or <b>Ctrl+Shift+F12</b>.</p>
          {(!desktop || !available) && <p className="muted small">App interaction needs the Windows desktop version; capture remains available here.</p>}
        </div>
      )}
    </div>
  );
}
