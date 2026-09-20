import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isPageScroll, pageScrolls } from '../server/public/scrolls.js';

function page(t) {
  const dom = new JSDOM('<body><div id="carousel"><div style="height:400px"></div></div></body>');
  t.after(() => dom.window.close());
  return dom.window;
}

test('a box inside the page scrolling is not the page scrolling', (t) => {
  const win = page(t);
  const doc = win.document;
  assert.equal(isPageScroll(doc.getElementById('carousel'), doc), false);
  assert.equal(isPageScroll(doc, doc), true);
  assert.equal(isPageScroll(doc.documentElement, doc), true);
  assert.equal(isPageScroll(win, doc), true);
});

test('only a scroll that moves the page is reported', (t) => {
  const win = page(t);
  const doc = win.document;
  const moved = pageScrolls(win);

  // A carousel, a sticky column, a lazy image: all of these reach a capture listener, and
  // closing the note card on them threw away a half-typed comment.
  win.scrollY = 400;
  assert.equal(moved(doc.getElementById('carousel')), false);

  assert.equal(moved(doc), true, 'the page really did move');
  assert.equal(moved(doc), false, 'and it has not moved again since');

  win.scrollY = 460;
  assert.equal(moved(doc), true);
});
