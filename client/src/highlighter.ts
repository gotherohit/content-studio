import { captureRange } from "../../server/public/highlights.js";
export { applyHighlights } from "../../server/public/highlights.js";

export function captureSelection(root: HTMLElement) {
  const selection = root.ownerDocument.defaultView?.getSelection();
  return selection && !selection.isCollapsed && selection.rangeCount ? captureRange(root, selection.getRangeAt(0)) : null;
}
