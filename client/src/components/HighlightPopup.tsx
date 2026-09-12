import { useState } from "react";
import { X } from "lucide-react";
import type { HighlightColor } from "../types";

const COLORS: HighlightColor[] = ["yellow", "green", "pink", "blue"];

interface Props {
  x: number;
  y: number;
  flip: boolean;
  onCommit: (color: HighlightColor, comment: string) => void;
  onCancel: () => void;
}

/** Floating "add highlight" card shown over a text selection. */
export function HighlightPopup({ x, y, flip, onCommit, onCancel }: Props) {
  const [comment, setComment] = useState("");
  return (
    <div className={`hl-popup ${flip ? "below" : ""}`} style={{ left: x, top: y }} onMouseDown={(e) => e.stopPropagation()}>
      <input
        autoFocus
        placeholder="Add a note… (Enter = yellow)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
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
