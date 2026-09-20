/**
 * Telling "the page moved" from "a box inside the page moved".
 *
 * A scroll event does not bubble, so everything that wants to know about scrolling listens in
 * the capture phase — which means every carousel, sticky column, code block and lazy image in
 * a real article reports its own scrolling too. The note card is closed when the page moves
 * under it, so those strays were enough to take a half-typed comment away.
 */

/** Whether this scroll event came from the page itself rather than something inside it. */
export function isPageScroll(target, doc) {
  return target === doc || target === doc.defaultView || target === doc.documentElement || target === doc.body;
}

/** Reports a scroll only when the page itself has actually moved since the last one. */
export function pageScrolls(win) {
  var doc = win.document;
  var x = win.scrollX || 0, y = win.scrollY || 0;
  return function (target) {
    if (!isPageScroll(target, doc)) return false;
    var nx = win.scrollX || 0, ny = win.scrollY || 0;
    if (nx === x && ny === y) return false;
    x = nx; y = ny;
    return true;
  };
}
