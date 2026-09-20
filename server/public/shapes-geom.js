// The maths of a drawn shape, kept in plain JavaScript so the app and the script injected
// into a framed article share one definition of where a rectangle, an oval or an arrow sits.
// Everything is fractions of the box the shape was drawn on, so it survives zooming and a
// resized pane.

/** Shorter than this and it was a click, not a drawing. */
export const MIN_DRAG = 5;

const clamp = (v) => Math.min(1, Math.max(0, v));

/**
 * A drag in pixels becomes fractions of the box it happened in. An arrow keeps its direction,
 * so its width and height may be negative; a rectangle and an oval are normalised.
 */
export function fromDrag(kind, from, to, size) {
  if (!size.width || !size.height) return null;
  if (Math.abs(to.x - from.x) < MIN_DRAG && Math.abs(to.y - from.y) < MIN_DRAG) return null;
  const x1 = clamp(from.x / size.width), y1 = clamp(from.y / size.height);
  const x2 = clamp(to.x / size.width), y2 = clamp(to.y / size.height);
  if (kind === 'arrow') return { kind, x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  return { kind, x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

/** Where a shape sits inside a host of this size, in pixels, with its corners the right way round. */
export function toBox(shape, size) {
  const left = (shape.w < 0 ? shape.x + shape.w : shape.x) * size.width;
  const top = (shape.h < 0 ? shape.y + shape.h : shape.y) * size.height;
  return { left, top, width: Math.abs(shape.w) * size.width, height: Math.abs(shape.h) * size.height };
}

/** An arrow runs from where the drag started to where it ended, not corner to corner. */
export function arrowLine(shape, size) {
  return {
    x1: shape.x * size.width,
    y1: shape.y * size.height,
    x2: (shape.x + shape.w) * size.width,
    y2: (shape.y + shape.h) * size.height,
  };
}

/** The two barbs of the arrow head, as points, in pixels. */
export function arrowHead(shape, size, length = 12) {
  const { x1, y1, x2, y2 } = arrowLine(shape, size);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const spread = Math.PI / 7;
  return [
    { x: x2 - length * Math.cos(angle - spread), y: y2 - length * Math.sin(angle - spread) },
    { x: x2, y: y2 },
    { x: x2 - length * Math.cos(angle + spread), y: y2 - length * Math.sin(angle + spread) },
  ];
}

/** Where a note badge sits for a shape: the top-right corner of a box, the head of an arrow. */
export function badgeAt(shape, size) {
  if (shape.kind === 'arrow') {
    const line = arrowLine(shape, size);
    return { x: line.x2, y: line.y2 };
  }
  const box = toBox(shape, size);
  return { x: box.left + box.width, y: box.top };
}

export function shapeLabel(kind) {
  return kind === 'rect' ? 'Rectangle' : kind === 'oval' ? 'Oval' : 'Arrow';
}
