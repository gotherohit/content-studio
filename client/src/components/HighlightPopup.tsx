import { useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { HighlightColor } from "../types";

const COLORS: HighlightColor[] = ["yellow", "green", "pink", "blue"];

interface Props {
  x: number;
  y: number;
  flip: boolean;
  onCommit: (color: HighlightColor, comment: string) => void;
  onCancel: () => void;
  /** Something has been typed, so the surface underneath must stop closing this card. */
  onType?: () => void;
}

/** Floating "add highlight" card shown over a text selection. */
export function HighlightPopup({ x, y, flip, onCommit, onCancel, onType }: Props) {
  const [comment, setComment] = useState("");
  const box = useRef<HTMLInputElement>(null);

  // Not `autoFocus`: the selection was made in a framed page, which can take the focus back
  // as it settles, and the first thing typed would then go to the article instead.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.focus();
    const again = requestAnimationFrame(() => { if (document.activeElement !== el) el.focus(); });
    return () => cancelAnimationFrame(again);
  }, []);

  return (
    <div className={`hl-popup ${flip ? "below" : ""}`} style={{ left: x, top: y }} onMouseDown={(e) => e.stopPropagation()}>
      <input
        ref={box}
        placeholder="Add a note… (Enter = yellow)"
        value={comment}
        onChange={(e) => { setComment(e.target.value); onType?.(); }}
        onKeyDown={(e) => { if (e.key === "Enter") onCommit("yellow", comment.trim()); if (e.key === "Escape") onCancel(); }}
      />
      <div className="hl-colors">
        {COLORS.map((c) => <button key={c} className={`swatch hl-${c}`} title={`Highlight ${c}`} onClick={() => onCommit(c, comment.trim())} />)}
        <span className="grow" />
        <button className="icon-btn" onClick={onCancel} title="Cancel"><X size={14} /></button>
      </div>
    </div>
  );
}
