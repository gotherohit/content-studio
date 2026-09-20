import test from "node:test";
import assert from "node:assert/strict";
import { clampPage, fitScale, highlightsOnPage, layoutPages, offsetOf, pageAt, pageOf, stepZoom, visiblePages, PAGE_GAP } from "../client/src/pdf.ts";

const sizes = Array.from({ length: 6 }, () => ({ width: 612, height: 792 }));

test("pages are laid out one after another with a gap", () => {
  const l = layoutPages(sizes, 1, 10);
  assert.equal(l.tops[0], 10);
  assert.equal(l.tops[1], 10 + 792 + 10);
  assert.equal(l.heights[3], 792);
  assert.equal(l.total, 10 + 6 * (792 + 10));
});

test("fit width fills the pane, fit page keeps the whole page", () => {
  const box = { width: 1000, height: 500 };
  assert.equal(fitScale(sizes[0], box, "width", 0), 1000 / 612);
  assert.equal(fitScale(sizes[0], box, "page", 0), 500 / 792);
});

test("the current page is the one under the top third", () => {
  const l = layoutPages(sizes, 1, 10);
  assert.equal(pageAt(l, 0, 800), 0);
  // Just before the second page reaches the mark, page one is still the answer.
  assert.equal(pageAt(l, l.tops[1] - 800 * 0.3 - 1, 800), 0);
  assert.equal(pageAt(l, l.tops[1] - 800 * 0.3, 800), 1);
  assert.equal(pageAt(l, l.total, 800), 5);
});

test("the last page reports itself once the scroller is at the bottom", () => {
  const l = layoutPages(sizes, 1, 10);
  const view = 800;
  // The last page cannot reach the top third, so the top-third rule alone would answer 4.
  const bottom = l.total - view;
  assert.equal(pageAt(l, bottom, view), 5);
  assert.equal(pageAt(l, bottom - 300, view), 4);
});

test("only pages near the viewport are rendered", () => {
  const l = layoutPages(sizes, 1, 10);
  const r = visiblePages(l, l.tops[3], 400, 1);
  assert.deepEqual(r, { start: 2, end: 4 });
  assert.deepEqual(visiblePages(l, 0, 400, 0), { start: 0, end: 0 });
  // A pane straddling the gap renders the page either side of it.
  assert.deepEqual(visiblePages(l, l.tops[2] - 15, 20, 0), { start: 1, end: 2 });
  assert.deepEqual(visiblePages(layoutPages([], 1), 0, 400), { start: 0, end: -1 });
});

test("scrolling to a page puts it at the top, and never past the ends", () => {
  const l = layoutPages(sizes, 1, PAGE_GAP);
  assert.equal(offsetOf(l, 0), 0);
  assert.equal(offsetOf(l, 2), l.tops[2] - PAGE_GAP);
  assert.equal(offsetOf(l, 99), l.tops[5] - PAGE_GAP);
  assert.equal(offsetOf(l, -3), 0);
});

test("a page number is clamped to the document", () => {
  assert.equal(clampPage(-1, 6), 0);
  assert.equal(clampPage(9, 6), 5);
  assert.equal(clampPage(NaN, 6), 0);
  assert.equal(clampPage(2, 0), 0);
});

test("zoom steps are symmetrical", () => {
  assert.equal(stepZoom(1, 1), 1.25);
  assert.equal(stepZoom(1.25, -1), 1);
  assert.equal(stepZoom(4, 1), 4);
  assert.equal(stepZoom(0.5, -1), 0.5);
});

test("a highlight belongs to the page it was made on", () => {
  const hs = [{ id: "a", page: 1 }, { id: "b", page: 3 }, { id: "c", page: 3 }, { id: "d" }];
  assert.equal(pageOf({ page: 1 }), 0);
  assert.equal(pageOf({ page: 4 }), 3);
  // One saved before pages were recorded, or with nonsense in it, belongs to the first page.
  assert.equal(pageOf({}), 0);
  assert.equal(pageOf({ page: 0 }), 0);
  assert.deepEqual(highlightsOnPage(hs, 0).map((h) => h.id), ["a", "d"]);
  assert.deepEqual(highlightsOnPage(hs, 2).map((h) => h.id), ["b", "c"]);
  assert.deepEqual(highlightsOnPage(hs, 1), []);
});
