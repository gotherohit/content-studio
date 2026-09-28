/**
 * The toolbar's text size, which Reader uses directly and the live page follows as a zoom.
 *
 * At the size the toolbar starts at, a live page is shown exactly as the site made it; every
 * step up or down zooms it by the same proportion as Reader's text. Anchoring the zoom to the
 * default rather than to 1 is what keeps every page anyone has already recorded at its old size.
 */
export const DEFAULT_TEXT_SCALE = 1.05;
export const MIN_TEXT_SCALE = 0.8;
export const MAX_TEXT_SCALE = 1.8;

export const pageZoom = (scale: number) => {
  const safe = Number.isFinite(scale) ? Math.min(MAX_TEXT_SCALE, Math.max(MIN_TEXT_SCALE, scale)) : DEFAULT_TEXT_SCALE;
  return Math.round((safe / DEFAULT_TEXT_SCALE) * 100) / 100;
};

/** One press of the toolbar's − or +, kept on the tenths so the number shown stays tidy. */
export const stepTextScale = (scale: number, direction: 1 | -1) =>
  Math.min(MAX_TEXT_SCALE, Math.max(MIN_TEXT_SCALE, +(scale + direction * 0.1).toFixed(2)));

/**
 * A rectangle the zoomed page reports, in the pane's pixels. The page measures in its own
 * pixels, and the frame is scaled up by the zoom to fill the pane.
 */
export const toPane = <T extends { left: number; top: number; width: number; height: number; bottom: number }>(r: T, zoom: number) => ({
  left: r.left * zoom, top: r.top * zoom, width: r.width * zoom, height: r.height * zoom, bottom: r.bottom * zoom,
});
