import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Copy, Crosshair } from "lucide-react";
import type { VerticalFrame } from "../types";
import { centredFrame, clampFrame, frameWidth } from "../exportPlan";

interface Props {
  index: number;
  total: number;
  point: string;
  frame: VerticalFrame | undefined;
  /** The export's layout, which the window is showing at 1:1 while framing. */
  viewport: { width: number; height: number };
  onFrame: (frame: VerticalFrame) => void;
  onBeat: (index: number) => void;
  onAll: (frame: VerticalFrame) => void;
  onDone: () => void;
}

/**
 * Choosing what a vertical export shows, on the screen itself.
 *
 * The window is laid out exactly as it will be captured and the beat is on it, so the 9:16
 * box is drawn over the real panes: drag it to move it, drag its corner to take in less. The
 * frame is kept as fractions of the screen, so it lands on the same place at any resolution.
 * None of this is ever captured — framing and capturing are separate passes.
 */
export function ExportFramer(p: Props) {
  const frame = clampFrame(p.frame ?? centredFrame(p.viewport), p.viewport);
  const live = useRef(frame);
  live.current = frame;
  const W = p.viewport.width, H = p.viewport.height;
  const box = { left: frame.x * W, top: frame.y * H, width: frameWidth(frame.h, p.viewport) * W, height: frame.h * H };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" && p.index < p.total - 1) p.onBeat(p.index + 1);
      else if (e.key === "ArrowLeft" && p.index > 0) p.onBeat(p.index - 1);
      else if (e.key === "Escape" || e.key === "Enter") p.onDone();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p]);

  const drag = (mode: "move" | "size") => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY, frame: live.current };
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / W, dy = (ev.clientY - start.y) / H;
      // The box stays 9:16, so a sideways pull on the corner is turned into the height it implies.
      const across = (dx * W * 16) / 9 / H;
      const next = mode === "move"
        ? { ...start.frame, x: start.frame.x + dx, y: start.frame.y + dy }
        : { ...start.frame, h: start.frame.h + (Math.abs(dy) > Math.abs(across) ? dy : across) };
      p.onFrame(clampFrame(next, p.viewport));
    };
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  return (
    <div className="export-framer" onPointerDown={(e) => e.preventDefault()}>
      <div className="framer-box" style={box} onPointerDown={drag("move")}>
        <span className="framer-label">9:16</span>
        <span className="framer-handle" onPointerDown={drag("size")} title="Drag to take in less or more" />
      </div>
      <div className="framer-bar" onPointerDown={(e) => e.stopPropagation()}>
        <button className="icon-btn" title="Previous beat (←)" disabled={p.index <= 0} onClick={() => p.onBeat(p.index - 1)}><ChevronLeft size={15} /></button>
        <span className="beat-hud-no">{p.index + 1}/{p.total}</span>
        <span className="ellipsis framer-point">{p.point || "no point written"}</span>
        <button className="icon-btn" title="Next beat (→)" disabled={p.index >= p.total - 1} onClick={() => p.onBeat(p.index + 1)}><ChevronRight size={15} /></button>
        <button className="ghost small" title="Put the frame back in the middle" onClick={() => p.onFrame(centredFrame(p.viewport))}><Crosshair size={12} /> Centre</button>
        <button className="ghost small" title="Give every beat this frame" onClick={() => p.onAll(frame)}><Copy size={12} /> Use for all beats</button>
        <button className="primary small" onClick={p.onDone}>Done</button>
      </div>
    </div>
  );
}
