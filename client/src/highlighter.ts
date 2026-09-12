import type { Highlight } from "./types";

const CTX = 40;

function textNodes(root: Node): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) out.push(n as Text);
  return out;
}

/** Character offset of (node, offset) inside root's concatenated text. */
function offsetOf(root: Node, node: Node, offset: number): number {
  let total = 0;
  for (const t of textNodes(root)) {
    if (t === node) return total + offset;
    if (node.nodeType !== Node.TEXT_NODE && node.contains(t)) {
      // selection boundary is an element: count children before `offset`
      const before = Array.from(node.childNodes).slice(0, offset);
      if (before.some((c) => c === t || c.contains(t))) { total += t.data.length; continue; }
      return total;
    }
    total += t.data.length;
  }
  return total;
}

/** Build an anchor descriptor from the current selection, if it lies inside root. */
export function captureSelection(root: HTMLElement): Omit<Highlight, "id" | "color" | "comment" | "createdAt"> | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const full = root.textContent || "";
  const start = offsetOf(root, range.startContainer, range.startOffset);
  const end = offsetOf(root, range.endContainer, range.endOffset);
  if (end <= start) return null;
  return {
    text: full.slice(start, end),
    prefix: full.slice(Math.max(0, start - CTX), start),
    suffix: full.slice(end, end + CTX),
  };
}

function locate(full: string, h: Highlight): number {
  // exact with context first, then progressively looser
  let i = full.indexOf(h.prefix + h.text + h.suffix);
  if (i >= 0) return i + h.prefix.length;
  i = full.indexOf(h.prefix + h.text);
  if (i >= 0) return i + h.prefix.length;
  i = full.indexOf(h.text + h.suffix);
  if (i >= 0) return i;
  return full.indexOf(h.text);
}

/** Wrap the text range [start, end) of root in <mark> elements. */
function wrapRange(root: HTMLElement, start: number, end: number, h: Highlight) {
  let pos = 0;
  for (const t of textNodes(root)) {
    const nStart = pos, nEnd = pos + t.data.length;
    pos = nEnd;
    if (nEnd <= start || nStart >= end) continue;
    const from = Math.max(start, nStart) - nStart;
    const to = Math.min(end, nEnd) - nStart;
    let target = t;
    if (from > 0) target = target.splitText(from);
    if (to - from < target.data.length) target.splitText(to - from);
    const mark = document.createElement("mark");
    mark.className = `hl hl-${h.color}`;
    mark.dataset.hid = h.id;
    if (h.comment) mark.title = h.comment;
    target.parentNode!.insertBefore(mark, target);
    mark.appendChild(target);
    // splitText made the walker list stale; total text is unchanged, so restart from here.
    const next = Math.min(end, nEnd);
    if (next < end) wrapRange(root, next, end, h);
    return;
  }
}

/** Remove all marks (unwrap) and re-apply the given highlights. */
export function applyHighlights(root: HTMLElement, highlights: Highlight[]) {
  root.querySelectorAll("mark.hl").forEach((m) => {
    const parent = m.parentNode!;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
  });
  root.normalize();
  const full = root.textContent || "";
  for (const h of highlights) {
    const start = locate(full, h);
    if (start < 0) continue;
    wrapRange(root, start, start + h.text.length, h);
    root.normalize();
  }
}
