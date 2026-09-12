/* Runs inside the framed copy of an article. Talks to the app through postMessage. */
(function () {
  var CTX = 40;
  var parentWin = window.parent;
  var send = function (msg) { parentWin.postMessage(Object.assign({ src: "rs-frame" }, msg), "*"); };
  var pageUrl = location.href;
  var currentList = [];
  var applying = false;

  function textNodes(root) {
    var out = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), n;
    while ((n = w.nextNode())) out.push(n);
    return out;
  }
  function offsetOf(root, node, offset) {
    var total = 0, nodes = textNodes(root);
    for (var i = 0; i < nodes.length; i++) {
      var t = nodes[i];
      if (t === node) return total + offset;
      if (node.nodeType !== 3 && node.contains(t)) {
        var before = Array.prototype.slice.call(node.childNodes, 0, offset);
        var inBefore = before.some(function (c) { return c === t || c.contains(t); });
        if (inBefore) { total += t.data.length; continue; }
        return total;
      }
      total += t.data.length;
    }
    return total;
  }
  function locate(full, h) {
    var i = full.indexOf(h.prefix + h.text + h.suffix); if (i >= 0) return i + h.prefix.length;
    i = full.indexOf(h.prefix + h.text); if (i >= 0) return i + h.prefix.length;
    i = full.indexOf(h.text + h.suffix); if (i >= 0) return i;
    return full.indexOf(h.text);
  }
  function wrapRange(root, start, end, h) {
    var pos = 0, nodes = textNodes(root);
    for (var i = 0; i < nodes.length; i++) {
      var t = nodes[i], nStart = pos, nEnd = pos + t.data.length;
      pos = nEnd;
      if (nEnd <= start || nStart >= end) continue;
      var from = Math.max(start, nStart) - nStart, to = Math.min(end, nEnd) - nStart;
      var target = t;
      if (from > 0) target = target.splitText(from);
      if (to - from < target.data.length) target.splitText(to - from);
      var mark = document.createElement("mark");
      mark.className = "rs-hl rs-hl-" + h.color;
      mark.setAttribute("data-hid", h.id);
      if (h.comment) mark.title = h.comment;
      target.parentNode.insertBefore(mark, target);
      mark.appendChild(target);
      var next = Math.min(end, nEnd);
      if (next < end) wrapRange(root, next, end, h);
      return;
    }
  }
  function applyHighlights(list) {
    currentList = list;
    applying = true;
    var root = document.body;
    Array.prototype.forEach.call(root.querySelectorAll("mark.rs-hl"), function (m) {
      var p = m.parentNode; while (m.firstChild) p.insertBefore(m.firstChild, m); p.removeChild(m);
    });
    root.normalize();
    var full = root.textContent || "";
    list.forEach(function (h) {
      var s = locate(full, h);
      if (s < 0) return;
      wrapRange(root, s, s + h.text.length, h);
      root.normalize();
    });
    setTimeout(function () { applying = false; }, 0);
  }
  // Page scripts (React hydration etc.) may replace the DOM and drop our marks: re-apply when that happens.
  var reapplyTimer = null;
  new MutationObserver(function () {
    if (applying || !currentList.length) return;
    if (document.querySelectorAll("mark.rs-hl").length >= currentList.length) return;
    clearTimeout(reapplyTimer);
    reapplyTimer = setTimeout(function () { applyHighlights(currentList); }, 400);
  }).observe(document.documentElement, { childList: true, subtree: true });

  // ---- selection -> parent
  document.addEventListener("mouseup", function () {
    setTimeout(function () {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) { send({ type: "selection", anchor: null }); return; }
      var range = sel.getRangeAt(0), root = document.body, full = root.textContent || "";
      var start = offsetOf(root, range.startContainer, range.startOffset);
      var end = offsetOf(root, range.endContainer, range.endOffset);
      if (end <= start) return;
      var text = full.slice(start, end);
      if (!text.trim()) return;
      var r = range.getBoundingClientRect();
      send({ type: "selection", anchor: { text: text, prefix: full.slice(Math.max(0, start - CTX), start), suffix: full.slice(end, end + CTX) },
        rect: { left: r.left, top: r.top, width: r.width, height: r.height, bottom: r.bottom } });
    }, 0);
  });
  document.addEventListener("scroll", function () { send({ type: "scroll" }); }, true);

  // ---- clicks: highlights and links
  document.addEventListener("click", function (e) {
    var mark = e.target.closest && e.target.closest("mark.rs-hl");
    if (mark) { send({ type: "hlclick", id: mark.getAttribute("data-hid") }); return; }
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var href = a.getAttribute("href");
    var abs;
    try { abs = new URL(href, pageUrl); } catch (_) { return; }
    var samePage = abs.origin === location.origin && abs.pathname === location.pathname;
    if (samePage && abs.hash) {
      e.preventDefault(); e.stopPropagation();
      var id = decodeURIComponent(abs.hash.slice(1));
      var el = document.getElementById(id) || document.querySelector("[name='" + id + "']");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      try { history.replaceState(null, "", location.pathname + location.search + abs.hash); } catch (_) {}
      return;
    }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return;
    e.preventDefault(); e.stopPropagation();
    // proxied host (www--example--com.localhost) -> real https URL
    var m = /^([a-z0-9-]+).localhost$/i.exec(abs.hostname);
    var real = m ? "https://" + m[1].replace(/--/g, ".") + abs.pathname + abs.search + abs.hash : abs.href;
    send({ type: "link", url: real, modifier: e.ctrlKey || e.metaKey || e.button === 1 });
  }, true);

  // forms/submit and anything else that would navigate away from our origin
  document.addEventListener("submit", function (e) { e.preventDefault(); }, true);

  window.addEventListener("message", function (e) {
    var m = e.data || {};
    if (m.src !== "rs-app") return;
    if (m.type === "highlights") {
      currentList = m.list || [];
      var delay = document.readyState === "complete" ? 0 : 800;
      setTimeout(function () { applyHighlights(currentList); }, delay);
    }
    if (m.type === "scrollTo") {
      var el = document.querySelector("mark.rs-hl[data-hid='" + m.id + "']");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (m.type === "clearSelection") { var s = window.getSelection(); if (s) s.removeAllRanges(); }
  });

  // initial fragment scroll (the frame URL carries the original #hash)
  var userScrolled = false;
  ["wheel", "touchstart", "keydown"].forEach(function (ev) { window.addEventListener(ev, function () { userScrolled = true; }, { passive: true }); });
  function jumpToHash() {
    if (!location.hash || userScrolled) return;
    var id = decodeURIComponent(location.hash.slice(1));
    var el = document.getElementById(id) || document.querySelector("[name='" + id + "']");
    if (el) el.scrollIntoView({ block: "start", behavior: "instant" });
  }
  // Layout keeps shifting while proxied CSS/fonts/images arrive, so re-run the jump a few times
  // (until the user scrolls). DOMContentLoaded fires long before "load" on image-heavy pages.
  function scheduleJumps() { [0, 300, 1000, 2000, 4000, 7000].forEach(function (ms) { setTimeout(jumpToHash, ms); }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scheduleJumps); else scheduleJumps();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(jumpToHash);
  window.addEventListener("load", function () { jumpToHash(); send({ type: "ready" }); });
  send({ type: "ready" });
})();
