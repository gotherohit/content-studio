// What a drawn shape belongs to, and where that thing is now.
//
// A shape over a PDF page or an image can be kept as fractions of it and that is the end of
// the matter. Over prose there is no such box: the text reflows with the pane, so a shape is
// anchored to the paragraph (or the picture) it was drawn over, exactly as a highlight is
// anchored to its quote, and its fractions are of that element's box. Shared by the app's
// Reader and the script injected into a framed article, so both agree on what "over" means.
import { captureRange, findRange } from "./highlights.js";

export const BLOCK = "p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,figure,table,ul,ol,img,section,article,main,div";

/** A block needs at least this much text before its first words can identify it. */
const ENOUGH = 12;

/** The element under a point, never one of our own overlays. */
export function elementAt(doc, x, y) {
  const stack = doc.elementsFromPoint ? doc.elementsFromPoint(x, y) : [doc.elementFromPoint(x, y)];
  return stack.find((el) => el && !(el.closest && el.closest(".shape-layer, .rs-shapes"))) || null;
}

/** The picture under a point, when there is one: the steadiest anchor a page offers. */
export function imageAt(doc, x, y) {
  const el = elementAt(doc, x, y);
  if (!el) return null;
  if (el.tagName === "IMG") return el;
  const near = (el.closest && el.closest("figure,picture")) || el;
  const inside = near.querySelectorAll ? Array.from(near.querySelectorAll("img")) : [];
  return inside.find((img) => {
    const r = img.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }) || null;
}

/** Blocks that hold prose themselves, rather than containing other blocks that do. */
const LEAF = "p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,figure,table";

/**
 * The block a shape drawn at this point belongs to: the one under the pointer, or — when the
 * drag starts in a margin or the gap between paragraphs, which is exactly where you start to
 * draw a box *around* something — the nearest line of prose to it.
 */
export function blockAt(doc, root, x, y) {
  const el = elementAt(doc, x, y);
  if (el && root.contains(el)) {
    let block = el.closest(BLOCK);
    while (block && block !== root && (block.textContent || "").trim().length < ENOUGH) {
      block = block.parentElement ? block.parentElement.closest(BLOCK) : null;
    }
    if (block && block !== root && root.contains(block)) return block;
  }
  return nearestBlock(root, x, y) || root;
}

/** The line of prose closest to a point, when the point itself is not on one. */
function nearestBlock(root, x, y, reach = 160) {
  let best = null, score = Infinity;
  for (const el of root.querySelectorAll(LEAF)) {
    if ((el.textContent || "").trim().length < ENOUGH) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const d = dy * 4 + dx;
    if (dy <= reach && d < score) { best = el; score = d; }
  }
  return best;
}

/** The first words of a block, captured the way a quote is, so the block can be found again. */
export function blockAnchor(root, block, limit = 60) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(block, 4);
  const range = doc.createRange();
  let node, taken = 0, started = false;
  while ((node = walker.nextNode())) {
    const text = node.data;
    if (!started && !text.trim()) continue;
    if (!started) { range.setStart(node, 0); started = true; }
    const room = limit - taken;
    if (text.length >= room) { range.setEnd(node, room); taken = limit; break; }
    range.setEnd(node, text.length);
    taken += text.length;
  }
  if (!started || !taken) return null;
  return captureRange(root, range);
}

const EMPTY = { text: "", prefix: "", suffix: "", blocks: undefined };

// A drawing can cover several paragraphs that become columns at another breakpoint.
// Its host is their union, not the page or whichever paragraph happened to be largest.
function groupHost(hosts) {
  return {
    getBoundingClientRect() {
      const boxes = hosts.map(el => el.getBoundingClientRect());
      const left = Math.min(...boxes.map(r => r.left)), top = Math.min(...boxes.map(r => r.top));
      const right = Math.max(...boxes.map(r => r.right)), bottom = Math.max(...boxes.map(r => r.bottom));
      return { left, top, right, bottom, x: left, y: top, width: right - left, height: bottom - top };
    },
    scrollIntoView(options) { hosts[0].scrollIntoView(options); },
  };
}

/**
 * What a drawing belongs to: the thing it mostly covers.
 *
 * Choosing by the point the drag started is wrong in the common case — a box drawn *around* a
 * paragraph starts in the gap above it, which belongs to the heading, and the drawing was then
 * kept as fractions of a heading one line tall and came back squashed into it. The element with
 * the largest overlap is the thing being pointed at; a picture wins over the figure around it.
 * `rect` is in viewport coordinates, like everything getBoundingClientRect returns.
 */
export function anchorForRect(doc, root, rect) {
  const overlap = (a, b) =>
    Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const covered = [];
  for (const el of root.querySelectorAll(LEAF)) {
    if (el.closest('.rs-shapes, .shape-layer') || el.querySelector(LEAF + ',img')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || overlap(rect, r) < r.width * r.height * 0.25) continue;
    const quote = blockAnchor(root, el);
    if (!quote?.text.trim()) continue;
    const host = hostFor(root, quote);
    if (host && !covered.some(c => c.host === host)) covered.push({ host, quote });
  }
  const drawnArea = Math.max(1, (rect.right - rect.left) * (rect.bottom - rect.top));
  if (covered.length > 1 && covered.reduce((sum, c) => sum + overlap(rect, c.host.getBoundingClientRect()), 0) >= drawnArea * 0.3) {
    return { host: groupHost(covered.map(c => c.host)), onImage: undefined,
      anchor: { ...covered[0].quote, blocks: covered.map(c => c.quote) } };
  }
  let best = null, most = 0;
  for (const el of root.querySelectorAll(LEAF + ",img")) {
    if (el.tagName !== "IMG" && (el.textContent || "").trim().length < ENOUGH) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const area = overlap(rect, r);
    if (area > most) { most = area; best = el; }
  }
  if (best && best.tagName !== "IMG") {
    const picture = best.querySelector ? best.querySelector("img") : null;
    if (picture && overlap(rect, picture.getBoundingClientRect()) > most * 0.8) best = picture;
  }
  // Nothing under it: the nearest line of prose, but only if it is close.
  if (!best) best = nearestBlock(root, (rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2, 60);
  if (!best) return { host: root, onImage: undefined, anchor: EMPTY };
  // A drawing that barely sits on that block is not about it — one dragged into the white
  // space beside a paragraph, say. Kept as fractions of the paragraph it would be squeezed
  // back towards it, so it belongs to the source as a whole instead.
  const area = Math.max(1, (rect.right - rect.left) * (rect.bottom - rect.top));
  if (overlap(rect, best.getBoundingClientRect()) / area < 0.3) {
    return { host: root, onImage: undefined, anchor: EMPTY };
  }
  if (best.tagName === "IMG") {
    return { host: best, onImage: best.currentSrc || best.getAttribute("src") || "", anchor: EMPTY };
  }
  const quote = blockAnchor(root, best);
  if (!quote || !quote.text.trim()) return { host: root, onImage: undefined, anchor: EMPTY };
  // The element the quote will be found on later, which is not always the one with the most
  // overlap: a container's first words belong to its first paragraph. Keeping the drawing
  // against anything else means it is drawn against a different box than it was measured in.
  const settled = hostFor(root, quote) || best;
  return { host: settled, onImage: undefined, anchor: { ...quote, blocks: undefined } };
}

/** What a shape drawn at this point should be anchored to: a picture, or a block of prose. */
export function anchorAt(doc, root, x, y) {
  const img = imageAt(doc, x, y);
  if (img && root.contains(img)) {
    return { host: img, onImage: img.currentSrc || img.getAttribute("src") || "", anchor: { text: "", prefix: "", suffix: "" } };
  }
  const block = blockAt(doc, root, x, y);
  if (!block) return null;
  // Falling back to the whole source must say so: a quote taken from the top of it would be
  // found again inside the first paragraph, and the shape would jump there.
  if (block === root) return { host: root, onImage: undefined, anchor: EMPTY };
  const quote = blockAnchor(root, block);
  return quote && quote.text.trim()
    ? { host: block, onImage: undefined, anchor: quote }
    : { host: root, onImage: undefined, anchor: EMPTY };
}

/** The element a saved shape sits on, or null when the page no longer has it. */
export function hostFor(root, h) {
  if (h.blocks?.length) {
    const hosts = h.blocks.map(quote => hostFor(root, quote));
    // A missing block must not silently shrink the drawing onto a different passage.
    return hosts.every(Boolean) ? groupHost(hosts) : null;
  }
  if (h.onImage) {
    const img = Array.from(root.querySelectorAll("img")).find((im) => (im.currentSrc || im.src) === h.onImage || im.getAttribute("src") === h.onImage);
    if (img) return img;
  }
  if (!h.text) return h.onImage ? null : root;
  const range = findRange(root, h);
  if (!range) return null;
  // Where the quote *starts*, not what contains all of it: a quote that runs a few characters
  // past the end of its paragraph has the whole article as its common ancestor, and a drawing
  // kept as fractions of that is nowhere near the paragraph it was drawn on.
  const node = range.startContainer;
  const el = node.nodeType === 3 ? node.parentElement : node;
  if (!el) return null;
  return el.closest(LEAF) || el.closest(BLOCK) || el;
}

/** Where an element sits inside the box that draws over it, in pixels. */
export function boxWithin(container, el) {
  const a = container.getBoundingClientRect(), b = el.getBoundingClientRect();
  return { left: b.left - a.left, top: b.top - a.top, width: b.width, height: b.height };
}
