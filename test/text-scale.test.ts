import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_TEXT_SCALE, MAX_TEXT_SCALE, MIN_TEXT_SCALE, pageZoom, stepTextScale, toPane } from "../client/src/textScale.ts";

test("at the toolbar's starting size a live page is shown exactly as the site made it", () => {
  assert.equal(pageZoom(DEFAULT_TEXT_SCALE), 1);
});

test("each step zooms the live page in proportion to Reader's text", () => {
  assert.equal(pageZoom(1.26), 1.2);
  assert.equal(pageZoom(MAX_TEXT_SCALE), 1.71);
  assert.equal(pageZoom(MIN_TEXT_SCALE), 0.76);
  assert.ok(pageZoom(1.15) > 1 && pageZoom(0.95) < 1);
});

test("a stored size that is out of range or unreadable cannot zoom the page absurdly", () => {
  assert.equal(pageZoom(9), pageZoom(MAX_TEXT_SCALE));
  assert.equal(pageZoom(0.1), pageZoom(MIN_TEXT_SCALE));
  assert.equal(pageZoom(Number.NaN), 1);
});

test("the toolbar steps by tenths and stops at its ends", () => {
  assert.equal(stepTextScale(1.05, 1), 1.15);
  assert.equal(stepTextScale(1.05, -1), 0.95);
  assert.equal(stepTextScale(MAX_TEXT_SCALE, 1), MAX_TEXT_SCALE);
  assert.equal(stepTextScale(MIN_TEXT_SCALE, -1), MIN_TEXT_SCALE);
});

test("what a zoomed page reports is scaled into the pane, so a note card opens beside the words", () => {
  const selection = { left: 100, top: 40, width: 200, height: 20, bottom: 60 };
  assert.deepEqual(toPane(selection, 1), selection);
  assert.deepEqual(toPane(selection, 1.5), { left: 150, top: 60, width: 300, height: 30, bottom: 90 });
});

test("the live page is zoomed with CSS zoom on its frame, so its text is drawn at the larger size", async () => {
  const { readFile } = await import("node:fs/promises");
  const view = await readFile(new URL("../client/src/components/OriginalView.tsx", import.meta.url), "utf8");
  // A transform stretched a page drawn at its normal size: the page reported a device pixel
  // ratio of 1 under a 1.29 zoom, and on screen its text came out soft.
  assert.doesNotMatch(view, /transform:\s*`scale\(/, "the frame must not be stretched with a transform");
  assert.match(view, /\{ zoom \}/, "the frame is given CSS zoom, which the page receives as its own zoom");
});
