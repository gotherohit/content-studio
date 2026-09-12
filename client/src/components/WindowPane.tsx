import { useCallback, useEffect, useRef, useState } from "react";
import { MonitorPlay, MousePointerClick, Square } from "lucide-react";
import { api, type InputTarget } from "../api";

/**
 * Live view of a desktop window or screen. With Control on, clicks, scrolls and
 * typing inside the pane are forwarded to the real desktop, so a GUI harness such
 * as Claude Desktop can be driven without leaving Research Studio.
 *
 * Screen capture gives pixels but not their position on the desktop, so the target
 * is picked from the list the server enumerates; its rectangle maps video pixels to
 * screen coordinates.
 */
export function WindowPane() {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [control, setControl] = useState(false);
  const [targets, setTargets] = useState<{ windows: InputTarget[]; screens: InputTarget[] } | null>(null);
  const [targetId, setTargetId] = useState<string>("");
  const [available, setAvailable] = useState(true);
  const lastMove = useRef(0);

  const target = [...(targets?.windows ?? []), ...(targets?.screens ?? [])].find((t) => String(t.id) === targetId) ?? null;

  const loadTargets = useCallback(async () => {
    try {
      const r = await api.inputTargets();
      setAvailable(r.available);
      setTargets({ windows: r.windows, screens: r.screens });
      if (!r.available && r.error) setErr(r.error);
    } catch (e) { setAvailable(false); setErr((e as Error).message); }
  }, []);

  useEffect(() => { loadTargets(); }, [loadTargets]);

  async function pick() {
    setErr(null);
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      s.getVideoTracks()[0].addEventListener("ended", () => { setStream(null); setControl(false); });
      setStream(s);
      loadTargets();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
    return () => { stream?.getTracks().forEach((t) => t.stop()); };
  }, [stream]);

  /** Video pixel under the pointer -> absolute desktop coordinate. */
  function toScreen(e: React.PointerEvent | React.WheelEvent): { x: number; y: number } | null {
    const v = video.current;
    if (!v || !target || !v.videoWidth) return null;
    const box = v.getBoundingClientRect();
    // object-fit: contain leaves letterbox bars; find the drawn rectangle.
    const scale = Math.min(box.width / v.videoWidth, box.height / v.videoHeight);
    const drawnW = v.videoWidth * scale, drawnH = v.videoHeight * scale;
    const offX = box.left + (box.width - drawnW) / 2, offY = box.top + (box.height - drawnH) / 2;
    const u = (e.clientX - offX) / drawnW, vY = (e.clientY - offY) / drawnH;
    if (u < 0 || u > 1 || vY < 0 || vY > 1) return null;
    // Window captures show the client area when the server reported one.
    const ox = target.cx ?? target.x, oy = target.cy ?? target.y;
    const ow = target.cw || target.w, oh = target.ch || target.h;
    return { x: Math.round(ox + u * ow), y: Math.round(oy + vY * oh) };
  }

  const send = (msg: Record<string, unknown>) => api.sendInput(msg).catch((e) => setErr(e.message));

  function onPointerMove(e: React.PointerEvent) {
    if (!control) return;
    const now = performance.now();
    if (now - lastMove.current < 40) return; // ~25 moves a second is plenty
    lastMove.current = now;
    const pt = toScreen(e);
    if (pt) send({ type: "move", ...pt });
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!control) return;
    e.preventDefault();
    const pt = toScreen(e);
    if (!pt) return;
    const button = e.button === 2 ? "right" : e.button === 1 ? "middle" : "left";
    send({ type: "button", action: "down", button, ...pt });
    (e.currentTarget as HTMLElement).focus();
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!control) return;
    e.preventDefault();
    const pt = toScreen(e);
    if (!pt) return;
    const button = e.button === 2 ? "right" : e.button === 1 ? "middle" : "left";
    send({ type: "button", action: "up", button, ...pt });
  }

  function onWheel(e: React.WheelEvent) {
    if (!control) return;
    const pt = toScreen(e);
    if (pt) send({ type: "scroll", delta: e.deltaY > 0 ? -120 : 120, ...pt });
  }

  /** SendKeys syntax: braces and a few symbols are escaped, special keys named. */
  const SPECIAL: Record<string, string> = {
    Enter: "{ENTER}", Tab: "{TAB}", Backspace: "{BACKSPACE}", Delete: "{DELETE}", Escape: "{ESC}",
    ArrowUp: "{UP}", ArrowDown: "{DOWN}", ArrowLeft: "{LEFT}", ArrowRight: "{RIGHT}",
    Home: "{HOME}", End: "{END}", PageUp: "{PGUP}", PageDown: "{PGDN}",
    F1: "{F1}", F2: "{F2}", F3: "{F3}", F4: "{F4}", F5: "{F5}", F6: "{F6}",
    F7: "{F7}", F8: "{F8}", F9: "{F9}", F10: "{F10}", F11: "{F11}", F12: "{F12}",
  };

  function onKeyDown(e: React.KeyboardEvent) {
    if (!control) return;
    e.preventDefault();
    e.stopPropagation();
    let keys = SPECIAL[e.key];
    if (!keys) {
      if (e.key.length !== 1) return;
      keys = e.key.replace(/[{}()[\]+^%~]/g, (c) => `{${c}}`);
    }
    if (e.ctrlKey) keys = `^(${keys})`;
    if (e.altKey) keys = `%(${keys})`;
    if (e.shiftKey && SPECIAL[e.key]) keys = `+(${keys})`;
    send({ type: "text", text: keys });
  }

  async function toggleControl() {
    if (control) { setControl(false); return; }
    if (!target) { setErr("Pick which window or screen you captured, so clicks land in the right place."); return; }
    setErr(null);
    if (targets?.windows.some((w) => String(w.id) === targetId)) await send({ type: "focus", hwnd: Number(targetId) });
    setControl(true);
  }

  return (
    <div className="window-pane">
      <div className="row term-bar wrap">
        <button className="primary small" onClick={pick}><MonitorPlay size={13} /> {stream ? "Change capture" : "Pick a window"}</button>
        {stream && (
          <>
            <select value={targetId} onChange={(e) => { setTargetId(e.target.value); setControl(false); }} title="Which window or screen did you capture?">
              <option value="">Match capture to…</option>
              {!!targets?.screens.length && (
                <optgroup label="Screens">
                  {targets.screens.map((s) => <option key={String(s.id)} value={String(s.id)}>{s.title}</option>)}
                </optgroup>
              )}
              {!!targets?.windows.length && (
                <optgroup label="Windows">
                  {targets.windows.map((w) => <option key={String(w.id)} value={String(w.id)}>{w.title.slice(0, 60)}</option>)}
                </optgroup>
              )}
            </select>
            <button className={`small ${control ? "primary" : "ghost"}`} onClick={toggleControl} disabled={!available} title={available ? "Forward clicks and typing to the real window" : "Window control needs Windows"}>
              <MousePointerClick size={13} /> {control ? "Control on" : "Control"}
            </button>
            <button className="ghost small" onClick={() => { setStream(null); setControl(false); }}><Square size={12} /> Stop</button>
          </>
        )}
        <span className="grow" />
        <button className="ghost small" onClick={loadTargets} title="Refresh the window list">Rescan</button>
      </div>
      {err && <div className="error-bar" onClick={() => setErr(null)}>{err}</div>}
      {stream ? (
        <video
          ref={video}
          autoPlay
          muted
          playsInline
          tabIndex={0}
          className={`window-video ${control ? "controlling" : ""}`}
          onPointerMove={onPointerMove}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
          onKeyDown={onKeyDown}
          onContextMenu={(e) => e.preventDefault()}
        />
      ) : (
        <div className="empty-state">
          <h2>Mirror a desktop app</h2>
          <p>Click <b>Pick a window</b> and choose the app you want beside the article — Claude Desktop, an IDE, another browser.</p>
          <p className="muted small">
            Then match the capture to its entry in the dropdown and switch <b>Control</b> on to click and type into it from here.
            {!available && " Control needs Windows; on other systems the pane stays a live view."}
          </p>
        </div>
      )}
    </div>
  );
}
