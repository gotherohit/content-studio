// Geometry for the PDF viewer. Kept out of the component so the page maths can be tested:
// which page the scroller is showing, and which pages are worth rendering, decide both what
// a beat captures and how much work every scroll costs.

export interface PageSize {
  width: number;
  height: number;
}

export interface PageLayout {
  /** Top of each page inside the scroller, in pixels. */
  tops: number[];
  heights: number[];
  widths: number[];
  total: number;
}

/** Gap between pages, and the padding around them, in CSS pixels. */
export const PAGE_GAP = 16;

export function layoutPages(sizes: PageSize[], scale: number, gap = PAGE_GAP): PageLayout {
  const tops: number[] = [], heights: number[] = [], widths: number[] = [];
  let y = gap;
  for (const s of sizes) {
    const h = Math.max(1, Math.round(s.height * scale));
    tops.push(y);
    heights.push(h);
    widths.push(Math.max(1, Math.round(s.width * scale)));
    y += h + gap;
  }
  return { tops, heights, widths, total: y };
}

/**
 * Scale that fits a page in the box. "width" fills the pane and scrolls; "page" shows a
 * whole page, which is what Slides mode wants.
 */
export function fitScale(size: PageSize, box: { width: number; height: number }, mode: "width" | "page", pad = PAGE_GAP) {
  const w = Math.max(1, box.width - pad * 2) / size.width;
  if (mode === "width") return w;
  return Math.min(w, Math.max(1, box.height - pad * 2) / size.height);
}

/**
 * The page a reader would say they are on: the one holding the top third of the viewport.
 * At the very bottom it is the last page, which can never be scrolled to the top third.
 */
export function pageAt(layout: PageLayout, scrollTop: number, viewHeight: number) {
  const n = layout.tops.length;
  if (!n) return 0;
  if (scrollTop + viewHeight >= layout.total - 1) return n - 1;
  const mark = scrollTop + viewHeight * 0.3;
  let i = 0;
  while (i + 1 < n && layout.tops[i + 1] <= mark) i++;
  return i;
}

/** Pages to keep rendered: everything touching the viewport, plus `overscan` either side. */
export function visiblePages(layout: PageLayout, scrollTop: number, viewHeight: number, overscan = 1) {
  const n = layout.tops.length;
  if (!n) return { start: 0, end: -1 };
  let start = 0;
  while (start < n && layout.tops[start] + layout.heights[start] < scrollTop) start++;
  let end = start;
  while (end + 1 < n && layout.tops[end + 1] < scrollTop + viewHeight) end++;
  return { start: Math.max(0, start - overscan), end: Math.min(n - 1, end + overscan) };
}

/** Scroll offset that puts a page at the top of the pane. */
export function offsetOf(layout: PageLayout, index: number, gap = PAGE_GAP) {
  const i = Math.min(Math.max(index, 0), layout.tops.length - 1);
  return i < 0 ? 0 : Math.max(0, layout.tops[i] - gap);
}

export function clampPage(index: number, count: number) {
  return Math.min(Math.max(Math.round(index) || 0, 0), Math.max(0, count - 1));
}

/** Zoom steps, so + and − land on the same values every time. */
export const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3, 4];

export function stepZoom(zoom: number, by: 1 | -1) {
  const i = ZOOM_STEPS.findIndex((z) => z > zoom + 0.001);
  const at = by > 0 ? (i === -1 ? ZOOM_STEPS.length - 1 : i) : Math.max(0, (i === -1 ? ZOOM_STEPS.length : i) - 2);
  return ZOOM_STEPS[Math.min(Math.max(at, 0), ZOOM_STEPS.length - 1)];
}

/** A PDF highlight belongs to one page; one saved without a page is treated as the first. */
export function pageOf(highlight: { page?: number }) {
  return Math.max(1, Math.round(highlight.page || 1)) - 1;
}

export function highlightsOnPage<T extends { page?: number }>(highlights: T[], index: number) {
  return highlights.filter((h) => pageOf(h) === index);
}
