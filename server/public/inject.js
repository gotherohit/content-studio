/* Runs inside the framed copy of an article. Talks to the app through postMessage. */
(async function () {
  var scriptUrl = document.currentScript.src;
  var positionModule = await import(new URL("./reading-position.js", scriptUrl).href);
  var highlightsModule = await import(new URL("./highlights.js", scriptUrl).href);
  var parentWin = window.parent;
  var send = function (msg) { parentWin.postMessage(Object.assign({ src: "rs-frame" }, msg), "*"); };
  var pageUrl = location.href;
  var currentList = [];
  var stopTracking = null;
  var positionNonce = null;
  var pendingHighlight = null;
  var presenting = false;

  var highlightWatcher = highlightsModule.watchHighlights(document.body, function () { return currentList; }, function () {
    highlightsModule.applyHighlights(document.body, currentList, "rs-hl");
    if (pendingHighlight) jumpToHighlight();
  });
  function applyHighlights(list) {
    currentList = list;
    highlightWatcher.render();
  }
  function jumpToHighlight() {
    var el = Array.from(document.querySelectorAll("mark.rs-hl")).find(function (mark) { return mark.getAttribute("data-hid") === pendingHighlight; });
    if (el) { el.scrollIntoView({ behavior: "instant", block: "center" }); pendingHighlight = null; }
  }
  // ---- selection -> parent
  document.addEventListener("mouseup", function () {
    setTimeout(function () {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) { send({ type: "selection", anchor: null }); return; }
      var range = sel.getRangeAt(0);
      var anchor = highlightsModule.captureRange(document.body, range);
      if (!anchor) return;
      var r = range.getBoundingClientRect();
      send({ type: "selection", anchor: anchor,
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

  // Key events do not bubble out of an iframe. Forward only presentation commands.
  window.addEventListener("keydown", function (e) {
    var target = e.target;
    if (!presenting || e.ctrlKey || e.metaKey || e.altKey || target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (["ArrowRight", "ArrowLeft", "PageDown", "PageUp", " ", "Home", "End", "Escape", "h"].indexOf(e.key) < 0) return;
    e.preventDefault(); e.stopImmediatePropagation();
    send({ type: "presentationKey", key: e.key });
  }, true);

  window.addEventListener("message", function (e) {
    var m = e.data || {};
    if (m.src !== "rs-app" || e.source !== parentWin) return;
    if (m.type === "presentation") presenting = Boolean(m.enabled);
    if (m.type === "restorePosition" && m.nonce !== positionNonce) {
      positionNonce = m.nonce;
      if (m.position) userScrolled = true;
      pendingHighlight = null;
      if (stopTracking) stopTracking();
      stopTracking = positionModule.trackReadingPosition(document.body, document.scrollingElement, m.position, function (position) {
        send({ type: "position", position: position, nonce: positionNonce });
      });
      // A concealed iframe may not receive animation frames; acknowledge the synchronous jump.
      send({ type: "positionRestored", nonce: positionNonce });
    }
    if (m.type === "highlights") {
      currentList = m.list || [];
      var delay = document.readyState === "complete" ? 0 : 800;
      setTimeout(function () { applyHighlights(currentList); }, delay);
    }
    if (m.type === "scrollTo") {
      userScrolled = true;
      if (stopTracking) stopTracking();
      stopTracking = positionModule.trackReadingPosition(document.body, document.scrollingElement, undefined, function (position) {
        send({ type: "position", position: position, nonce: positionNonce });
      });
      pendingHighlight = m.id;
      jumpToHighlight();
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
