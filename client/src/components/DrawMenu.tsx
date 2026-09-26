import { useEffect, useRef, useState } from "react";
import {
  Circle, Diamond, Highlighter, Minus, MessageSquare, MessageSquareText, MousePointer2, MoveUpRight,
  PenLine, Square, Star, Triangle,
} from "lucide-react";
import type { HighlightColor, Shape, ShapeDash, ShapeKind, ShapePaint, ShapeStyle } from "../types";
import { PALETTE, isLine, resolveStyle, shapeLabel } from "../shapes";

/** A double-headed arrow: lucide has no such icon, so it is drawn here in the same weight. */
function DoubleArrow({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 18 18 6" /><path d="M11 6h7v7" /><path d="M13 18H6v-7" />
    </svg>
  );
}

const TOOLS: { kind: ShapeKind; icon: React.ComponentType<{ size?: number }> }[] = [
  { kind: "marker", icon: Highlighter },
  { kind: "rect", icon: Square },
  { kind: "oval", icon: Circle },
  { kind: "triangle", icon: Triangle },
  { kind: "diamond", icon: Diamond },
  { kind: "star", icon: Star },
  { kind: "callout", icon: MessageSquare },
  { kind: "line", icon: Minus },
  { kind: "arrow", icon: MoveUpRight },
  { kind: "darrow", icon: DoubleArrow },
];

const HINTS: Partial<Record<ShapeKind, string>> = {
  marker: "Highlighter — a see-through wash, for marking part of a picture or a slide",
  callout: "Callout — shows its note on the source itself",
};

interface Props {
  tool: ShapeKind | null;
  onTool: (tool: ShapeKind | null) => void;
  color: HighlightColor;
  onColor: (color: HighlightColor) => void;
  /** How each kind is painted when it is drawn next. */
  styles: Partial<Record<ShapeKind, ShapeStyle>>;
  onStyle: (kind: ShapeKind, style: ShapeStyle) => void;
  /** A drawing chosen on this source: the menu restyles it instead of the next one. */
  selected?: { shape: Shape; color: HighlightColor } | null;
  onRestyle?: (change: Partial<Shape> & { color?: HighlightColor }) => void;
  notes: boolean;
  onNotes: (show: boolean) => void;
}

/**
 * The drawing tools. A tool stays chosen until it is put down, because drawing three arrows
 * in a row is the normal case; while one is out the source underneath cannot be clicked, so
 * the button says so by staying lit.
 *
 * The same panel paints things, the way PowerPoint's does: with a drawing chosen it restyles
 * that drawing; otherwise it sets how the next one of the current kind will look.
 */
export function DrawMenu(p: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const Active = TOOLS.find((t) => t.kind === p.tool)?.icon ?? PenLine;

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    // A click inside the article frame never reaches this document; the window losing focus does.
    const blur = () => setOpen(false);
    // The press, not mousedown: starting a drawing cancels the press so the page underneath
    // does not select text, and a cancelled press sends no mousedown at all.
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key);
    window.addEventListener("blur", blur);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", key); window.removeEventListener("blur", blur); };
  }, [open]);

  // Escape puts the tool down wherever the focus is, so a drawing mode cannot strand a take.
  useEffect(() => {
    if (!p.tool) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") p.onTool(null); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [p.tool]); // eslint-disable-line react-hooks/exhaustive-deps

  // What the style controls act on: the chosen drawing, or the next drawing of this kind.
  const editing = !p.tool && p.selected ? p.selected : null;
  const kind: ShapeKind = editing?.shape.kind ?? p.tool ?? "rect";
  const own = editing?.color ?? p.color;
  const style = resolveStyle({ kind, x: 0, y: 0, w: 0, h: 0, ...(editing ? editing.shape : p.styles[kind]) });
  const set = (change: ShapeStyle & { color?: HighlightColor }) => {
    if (editing) { p.onRestyle?.(change); return; }
    const { color, ...rest } = change;
    if (color) p.onColor(color);
    if (Object.keys(rest).length) p.onStyle(kind, { ...p.styles[kind], ...rest });
  };
  const line = isLine(kind);

  return (
    <div className="draw-menu" ref={ref}>
      <button
        className={`icon-btn ${p.tool ? "on" : ""}`}
        onClick={() => (p.tool ? p.onTool(null) : setOpen((v) => !v))}
        title={p.tool ? "Put the drawing tool down (Esc)" : p.selected ? "Draw, or restyle the chosen drawing" : "Draw shapes, lines, arrows and callouts on this source"}
        aria-expanded={open}
      >
        <Active size={14} />
      </button>
      {open && (
        <div className="draw-menu-list" role="menu">
          <div className="draw-grid">
            <button className={`icon-btn ${!p.tool ? "on" : ""}`} title="Pointer — pick up, move and restyle a drawing" onClick={() => { p.onTool(null); }}>
              <MousePointer2 size={14} />
            </button>
            {TOOLS.map(({ kind: k, icon: Icon }) => (
              <button
                key={k}
                className={`icon-btn ${p.tool === k ? "on" : ""}`}
                title={HINTS[k] ?? shapeLabel(k)}
                // The menu stays open, so the tool can be styled before it is used; starting
                // to draw anywhere outside it closes it.
                onClick={() => p.onTool(k)}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>

          <div className="draw-style">
            <div className="draw-style-head muted small">
              {editing ? `Chosen ${shapeLabel(kind).toLowerCase()}` : `Next ${shapeLabel(kind).toLowerCase()}`}
            </div>

            <StyleRow label="Colour">
              {PALETTE.map((c) => (
                <button key={c} className={`swatch strong small hl-${c} ${own === c ? "active" : ""}`} title={c} onClick={() => set({ color: c })} />
              ))}
            </StyleRow>

            {!line && (
              <StyleRow label="Fill">
                <PaintPicker value={style.fill} own={own} onChange={(fill) => set({ fill })} />
              </StyleRow>
            )}
            {!line && style.fill !== "none" && (
              <StyleRow label="Opacity">
                <input
                  type="range" min={0} max={100} step={5}
                  value={Math.round(style.fillOpacity * 100)}
                  onChange={(e) => set({ fillOpacity: Number(e.target.value) / 100 })}
                  aria-label="Fill opacity"
                />
                <span className="draw-value">{Math.round(style.fillOpacity * 100)}%</span>
              </StyleRow>
            )}

            <StyleRow label={line ? "Line" : "Border"}>
              <PaintPicker value={style.stroke} own={own} onChange={(stroke) => set({ stroke })} allowNone={!line} />
            </StyleRow>
            {style.stroke !== "none" && (
              <>
                <StyleRow label="Width">
                  <input type="range" min={1} max={12} step={0.5} value={style.width} onChange={(e) => set({ width: Number(e.target.value) })} aria-label="Border width" />
                  <span className="draw-value">{style.width}px</span>
                </StyleRow>
                <StyleRow label="Style">
                  {(["solid", "dashed", "dotted"] as ShapeDash[]).map((dash) => (
                    <button key={dash} className={`ghost small draw-dash ${style.dash === dash ? "on" : ""}`} onClick={() => set({ dash })} title={dash}>
                      <svg width="26" height="8"><line x1="2" y1="4" x2="24" y2="4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeDasharray={dash === "dashed" ? "6 4" : dash === "dotted" ? "0.01 4" : undefined} /></svg>
                    </button>
                  ))}
                </StyleRow>
              </>
            )}
          </div>

          <button role="menuitemcheckbox" aria-checked={p.notes} className="draw-notes" onClick={() => p.onNotes(!p.notes)}>
            <MessageSquareText size={13} /> {p.notes ? "Hide the note markers" : "Show the note markers"}
          </button>
        </div>
      )}
    </div>
  );
}

function StyleRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="draw-style-row">
      <span className="draw-style-label">{label}</span>
      <div className="draw-style-controls">{children}</div>
    </div>
  );
}

/** None, the drawing's own colour, or a colour of its own. */
function PaintPicker({ value, own, onChange, allowNone = true }: { value: ShapePaint; own: HighlightColor; onChange: (v: ShapePaint) => void; allowNone?: boolean }) {
  return (
    <>
      {allowNone && (
        <button className={`swatch small swatch-none ${value === "none" ? "active" : ""}`} title="None" onClick={() => onChange("none")} />
      )}
      <button className={`swatch strong small hl-${own} swatch-match ${value === "match" ? "active" : ""}`} title="Same as the drawing's colour" onClick={() => onChange("match")} />
      {PALETTE.filter((c) => c !== own).map((c) => (
        <button key={c} className={`swatch strong small hl-${c} ${value === c ? "active" : ""}`} title={c} onClick={() => onChange(c)} />
      ))}
    </>
  );
}

