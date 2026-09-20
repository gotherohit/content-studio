/* Runs inside the framed copy of an article. Talks to the app through postMessage. */
(async function () {
  var scriptUrl = document.currentScript.src;
  var positionModule = await import(new URL("./reading-position.js", scriptUrl).href);
  var highlightsModule = await import(new URL("./highlights.js", scriptUrl).href);
  var pagesModule = await import(new URL("./pages.js", scriptUrl).href);
  var geomModule = await import(new URL("./shapes-geom.js", scriptUrl).href);
  var shapesDomModule = await import(new URL("./shapes-dom.js", scriptUrl).href);
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
  // ---- shapes drawn over the page
  //
  // A shape belongs to the paragraph or picture it was drawn over, so it is kept as fractions
  // of that element and placed again whenever the page reflows. The overlay sits in document
  // coordinates and never takes the pointer, except the note markers and the shapes' own
  // strokes, or the article underneath would stop being clickable.
  var SHAPE_COLOURS = { yellow: "#e0b528", green: "#2fae51", pink: "#dd5f92", blue: "#3d84dd" };
  var SVG_NS = "http://www.w3.org/2000/svg";
  var shapeRoot = null;
  var shapeList = [];
  var showNotes = true;
  var drawTool = null;
  var drawColour = "yellow";
  var drawLayer = null;
  var placeTimer = null;
  var shapeWatcher = null;

  function ensureShapeRoot() {
    if (shapeRoot && shapeRoot.isConnected) return shapeRoot;
    shapeRoot = document.createElement("div");
    shapeRoot.className = "rs-shapes";
    shapeRoot.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:2147483000";
    document.body.appendChild(shapeRoot);
    return shapeRoot;
  }

  function shapeSvg(h, size) {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", String(size.width));
    svg.setAttribute("height", String(size.height));
    svg.style.cssText = "position:absolute;left:0;top:0;overflow:visible;pointer-events:none";
    var colour = SHAPE_COLOURS[h.color] || SHAPE_COLOURS.yellow;
    var node;
    if (h.shape.kind === "arrow") {
      node = document.createElementNS(SVG_NS, "g");
      var line = geomModule.arrowLine(h.shape, size);
      var seg = document.createElementNS(SVG_NS, "line");
      seg.setAttribute("x1", String(line.x1)); seg.setAttribute("y1", String(line.y1));
      seg.setAttribute("x2", String(line.x2)); seg.setAttribute("y2", String(line.y2));
      var head = document.createElementNS(SVG_NS, "polyline");
      head.setAttribute("points", geomModule.arrowHead(h.shape, size).map(function (p) { return p.x + "," + p.y; }).join(" "));
      node.appendChild(seg); node.appendChild(head);
    } else if (h.shape.kind === "oval") {
      var box = geomModule.toBox(h.shape, size);
      node = document.createElementNS(SVG_NS, "ellipse");
      node.setAttribute("cx", String(box.left + box.width / 2));
      node.setAttribute("cy", String(box.top + box.height / 2));
      node.setAttribute("rx", String(Math.max(1, box.width / 2)));
      node.setAttribute("ry", String(Math.max(1, box.height / 2)));
    } else {
      var rect = geomModule.toBox(h.shape, size);
      node = document.createElementNS(SVG_NS, "rect");
      node.setAttribute("x", String(rect.left)); node.setAttribute("y", String(rect.top));
      node.setAttribute("width", String(Math.max(1, rect.width))); node.setAttribute("height", String(Math.max(1, rect.height)));
      node.setAttribute("rx", "3");
    }
    node.style.cssText = "fill:none;stroke:" + colour + ";stroke-width:2.5px;stroke-linecap:round;stroke-linejoin:round;pointer-events:stroke;cursor:pointer";
    node.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); send({ type: "hlclick", id: h.id }); });
    svg.appendChild(node);
    return svg;
  }

  function shapeNote(h, size) {
    var spot = geomModule.badgeAt(h.shape, size);
    var dot = document.createElement("button");
    dot.type = "button";
    dot.title = h.comment;
    dot.style.cssText = "all:unset;position:absolute;left:" + spot.x + "px;top:" + spot.y + "px;transform:translate(-40%,-55%);" +
      "width:18px;height:18px;border-radius:50%;background:#fff;border:1px solid " + (SHAPE_COLOURS[h.color] || SHAPE_COLOURS.yellow) + ";" +
      "box-shadow:0 1px 3px rgba(0,0,0,.35);pointer-events:auto;cursor:pointer;display:flex;align-items:center;justify-content:center;" +
      "font:600 11px system-ui,sans-serif;color:#333";
    dot.textContent = "i";
    dot.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); send({ type: "hlclick", id: h.id }); });
    return dot;
  }

  function placeShapes() {
    var root = ensureShapeRoot();
    if (shapeWatcher) shapeWatcher.disconnect();
    root.textContent = "";
    var list = onHome() ? shapeList : [];
    var docX = window.scrollX || 0, docY = window.scrollY || 0;
    list.forEach(function (h) {
      var host = shapesDomModule.hostFor(document.body, h);
      if (!host) return;
      var r = host.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var size = { width: r.width, height: r.height };
      var wrap = document.createElement("div");
      wrap.style.cssText = "position:absolute;pointer-events:none;left:" + (r.left + docX) + "px;top:" + (r.top + docY) +
        "px;width:" + r.width + "px;height:" + r.height + "px";
      wrap.appendChild(shapeSvg(h, size));
      if (showNotes && h.comment && h.comment.trim()) wrap.appendChild(shapeNote(h, size));
      root.appendChild(wrap);
    });
    if (shapeWatcher) watchShapes();
  }

  function schedulePlace() { clearTimeout(placeTimer); placeTimer = setTimeout(placeShapes, 60); }

  function watchShapes() {
    shapeWatcher.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "hidden"] });
  }

  function setDraw(tool, colour) {
    drawTool = tool || null;
    if (colour) drawColour = colour;
    if (!drawTool) {
      if (drawLayer) { drawLayer.remove(); drawLayer = null; }
      return;
    }
    if (drawLayer) return;
    drawLayer = document.createElement("div");
    drawLayer.className = "rs-shapes";
    drawLayer.style.cssText = "position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483001;cursor:crosshair;background:transparent";
    var start = null, band = null;
    drawLayer.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      drawLayer.setPointerCapture(e.pointerId);
      start = { x: e.clientX, y: e.clientY };
      band = document.createElement("div");
      band.style.cssText = "position:fixed;pointer-events:none;border:2px dashed " + (SHAPE_COLOURS[drawColour] || SHAPE_COLOURS.yellow) +
        ";border-radius:" + (drawTool === "oval" ? "50%" : "3px");
      drawLayer.appendChild(band);
    });
    drawLayer.addEventListener("pointermove", function (e) {
      if (!start || !band) return;
      band.style.left = Math.min(start.x, e.clientX) + "px";
      band.style.top = Math.min(start.y, e.clientY) + "px";
      band.style.width = Math.abs(e.clientX - start.x) + "px";
      band.style.height = Math.abs(e.clientY - start.y) + "px";
    });
    drawLayer.addEventListener("pointerup", function (e) {
      if (!start) return;
      var from = start, to = { x: e.clientX, y: e.clientY };
      start = null;
      if (band) { band.remove(); band = null; }
      finishDraw(from, to);
    });
    document.body.appendChild(drawLayer);
  }

  function finishDraw(from, to) {
    var found = shapesDomModule.anchorAt(document, document.body, from.x, from.y);
    if (!found) return;
    var r = found.host.getBoundingClientRect();
    var shape = geomModule.fromDrag(drawTool, { x: from.x - r.left, y: from.y - r.top }, { x: to.x - r.left, y: to.y - r.top }, r);
    if (!shape) return;
    send({
      type: "shapeDrawn", shape: shape, anchor: found.anchor, onImage: found.onImage,
      rect: {
        left: Math.min(from.x, to.x), top: Math.min(from.y, to.y),
        width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y), bottom: Math.max(from.y, to.y),
      },
    });
  }

  shapeWatcher = new MutationObserver(schedulePlace);
  watchShapes();
  window.addEventListener("resize", schedulePlace);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedulePlace);

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
    if (m.type === "home") { home = m.url; highlightWatcher.render(); schedulePlace(); }
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
      var all = m.list || [];
      // Marks go over text; shapes are drawn on top of it, so each half goes its own way.
      currentList = all.filter(function (h) { return !h.shape; });
      shapeList = all.filter(function (h) { return h.shape; });
      var delay = document.readyState === "complete" ? 0 : 800;
      setTimeout(function () { applyHighlights(currentList); placeShapes(); }, delay);
    }
    if (m.type === "notes") { showNotes = m.show !== false; schedulePlace(); }
    if (m.type === "draw") setDraw(m.tool, m.color);
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
    schedulePlace();
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
