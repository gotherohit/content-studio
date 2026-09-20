import { useLayoutEffect, useRef, useState } from "react";
import { MessageSquareText } from "lucide-react";
import type { HighlightColor, Shape, ShapeKind } from "../types";
import { arrowHead, arrowLine, badgeAt, toBox, type Box } from "../shapes";

export interface LayerItem {
  id: string;
  /** Absent for a marked quote: it has no drawing, only a marker at the end of its text. */
  shape?: Shape;
  color: HighlightColor;
  comment?: string;
  /** Whether it is one end of a link, which earns a marker even without a note. */
  linked?: boolean;
  /** What it is drawn on, in pixels within this layer. The whole layer when absent. */
  host?: Box;
}

export interface Drag {
  from: { x: number; y: number };
  to: { x: number; y: number };
}

interface Props {
  items: LayerItem[];
  tool: ShapeKind | null;
  color: HighlightColor;
  selectedId?: string | null;
  showNotes?: boolean;
  /** The drag in pixels within this layer; the caller decides what it was drawn on. */
  onDraw?: (drag: Drag) => void;
  onSelect?: (id: string) => void;
  /** The marker was clicked, at this point on screen, so the note can open beside it. */
  onNote?: (id: string, at: { x: number; y: number }) => void;
}

/**
 * The shapes over one surface — a PDF page, an image, an article.
 *
 * Everything is drawn in pixels rather than in a stretched coordinate space, or an arrow head
 * on a wide page would come out flattened. The layer only takes the pointer while a tool is
 * chosen, so an article underneath stays clickable the rest of the time.
 */
export function ShapeLayer(p: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const whole: Box = { left: 0, top: 0, width: size.width, height: size.height };
  const at = (e: React.PointerEvent) => {
    const r = hostRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!p.tool || e.button !== 0) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const from = at(e);
    setDrag({ from, to: from });
  };
  const onPointerMove = (e: React.PointerEvent) => { if (drag) setDrag({ from: drag.from, to: at(e) }); };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag) return;
    const finished = { from: drag.from, to: at(e) };
    setDrag(null);
    p.onDraw?.(finished);
  };

  const draw = (shape: Shape, host: Box, key: string, item?: LayerItem) => {
    const inner = { width: host.width, height: host.height };
    const stroke = item ? `hl-${item.color}` : `hl-${p.color}`;
    const classes = `shape ${stroke} ${item && p.selectedId === item.id ? "selected" : ""} ${item ? "" : "drawing"}`;
    const common = {
      className: classes,
      onPointerDown: item && !p.tool ? (e: React.PointerEvent) => { e.stopPropagation(); p.onSelect?.(item.id); } : undefined,
    };
    if (shape.kind === "arrow") {
      const line = arrowLine(shape, inner);
      const head = arrowHead(shape, inner).map((pt) => `${pt.x + host.left},${pt.y + host.top}`).join(" ");
      return (
        <g key={key} {...common}>
          <line x1={line.x1 + host.left} y1={line.y1 + host.top} x2={line.x2 + host.left} y2={line.y2 + host.top} />
          <polyline points={head} fill="none" />
        </g>
      );
    }
    const box = toBox(shape, inner);
    if (shape.kind === "oval") {
      return (
        <ellipse
          key={key}
          {...common}
          cx={host.left + box.left + box.width / 2}
          cy={host.top + box.top + box.height / 2}
          rx={Math.max(1, box.width / 2)}
          ry={Math.max(1, box.height / 2)}
        />
      );
    }
    return <rect key={key} {...common} x={host.left + box.left} y={host.top + box.top} width={Math.max(1, box.width)} height={Math.max(1, box.height)} rx={3} />;
  };

  const preview = drag && p.tool
    ? { kind: p.tool, x: drag.from.x / (size.width || 1), y: drag.from.y / (size.height || 1),
        w: (drag.to.x - drag.from.x) / (size.width || 1), h: (drag.to.y - drag.from.y) / (size.height || 1) } as Shape
    : null;

  return (
    <div
      ref={hostRef}
      className={`shape-layer ${p.tool ? "drawing" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <svg className="shape-svg" width={size.width} height={size.height}>
        {p.items.map((item) => (item.shape ? draw(item.shape, item.host ?? whole, item.id, item) : null))}
        {preview && draw(preview.kind === "arrow" ? preview : { ...preview, ...normalise(preview) }, whole, "preview")}
      </svg>
      {p.showNotes !== false && p.items.filter((i) => i.comment?.trim() || i.linked).map((item) => {
        const host = item.host ?? whole;
        const open = (e: React.SyntheticEvent) => {
          e.stopPropagation();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          p.onNote?.(item.id, { x: r.left + r.width / 2, y: r.bottom });
        };
        // A drawing carries its marker on itself; a quote carries it at the end of its text.
        const spot = item.shape
          ? badgeAt(item.shape, { width: host.width, height: host.height })
          : { x: host.width, y: 0 };
        return (
          <button
            key={item.id}
            className={`shape-note hl-${item.color}`}
            style={{ left: host.left + spot.x, top: host.top + spot.y }}
            title={item.comment || "Linked"}
            // Opens on the press, not the click: a marker that is re-placed between pressing
            // and releasing — which happens on every scroll of a PDF and every reflow of an
            // article — would otherwise swallow the click and look broken.
            onPointerDown={(e) => { e.preventDefault(); open(e); }}
            // Also on click, so a keyboard can reach it; opening the same card twice shows
            // the same card.
            onClick={open}
          >
            <MessageSquareText size={11} />
          </button>
        );
      })}
    </div>
  );
}

/** A rectangle drawn right-to-left is still a rectangle while it is being dragged. */
function normalise(shape: Shape) {
  return {
    x: Math.min(shape.x, shape.x + shape.w),
    y: Math.min(shape.y, shape.y + shape.h),
    w: Math.abs(shape.w),
    h: Math.abs(shape.h),
  };
}
