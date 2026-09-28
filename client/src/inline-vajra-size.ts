export interface VajraSize { width: number; height: number }
export interface VajraBounds { width: number; height: number }

export function inlineVajraLayout(preferred: VajraSize | null, bounds: VajraBounds, expanded = false) {
  const margin = Math.min(10, bounds.width / 4, bounds.height / 4);
  const maxWidth = Math.max(1, bounds.width - margin * 2);
  const maxHeight = Math.max(1, bounds.height - margin * 2);
  const width = expanded ? maxWidth : Math.min(maxWidth, Math.max(Math.min(300, maxWidth), Number.isFinite(preferred?.width) ? preferred!.width : 450));
  const height = expanded ? maxHeight : preferred ? Math.min(maxHeight, Math.max(Math.min(280, maxHeight), Number.isFinite(preferred.height) ? preferred.height : 540)) : null;
  return { width, height, maxHeight, top: margin, right: margin };
}

/** The handle is on the lower left: moving left widens, moving down makes more room to read. */
export function resizeInlineVajra(start: VajraSize, dx: number, dy: number, bounds: VajraBounds): VajraSize {
  const layout = inlineVajraLayout({ width: start.width - dx, height: start.height + dy }, bounds);
  return { width: layout.width, height: layout.height! };
}
