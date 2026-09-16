import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { captureReadingPosition, restoreReadingPosition, trackReadingPosition } from "../server/public/reading-position.js";

function fixture(t, documentScroll = false) {
  const dom = new JSDOM("<!doctype html><body><main><p>First passage</p><p>Second passage</p></main></body>");
  const doc = dom.window.document;
  const root = doc.querySelector("main");
  const scroller = documentScroll ? doc.documentElement : root;
  Object.defineProperty(doc, "scrollingElement", { value: doc.documentElement });
  Object.defineProperty(scroller, "clientHeight", { value: 500 });
  const top = documentScroll ? 0 : 50;
  scroller.getBoundingClientRect = () => ({ top, height: 500 });
  const geometry = [{ y: 0, height: 200 }, { y: 440, height: 200 }];
  [...root.children].forEach((el, i) => {
    el.getBoundingClientRect = () => ({ top: top + geometry[i].y - scroller.scrollTop, bottom: top + geometry[i].y - scroller.scrollTop + geometry[i].height, height: geometry[i].height });
  });
  const jumps = [];
  scroller.scrollTo = (options) => {
    jumps.push(options);
    scroller.scrollTop = options.top;
    scroller.scrollLeft = options.left;
  };
  const previous = {};
  const frames = new Map();
  let id = 0;
  const globals = {
    requestAnimationFrame: (callback) => { frames.set(++id, callback); return id; },
    cancelAnimationFrame: (key) => frames.delete(key),
    ResizeObserver: class { observe() {} disconnect() {} },
    MutationObserver: dom.window.MutationObserver,
  };
  for (const [key, value] of Object.entries(globals)) { previous[key] = globalThis[key]; globalThis[key] = value; }
  const cleanups = [];
  t.after(() => { cleanups.forEach((cleanup) => cleanup()); dom.window.close(); for (const key of Object.keys(globals)) { if (previous[key] === undefined) delete globalThis[key]; else globalThis[key] = previous[key]; } });
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback()); };
  return { dom, doc, root, scroller, geometry, jumps, flush, cleanups };
}

/**
 * An article with page chrome. `layout` maps a selector to its geometry; `fixed` elements
 * stay put while the pane scrolls, like a site header or a sticky contents list.
 */
function article(t, html, layout) {
  const dom = new JSDOM(`<!doctype html><body><main>${html}</main></body>`);
  const doc = dom.window.document;
  const root = doc.querySelector("main");
  Object.defineProperty(doc, "scrollingElement", { value: doc.documentElement });
  Object.defineProperty(root, "clientHeight", { value: 500 });
  const top = 50;
  root.getBoundingClientRect = () => ({ top, height: 500 });
  for (const [selector, box] of Object.entries(layout)) {
    const el = doc.querySelector(selector);
    el.getBoundingClientRect = () => {
      const at = top + box.y - (box.fixed ? 0 : root.scrollTop);
      return { top: at, bottom: at + box.height, height: box.height };
    };
  }
  root.scrollTo = (options) => { root.scrollTop = options.top; root.scrollLeft = options.left; };
  t.after(() => dom.window.close());
  return { doc, root, scroller: root };
}

test("page chrome that stays in view is never chosen as the anchor", (t) => {
  const { root, scroller } = article(t,
    `<nav style="position: fixed"><ul><li id="chrome">Research</li></ul></nav><p id="a">First passage</p><p id="b">Second passage</p>`,
    { "#chrome": { y: 0, height: 20, fixed: true }, "#a": { y: 0, height: 200 }, "#b": { y: 440, height: 200 } });
  scroller.scrollTop = 500;
  const saved = captureReadingPosition(root, scroller);
  assert.equal(saved.text, "Second passage");
  assert.equal(saved.occurrence, 0);
});

test("an older capture anchored on page chrome returns to its saved place, not wherever the page is", (t) => {
  const { root, scroller } = article(t,
    `<nav style="position: sticky"><ul><li id="chrome">Research</li></ul></nav><p id="a">First passage</p>`,
    { "#chrome": { y: 0, height: 20, fixed: true }, "#a": { y: 0, height: 2000 } });
  scroller.scrollTop = 100;
  restoreReadingPosition(root, scroller, { x: 0, y: 640, anchor: 0, text: "Research", offset: -1.1 });
  assert.equal(scroller.scrollTop, 640);
});

test("an anchor without text returns to its saved place, not the first empty element", (t) => {
  const { root, scroller } = article(t,
    `<p id="empty"></p><p id="a">First passage</p>`,
    { "#empty": { y: 0, height: 30 }, "#a": { y: 30, height: 2000 } });
  scroller.scrollTop = 0;
  restoreReadingPosition(root, scroller, { x: 0, y: 700, anchor: 5, text: "", offset: 0.2 });
  assert.equal(scroller.scrollTop, 700);
});

test("a repeated heading returns to the copy that was read, not a hidden contents entry", (t) => {
  const { doc, root, scroller } = article(t,
    `<ul><li id="toc">Illicit distillation</li></ul><h2 id="heading">Illicit distillation</h2><p id="body">Body text</p>`,
    { "#toc": { y: 0, height: 0 }, "#heading": { y: 900, height: 40 }, "#body": { y: 940, height: 600 } });
  scroller.scrollTop = 890;
  const saved = captureReadingPosition(root, scroller);
  assert.equal(saved.text, "Illicit distillation");
  assert.equal(saved.occurrence, 1);

  // The page gains content above, so the recorded index now points elsewhere.
  const intro = doc.createElement("p");
  intro.textContent = "An introduction added later";
  intro.getBoundingClientRect = () => ({ top: 50 - root.scrollTop, bottom: 250 - root.scrollTop, height: 200 });
  root.prepend(intro);
  scroller.scrollTop = 0;
  restoreReadingPosition(root, scroller, saved);
  assert.equal(scroller.scrollTop, 890);

  // An older capture with no occurrence still finds the only visible copy.
  scroller.scrollTop = 0;
  restoreReadingPosition(root, scroller, { x: 0, y: 5, anchor: 0, text: "Illicit distillation", offset: saved.offset });
  assert.equal(scroller.scrollTop, 890);
});

test("a heading is still found when a narrower pane changes how many copies of it the page has", (t) => {
  const { root, scroller } = article(t,
    `<h2 id="heading">GTG-15001: Deceptive dating app network</h2><p id="body">Body text</p>`,
    { "#heading": { y: 1200, height: 40 }, "#body": { y: 1240, height: 600 } });
  // Captured in a wide pane, where a contents list put another copy of the heading first.
  const saved = { x: 0, y: 900, anchor: 3, text: "GTG-15001: Deceptive dating app network", occurrence: 1, offset: 0 };
  scroller.scrollTop = 0;
  restoreReadingPosition(root, scroller, saved);
  assert.equal(scroller.scrollTop, 1200);
});

test("a passage retains its relative place when a narrower pane reflows it", (t) => {
  const { root, scroller, geometry, jumps } = fixture(t);
  scroller.scrollTop = 500;
  scroller.scrollLeft = 12;
  const saved = captureReadingPosition(root, scroller);
  geometry[1] = { y: 650, height: 300 };
  restoreReadingPosition(root, scroller, saved);
  assert.equal(scroller.scrollTop, 740);
  assert.equal(scroller.scrollLeft, 12);
  assert.equal(jumps.at(-1).behavior, "instant");
});

test("a beat captured at the beginning returns to the beginning", (t) => {
  const { root, scroller } = fixture(t);
  const saved = captureReadingPosition(root, scroller);
  scroller.scrollTop = 500;
  restoreReadingPosition(root, scroller, saved);
  assert.equal(scroller.scrollTop, 0);
});

test("Original pages report document scroll events, independently of element scrolling", (t) => {
  const { root, scroller, doc, dom, flush, cleanups } = fixture(t, true);
  const reports = [];
  const stop = trackReadingPosition(root, scroller, undefined, (position) => reports.push(position));
  cleanups.push(stop);
  scroller.scrollTop = 500;
  doc.dispatchEvent(new dom.window.Event("scroll"));
  flush();
  assert.equal(reports.at(-1).y, 500);
});

test("user scrolling takes over after a restore, and an obsolete tracker stops reporting", (t) => {
  const { root, scroller, doc, dom, flush, cleanups } = fixture(t);
  const reports = [];
  const stop = trackReadingPosition(root, scroller, { x: 0, y: 500 }, (position) => reports.push(position));
  cleanups.push(stop);
  assert.equal(scroller.scrollTop, 500);
  doc.dispatchEvent(new dom.window.Event("wheel"));
  scroller.scrollTop = 700;
  scroller.dispatchEvent(new dom.window.Event("scroll"));
  flush();
  assert.equal(reports.at(-1).y, 700);
  stop();
  const count = reports.length;
  scroller.scrollTop = 900;
  scroller.dispatchEvent(new dom.window.Event("scroll"));
  flush();
  assert.equal(reports.length, count);
});
