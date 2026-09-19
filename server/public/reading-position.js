// Shared by the Reader and the proxied article. Content anchors survive pane reflow.
const blocks = "p,h1,h2,h3,h4,h5,h6,li,pre,blockquote,figure,img,table";
const label = (el) => (el.textContent || el.getAttribute("src") || "").trim().slice(0, 160);
const topOf = (scroller) => scroller === scroller.ownerDocument.scrollingElement ? 0 : scroller.getBoundingClientRect().top;

/**
 * Page chrome — a fixed site header, a sticky contents list — stays in view at every scroll
 * position, so anchoring to it records nothing about where the reader is. On a site with a
 * desktop header, every capture used to anchor to its first link, and restoring "just below
 * the header" left the article wherever it already was.
 */
function pinned(el, root, cache) {
  const view = el.ownerDocument.defaultView;
  const chain = [];
  let result = false;
  for (let node = el; node && node !== root && node.nodeType === 1; node = node.parentElement) {
    if (cache.has(node)) { result = cache.get(node); break; }
    chain.push(node);
    const position = view.getComputedStyle(node).position;
    if (position === "fixed" || position === "sticky") { result = true; break; }
  }
  chain.forEach((node) => cache.set(node, result));
  return result;
}

export function captureReadingPosition(root, scroller) {
  const position = { x: scroller.scrollLeft, y: scroller.scrollTop };
  if (position.y === 0) return position;
  const top = topOf(scroller);
  const candidates = Array.from(root.querySelectorAll(blocks));
  const cache = new Map();
  // Cheapest tests first: geometry, then text, then the ancestor walk.
  const index = candidates.findIndex((el) => {
    const rect = el.getBoundingClientRect();
    return rect.height > 0 && rect.bottom > top + 1 && rect.top < top + scroller.clientHeight
      && label(el) !== "" && !pinned(el, root, cache);
  });
  if (index >= 0) {
    const el = candidates[index], rect = el.getBoundingClientRect(), text = label(el);
    position.anchor = index;
    position.text = text;
    position.occurrence = candidates.slice(0, index).filter((item) => label(item) === text).length;
    position.offset = (top - rect.top) / rect.height;
  }
  // The anchor can sit under a site's sticky bar; for telling the creator what was captured,
  // name the passage actually showing a third of the way down instead.
  const doc = root.ownerDocument;
  const box = scroller === doc.scrollingElement ? { left: 0, width: scroller.clientWidth } : scroller.getBoundingClientRect();
  const hit = doc.elementFromPoint?.(box.left + box.width / 2, top + scroller.clientHeight * 0.3);
  const block = hit?.closest?.(blocks);
  if (block && root.contains(block) && label(block) && !pinned(block, root, cache)) position.seen = label(block).slice(0, 80);
  return position;
}

/** The element a saved position was measured from, or null when only its pixels can be trusted. */
function findAnchor(root, position) {
  // Text is what confirms an anchor; an empty one matches the first empty element anywhere.
  if (position.anchor === undefined || !position.text) return null;
  const candidates = Array.from(root.querySelectorAll(blocks));
  const cache = new Map();
  const usable = (el) => el.getBoundingClientRect().height > 0 && !pinned(el, root, cache);
  const indexed = candidates[position.anchor];
  if (indexed && label(indexed) === position.text) {
    if (usable(indexed)) return indexed;
    // A capture from before chrome was excluded landed on the header itself.
    if (position.occurrence === undefined) return null;
  }
  const same = candidates.filter((el) => label(el) === position.text);
  if (position.occurrence !== undefined) {
    const el = same[position.occurrence];
    if (el && usable(el)) return el;
  }
  // Older captures cannot say which copy they meant, and a narrower pane can swap a site's
  // contents list for another with a different number of copies. Only an unambiguous match will do.
  const matches = same.filter(usable);
  return matches.length === 1 ? matches[0] : null;
}

export function restoreReadingPosition(root, scroller, position) {
  let y = position.y;
  const el = findAnchor(root, position);
  if (el) {
    const rect = el.getBoundingClientRect();
    y = scroller.scrollTop + rect.top - topOf(scroller) + (position.offset || 0) * rect.height;
  }
  scroller.scrollTo({ left: position.x, top: y, behavior: "instant" });
}

/**
 * Reapply while late images/fonts settle, but never fight the creator's next action.
 *
 * After that, keep the passage on screen when the pane changes width. Collapsing the sidebar
 * or entering Present mode reflows the text under an unchanged scroll offset, and the
 * browser's own scroll anchoring does not reliably hold it, so a beat that restored
 * correctly drifted to a different passage a moment later.
 */
export function trackReadingPosition(root, scroller, target, report) {
  let restoring = Boolean(target), frame = 0;
  let held = target || null, width = scroller.clientWidth;
  const capture = () => {
    held = captureReadingPosition(root, scroller);
    width = scroller.clientWidth;
    report(held);
  };
  const restore = () => { if (restoring) restoreReadingPosition(root, scroller, target); };
  // Runs before any capture, so a scroll event caused by the reflow cannot overwrite the passage.
  const keep = () => { if (held && scroller.clientWidth !== width) restoreReadingPosition(root, scroller, held); };
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { restore(); if (!restoring) { keep(); capture(); } });
  };
  const release = () => { restoring = false; keep(); capture(); };
  const scroll = () => { if (!restoring) schedule(); };
  const events = ["wheel", "touchstart", "pointerdown", "keydown"];
  const scrollTarget = scroller === scroller.ownerDocument.scrollingElement ? scroller.ownerDocument : scroller;
  events.forEach((event) => scroller.ownerDocument.addEventListener(event, release, { capture: true, passive: true }));
  scrollTarget.addEventListener("scroll", scroll, { passive: true });
  const resize = new ResizeObserver(schedule);
  resize.observe(root);
  if (root !== scroller) resize.observe(scroller);
  // An iframe's body can keep its width while its viewport changes; the window always reports it.
  const view = scroller.ownerDocument.defaultView;
  view?.addEventListener("resize", schedule);
  const mutation = new MutationObserver(schedule);
  mutation.observe(root, { childList: true, subtree: true });
  root.addEventListener("load", schedule, true);
  scroller.ownerDocument.fonts?.addEventListener("loadingdone", schedule);
  restore();
  if (target) report(target); else capture();
  const timer = setTimeout(release, 2500);
  return () => {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    resize.disconnect();
    view?.removeEventListener("resize", schedule);
    mutation.disconnect();
    root.removeEventListener("load", schedule, true);
    scroller.ownerDocument.fonts?.removeEventListener("loadingdone", schedule);
    scrollTarget.removeEventListener("scroll", scroll);
    events.forEach((event) => scroller.ownerDocument.removeEventListener(event, release, true));
  };
}
