import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Clipboard, Flag, Play, RotateCcw, Square } from "lucide-react";
import { desktop, type PresenterState } from "./desktop";

/** mm:ss, which is what a chapter list wants. */
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

interface Entry {
  at: number;
  label: string;
  flub?: boolean;
}

/**
 * The presenter's window.
 *
 * It lives on the other monitor and is never inside the recording, which is the whole
 * reason it exists: the studio window is what capture software takes, so anything meant
 * only for the creator has to be somewhere else.
 *
 * It owns no project state. The studio window publishes which beat is running and this
 * sends back what the creator asks for, so the two can never disagree.
 */
export default function Presenter() {
  const [state, setState] = useState<PresenterState | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [log, setLog] = useState<Entry[]>([]);
  const [copied, setCopied] = useState(false);
  const startedAt = useRef<number | null>(null);
  const lastIndex = useRef<number>(-1);

  // The theme is the studio's, read from the same place it stores it.
  useEffect(() => {
    const apply = () => {
      let dark = "1";
      try { dark = localStorage.getItem("dark") ?? "1"; } catch { /* private window */ }
      document.documentElement.dataset.theme = dark === "1" ? "dark" : "light";
    };
    apply();
    window.addEventListener("storage", apply);
    return () => window.removeEventListener("storage", apply);
  }, []);

  useEffect(() => {
    const off = desktop?.onPresenterState(setState);
    // Ask for the current state: anything published before this window existed is gone.
    desktop?.sendPresenterCommand({ type: "sync" });
    return off;
  }, []);

  // The clock is this window's own, so it keeps time whatever the studio is doing.
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => {
      setElapsed(startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0);
    }, 250);
    return () => window.clearInterval(t);
  }, [running]);

  // Every beat change while the clock runs becomes a line of the chapter list.
  useEffect(() => {
    if (!state || state.index === lastIndex.current) return;
    lastIndex.current = state.index;
    if (!running || state.index < 0) return;
    const at = startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0;
    setLog((l) => [...l, { at, label: state.beats[state.index]?.point || `Beat ${state.index + 1}` }]);
  }, [state, running]);

  const send = (cmd: Parameters<NonNullable<typeof desktop>["sendPresenterCommand"]>[0]) =>
    desktop?.sendPresenterCommand(cmd);

  // The arrow keys work here too, so the creator can drive from either window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (["ArrowRight", "PageDown", " "].includes(e.key)) { send({ type: "next" }); e.preventDefault(); }
      if (["ArrowLeft", "PageUp"].includes(e.key)) { send({ type: "prev" }); e.preventDefault(); }
      if (e.key === "f") { mark(true); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, state]); // eslint-disable-line react-hooks/exhaustive-deps

  function start() {
    startedAt.current = Date.now();
    setElapsed(0);
    setLog(state && state.index >= 0 ? [{ at: 0, label: state.beats[state.index]?.point || "Beat 1" }] : []);
    setRunning(true);
  }

  /** A moment worth finding again in the edit — usually a fluffed line. */
  function mark(flub = false) {
    if (!running) return;
    const at = startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0;
    setLog((l) => [...l, { at, label: flub ? "redo from here" : "mark", flub: true }]);
  }

  function copyLog() {
    const text = log.map((e) => `${clock(e.at)} ${e.flub ? "— " : ""}${e.label}`).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  if (!desktop) {
    return <div className="presenter"><p className="muted small">The presenter view belongs to the desktop app.</p></div>;
  }

  const beats = state?.beats ?? [];
  const i = state?.index ?? -1;
  const current = i >= 0 ? beats[i] : null;
  const next = i >= 0 && i + 1 < beats.length ? beats[i + 1] : null;

  return (
    <div className="presenter">
      <div className="presenter-top">
        <span className="presenter-count">{beats.length ? `${i < 0 ? "—" : i + 1} / ${beats.length}` : "no beats"}</span>
        <span className="grow ellipsis muted small">{state?.projectTitle ?? ""}</span>
        <span className={`presenter-clock ${running ? "live" : ""}`}>{clock(elapsed)}</span>
      </div>

      <div className="presenter-point">
        {current ? (current.point || <span className="muted">no point written</span>) : (
          beats.length ? "Press → to start the running order" : "Capture some beats in the studio window first"
        )}
      </div>

      {next && <div className="presenter-next">next · {next.point || `beat ${i + 2}`}</div>}

      <div className="presenter-controls">
        <button className="icon-btn" title="Previous beat (←)" disabled={i <= 0} onClick={() => send({ type: "prev" })}><ChevronLeft size={18} /></button>
        <button className="icon-btn" title="Next beat (→)" disabled={!beats.length || i >= beats.length - 1} onClick={() => send({ type: "next" })}><ChevronRight size={18} /></button>
        <span className="grow" />
        {running ? (
          <>
            <button className="ghost small" title="Mark this moment to redo (f)" onClick={() => mark(true)}><Flag size={13} /> Redo</button>
            <button className="ghost small" onClick={() => setRunning(false)}><Square size={13} /> Stop</button>
          </>
        ) : (
          <button className="primary small" title="Start timing, so beat changes become chapters" onClick={start}><Play size={13} /> Start clock</button>
        )}
        {log.length > 0 && !running && (
          <>
            <button className="ghost small" onClick={copyLog}><Clipboard size={13} /> {copied ? "Copied" : "Copy log"}</button>
            <button className="icon-btn" title="Clear the log" onClick={() => { setLog([]); setElapsed(0); }}><RotateCcw size={13} /></button>
          </>
        )}
      </div>

      {log.length > 0 && (
        <ol className="presenter-log">
          {log.map((e, k) => (
            <li key={k} className={e.flub ? "flub" : ""}>
              <span className="mono">{clock(e.at)}</span> {e.label}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
