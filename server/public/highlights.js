// Capture and replay share a visible-text index in Reader and Original views.
const colours = { yellow: '#fff3a3', green: '#c6f2c9', pink: '#ffd0e0', blue: '#cfe4ff' };
export function textNodes(root) {
  const doc = root.ownerDocument, hidden = new Map(), out = [];
  const excluded = el => {
    if (!el || el === root.parentElement) return false;
    if (hidden.has(el)) return hidden.get(el);
    const style = doc.defaultView.getComputedStyle(el);
    const value = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TEXTAREA|INPUT)$/.test(el.tagName) || el.hidden ||
      style.display === 'none' || style.visibility === 'hidden' || excluded(el.parentElement);
    hidden.set(el, value); return value;
  };
  const walker = doc.createTreeWalker(root, 4); let node;
  while ((node = walker.nextNode())) if (!excluded(node.parentElement)) out.push(node);
  return out;
}
export function captureRange(root, range) {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const nodes = textNodes(root), full = nodes.map(n => n.data).join('');
  const offset = (node, at) => {
    const before = root.ownerDocument.createRange(); before.selectNodeContents(root); before.setEnd(node, at);
    let count = 0;
    for (const text of nodes) {
      if (text === node) return count + at;
      if (before.comparePoint(text, text.length) !== 0) return count;
      count += text.length;
    }
    return count;
  };
  const start = offset(range.startContainer, range.startOffset), end = offset(range.endContainer, range.endOffset);
  if (end <= start || !full.slice(start, end).trim()) return null;
  return { text: full.slice(start, end), prefix: full.slice(Math.max(0, start - 40), start), suffix: full.slice(end, end + 40) };
}
function find(full, h) {
  if (!h.text) return -1;
  const prefix = h.prefix || '', suffix = h.suffix || '';
  let at = full.indexOf(prefix + h.text + suffix);
  if (at >= 0) return at + prefix.length;
  at = full.indexOf(prefix + h.text);
  if (at >= 0) return at + prefix.length;
  at = full.indexOf(h.text + suffix);
  return at >= 0 ? at : full.indexOf(h.text);
}
function normalise(text) {
  let value = ''; const starts = [], ends = [];
  for (let i = 0; i < text.length; i++) {
    const char = /\s/.test(text[i]) ? ' ' : text[i];
    if (char === ' ' && value.endsWith(' ')) { ends[ends.length - 1] = i + 1; continue; }
    value += char; starts.push(i); ends.push(i + 1);
  }
  return { value, starts, ends };
}
export function applyHighlights(root, highlights, className = 'hl') {
  root.querySelectorAll(`mark.${className}[data-hid]`).forEach(mark => mark.replaceWith(...mark.childNodes));
  root.normalize();
  const full = textNodes(root).map(n => n.data).join(''); let normal;
  const missing = [];
  for (const h of highlights) {
    let start = find(full, h), end = start + h.text.length;
    if (start < 0) {
      normal ||= normalise(full);
      const quote = normalise(h.text).value;
      const at = find(normal.value, { text: quote, prefix: normalise(h.prefix || '').value, suffix: normalise(h.suffix || '').value });
      if (at >= 0) { start = normal.starts[at]; end = normal.ends[at + quote.length - 1]; }
    }
    if (start < 0) { missing.push(h.id); continue; }
    // Snapshot before splitting; iteration also handles very long selections.
    let pos = 0;
    for (const node of textNodes(root)) {
      const begin = pos; pos += node.length;
      if (pos <= start || begin >= end) continue;
      const from = Math.max(start, begin) - begin, length = Math.min(end, pos) - begin - from;
      let target = from ? node.splitText(from) : node;
      if (length < target.length) target.splitText(length);
      const mark = root.ownerDocument.createElement('mark');
      mark.className = `${className} ${className}-${h.color}`; mark.dataset.hid = h.id;
      if (h.comment) mark.title = h.comment;
      if (className === 'rs-hl') {
        // Website styles must not erase the colour the reader chose.
        mark.style.setProperty('background-color', colours[h.color] || colours.yellow, 'important');
        mark.style.setProperty('color', '#202020', 'important');
        mark.style.setProperty('-webkit-text-fill-color', '#202020', 'important');
        mark.style.setProperty('display', 'inline', 'important');
      }
      target.replaceWith(mark); mark.append(target);
    }
  }
  return missing;
}
export function watchHighlights(root, getHighlights, apply, delay = 150) {
  let timer;
  const observer = new root.ownerDocument.defaultView.MutationObserver(() => {
    if (!getHighlights().length) return;
    clearTimeout(timer); timer = setTimeout(repair, delay);
  });
  const observe = () => observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
  function render() { observer.disconnect(); try { apply(); } finally { observe(); } }
  function repair() {
    if (!root.ownerDocument.defaultView.getSelection()?.isCollapsed) { timer = setTimeout(repair, delay); return; }
    render();
  }
  observe();
  return { render, stop: () => { clearTimeout(timer); observer.disconnect(); } };
}
