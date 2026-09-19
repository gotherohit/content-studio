/* Runs inside the framed copy of an article. Talks to the app through postMessage. */
(async function () {
  var scriptUrl = document.currentScript.src;
  var positionModule = await import(new URL("./reading-position.js", scriptUrl).href);
  var highlightsModule = await import(new URL("./highlights.js", scriptUrl).href);
  var pagesModule = await import(new URL("./pages.js", scriptUrl).href);
  var parentWin = window.parent;
  var send = function (msg) { parentWin.postMessage(Object.assign({ src: "rs-frame" }, msg), "*"); };
  var pageUrl = location.href;
  var currentList = [];
  var stopTracking = null;
  var positionNonce = null;
  var pendingHighlight = null;
  var presenting = false;
  // The source's own page. Another page of the site can be browsed in the same pane, but a
  // highlight belongs to the page it was made on and would land on matching text elsewhere.
  var home = null;
  var here = function () { return pagesModule.realUrl(location.href); };
  var onHome = function () { return !home || pagesModule.samePage(home, here()); };
  var visibleList = function () { return onHome() ? currentList : []; };

  var highlightWatcher = highlightsModule.watchHighlights(document.body, visibleList, function () {
    highlightsModule.applyHighlights(document.body, visibleList(), "rs-hl");
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
      if (!sel || sel.isCollapsed || !sel.rangeCount || !onHome()) { send({ type: "selection", anchor: null }); return; }
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
    // The app decides: another page of this site opens in the pane, another site becomes a source.
    send({ type: "link", url: pagesModule.realUrl(abs.href), sameSite: abs.origin === location.origin, modifier: e.ctrlKey || e.metaKey || e.button === 1 });
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

  function report(position) { send({ type: "position", position: position, nonce: positionNonce, url: here() }); }

  window.addEventListener("message", function (e) {
    var m = e.data || {};
    if (m.src !== "rs-app" || e.source !== parentWin) return;
    if (m.type === "presentation") presenting = Boolean(m.enabled);
    if (m.type === "home") { home = m.url; highlightWatcher.render(); }
    // A position is only meaningful on the page it was captured on.
    if (m.type === "restorePosition" && m.page && !pagesModule.samePage(m.page, here())) return;
    if (m.type === "restorePosition" && m.nonce !== positionNonce) {
      positionNonce = m.nonce;
      if (m.position) userScrolled = true;
      pendingHighlight = null;
      if (stopTracking) stopTracking();
      stopTracking = positionModule.trackReadingPosition(document.body, document.scrollingElement, m.position, report);
      // A concealed iframe may not receive animation frames; acknowledge the synchronous jump.
      send({ type: "positionRestored", nonce: positionNonce, url: here() });
    }
    if (m.type === "highlights") {
      currentList = m.list || [];
      var delay = document.readyState === "complete" ? 0 : 800;
      setTimeout(function () { applyHighlights(currentList); }, delay);
    }
    if (m.type === "scrollTo") {
      userScrolled = true;
      if (stopTracking) stopTracking();
      stopTracking = positionModule.trackReadingPosition(document.body, document.scrollingElement, undefined, report);
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
  // Sites that route in the page change what is shown without loading a document. Positions
  // and highlights from the previous route must not follow it, and the app must know.
  var lastPage = here();
  function checkPage() {
    var now = here();
    if (pagesModule.samePage(now, lastPage)) return;
    lastPage = now;
    if (stopTracking) stopTracking();
    stopTracking = positionModule.trackReadingPosition(document.body, document.scrollingElement, undefined, report);
    highlightWatcher.render();
    send({ type: "navigated", url: now });
  }
  ["pushState", "replaceState"].forEach(function (name) {
    var original = history[name];
    history[name] = function () { var result = original.apply(this, arguments); setTimeout(checkPage, 0); return result; };
  });
  window.addEventListener("popstate", checkPage);
  setInterval(checkPage, 1000);

  window.addEventListener("load", function () { jumpToHash(); send({ type: "ready", url: here() }); });
  send({ type: "ready", url: here() });
})();
