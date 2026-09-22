/** Keep the whole note inside its source pane while letting prose reflow naturally. */
export function noteCardLayout(preferredWidth: number, x: number, y: number, below: boolean, bounds: { width: number; height: number }, measuredHeight: number) {
  const margin = Math.min(8, bounds.width / 4, bounds.height / 4);
  const maxWidth = Math.max(1, Math.min(1600, bounds.width - margin * 2));
  const width = Math.min(maxWidth, Math.max(Math.min(200, maxWidth), Number.isFinite(preferredWidth) ? preferredWidth : 300));
  const maxHeight = Math.max(1, bounds.height - margin * 2);
  const height = Math.min(maxHeight, measuredHeight);
  const left = Math.max(margin, Math.min(x - width / 2, bounds.width - margin - width));
  const top = Math.max(margin, Math.min(below ? y : y - height, bounds.height - margin - height));
  return { width, left, top, maxHeight };
}
