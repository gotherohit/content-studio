import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Circle, MessageSquareText, MousePointer2, PenLine, Square } from "lucide-react";
import type { HighlightColor, ShapeKind } from "../types";

const TOOLS: { kind: ShapeKind; label: string; icon: typeof Square }[] = [
  { kind: "rect", label: "Rectangle", icon: Square },
  { kind: "oval", label: "Oval", icon: Circle },
  { kind: "arrow", label: "Arrow", icon: ArrowUpRight },
];
const COLORS: HighlightColor[] = ["yellow", "green", "pink", "blue"];

interface Props {
  tool: ShapeKind | null;
  onTool: (tool: ShapeKind | null) => void;
  color: HighlightColor;
  onColor: (color: HighlightColor) => void;
  notes: boolean;
  onNotes: (show: boolean) => void;
}

/**
 * The drawing tools. A tool stays chosen until it is put down, because drawing three arrows
 * in a row is the normal case; while one is out the source underneath cannot be clicked, so
 * the button says so by staying lit.
 */
export function DrawMenu(p: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const Active = TOOLS.find((t) => t.kind === p.tool)?.icon ?? PenLine;

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    // A click inside the article frame never reaches this document; the window losing focus does.
    const blur = () => setOpen(false);
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", key);
    window.addEventListener("blur", blur);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", key); window.removeEventListener("blur", blur); };
  }, [open]);

  // Escape puts the tool down wherever the focus is, so a drawing mode cannot strand a take.
  useEffect(() => {
    if (!p.tool) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") p.onTool(null); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [p.tool]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="draw-menu" ref={ref}>
      <button
        className={`icon-btn ${p.tool ? "on" : ""}`}
        onClick={() => (p.tool ? p.onTool(null) : setOpen((v) => !v))}
        title={p.tool ? "Put the drawing tool down (Esc)" : "Draw a rectangle, an oval or an arrow on this source"}
        aria-expanded={open}
      >
        <Active size={14} />
      </button>
      {open && (
        <div className="draw-menu-list" role="menu">
          <div className="draw-row">
            <button className={`icon-btn ${!p.tool ? "on" : ""}`} title="Pointer" onClick={() => { p.onTool(null); setOpen(false); }}>
              <MousePointer2 size={14} />
            </button>
            {TOOLS.map(({ kind, label, icon: Icon }) => (
              <button
                key={kind}
                className={`icon-btn ${p.tool === kind ? "on" : ""}`}
                title={label}
                onClick={() => { p.onTool(kind); setOpen(false); }}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>
          <div className="draw-row">
            {COLORS.map((c) => (
              <button key={c} className={`swatch hl-${c} ${p.color === c ? "active" : ""}`} title={c} onClick={() => p.onColor(c)} />
            ))}
          </div>
          <button role="menuitemcheckbox" aria-checked={p.notes} className="draw-notes" onClick={() => p.onNotes(!p.notes)}>
            <MessageSquareText size={13} /> {p.notes ? "Hide the note markers" : "Show the note markers"}
          </button>
        </div>
      )}
    </div>
  );
}
