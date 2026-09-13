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
