// The maths of a drawn shape, kept in plain JavaScript so the app and the script injected
// into a framed article share one definition of every outline, arrow head and default style.
// Everything is fractions of the box the shape was drawn on, so it survives zooming and a
// resized pane; the same drawing must look the same in Reader and in the live page.

/** Shorter than this and it was a click, not a drawing. */
export const MIN_DRAG = 5;

/**
   * How far outside its host a shape may reach, as a multiple of it. Drawing a box *around* a
   * paragraph starts in the margin and ends past its other corner, and a drawing dragged a
   * little clear of its paragraph must not be squashed back onto it; clamping tightly was the
   * drawing snapping to a place nobody asked for.
   */
const SPILL = 1;
const clamp = (v) => Math.min(1 + SPILL, Math.max(-SPILL, v));

/** Every kind, in the order the drawing menu offers them. */
export const SHAPE_KINDS = ['marker', 'rect', 'oval', 'triangle', 'diamond', 'star', 'callout', 'line', 'arrow', 'darrow'];

/** Lines have a direction and two ends to grab; everything else is a box with four corners. */
const LINES = new Set(['line', 'arrow', 'darrow']);
export const isLine = (kind) => LINES.has(kind);

/**
 * The palette a drawing may use, in the strong shades. They are the same in the light and dark
 * themes, which is what lets the app and the framed page paint a drawing identically.
 */
export const COLOURS = {
  yellow: '#e0b528', green: '#2fae51', pink: '#dd5f92', blue: '#3d84dd',
  red: '#e5484d', orange: '#e8820c', purple: '#8b5cf6', black: '#1f2328', white: '#ffffff',
};
export const PALETTE = Object.keys(COLOURS);

/**
 * A drag in pixels becomes fractions of the box it happened in. A line keeps its direction,
 * so its width and height may be negative; every other shape is normalised.
 */
export function fromDrag(kind, from, to, size) {
  if (!size.width || !size.height) return null;
  if (Math.abs(to.x - from.x) < MIN_DRAG && Math.abs(to.y - from.y) < MIN_DRAG) return null;
  const x1 = clamp(from.x / size.width), y1 = clamp(from.y / size.height);
  const x2 = clamp(to.x / size.width), y2 = clamp(to.y / size.height);
  if (isLine(kind)) return { kind, x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  return { kind, x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

/** Where a shape sits inside a host of this size, in pixels, with its corners the right way round. */
export function toBox(shape, size) {
  const left = (shape.w < 0 ? shape.x + shape.w : shape.x) * size.width;
  const top = (shape.h < 0 ? shape.y + shape.h : shape.y) * size.height;
  return { left, top, width: Math.abs(shape.w) * size.width, height: Math.abs(shape.h) * size.height };
}

/** A line runs from where the drag started to where it ended, not corner to corner. */
export function arrowLine(shape, size) {
  return {
    x1: shape.x * size.width,
    y1: shape.y * size.height,
    x2: (shape.x + shape.w) * size.width,
    y2: (shape.y + shape.h) * size.height,
  };
}

/** The two barbs of the arrow head at the end of a line, as points, in pixels. */
export function arrowHead(shape, size, length = 12) {
  const { x1, y1, x2, y2 } = arrowLine(shape, size);
  return headAt(x2, y2, Math.atan2(y2 - y1, x2 - x1), length);
}

function headAt(x, y, angle, length) {
  const spread = Math.PI / 7;
  return [
    { x: x - length * Math.cos(angle - spread), y: y - length * Math.sin(angle - spread) },
    { x, y },
    { x: x - length * Math.cos(angle + spread), y: y - length * Math.sin(angle + spread) },
  ];
}

/**
 * The paint a shape is drawn with. Every field is optional on a saved shape, so a drawing made
 * before styles existed resolves to exactly what it looked like then: an outline in its own
 * colour, 2.5 px, nothing inside. `match` means the drawing's own colour, the one its card,
 * marker and map dot carry.
 */
export function resolveStyle(shape) {
  const kind = shape.kind;
  return {
    fill: shape.fill ?? (kind === 'marker' ? 'match' : kind === 'callout' ? 'white' : 'none'),
    fillOpacity: clampUnit(shape.fillOpacity ?? (kind === 'marker' ? 0.35 : kind === 'callout' ? 0.95 : 0.25)),
    stroke: shape.stroke ?? (kind === 'marker' ? 'none' : 'match'),
    width: Math.min(12, Math.max(1, shape.width ?? 2.5)),
    dash: shape.dash ?? 'solid',
  };
}
const clampUnit = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** A palette name, `match` or `none`, as a colour a renderer can use. `none` stays null. */
export function paint(name, own) {
  if (!name || name === 'none') return null;
  if (name === 'match') return COLOURS[own] || COLOURS.yellow;
  return COLOURS[name] || COLOURS[own] || COLOURS.yellow;
}

/** The dash pattern for a stroke, sized to its width so a thick dotted line still reads as dots. */
export function dashArray(dash, width) {
  if (dash === 'dashed') return `${width * 3} ${width * 2}`;
  if (dash === 'dotted') return `0.01 ${width * 2}`;
  return '';
}

/** Black or white text, whichever reads on this fill. */
export function inkOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#1f2328';
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#1f2328' : '#ffffff';
}

const f = (n) => Math.round(n * 100) / 100;

/** A rectangle with rounded corners, as path data. */
function roundedRect(l, t, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!r) return `M${f(l)} ${f(t)}H${f(l + w)}V${f(t + h)}H${f(l)}Z`;
  return `M${f(l + r)} ${f(t)}H${f(l + w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(l + w)} ${f(t + r)}` +
    `V${f(t + h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(l + w - r)} ${f(t + h)}` +
    `H${f(l + r)}A${f(r)} ${f(r)} 0 0 1 ${f(l)} ${f(t + h - r)}` +
    `V${f(t + r)}A${f(r)} ${f(r)} 0 0 1 ${f(l + r)} ${f(t)}Z`;
}

const polygon = (pts) => `M${pts.map((p) => `${f(p.x)} ${f(p.y)}`).join('L')}Z`;

/**
 * The part of a callout that holds its text: all of the box but the band its tail points out
 * of. The tail stays inside the drawn box, so resizing the box resizes the whole callout.
 */
export function calloutBody(shape, size) {
  const b = toBox(shape, size);
  const tail = Math.min(Math.max(10, b.height * 0.22), b.height * 0.45);
  return { left: b.left, top: b.top, width: b.width, height: b.height - tail };
}

/**
 * The size of a callout's words, chosen so the note fits its box: roughly how many characters
 * of that size fit the area, never smaller than can be read on a recording nor larger than a
 * heading. Computed rather than measured, so the app and the framed page agree to the pixel.
 */
export function calloutFont(body, text) {
  const chars = Math.max(1, String(text || '').trim().length);
  const area = Math.max(0, body.width - 18) * Math.max(0, body.height - 12);
  const fit = Math.sqrt(area / (0.56 * 1.35 * chars));
  return Math.round(Math.min(18, Math.max(9, fit)) * 2) / 2;
}

/**
 * The outline of a shape as SVG path data, in the pixels of a host of this size. Closed for a
 * box, which is what a fill paints inside; open for a line, which a fill ignores.
 */
export function shapePath(shape, size) {
  if (isLine(shape.kind)) {
    const { x1, y1, x2, y2 } = arrowLine(shape, size);
    return `M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}`;
  }
  const b = toBox(shape, size);
  const { left: l, top: t, width: w, height: h } = b;
  const cx = l + w / 2, cy = t + h / 2;
  switch (shape.kind) {
    case 'oval': {
      const rx = Math.max(0.5, w / 2), ry = Math.max(0.5, h / 2);
      return `M${f(cx - rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)}Z`;
    }
    case 'triangle':
      return polygon([{ x: cx, y: t }, { x: l + w, y: t + h }, { x: l, y: t + h }]);
    case 'diamond':
      return polygon([{ x: cx, y: t }, { x: l + w, y: cy }, { x: cx, y: t + h }, { x: l, y: cy }]);
    case 'star': {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const k = i % 2 ? 0.4 : 1;
        pts.push({ x: cx + (w / 2) * k * Math.cos(a), y: cy + (h / 2) * k * Math.sin(a) });
      }
      return polygon(pts);
    }
    case 'callout': {
      const body = calloutBody(shape, size);
      const r = Math.min(8, body.width / 4, body.height / 4);
      const bottom = body.top + body.height;
      // The tail leaves the body's lower edge a quarter of the way along and points down-left.
      const a = l + w * 0.2, c = l + w * 0.38, tip = { x: l + w * 0.12, y: t + h };
      return `M${f(l + r)} ${f(t)}H${f(l + w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(l + w)} ${f(t + r)}` +
        `V${f(bottom - r)}A${f(r)} ${f(r)} 0 0 1 ${f(l + w - r)} ${f(bottom)}` +
        `H${f(c)}L${f(tip.x)} ${f(tip.y)}L${f(a)} ${f(bottom)}` +
        `H${f(l + r)}A${f(r)} ${f(r)} 0 0 1 ${f(l)} ${f(bottom - r)}` +
        `V${f(t + r)}A${f(r)} ${f(r)} 0 0 1 ${f(l + r)} ${f(t)}Z`;
    }
    case 'marker':
      return roundedRect(l, t, w, h, 2);
    default:
      return roundedRect(l, t, w, h, 3);
  }
}

/**
 * The arrow heads of a line, each a closed triangle painted in the stroke colour. Sized to the
 * stroke, so a thick arrow does not end in a pin head.
 */
export function shapeHeads(shape, size) {
  if (shape.kind !== 'arrow' && shape.kind !== 'darrow') return [];
  const { x1, y1, x2, y2 } = arrowLine(shape, size);
  const length = Math.max(10, resolveStyle(shape).width * 4);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const heads = [polygon(headAt(x2, y2, angle, length))];
  if (shape.kind === 'darrow') heads.push(polygon(headAt(x1, y1, angle + Math.PI, length)));
  return heads;
}

/** Where a note badge sits for a shape: the top-right corner of a box, the end of a line. */
export function badgeAt(shape, size) {
  if (isLine(shape.kind)) {
    const line = arrowLine(shape, size);
    return { x: line.x2, y: line.y2 };
  }
  const box = toBox(shape, size);
  return { x: box.left + box.width, y: box.top };
}

const LABELS = {
  marker: 'Highlighter', rect: 'Rectangle', oval: 'Oval', triangle: 'Triangle', diamond: 'Diamond',
  star: 'Star', callout: 'Callout', line: 'Line', arrow: 'Arrow', darrow: 'Double arrow',
};
export function shapeLabel(kind) {
  return LABELS[kind] || 'Shape';
}
