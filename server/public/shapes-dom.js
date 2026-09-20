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

/** The block a shape drawn at this point belongs to: the nearest one with words in it. */
export function blockAt(doc, root, x, y) {
  const el = elementAt(doc, x, y);
  if (!el || !root.contains(el)) return root;
  let block = el.closest(BLOCK);
  while (block && block !== root && (block.textContent || "").trim().length < ENOUGH) {
    block = block.parentElement ? block.parentElement.closest(BLOCK) : null;
  }
  return block && root.contains(block) ? block : root;
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

/** What a shape drawn at this point should be anchored to: a picture, or a block of prose. */
export function anchorAt(doc, root, x, y) {
  const img = imageAt(doc, x, y);
  if (img && root.contains(img)) {
    return { host: img, onImage: img.currentSrc || img.getAttribute("src") || "", anchor: { text: "", prefix: "", suffix: "" } };
  }
  const block = blockAt(doc, root, x, y);
  if (!block) return null;
  return { host: block, onImage: undefined, anchor: blockAnchor(root, block) || { text: "", prefix: "", suffix: "" } };
}

/** The element a saved shape sits on, or null when the page no longer has it. */
export function hostFor(root, h) {
  if (h.onImage) {
    const img = Array.from(root.querySelectorAll("img")).find((im) => (im.currentSrc || im.src) === h.onImage || im.getAttribute("src") === h.onImage);
    if (img) return img;
  }
  if (!h.text) return h.onImage ? null : root;
  const range = findRange(root, h);
  if (!range) return null;
  const node = range.commonAncestorContainer;
  const el = node.nodeType === 3 ? node.parentElement : node;
  return (el && el.closest(BLOCK)) || el;
}

/** Where an element sits inside the box that draws over it, in pixels. */
export function boxWithin(container, el) {
  const a = container.getBoundingClientRect(), b = el.getBoundingClientRect();
  return { left: b.left - a.left, top: b.top - a.top, width: b.width, height: b.height };
}
