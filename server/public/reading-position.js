// Shared by the Reader and the proxied article. Content anchors survive pane reflow.
const blocks = "p,h1,h2,h3,h4,h5,h6,li,pre,blockquote,figure,img,table";
const label = (el) => (el.textContent || el.getAttribute("src") || "").trim().slice(0, 160);
const topOf = (scroller) => scroller === scroller.ownerDocument.scrollingElement ? 0 : scroller.getBoundingClientRect().top;

export function captureReadingPosition(root, scroller) {
  const position = { x: scroller.scrollLeft, y: scroller.scrollTop };
  if (position.y === 0) return position;
  const top = topOf(scroller);
  const candidates = Array.from(root.querySelectorAll(blocks));
  const index = candidates.findIndex((el) => {
    const rect = el.getBoundingClientRect();
    return rect.height > 0 && rect.bottom > top + 1 && rect.top < top + scroller.clientHeight;
  });
  if (index >= 0) {
    const el = candidates[index], rect = el.getBoundingClientRect();
    position.anchor = index;
    position.text = label(el);
    position.offset = (top - rect.top) / rect.height;
  }
  return position;
}

export function restoreReadingPosition(root, scroller, position) {
  let y = position.y;
  if (position.anchor !== undefined) {
    const candidates = Array.from(root.querySelectorAll(blocks));
    let el = candidates[position.anchor];
    if (!el || label(el) !== position.text) el = candidates.find((item) => label(item) === position.text);
    if (el) {
      const rect = el.getBoundingClientRect();
      y = scroller.scrollTop + rect.top - topOf(scroller) + (position.offset || 0) * rect.height;
    }
  }
  scroller.scrollTo({ left: position.x, top: y, behavior: "instant" });
}

/** Reapply while late images/fonts settle, but never fight the creator's next action. */
export function trackReadingPosition(root, scroller, target, report) {
  let restoring = Boolean(target), frame = 0;
  const capture = () => report(captureReadingPosition(root, scroller));
  const restore = () => { if (restoring) restoreReadingPosition(root, scroller, target); };
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { restore(); if (!restoring) capture(); });
  };
  const release = () => { restoring = false; capture(); };
  const scroll = () => { if (!restoring) schedule(); };
  const events = ["wheel", "touchstart", "pointerdown", "keydown"];
  const scrollTarget = scroller === scroller.ownerDocument.scrollingElement ? scroller.ownerDocument : scroller;
  events.forEach((event) => scroller.ownerDocument.addEventListener(event, release, { capture: true, passive: true }));
  scrollTarget.addEventListener("scroll", scroll, { passive: true });
  const resize = new ResizeObserver(schedule);
  resize.observe(root);
  if (root !== scroller) resize.observe(scroller);
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
    mutation.disconnect();
    root.removeEventListener("load", schedule, true);
    scroller.ownerDocument.fonts?.removeEventListener("loadingdone", schedule);
    scrollTarget.removeEventListener("scroll", scroll);
    events.forEach((event) => scroller.ownerDocument.removeEventListener(event, release, true));
  };
}
