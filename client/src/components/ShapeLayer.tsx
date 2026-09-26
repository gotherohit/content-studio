import { useLayoutEffect, useRef, useState } from "react";
import { MessageSquareText } from "lucide-react";
import type { HighlightColor, Shape, ShapeKind, ShapeStyle } from "../types";
import { arrowLine, badgeAt, calloutBody, calloutFont, dashArray, inkOn, isLine, paint, resolveStyle, shapeHeads, shapePath, toBox, type Box } from "../shapes";

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

interface Point {
  x: number;
  y: number;
}

export interface Drag {
  from: Point;
  to: Point;
}

/** Which part of a chosen drawing is being pulled. */
type Grab = "move" | "from" | "to" | "nw" | "ne" | "sw" | "se";

interface Props {
  items: LayerItem[];
  tool: ShapeKind | null;
  color: HighlightColor;
  /** How the tool paints, so what is being drawn looks like what will be kept. */
  toolStyle?: ShapeStyle;
  selectedId?: string | null;
  showNotes?: boolean;
  /** The drag in pixels within this layer; the caller decides what it was drawn on. */
  onDraw?: (drag: Drag) => void;
  /** The same two points again, for a drawing that has been moved or resized. */
  onEdit?: (id: string, drag: Drag) => void;
  onSelect?: (id: string) => void;
  /** The marker was clicked, at this point on screen, so the note can open beside it. */
  onNote?: (id: string, at: { x: number; y: number }) => void;
}

/**
 * The shapes over one surface — a PDF page, an image, an article.
 *
 * Everything is drawn in pixels rather than in a stretched coordinate space, or an arrow head
 * on a wide page would come out flattened. The layer only takes the pointer while a tool is
 * chosen, so an article underneath stays clickable the rest of the time; a drawing and its
 * handles take the pointer themselves, which is how one can be picked up with nothing armed.
 */
export function ShapeLayer(p: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [edit, setEdit] = useState<({ id: string; grab: Grab; origin: Point; start: Drag } & Drag) | null>(null);

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
  const at = (e: { clientX: number; clientY: number }) => {
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

  /** The two points that define a drawing, in this layer's pixels: tail and head, or opposite corners. */
  const pointsOf = (item: LayerItem): Drag => {
    const host = item.host ?? whole;
    const inner = { width: host.width, height: host.height };
    if (isLine(item.shape!.kind)) {
      const line = arrowLine(item.shape!, inner);
      return { from: { x: host.left + line.x1, y: host.top + line.y1 }, to: { x: host.left + line.x2, y: host.top + line.y2 } };
    }
    const box = toBox(item.shape!, inner);
    return {
      from: { x: host.left + box.left, y: host.top + box.top },
      to: { x: host.left + box.left + box.width, y: host.top + box.top + box.height },
    };
  };

  /** Where the two points go while a corner, an end, or the whole drawing is pulled. */
  const pull = (state: NonNullable<typeof edit>, now: Point): Drag => {
    const { start, grab } = state;
    const dx = now.x - state.origin.x, dy = now.y - state.origin.y;
    if (grab === "move") {
      return { from: { x: start.from.x + dx, y: start.from.y + dy }, to: { x: start.to.x + dx, y: start.to.y + dy } };
    }
    if (grab === "from" || grab === "nw") return { from: now, to: start.to };
    if (grab === "to" || grab === "se") return { from: start.from, to: now };
    if (grab === "ne") return { from: { x: start.from.x, y: now.y }, to: { x: now.x, y: start.to.y } };
    return { from: { x: now.x, y: start.from.y }, to: { x: start.to.x, y: now.y } };
  };

  const startEdit = (item: LayerItem, grab: Grab) => (e: React.PointerEvent) => {
    if (e.button !== 0 || p.tool) return;
    e.stopPropagation();
    p.onSelect?.(item.id);
    if (!p.onEdit) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const start = pointsOf(item);
    setEdit({ id: item.id, grab, origin: at(e), start, ...start });
  };
  const moveEdit = (e: React.PointerEvent) => {
    if (!edit) return;
    e.stopPropagation();
    setEdit({ ...edit, ...pull(edit, at(e)) });
  };
  const endEdit = (e: React.PointerEvent) => {
    if (!edit) return;
    e.stopPropagation();
    const finished = pull(edit, at(e));
    const shifted = Math.abs(finished.from.x - edit.start.from.x) + Math.abs(finished.from.y - edit.start.from.y)
      + Math.abs(finished.to.x - edit.start.to.x) + Math.abs(finished.to.y - edit.start.to.y);
    const id = edit.id;
    setEdit(null);
    // Picking a drawing up to look at it is not an edit; only a real pull rewrites it.
    if (shifted > 2) p.onEdit?.(id, finished);
  };

  /**
   * One drawing, from the outline the injected script also uses. It is grabbed by an invisible
   * wide stroke along its edge, and by its inside only when the inside is painted — an empty
   * box over an article must not stop the words under it being selected.
   */
  const draw = (shape: Shape, host: Box, key: string, item?: LayerItem) => {
    const inner = { width: host.width, height: host.height };
    const own = item?.color ?? p.color;
    const style = resolveStyle(shape);
    const stroke = paint(style.stroke, own);
    const fill = isLine(shape.kind) ? null : paint(style.fill, own);
    const d = shapePath(shape, inner);
    const selected = Boolean(item && p.selectedId === item.id);
    const grab = item && !p.tool ? { onPointerDown: startEdit(item, "move" as Grab), onPointerMove: moveEdit, onPointerUp: endEdit } : {};
    return (
      <g key={key} className={`shape ${selected ? "selected" : ""} ${item ? "" : "drawing"}`} transform={`translate(${host.left} ${host.top})`} {...grab}>
        <path
          className={`shape-body ${fill && style.fillOpacity > 0 ? "filled" : ""}`}
          d={d}
          fill={fill ?? "none"}
          fillOpacity={style.fillOpacity}
          stroke={stroke ?? "none"}
          strokeWidth={style.width}
          strokeDasharray={dashArray(style.dash, style.width) || undefined}
        />
        {shapeHeads(shape, inner).map((head, i) => (
          <path key={i} className="shape-head" d={head} fill={stroke ?? "none"} stroke={stroke ?? "none"} strokeWidth={1} />
        ))}
        {selected && <path className="shape-selection" d={d} />}
        {item && <path className="shape-hit" d={d} strokeWidth={Math.max(12, style.width + 8)} />}
      </g>
    );
  };

  /** A drawing being dragged about is drawn from the pointer, in the layer's own pixels, in its own paint. */
  const asShape = (points: Drag, kind: ShapeKind, style?: ShapeStyle): Shape => ({
    ...style,
    kind,
    x: points.from.x / (size.width || 1),
    y: points.from.y / (size.height || 1),
    w: (points.to.x - points.from.x) / (size.width || 1),
    h: (points.to.y - points.from.y) / (size.height || 1),
  });

  const preview = drag && p.tool ? asShape(drag, p.tool, p.toolStyle) : null;

  /** The grips on the chosen drawing: its corners, or the two ends of an arrow. */
  const handles = (item: LayerItem) => {
    if (!p.onEdit || p.tool || p.selectedId !== item.id) return null;
    const points = edit?.id === item.id ? { from: edit.from, to: edit.to } : pointsOf(item);
    const spots: { grab: Grab; at: Point; cursor: string }[] = isLine(item.shape!.kind)
      ? [
          { grab: "from", at: points.from, cursor: "move" },
          { grab: "to", at: points.to, cursor: "move" },
        ]
      : [
          { grab: "nw", at: points.from, cursor: "nwse-resize" },
          { grab: "ne", at: { x: points.to.x, y: points.from.y }, cursor: "nesw-resize" },
          { grab: "sw", at: { x: points.from.x, y: points.to.y }, cursor: "nesw-resize" },
          { grab: "se", at: points.to, cursor: "nwse-resize" },
        ];
    return spots.map((spot) => (
      <circle
        key={`${item.id}:${spot.grab}`}
        className={`shape-handle hl-${item.color}`}
        style={{ cursor: spot.cursor }}
        cx={spot.at.x}
        cy={spot.at.y}
        r={5.5}
        onPointerDown={startEdit(item, spot.grab)}
        onPointerMove={moveEdit}
        onPointerUp={endEdit}
      />
    ));
  };

  return (
    <div
      ref={hostRef}
      className={`shape-layer ${p.tool ? "drawing" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <svg className="shape-svg" width={size.width} height={size.height}>
        {p.items.map((item) => {
          if (!item.shape) return null;
          // The element being dragged keeps its identity, or the pointer capture that follows
          // the drag would be lost with the node and the drawing would stop moving.
          const pulling = edit?.id === item.id;
          const shape = pulling ? asShape({ from: edit!.from, to: edit!.to }, item.shape.kind, item.shape) : item.shape;
          return draw(shape, pulling ? whole : item.host ?? whole, item.id, item);
        })}
        {preview && draw(preview, whole, "preview")}
        {p.items.map((item) => (item.shape ? handles(item) : null))}
      </svg>
      {p.items.map((item) => {
        if (item.shape?.kind !== "callout" || !item.comment?.trim()) return null;
        // A callout says its note on the source itself, which is the point of drawing one.
        const pulling = edit?.id === item.id;
        const shape = pulling ? asShape({ from: edit!.from, to: edit!.to }, "callout", item.shape) : item.shape;
        const host = pulling ? whole : item.host ?? whole;
        const body = calloutBody(shape, { width: host.width, height: host.height });
        const style = resolveStyle(shape);
        const fill = paint(style.fill, item.color);
        const solid = Boolean(fill && style.fillOpacity >= 0.5);
        return (
          <div
            key={`${item.id}:text`}
            className={`callout-text ${solid ? "" : "on-page"}`}
            style={{ left: host.left + body.left, top: host.top + body.top, width: body.width, height: body.height, fontSize: calloutFont(body, item.comment), color: solid ? inkOn(fill!) : undefined }}
          >
            {item.comment}
          </div>
        );
      })}
      {p.showNotes !== false && p.items.filter((i) => (i.shape?.kind === "callout" ? false : i.comment?.trim()) || i.linked).map((item) => {
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
